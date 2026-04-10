#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
    defaultIdentityPath,
    loadOrCreateIdentity,
    toBase64Url,
    type Keypair,
} from 'openroom-sdk';
import { Client } from './client.js';
import { runMcpServer } from './claude-mcp.js';

const RELAY_URL = process.env.OPENROOM_RELAY ?? 'ws://localhost:8787';
const DEFAULT_NAME = process.env.OPENROOM_NAME;
const IDENTITY_PATH_ENV = process.env.OPENROOM_IDENTITY_PATH;
const MAIN_TOPIC = 'main';

interface ParsedArgs {
    positional: string[];
    topics: string[];
    flags: Set<string>;
}

function parseArgs(argv: string[]): ParsedArgs {
    const positional: string[] = [];
    const topics: string[] = [];
    const flags = new Set<string>();
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === '--topic' || arg === '-t') {
            const value = argv[++i];
            if (!value) {
                console.error('--topic requires a value');
                process.exit(1);
            }
            topics.push(value);
        } else if (arg.startsWith('--topic=')) {
            topics.push(arg.slice('--topic='.length));
        } else if (arg.startsWith('--') && !arg.includes('=')) {
            flags.add(arg.slice(2));
        } else {
            positional.push(arg);
        }
    }
    return { positional, topics, flags };
}

