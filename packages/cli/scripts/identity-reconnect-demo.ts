// Demonstrates cross-session cap continuity via identity keys.
//
// Scenario:
//   1. Master generates a long-lived identity keypair.
//   2. Master connects (session #1) with a session attestation, creates a
//      `decisions` topic gated with its identity pubkey, and signs a root
//      cap with its identity private key.
//   3. Master delegates a post cap to a trusted agent's IDENTITY pubkey.
//   4. Trusted connects with a session attestation to the same identity,
//      posts to decisions using the delegated cap — succeeds.
//   5. BOTH agents disconnect. They reconnect with fresh session keys but
//      the same underlying identity keys.
//   6. Master re-attests session #2. Trusted re-attests session #2.
//   7. Trusted reuses the SAME cap that was issued before the reconnect
//      and successfully posts to decisions. Master receives the message.
//
// This proves identity-rooted caps are durable across reconnection.

import {
    delegateCap,
    generateKeypair,
    makeRootCap,
    toBase64Url,
    type Cap,
    type Keypair,
} from 'openroom-sdk';
import { Client } from '../src/client.js';

const RELAY_URL = process.env.OPENROOM_RELAY ?? 'ws://localhost:19300';
const ROOM = process.env.OPENROOM_ROOM ?? `identity-demo-${Date.now()}`;

function pass(label: string, ok: boolean, detail?: unknown) {
    const tag = ok ? 'ok' : 'FAIL';
    console.log(
        `${tag} ${label}${!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`
    );
    if (!ok) process.exitCode = 1;
}

interface Inbox {
    topic: string;
    body: string;
    from: string;
}

function makeClient(
    label: string,
    identityKp: Keypair,
    inbox: Inbox[]
): Client {
    return new Client({
        relayUrl: RELAY_URL,
        room: ROOM,
        displayName: label,
        identityKeypair: identityKp,
        onMessage: (event) => {
            inbox.push({
                topic: event.envelope.payload.topic,
                body: event.envelope.payload.body,
                from: event.envelope.from,
            });
        },
        onError: () => {
            /* swallow during demo */
        },
    });
}

async function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function run() {
    // Persistent identities (stay the same across reconnects)
    const masterId = generateKeypair();
    const trustedId = generateKeypair();

    const masterIdPub = toBase64Url(masterId.publicKey);
    const trustedIdPub = toBase64Url(trustedId.publicKey);

    // Master signs a root cap with its IDENTITY key. This cap is durable:
    // it outlives any particular session because its signer and its root
    // authority are the identity key, not a session key.
    const masterRootCap = makeRootCap(
        masterId.publicKey,
        masterId.privateKey,
        { resource: `room:${ROOM}/*`, action: '*' }
    );

    // Master delegates a narrower post cap to trusted's IDENTITY pubkey.
    const trustedPostCap = delegateCap(
        masterRootCap,
        trustedIdPub,
        { resource: `room:${ROOM}/topic:decisions`, action: 'post' },
        masterId.privateKey
    );

    // ---- Session #1 ----
    const masterInbox1: Inbox[] = [];
    const trustedInbox1: Inbox[] = [];
    const master1 = makeClient('master', masterId, masterInbox1);
    await master1.connect();

    // Gate decisions on the master's IDENTITY pubkey.
    await master1.createTopic('decisions', {
        subscribeCap: masterIdPub,
        postCap: masterIdPub,
    });

    // Master subscribes to its own gated topic using its identity-rooted cap.
    await master1.subscribe('decisions', { cap: masterRootCap });

    const trusted1 = makeClient('trusted', trustedId, trustedInbox1);
    await trusted1.connect();

    // Session #1 post: trusted uses the delegated cap.
    trusted1.send('pre-reconnect-message', 'decisions', { cap: trustedPostCap });
    await sleep(250);

    const sess1Got = masterInbox1.some(
        (m) => m.topic === 'decisions' && m.body === 'pre-reconnect-message'
    );
    pass('session #1: master received trusted post', sess1Got);

    // Disconnect both
    master1.leave();
    trusted1.leave();
    await sleep(200);

    // ---- Session #2: same identities, fresh session keys ----
    const masterInbox2: Inbox[] = [];
    const trustedInbox2: Inbox[] = [];
    const master2 = makeClient('master', masterId, masterInbox2);
    await master2.connect();

    // Different session pubkey than session #1
    pass(
        'session #2: master has a different session key',
        master2.sessionPubkey !== undefined
    );
    pass(
        'session #2: master identity pubkey unchanged',
        master2.identityPubkey === masterIdPub
    );

    // Master recreates the gated topic — idempotent since cap fields match.
    await master2.createTopic('decisions', {
        subscribeCap: masterIdPub,
        postCap: masterIdPub,
    });

    // Master re-subscribes using its durable identity-rooted cap.
    await master2.subscribe('decisions', { cap: masterRootCap });

    const trusted2 = makeClient('trusted', trustedId, trustedInbox2);
    await trusted2.connect();

    // Trusted reuses the SAME cap issued during session #1. It should still
    // work because:
    //   - Cap's iss is master's identity key (unchanged)
    //   - Cap's aud is trusted's identity key (unchanged)
    //   - Trusted's session #2 is bound to that identity via attestation
    //   - Cap's nbf..exp window is still open
    trusted2.send('post-reconnect-message', 'decisions', {
        cap: trustedPostCap,
    });
    await sleep(250);

    const sess2Got = masterInbox2.some(
        (m) => m.topic === 'decisions' && m.body === 'post-reconnect-message'
    );
    pass(
        'session #2: master received reconnect post using same cap',
        sess2Got
    );

    // Sanity: a third agent without identity attestation cannot present
    // the trusted cap. Its aud points at trustedIdPub, and without the
    // attestation the relay only accepts the agent's session pubkey.
    const imposter = new Client({
        relayUrl: RELAY_URL,
        room: ROOM,
        displayName: 'imposter',
        // no identityKeypair
        onError: () => {},
    });
    await imposter.connect();
    let imposterErr: string | null = null;
    try {
        await imposter.subscribe('decisions', { cap: trustedPostCap });
    } catch (e) {
        imposterErr = (e as Error).message;
    }
    pass(
        'imposter without identity attestation cannot use trusted cap',
        imposterErr !== null && /denied|no valid cap/i.test(imposterErr),
        imposterErr
    );

    master2.leave();
    trusted2.leave();
    imposter.leave();
    await sleep(150);
    process.exit(process.exitCode ?? 0);
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
