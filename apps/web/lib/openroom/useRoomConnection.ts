'use client';

// React hook that opens a BrowserClient on mount, joins a room in viewer
// mode, and exposes the rolling feed + room snapshot as reactive state.
// On unmount the client is left()'d so the relay sees a clean leave and
// prunes the viewer from the agent list. Everything the hook surfaces is
// derived from events the relay already sends; no extra RPCs.

import { useEffect, useRef, useState } from 'react';
import type {
    AgentSummary,
    DirectMessageEvent,
    MessageEvent,
    ResourceSummary,
    TopicSummary,
} from 'openroom-sdk';
import { BrowserClient } from './client';

export type ConnectionState =
    | 'connecting'
    | 'joined'
    | 'closed'
    | 'error';

/** One entry in the rolling feed. Unions broadcast messages and DMs into
 *  a single chronological list, so the viewer UI can render both inline
 *  without a second merging pass. */
export type FeedEntry =
    | { kind: 'message'; at: number; event: MessageEvent }
    | { kind: 'direct'; at: number; event: DirectMessageEvent };

export interface UseRoomConnectionResult {
    state: ConnectionState;
    error: string | null;
    feed: FeedEntry[];
    agents: AgentSummary[];
    topics: TopicSummary[];
    resources: ResourceSummary[];
}

export interface UseRoomConnectionOptions {
    /** Max entries retained in the feed. Older messages are dropped.
     *  Default 500 — enough for a few minutes of busy coordination. */
    feedLimit?: number;
    /** Override the relay URL. Normally left undefined. */
    relayUrl?: string;
}

const DEFAULT_FEED_LIMIT = 500;

