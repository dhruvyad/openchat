// Rate limit + memory bound smoke test. Directly drives raw WebSocket
// envelopes at the relay to verify the token bucket actually throttles
// abusive traffic and that per-room memory caps kick in.

import {
    generateKeypair,
    makeEnvelope,
    toBase64Url,
} from 'openroom-sdk';
import WebSocket from 'ws';

const RELAY_URL = process.env.OPENROOM_RELAY ?? 'ws://localhost:19950';
const ROOM = `rate-demo-${Date.now()}`;

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

async function joinAsFreshSession(): Promise<{
    ws: WebSocket;
    events: any[];
    kp: { privateKey: Uint8Array; publicKey: Uint8Array };
}> {
    const kp = generateKeypair();
    const ws = new WebSocket(
        `${RELAY_URL}/v1/room/${encodeURIComponent(ROOM)}`
    );
    const events: any[] = [];
    ws.on('message', (d: Buffer) => events.push(JSON.parse(d.toString())));
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));
    while (!events.find((e) => e.type === 'challenge')) await sleep(10);
    const ch = events.find((e) => e.type === 'challenge');
    const joinEnv = makeEnvelope(
        'join',
        { nonce: ch.nonce, display_name: 'rate-probe' },
        kp.privateKey,
        kp.publicKey
    );
    ws.send(JSON.stringify(joinEnv));
    while (!events.find((e) => e.type === 'joined' || e.type === 'error'))
        await sleep(10);
    return { ws, events, kp };
}

async function run() {
    // ---- Test 1: token bucket throttles a flood of envelopes ----
    const { ws, events, kp } = await joinAsFreshSession();

    // Clear existing events (challenge, joined, agents_changed).
    events.length = 0;

    // Fire 150 `send` envelopes as fast as we can. Burst cap is 100,
    // so at least 50 should be rate-limited.
    const totalSent = 150;
    for (let i = 0; i < totalSent; i++) {
        const env = makeEnvelope(
            'send',
            { topic: 'main', body: `flood-${i}` },
            kp.privateKey,
            kp.publicKey
        );
        ws.send(JSON.stringify(env));
    }

    // Give the relay time to process.
    await sleep(500);

    const errors = events.filter(
        (e) => e.type === 'error' && e.reason === 'rate limit exceeded'
    );
    const successResults = events.filter(
        (e) => e.type === 'send_result' && e.success === true
    );
    pass(
        '1 rate limit errors emitted above burst',
        errors.length >= 40,
        { errors: errors.length, success: successResults.length }
    );
    pass(
        '1 burst count roughly matches token bucket size',
        successResults.length >= 90 && successResults.length <= 110,
        { success: successResults.length }
    );

    // ---- Test 2: wait and verify tokens refill ----
    await sleep(1500);
    // 1.5s * 20 tokens/sec = 30 tokens available; at least some sends
    // should succeed again.
    events.length = 0;
    const postRefill = makeEnvelope(
        'send',
        { topic: 'main', body: 'post-refill' },
        kp.privateKey,
        kp.publicKey
    );
    ws.send(JSON.stringify(postRefill));
    await sleep(200);
    const postRefillOk = events.find(
        (e) =>
            e.type === 'send_result' &&
            e.id === postRefill.id &&
            e.success === true
    );
    pass('2 tokens refill after idle', !!postRefillOk);

    ws.close();
    await sleep(100);

    // ---- Test 3: resource byte limit ----
    const { ws: ws2, events: events2, kp: kp2 } = await joinAsFreshSession();
    events2.length = 0;

    // Attempt to put a resource larger than the 1 MiB per-resource cap.
    const tooLarge = new Uint8Array(1024 * 1024 + 1);
    const oversizePut = makeEnvelope(
        'resource_put',
        {
            name: 'oversize',
            kind: 'blob',
            content: toBase64Url(tooLarge),
        },
        kp2.privateKey,
        kp2.publicKey
    );
    ws2.send(JSON.stringify(oversizePut));
    await sleep(200);
    const oversizeResult = events2.find(
        (e) => e.type === 'resource_put_result' && e.id === oversizePut.id
    );
    pass(
        '3 oversize resource rejected',
        oversizeResult?.success === false &&
            /exceeds.*bytes/i.test(oversizeResult?.error ?? ''),
        oversizeResult
    );

    ws2.close();
    await sleep(100);
    process.exit(process.exitCode ?? 0);
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
