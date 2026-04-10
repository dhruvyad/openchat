#!/usr/bin/env node
import { Client } from './client.js';

const RELAY_URL = process.env.OPENCHAT_RELAY ?? 'ws://localhost:8787';
const DEFAULT_NAME = process.env.OPENCHAT_NAME;

async function main() {
    const [, , command, ...args] = process.argv;

    switch (command) {
        case 'send':
            await cmdSend(args);
            return;
        case 'listen':
            await cmdListen(args);
            return;
        case undefined:
        case '--help':
        case '-h':
        case 'help':
            printUsage();
            return;
        default:
            console.error(`unknown command: ${command}`);
            printUsage();
            process.exit(1);
    }
}

function printUsage() {
    console.log(`openchat — agents coordinating across the internet

usage:
  openchat send <room> <message>    send a single message and exit
  openchat listen <room>            join a room and stream messages

env:
  OPENCHAT_RELAY   relay url, default ws://localhost:8787
  OPENCHAT_NAME    display name for this session`);
}

async function cmdSend(args: string[]) {
    const [room, ...rest] = args;
    const body = rest.join(' ');
    if (!room || !body) {
        console.error('usage: openchat send <room> <message>');
        process.exit(1);
    }
    const client = new Client({
        relayUrl: RELAY_URL,
        room,
        displayName: DEFAULT_NAME ?? 'sender',
        onError: (reason) => console.error(`[error] ${reason}`),
    });
    await client.connect();
    client.send(body);
    // Give the frame a tick to flush before closing.
    await new Promise((r) => setTimeout(r, 50));
    client.leave();
    console.log(`sent to ${room}: ${body}`);
}

async function cmdListen(args: string[]) {
    const [room] = args;
    if (!room) {
        console.error('usage: openchat listen <room>');
        process.exit(1);
    }
    const client = new Client({
        relayUrl: RELAY_URL,
        room,
        displayName: DEFAULT_NAME ?? 'listener',
        onMessage: (event) => {
            const sender = event.from.slice(0, 8);
            console.log(`[${event.topic}] ${sender}: ${event.body}`);
        },
        onAgentsChanged: (event) => {
            console.log(`[agents] ${event.agents.length} in room`);
        },
        onError: (reason) => console.error(`[error] ${reason}`),
    });
    await client.connect();
    console.log(
        `listening on ${room} as ${client.sessionPubkey.slice(0, 8)} (Ctrl-C to leave)`
    );
    process.stdin.resume();
    const shutdown = () => {
        client.leave();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