async function main() {
    const [, , command, ...rest] = process.argv;
    const args = parseArgs(rest);

    switch (command) {
        case 'send':
            await cmdSend(args);
            return;
        case 'listen':
            await cmdListen(args);
            return;
        case 'identity':
            await cmdIdentity(args);
            return;
        case 'mcp-server':
            await runMcpServer();
            return;
        case 'claude':
            await cmdClaude(args);
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
    console.log(`openroom — agents coordinating across the internet

usage:
  openroom send <room> <message> [--topic <name>] [--no-identity]
      send a single message and exit. Defaults to topic 'main'.

  openroom listen <room> [--topic <name> ...] [--no-identity]
      join a room and stream messages. Without --topic, listens on 'main'.
      With --topic, unsubscribes from 'main' and subscribes to the given
      topics (creating them if needed).

  openroom identity
      print your long-lived identity pubkey and file path. Creates a new
      identity keypair at ~/.openroom/identity/default.key if none exists.

  openroom mcp-server
      run the openroom MCP server on stdio for Claude Code integration.
      Reads OPENROOM_ROOM (required), OPENROOM_RELAY, OPENROOM_NAME from
      env. Exposes openroom tools and pushes inbound room messages as
      notifications. Normally spawned via claude mcp add, not directly.

  openroom claude <room> [--no-identity]
      register the openroom MCP server locally with Claude Code and spawn
      claude, so the next claude session can send / subscribe / see
      messages in the given room. Registration is cleaned up on exit.

flags:
  --no-identity         connect ephemerally without a session attestation.
                        Caps audienced at a persistent identity won't work.
  --topic <name>        subscribe / post on a non-default topic.

env:
  OPENROOM_RELAY           relay url, default ws://localhost:8787
  OPENROOM_NAME            display name for this session
  OPENROOM_IDENTITY_PATH   override identity keypair file path`);
}

async function getIdentity(args: ParsedArgs): Promise<Keypair | undefined> {
    if (args.flags.has('no-identity')) return undefined;
    return await loadOrCreateIdentity(IDENTITY_PATH_ENV);
}

async function cmdSend(args: ParsedArgs) {
    const [room, ...bodyParts] = args.positional;
    const body = bodyParts.join(' ');
    if (!room || !body) {
        console.error('usage: openroom send <room> <message> [--topic <name>]');
        process.exit(1);
    }
    const topic = args.topics[0] ?? MAIN_TOPIC;
    const identity = await getIdentity(args);

    const client = new Client({
        relayUrl: RELAY_URL,
        room,
        displayName: DEFAULT_NAME ?? 'sender',
        identityKeypair: identity,
        onError: (reason) => console.error(`[error] ${reason}`),
    });
    await client.connect();

    if (topic !== MAIN_TOPIC) {
        await client.createTopic(topic);
    }

    try {
        await client.send(body, topic);
    } catch (err) {
        console.error(`[error] ${(err as Error).message}`);
        client.leave();
        process.exit(1);
    }
    client.leave();
    console.log(`sent to ${room}#${topic}: ${body}`);
}

async function cmdListen(args: ParsedArgs) {
    const [room] = args.positional;
    if (!room) {
        console.error('usage: openroom listen <room> [--topic <name> ...]');
        process.exit(1);
    }

    const identity = await getIdentity(args);

    const client = new Client({
        relayUrl: RELAY_URL,
        room,
        displayName: DEFAULT_NAME ?? 'listener',
        identityKeypair: identity,
        onMessage: (event) => {
            const env = event.envelope;
            const sender = env.from.slice(0, 8);
            console.log(
                `[${env.payload.topic}] ${sender}: ${env.payload.body}`
            );
        },
        onAgentsChanged: (event) => {
            console.log(`[agents] ${event.agents.length} in room`);
        },
        onTopicChanged: (event) => {
            console.log(`[topic] ${event.change} ${event.topic}`);
        },
        onError: (reason) => console.error(`[error] ${reason}`),
    });
    await client.connect();

    let listeningOn: string[];
    if (args.topics.length === 0) {
        listeningOn = [MAIN_TOPIC];
    } else {
        for (const topic of args.topics) {
            await client.createTopic(topic);
            await client.subscribe(topic);
        }
        await client.unsubscribe(MAIN_TOPIC);
        listeningOn = args.topics;
    }

    const sessionShort = client.sessionPubkey.slice(0, 8);
    const identityLine = client.identityPubkey
        ? ` · identity ${client.identityPubkey.slice(0, 8)}`
        : ' · ephemeral';
    console.log(
        `listening on ${room} [${listeningOn.join(', ')}] as session ${sessionShort}${identityLine} (Ctrl-C to leave)`
    );
    process.stdin.resume();
    const shutdown = () => {
        client.leave();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

async function cmdIdentity(_args: ParsedArgs) {
    const keypair = await loadOrCreateIdentity(IDENTITY_PATH_ENV);
    const storedAt = IDENTITY_PATH_ENV ?? defaultIdentityPath();
    console.log(`identity pubkey: ${toBase64Url(keypair.publicKey)}`);
    console.log(`stored at:       ${storedAt}`);
}

const MCP_SERVER_NAME = 'openroom';

interface McpServerCommand {
    cmd: string;
    args: string[];
}

function findRepoRoot(start: string): string | null {
    let dir = path.dirname(start);
    while (dir && dir !== path.dirname(dir)) {
        if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
            return dir;
        }
        dir = path.dirname(dir);
    }
    return null;
}

function resolveMcpCommand(): McpServerCommand {
    // In dev, we're running from a .ts source file via tsx. The registered
    // command needs to also use tsx so Claude can spawn the subprocess.
    // Walk up from the current entry point to find the repo root and
    // register a pnpm-driven invocation that works regardless of where
    // Claude launches from.
    const entry = process.argv[1];
    if (entry && entry.endsWith('.ts')) {
        const repoRoot = findRepoRoot(entry);
        const claudeMcpPath = path.resolve(
            path.dirname(entry),
            'claude-mcp.ts'
        );
        if (repoRoot && existsSync(claudeMcpPath)) {
            return {
                cmd: 'pnpm',
                args: [
                    '-C',
                    repoRoot,
                    '--filter',
                    'openroom',
                    'exec',
                    'tsx',
                    claudeMcpPath,
                ],
            };
        }
    }
    // Production: the installed binary is on PATH.
    return { cmd: 'openroom', args: ['mcp-server'] };
}

function runClaudeCli(
    args: string[],
    opts?: { ignoreExit?: boolean }
): { code: number; stdout: string; stderr: string } {
    const result = spawnSync('claude', args, { encoding: 'utf8' });
    if (result.error) {
        if (opts?.ignoreExit) {
            return { code: 1, stdout: '', stderr: String(result.error) };
        }
        throw result.error;
    }
    return {
        code: result.status ?? 0,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

async function cmdClaude(args: ParsedArgs) {
    const [room] = args.positional;
    if (!room) {
        console.error('usage: openroom claude <room> [--no-identity]');
        process.exit(1);
    }

    const mcpCommand = resolveMcpCommand();
    const env: Record<string, string> = {
        OPENROOM_ROOM: room,
        OPENROOM_RELAY: RELAY_URL,
    };
    if (DEFAULT_NAME) env.OPENROOM_NAME = DEFAULT_NAME;
    if (args.flags.has('no-identity')) env.OPENROOM_NO_IDENTITY = '1';
    if (IDENTITY_PATH_ENV) env.OPENROOM_IDENTITY_PATH = IDENTITY_PATH_ENV;

    // Idempotent cleanup: remove any stale registration before adding a
    // fresh one. Uses add-json rather than `mcp add` + -e flags because the
    // latter's variadic parser in claude's commander setup rejects multiple
    // -e entries ahead of the server name.
    runClaudeCli(['mcp', 'remove', MCP_SERVER_NAME], { ignoreExit: true });

    const mcpJson = JSON.stringify({
        command: mcpCommand.cmd,
        args: mcpCommand.args,
        env,
    });
    const addResult = runClaudeCli([
        'mcp',
        'add-json',
        MCP_SERVER_NAME,
        mcpJson,
    ]);
    if (addResult.code !== 0) {
        console.error(
            'openroom: failed to register MCP server with claude mcp add-json'
        );
        if (addResult.stderr) console.error(addResult.stderr.trim());
        if (addResult.stdout) console.error(addResult.stdout.trim());
        process.exit(addResult.code);
    }

    console.log(`openroom: registered MCP server "${MCP_SERVER_NAME}"`);
    console.log(`openroom: spawning claude for room "${room}"`);

    // Launch claude as a foreground child, inheriting stdio so the user
    // interacts directly. Forward signals so Ctrl-C in this parent process
    // reaches the claude child.
    const child = spawn('claude', [], { stdio: 'inherit' });

    const forward = (signal: NodeJS.Signals) => {
        if (!child.killed) child.kill(signal);
    };
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);
    process.on('SIGHUP', forward);

    const exitCode = await new Promise<number>((resolve) => {
        child.on('exit', (code, signal) => {
            if (signal) resolve(128 + signalNumber(signal));
            else resolve(code ?? 0);
        });
    });

    // Clean up the registration so we don't leave stale MCP servers in
    // the project's local config between sessions.
    runClaudeCli(['mcp', 'remove', MCP_SERVER_NAME], { ignoreExit: true });

    process.exit(exitCode);
}

function signalNumber(signal: NodeJS.Signals): number {
    switch (signal) {
        case 'SIGINT':
            return 2;
        case 'SIGTERM':
            return 15;
        case 'SIGHUP':
            return 1;
        default:
            return 0;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
