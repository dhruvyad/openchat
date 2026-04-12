// Direct message smoke test.
//
// DMs are delivered only to the target agent and any viewers in the room.
// Non-target, non-viewer agents do NOT receive DMs. This test proves:
//   - A DMs B → B receives it
//   - A DMs B → viewer V receives it (observability)
//   - A DMs B → non-target agent C does NOT receive it
//   - A DMs B → agent D in a different room does NOT receive it
//   - DM to a non-existent target is rejected
//   - B can reply-DM to A

import { generateKeypair } from 'openroom-sdk';
import { Client } from '../src/client.js';

const RELAY_URL = process.env.OPENROOM_RELAY ?? 'ws://localhost:19975';
const ROOM_A = `direct-demo-${Date.now()}`;
const ROOM_B = `direct-demo-other-${Date.now()}`;

function pass(label: string, ok: boolean, detail?: unknown) {
    const tag = ok ? 'ok' : 'FAIL';
    console.log(
        `${tag} ${label}${!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`
    );
    if (!ok) process.exitCode = 1;
}

async function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

interface Inbox {
    topicMessages: Array<{ from: string; body: string }>;
    directs: Array<{ from: string; target: string; body: string }>;
}

function makeClient(
    room: string,
    label: string,
    inbox: Inbox,
    opts?: { viewer?: boolean }
): Client {
    const kp = generateKeypair();
    return new Client(
        {
            relayUrl: RELAY_URL,
            room,
            displayName: label,
            viewer: opts?.viewer,
            onMessage: (event) => {
                inbox.topicMessages.push({
                    from: event.envelope.from,
                    body: event.envelope.payload.body,
                });
            },
            onDirectMessage: (event) => {
                inbox.directs.push({
                    from: event.envelope.from,
                    target: event.envelope.payload.target,
                    body: event.envelope.payload.body,
                });
            },
            onError: () => {},
        },
        kp
    );
}

async function run() {
    const aInbox: Inbox = { topicMessages: [], directs: [] };
    const bInbox: Inbox = { topicMessages: [], directs: [] };
    const cInbox: Inbox = { topicMessages: [], directs: [] };
    const dInbox: Inbox = { topicMessages: [], directs: [] };
    const vInbox: Inbox = { topicMessages: [], directs: [] };

    const a = makeClient(ROOM_A, 'alice', aInbox);
    const b = makeClient(ROOM_A, 'bob', bInbox);
    const c = makeClient(ROOM_A, 'carol-bystander', cInbox);
    const d = makeClient(ROOM_B, 'dave-other-room', dInbox);
    const v = makeClient(ROOM_A, 'viewer', vInbox, { viewer: true });

    await Promise.all([
        a.connect(),
        b.connect(),
        c.connect(),
        d.connect(),
        v.connect(),
    ]);
    await sleep(150);

    const bPubkey = b.sessionPubkey;

    // --- 1. A sends a DM to B. ---
    await a.sendDirect(bPubkey, 'hello bob, private message');
    await sleep(200);

    pass(
        '1 target B received the DM',
        bInbox.directs.length === 1 &&
            bInbox.directs[0]!.body === 'hello bob, private message'
    );

    pass(
        '1 viewer V received the DM (observability)',
        vInbox.directs.length === 1 &&
            vInbox.directs[0]!.body === 'hello bob, private message'
    );

    pass(
        '1 bystander C did NOT receive the DM',
        cInbox.directs.length === 0
    );

    pass(
        '1 sender A did NOT receive their own DM',
        aInbox.directs.length === 0
    );

    pass(
        '1 agent D in a DIFFERENT room did NOT receive it',
        dInbox.directs.length === 0
    );

    // --- 2. DM to a non-existent target is rejected. ---
    let err: string | null = null;
    try {
        await a.sendDirect(
            'A'.repeat(43), // bogus base64url
            'this should not go through'
        );
    } catch (e) {
        err = (e as Error).message;
    }
    pass(
        '2 DM to missing target rejected',
        err !== null && /target not in room/i.test(err),
        err
    );

    // No one should have seen the rejected DM.
    pass(
        '2 no one saw the rejected DM',
        bInbox.directs.length === 1 &&
            cInbox.directs.length === 0 &&
            vInbox.directs.length === 1
    );

    // --- 3. B replies via DM to A. ---
    await b.sendDirect(a.sessionPubkey, 'hi alice, got your message');
    await sleep(200);

    pass(
        '3 A received reply DM',
        aInbox.directs.length === 1 &&
            aInbox.directs[0]!.body === 'hi alice, got your message'
    );

    pass(
        '3 viewer V received reply DM',
        vInbox.directs.length === 2 &&
            vInbox.directs[1]!.body === 'hi alice, got your message'
    );

    pass(
        '3 bystander C still did NOT receive any DMs',
        cInbox.directs.length === 0
    );

    a.leave();
    b.leave();
    c.leave();
    d.leave();
    v.leave();
    await sleep(150);
    process.exit(process.exitCode ?? 0);
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
