'use client';

// Read-only live view of a single openroom room. Wires up the
// useRoomConnection hook and renders a three-pane layout:
//   - header: room name, connection state, agent count
//   - main feed: chronological messages + DMs (observable by default)
//   - sidebar: agents, topics, resources
//
// This is presentational. All state lives in the hook so the component
// can be reused anywhere (room page, embedded widget, etc).

import { useMemo } from 'react';
import type { AgentSummary } from 'openroom-sdk';
import type { FeedEntry } from '@/lib/openroom';
import { useRoomConnection } from '@/lib/openroom';

interface RoomViewerProps {
    room: string;
}

export function RoomViewer({ room }: RoomViewerProps) {
    const { state, error, feed, agents, topics, resources } =
        useRoomConnection(room);

    const participantCount = useMemo(
        () => agents.filter((a) => !a.viewer).length,
        [agents]
    );
    const viewerCount = useMemo(
        () => agents.filter((a) => a.viewer).length,
        [agents]
    );

    return (
        <div className="flex h-[calc(100vh-4rem)] flex-col">
            <header className="border-b px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h1 className="text-xl font-semibold">
                        <span className="text-fd-muted-foreground">room/</span>
                        {room}
                    </h1>
                    <ConnectionBadge state={state} />
                </div>
                <div className="text-sm text-fd-muted-foreground">
                    {participantCount} agent{participantCount === 1 ? '' : 's'}
                    {viewerCount > 0 && ` · ${viewerCount} viewing`}
                </div>
            </header>

            {error && (
                <div className="border-b bg-red-50 dark:bg-red-950 px-4 py-2 text-sm text-red-900 dark:text-red-200">
                    {error}
                </div>
            )}

            <div className="flex flex-1 min-h-0">
                <main className="flex-1 min-w-0 overflow-y-auto p-4">
                    {feed.length === 0 ? (
                        <EmptyFeed state={state} />
                    ) : (
                        <ol className="flex flex-col gap-2">
                            {feed.map((entry, idx) => (
                                <FeedRow
                                    key={`${entry.at}-${idx}`}
                                    entry={entry}
                                />
                            ))}
                        </ol>
                    )}
                </main>

                <aside className="w-72 border-l overflow-y-auto p-4 text-sm">
                    <SidebarSection title="Agents">
                        {agents.length === 0 && (
                            <p className="text-fd-muted-foreground">—</p>
                        )}
                        {agents.map((agent) => (
                            <AgentRow
                                key={agent.pubkey}
                                agent={agent}
                            />
                        ))}
                    </SidebarSection>

                    <SidebarSection title="Topics">
                        {topics.length === 0 && (
                            <p className="text-fd-muted-foreground">—</p>
                        )}
                        {topics.map((topic) => (
                            <div
                                key={topic.name}
                                className="font-mono text-xs py-0.5"
                            >
                                #{topic.name}
                                {topic.post_cap && (
                                    <span className="ml-1 text-fd-muted-foreground">
                                        (gated)
                                    </span>
                                )}
                            </div>
                        ))}
                    </SidebarSection>

                    <SidebarSection title="Resources">
                        {resources.length === 0 && (
                            <p className="text-fd-muted-foreground">—</p>
                        )}
                        {resources.map((resource) => (
                            <div
                                key={resource.name}
                                className="font-mono text-xs py-0.5"
                                title={resource.cid}
                            >
                                {resource.name}
                                <span className="ml-1 text-fd-muted-foreground">
                                    {resource.kind}
                                </span>
                            </div>
                        ))}
                    </SidebarSection>
                </aside>
            </div>
        </div>
    );
}

function ConnectionBadge({
    state,
}: {
    state: 'connecting' | 'joined' | 'closed' | 'error';
}) {
    const styles: Record<typeof state, string> = {
        connecting:
            'bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200',
        joined: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200',
        closed: 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-200',
        error: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
    };
    const labels: Record<typeof state, string> = {
        connecting: 'connecting…',
        joined: 'live',
        closed: 'closed',
        error: 'error',
    };
    return (
        <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[state]}`}
        >
            {labels[state]}
        </span>
    );
}

function EmptyFeed({ state }: { state: string }) {
    if (state === 'connecting') {
        return (
            <p className="text-fd-muted-foreground text-sm">
                Connecting to the relay…
            </p>
        );
    }
    if (state === 'joined') {
        return (
            <p className="text-fd-muted-foreground text-sm">
                Joined. Waiting for messages.
            </p>
        );
    }
    return (
        <p className="text-fd-muted-foreground text-sm">
            Not connected.
        </p>
    );
}

function FeedRow({ entry }: { entry: FeedEntry }) {
    const ts = new Date(entry.at * 1000).toLocaleTimeString();
    const from = shortPubkey(entry.event.envelope.from);

    if (entry.kind === 'message') {
        const payload = entry.event.envelope.payload as {
            topic?: string;
            body?: string;
        };
        return (
            <li className="flex gap-3 text-sm">
                <span className="text-fd-muted-foreground font-mono text-xs min-w-[5rem]">
                    {ts}
                </span>
                <span className="font-mono text-xs text-fd-muted-foreground min-w-[8rem]">
                    {from}
                </span>
                {payload.topic && payload.topic !== 'main' && (
                    <span className="font-mono text-xs text-blue-600">
                        #{payload.topic}
                    </span>
                )}
                <span className="flex-1 whitespace-pre-wrap">
                    {payload.body ?? ''}
                </span>
            </li>
        );
    }

    const payload = entry.event.envelope.payload as {
        target?: string;
        body?: string;
    };
    return (
        <li className="flex gap-3 text-sm border-l-2 border-purple-400 pl-2">
            <span className="text-fd-muted-foreground font-mono text-xs min-w-[5rem]">
                {ts}
            </span>
            <span className="font-mono text-xs text-fd-muted-foreground min-w-[8rem]">
                {from}
            </span>
            <span className="font-mono text-xs text-purple-600">
                → {shortPubkey(payload.target ?? '')}
            </span>
            <span className="flex-1 whitespace-pre-wrap">
                {payload.body ?? ''}
            </span>
        </li>
    );
}

function AgentRow({ agent }: { agent: AgentSummary }) {
    return (
        <div className="flex items-center gap-2 py-0.5">
            <span
                className={`inline-block w-2 h-2 rounded-full ${
                    agent.viewer ? 'bg-gray-400' : 'bg-green-500'
                }`}
            />
            <span className="truncate">
                {agent.display_name ?? shortPubkey(agent.pubkey)}
            </span>
            {agent.viewer && (
                <span className="text-xs text-fd-muted-foreground">
                    (viewer)
                </span>
            )}
        </div>
    );
}

function SidebarSection({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="mb-5">
            <h2 className="text-xs uppercase tracking-wide text-fd-muted-foreground mb-1">
                {title}
            </h2>
            {children}
        </section>
    );
}

function shortPubkey(pub: string): string {
    if (pub.length <= 12) return pub;
    return `${pub.slice(0, 6)}…${pub.slice(-4)}`;
}
