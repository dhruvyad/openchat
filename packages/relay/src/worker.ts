// Cloudflare Worker entry point for the openroom relay.
//
// The Worker's fetch handler routes `/v1/room/<name>` WebSocket upgrade
// requests to a Durable Object instance named after the room. The DO runs
// one RelayCore per instance, which means one DO per room. Non-hibernating
// WebSockets for v1 — the DO stays warm while any connection is open.
// Hibernation is a future optimization.

import { randomNonce } from 'openroom-sdk';
import { RelayCore } from './room.js';

export interface Env {
    ROOM_DO: DurableObjectNamespace;
}

const ROOM_PATH_RE = /^\/v1\/room\/(.+)$/;

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        // Lightweight health endpoint so deploys can be smoke-tested
        // without speaking the full wire protocol.
        if (url.pathname === '/' || url.pathname === '/health') {
            return new Response(
                JSON.stringify({
                    service: 'openroom-relay',
                    protocol: 'openroom/1',
                    status: 'ok',
                }),
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }
            );
        }

        const match = url.pathname.match(ROOM_PATH_RE);
        if (!match) {
            return new Response('not found', { status: 404 });
        }
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('expected websocket upgrade', {
                status: 426,
            });
        }

        // Route to the DO instance named after the room. Any number of
        // concurrent agents joining the same room end up on the same DO.
        const roomName = decodeURIComponent(match[1]!);
        const id = env.ROOM_DO.idFromName(roomName);
        const stub = env.ROOM_DO.get(id);

        // Forward the original request (including the Upgrade header) to
        // the DO. The DO instance is responsible for accepting the ws.
        return stub.fetch(request);
    },
};

/**
 * Per-room Durable Object. Each room name maps to a unique DO via
 * `idFromName(roomName)`, so every connection for a given room lands on
 * the same instance and shares the in-memory RelayCore state.
 */
export class RoomDurableObject {
    private core = new RelayCore();
    private state: DurableObjectState;

    constructor(state: DurableObjectState, _env: Env) {
        this.state = state;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const match = url.pathname.match(ROOM_PATH_RE);
        if (!match) return new Response('not found', { status: 404 });
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('expected websocket upgrade', {
                status: 426,
            });
        }

        const roomName = decodeURIComponent(match[1]!);

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];

        server.accept();

        this.core.attach(server, roomName, randomNonce());

        server.addEventListener('message', (event) => {
            if (typeof event.data === 'string') {
                this.core.deliverMessage(server, event.data);
            }
            // Binary frames are not used by openroom/1. Drop silently.
        });

        const drop = () => this.core.detach(server);
        server.addEventListener('close', drop);
        server.addEventListener('error', drop);

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }
}