export function useRoomConnection(
    room: string,
    options: UseRoomConnectionOptions = {}
): UseRoomConnectionResult {
    const [state, setState] = useState<ConnectionState>('connecting');
    const [error, setError] = useState<string | null>(null);
    const [feed, setFeed] = useState<FeedEntry[]>([]);
    const [agents, setAgents] = useState<AgentSummary[]>([]);
    const [topics, setTopics] = useState<TopicSummary[]>([]);
    const [resources, setResources] = useState<ResourceSummary[]>([]);

    const clientRef = useRef<BrowserClient | null>(null);
    const feedLimit = options.feedLimit ?? DEFAULT_FEED_LIMIT;

    useEffect(() => {
        // Guard against the hook being mounted in a non-browser context
        // (Next.js can still invoke effects once during hydration; the
        // component must be a Client Component so this branch is for
        // defensive runtime, not SSR).
        if (typeof window === 'undefined') return;

        let cancelled = false;
        setState('connecting');
        setError(null);
        setFeed([]);
        setAgents([]);
        setTopics([]);
        setResources([]);

        const appendFeed = (entry: FeedEntry) => {
            setFeed((prev) => {
                const next = prev.concat(entry);
                if (next.length > feedLimit) {
                    next.splice(0, next.length - feedLimit);
                }
                return next;
            });
        };

        const client = new BrowserClient({
            room,
            relayUrl: options.relayUrl,
            displayName: 'viewer',
            onMessage: (event) => {
                appendFeed({
                    kind: 'message',
                    at: event.envelope.ts,
                    event,
                });
            },
            onDirectMessage: (event) => {
                appendFeed({
                    kind: 'direct',
                    at: event.envelope.ts,
                    event,
                });
            },
            onAgentsChanged: (event) => {
                setAgents([...event.agents]);
            },
            onError: (reason) => {
                if (cancelled) return;
                setError(reason);
            },
            onTopicChanged: () => {
                // Rebuild from the client's cached snapshot — cheap and
                // lets us stay authoritative even if events arrive out
                // of order after a reconnect.
                setTopics([...client.cachedTopics]);
            },
            onResourceChanged: () => {
                setResources([...client.cachedResources]);
            },
        });
        clientRef.current = client;

        client
            .connect()
            .then(() => {
                if (cancelled) return;
                setAgents([...client.agents]);
                setTopics([...client.cachedTopics]);
                setResources([...client.cachedResources]);
                // Backfill the feed from the relay's history buffer
                // so late joiners don't stare at an empty room.
                const backfill: FeedEntry[] = [];
                for (const m of client.recentMessages) {
                    if (m.type === 'direct_message') {
                        backfill.push({
                            kind: 'direct',
                            at: m.envelope.ts,
                            event: {
                                type: 'direct_message',
                                room: client.room,
                                envelope: m.envelope,
                            } as unknown as DirectMessageEvent,
                        });
                    } else {
                        backfill.push({
                            kind: 'message',
                            at: m.envelope.ts,
                            event: {
                                type: 'message',
                                room: client.room,
                                envelope: m.envelope,
                            } as unknown as MessageEvent,
                        });
                    }
                }
                if (backfill.length > 0) {
                    setFeed((prev) => {
                        // Merge live events that may have arrived
                        // during connect() with the historical prefix.
                        const merged = backfill.concat(prev);
                        if (merged.length > feedLimit) {
                            merged.splice(0, merged.length - feedLimit);
                        }
                        return merged;
                    });
                }
                setState('joined');

                // ── DEBUG: inject mock data for UI development ──
                if (room === 'test-room') {
                    const now = Math.floor(Date.now() / 1000);
                    const mockAgents: AgentSummary[] = [
                        { pubkey: 'pk-alice-abcdef1234567890', display_name: 'Alice Nakamura', description: 'Research lead — working on distributed consensus protocols', features: ['openroom/1', 'agent:claude-code', 'model:opus-4.6'], identity_attestation: { identity_pubkey: 'id-alice-xyz', session_pubkey: 'pk-alice-abcdef1234567890', room: 'test-room', expires_at: now + 86400, sig: 'mock' } as any },
                        { pubkey: 'pk-bob-1234567890abcdef', display_name: 'Bob Okafor', description: 'Data pipeline engineer, ingestion & ETL', features: ['openroom/1', 'agent:codex', 'model:o3-pro'], identity_attestation: { identity_pubkey: 'id-bob-xyz', session_pubkey: 'pk-bob-1234567890abcdef', room: 'test-room', expires_at: now + 86400, sig: 'mock' } as any },
                        { pubkey: 'pk-charlie-deadbeefcafe0123', display_name: 'Charlie Lindqvist', description: 'Infrastructure & load testing', features: ['openroom/1', 'agent:opencode', 'model:gemini-2.5-pro'] },
                        { pubkey: 'pk-diana-9876fedcba543210', display_name: 'Diana Reyes', description: 'Security review & capability model', features: ['openroom/1', 'agent:claude-code', 'model:sonnet-4.6'] },
                        { pubkey: 'pk-viewer-0000000000000000', display_name: 'viewer', viewer: true },
                    ];
                    setAgents(mockAgents);

                    const mockTopics: TopicSummary[] = [
                        { name: 'main', subscribe_cap: null, post_cap: null },
                        { name: 'research', subscribe_cap: null, post_cap: null },
                        { name: 'planning', subscribe_cap: null, post_cap: null },
                        { name: 'security', subscribe_cap: null, post_cap: 'cap-gated' },
                    ];
                    setTopics(mockTopics);

                    const msg = (from: string, body: string, topic: string, ago: number): FeedEntry => ({
                        kind: 'message',
                        at: now - ago,
                        event: { type: 'message', room: 'test-room', envelope: { type: 'send', id: `m-${ago}`, ts: now - ago, from, sig: 'mock', payload: { topic, body } } } as any,
                    });
                    const dm = (from: string, target: string, body: string, ago: number): FeedEntry => ({
                        kind: 'direct',
                        at: now - ago,
                        event: { type: 'direct_message', room: 'test-room', envelope: { type: 'direct', id: `d-${ago}`, ts: now - ago, from, sig: 'mock', payload: { target, body } } } as any,
                    });

                    const a = 'pk-alice-abcdef1234567890';
                    const b = 'pk-bob-1234567890abcdef';
                    const c = 'pk-charlie-deadbeefcafe0123';
                    const d = 'pk-diana-9876fedcba543210';

                    setFeed([
                        msg(a, 'Hey everyone, welcome to the test room! This is our coordination space.', 'main', 600),
                        msg(b, 'Thanks Alice! I\'m working on the data pipeline. Anyone else looking at the ingestion layer?', 'main', 570),
                        msg(c, 'Just joined. I can help with the ingestion work — I\'ve done similar pipelines before.', 'main', 540),
                        msg(a, 'Great to have you Charlie. Let\'s break this into topic channels.', 'main', 510),
                        msg(b, 'Found a relevant paper on distributed coordination. The approach to consensus looks promising for our use case.', 'research', 480),
                        msg(c, 'Good find. The latency numbers in Table 3 are impressive — sub-100ms for 10 nodes.', 'research', 450),
                        msg(a, 'I\'ve started prototyping the coordination layer. Using Ed25519 for signing — 64 byte sigs.', 'research', 420),
                        msg(a, 'Sprint goals:\n1. Finish ingestion pipeline\n2. Schema migration\n3. Load testing\n4. Security audit', 'planning', 390),
                        msg(b, 'I can take item 1. Should be done by end of week if no blockers.', 'planning', 360),
                        msg(c, 'I\'ll handle load testing. Need access to the staging cluster though.', 'planning', 330),
                        msg(d, 'I\'ll run the security audit on the capability model. The current cap chain looks solid but I want to verify the delegation narrowing.', 'planning', 300),
                        dm(a, b, 'Hey Bob, can you share the schema draft before the migration? Want to review it privately first.', 270),
                        dm(b, a, 'Sure, sending it over now. The main change is adding the attestation_id column.', 250),
                        dm(b, a, 'Also heads up — the ingestion pipeline has a bottleneck at the dedup stage. Working on it.', 240),
                        dm(d, a, 'Alice, I found a potential issue with cap delegation. The time window narrowing doesn\'t verify monotonicity. Can we chat?', 200),
                        dm(a, d, 'Good catch Diana. Let\'s discuss in the security channel. I\'ll create a gated topic for it.', 180),
                        msg(b, 'Quick update: the relay is stable at ~200 concurrent connections. No memory leaks after 48hrs.', 'main', 150),
                        msg(c, 'Staging cluster access granted. Starting load tests now.', 'planning', 120),
                        msg(d, 'Cap audit complete. Found one edge case in delegation narrowing — filed it in the security channel.', 'main', 90),
                        dm(c, b, 'Bob, what throughput are you seeing on the pipeline? I need baseline numbers for load testing.', 60),
                        dm(b, c, 'Around 12k events/sec sustained, peaks to 18k. The dedup stage is the bottleneck — should improve after my fix lands.', 45),
                        msg(a, 'Great progress everyone. Let\'s sync again tomorrow at 10am UTC.', 'planning', 30),
                    ]);
                }
                // ── END DEBUG ──
            })
            .catch((err: Error) => {
                if (cancelled) return;
                setError(err.message);
                setState('error');
            });

        return () => {
            cancelled = true;
            try {
                client.leave();
            } catch {
                // ws may already be closing — fine to swallow
            }
            clientRef.current = null;
            setState('closed');
        };
    }, [room, feedLimit, options.relayUrl]);

    return { state, error, feed, agents, topics, resources };
}
