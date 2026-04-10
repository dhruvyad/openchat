import WebSocket from 'ws';
import {
    generateKeypair,
    makeEnvelope,
    toBase64Url,
    verifyEnvelope,
    type Envelope,
    type JoinPayload,
    type LeavePayload,
    type SendPayload,
    type ServerEvent,
} from '@dhruvy/openchat-sdk';

export interface ClientOptions {
    relayUrl: string;
    room: string;
    displayName?: string;
    description?: string;
    onMessage?: (event: Extract<ServerEvent, { type: 'message' }>) => void;
    onAgentsChanged?: (
        event: Extract<ServerEvent, { type: 'agents_changed' }>
    ) => void;
    onError?: (reason: string) => void;
}

export class Client {
    private ws: WebSocket;
    private privateKey: Uint8Array;
    private publicKey: Uint8Array;
    private joined = false;
    private joinResolve?: () => void;
    private joinReject?: (err: Error) => void;

    constructor(private opts: ClientOptions) {
        const kp = generateKeypair();
        this.privateKey = kp.privateKey;
        this.publicKey = kp.publicKey;

        const baseUrl = opts.relayUrl.replace(/\/+$/, '');
        const url = `${baseUrl}/v1/room/${encodeURIComponent(opts.room)}`;
        this.ws = new WebSocket(url);
        this.ws.on('message', (data) => this.handleServerEvent(data.toString()));
        this.ws.on('error', (err) => {
            this.joinReject?.(err);
            this.opts.onError?.(err.message);
        });
        this.ws.on('close', () => {
            if (!this.joined) {
                this.joinReject?.(
                    new Error('connection closed before join completed')
                );
            }
        });
    }

    connect(): Promise<void> {
        if (this.joined) return Promise.resolve();
        return new Promise((resolve, reject) => {
            this.joinResolve = resolve;
            this.joinReject = reject;
        });
    }

    private handleServerEvent(raw: string) {
        let event: ServerEvent;
        try {
            event = JSON.parse(raw) as ServerEvent;
        } catch {
            return;
        }

        switch (event.type) {
            case 'challenge':
                this.sendJoin(event.nonce);
                return;
            case 'joined':
                this.joined = true;
                this.joinResolve?.();
                return;
            case 'message':
                if (!this.verifyForwardedMessage(event)) {
                    this.opts.onError?.(
                        'dropped message with invalid forwarded signature'
                    );
                    return;
                }
                this.opts.onMessage?.(event);
                return;
            case 'agents_changed':
                this.opts.onAgentsChanged?.(event);
                return;
            case 'error':
                this.opts.onError?.(event.reason);
                if (!this.joined) {
                    this.joinReject?.(new Error(event.reason));
                }
                return;
        }
    }

    private verifyForwardedMessage(
        event: Extract<ServerEvent, { type: 'message' }>
    ): boolean {
        // Reconstruct the original signed envelope and verify end-to-end.
        // The relay forwarded it without modification.
        const envelope: Envelope<SendPayload> = {
            type: 'send',
            id: event.message_id,
            ts: event.ts,
            from: event.from,
            sig: event.sig,
            payload: {
                topic: event.topic,
                body: event.body,
            },
        };
        return verifyEnvelope(envelope);
    }

    private sendJoin(nonce: string) {
        const payload: JoinPayload = {
            nonce,
            display_name: this.opts.displayName,
            description: this.opts.description,
            features: ['openchat/1'],
        };
        const envelope = makeEnvelope(
            'join',
            payload,
            this.privateKey,
            this.publicKey
        );
        this.ws.send(JSON.stringify(envelope));
    }

    send(body: string, topic = 'main') {
        const payload: SendPayload = { topic, body };
        const envelope = makeEnvelope(
            'send',
            payload,
            this.privateKey,
            this.publicKey
        );
        this.ws.send(JSON.stringify(envelope));
    }

    leave() {
        if (this.ws.readyState === WebSocket.OPEN) {
            const envelope = makeEnvelope<LeavePayload>(
                'leave',
                {},
                this.privateKey,
                this.publicKey
            );
            this.ws.send(JSON.stringify(envelope));
        }
        this.ws.close();
    }

    get sessionPubkey(): string {
        return toBase64Url(this.publicKey);
    }
}
