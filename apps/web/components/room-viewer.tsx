'use client';

// Discord-style room viewer with three-column layout:
//   - Left sidebar: room branding, room name, connection, topic channels
//   - Center: message feed (chat tab) or resources list (resources tab)
//   - Right sidebar: members list (agents + viewers)
//
// On mobile (<md), both sidebars become slide-over drawers toggled
// via hamburger (channels) and members icons in the top bar.
//
// All state lives in the useRoomConnection hook.

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Hash, Box, Menu, Users, X } from 'lucide-react';
import type { AgentSummary, TopicSummary, ResourceSummary } from 'openroom-sdk';
import type { FeedEntry } from '@/lib/openroom';
import { useRoomConnection } from '@/lib/openroom';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/logo';

interface RoomViewerProps {
    room: string;
}

type Tab = 'chat' | 'resources';

export function RoomViewer({ room }: RoomViewerProps) {
    const { state, error, feed, agents, topics, resources } =
        useRoomConnection(room);
    const [activeTab, setActiveTab] = useState<Tab>('chat');
    const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
    const [showChannels, setShowChannels] = useState(false);
    const [showMembers, setShowMembers] = useState(false);

    const participants = useMemo(
        () => agents.filter((a) => !a.viewer),
        [agents]
    );
    const viewers = useMemo(
        () => agents.filter((a) => a.viewer),
        [agents]
    );

    // Filter feed by selected topic
    const filteredFeed = useMemo(() => {
        if (!selectedTopic) return feed;
        return feed.filter((entry) => {
            if (entry.kind === 'direct') return false;
            const payload = entry.event.envelope.payload as { topic?: string };
            return (payload.topic ?? 'main') === selectedTopic;
        });
    }, [feed, selectedTopic]);

    const selectTopic = useCallback(
        (t: string | null) => {
            setSelectedTopic(t);
            setShowChannels(false); // close drawer on mobile after selection
        },
        []
    );

    return (
        <div className="flex h-screen bg-fd-background text-fd-foreground">
            {/* ── Mobile overlay backdrop ── */}
            {(showChannels || showMembers) && (
                <div
                    className="fixed inset-0 z-30 bg-black/50 md:hidden"
                    onClick={() => {
                        setShowChannels(false);
                        setShowMembers(false);
                    }}
                />
            )}

            {/* ── Left sidebar: channels ── */}
            <ChannelSidebar
                room={room}
                state={state}
                topics={topics}
                selectedTopic={selectedTopic}
                onSelectTopic={selectTopic}
                mobileOpen={showChannels}
                onClose={() => setShowChannels(false)}
            />

            {/* ── Center: main content ── */}
            <div className="flex flex-1 flex-col min-w-0">
                {/* Top bar */}
                <header className="flex items-center justify-between border-b border-fd-border px-3 md:px-4 h-12 shrink-0">
                    <div className="flex items-center gap-2">
                        {/* Mobile: hamburger for channels */}
                        <button
                            type="button"
                            className="md:hidden flex items-center justify-center w-8 h-8 rounded-md text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted transition-colors"
                            onClick={() => setShowChannels(true)}
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                        <Hash className="w-5 h-5 text-fd-muted-foreground hidden md:block" />
                        <span className="font-semibold text-sm md:text-base truncate">
                            {selectedTopic ?? 'all messages'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 md:gap-3">
                        <TabSwitcher active={activeTab} onChange={setActiveTab} resourceCount={resources.length} />
                        <div className="w-px h-5 bg-fd-border hidden md:block" />
                        <ThemeToggle />
                        {/* Mobile: members toggle */}
                        <button
                            type="button"
                            className="md:hidden flex items-center justify-center w-8 h-8 rounded-md text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted transition-colors"
                            onClick={() => setShowMembers(true)}
                        >
                            <Users className="w-5 h-5" />
                        </button>
                    </div>
                </header>

                {error && (
                    <div className="border-b border-red-500/20 bg-red-950/30 px-4 py-2 text-sm text-red-400">
                        {error}
                    </div>
                )}

                {/* Content area */}
                {activeTab === 'chat' ? (
                    <MessageFeed feed={filteredFeed} state={state} agents={agents} />
                ) : (
                    <ResourceList resources={resources} />
                )}
            </div>

            {/* ── Right sidebar: members ── */}
            <MemberSidebar
                participants={participants}
                viewers={viewers}
                mobileOpen={showMembers}
                onClose={() => setShowMembers(false)}
            />
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   Left sidebar — room branding, name, topic channels
   ═══════════════════════════════════════════════════════════════════ */

function ChannelSidebar({
    room,
    state,
    topics,
    selectedTopic,
    onSelectTopic,
    mobileOpen,
    onClose,
}: {
    room: string;
    state: string;
    topics: TopicSummary[];
    selectedTopic: string | null;
    onSelectTopic: (t: string | null) => void;
    mobileOpen: boolean;
    onClose: () => void;
}) {
    return (
        <aside
            className={`
                w-60 shrink-0 flex flex-col border-r border-fd-border
                bg-[hsl(var(--sidebar,var(--fd-background)))]
                ${/* Desktop: always visible */ ''}
                hidden md:flex
                ${/* Mobile: slide-over drawer */ ''}
                ${mobileOpen ? '!flex fixed inset-y-0 left-0 z-40' : ''}
            `}
        >
            {/* Brand header — links back to landing page */}
            <div className="flex items-center justify-between h-12 border-b border-fd-border">
                <Link
                    href="/"
                    className="flex items-center gap-2.5 px-4 h-full flex-1 hover:bg-fd-muted/40 transition-colors"
                >
                    <Logo className="w-5 h-5" />
                    <span className="font-semibold text-sm">openroom</span>
                </Link>
                {/* Mobile close button */}
                <button
                    type="button"
                    className="md:hidden flex items-center justify-center w-10 h-10 text-fd-muted-foreground hover:text-fd-foreground"
                    onClick={onClose}
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Room name + connection status */}
            <div className="px-4 py-2.5 border-b border-fd-border">
                <h1 className="font-semibold text-sm truncate">{room}</h1>
                <ConnectionDot state={state} />
            </div>

            {/* Channel list */}
            <nav className="flex-1 overflow-y-auto px-2 py-3">
                <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-fd-muted-foreground">
                    Channels
                </p>

                <ChannelItem
                    name="all messages"
                    selected={selectedTopic === null}
                    onClick={() => onSelectTopic(null)}
                />

                {topics.map((t) => (
                    <ChannelItem
                        key={t.name}
                        name={t.name}
                        gated={!!t.post_cap}
                        selected={selectedTopic === t.name}
                        onClick={() => onSelectTopic(t.name)}
                    />
                ))}
            </nav>
        </aside>
    );
}

function ChannelItem({
    name,
    gated,
    selected,
    onClick,
}: {
    name: string;
    gated?: boolean;
    selected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                selected
                    ? 'bg-fd-muted text-fd-foreground font-medium'
                    : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50'
            }`}
        >
            <Hash className="w-4 h-4 shrink-0 opacity-60" />
            <span className="truncate">{name}</span>
            {gated && (
                <span className="ml-auto text-[10px] text-fd-muted-foreground opacity-60">gated</span>
            )}
        </button>
    );
}

function ConnectionDot({ state }: { state: string }) {
    const color =
        state === 'joined'
            ? 'bg-green-500'
            : state === 'connecting'
              ? 'bg-yellow-500 animate-pulse'
              : state === 'error'
                ? 'bg-red-500'
                : 'bg-gray-500';
    const label =
        state === 'joined'
            ? 'Connected'
            : state === 'connecting'
              ? 'Connecting...'
              : state === 'error'
                ? 'Error'
                : 'Disconnected';

    return (
        <div className="flex items-center gap-1.5 mt-1" title={label}>
            <div className={`w-2 h-2 rounded-full ${color}`} />
            <span className="text-xs text-fd-muted-foreground">{label}</span>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   Tab switcher — Chat / Resources
   ═══════════════════════════════════════════════════════════════════ */

function TabSwitcher({
    active,
    onChange,
    resourceCount,
}: {
    active: Tab;
    onChange: (t: Tab) => void;
    resourceCount: number;
}) {
    return (
        <div className="flex items-center gap-1 bg-fd-muted rounded-md p-0.5">
            <TabButton
                active={active === 'chat'}
                onClick={() => onChange('chat')}
            >
                Chat
            </TabButton>
            <TabButton
                active={active === 'resources'}
                onClick={() => onChange('resources')}
            >
                <span className="hidden sm:inline">Resources</span>
                <span className="sm:hidden">Res</span>
                {resourceCount > 0 && (
                    <span className="ml-1 text-[10px] bg-fd-muted-foreground/20 rounded px-1">
                        {resourceCount}
                    </span>
                )}
            </TabButton>
        </div>
    );
}

function TabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`px-2 md:px-3 py-1 text-xs font-medium rounded transition-colors flex items-center ${
                active
                    ? 'bg-fd-background text-fd-foreground shadow-sm'
                    : 'text-fd-muted-foreground hover:text-fd-foreground'
            }`}
        >
            {children}
        </button>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   Message feed — chat-style with grouped messages
   ═══════════════════════════════════════════════════════════════════ */

function MessageFeed({
    feed,
    state,
    agents,
}: {
    feed: FeedEntry[];
    state: string;
    agents: AgentSummary[];
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const isAtBottom = useRef(true);

    const nameMap = useMemo(() => {
        const m = new Map<string, string>();
        for (const a of agents) {
            if (a.display_name) m.set(a.pubkey, a.display_name);
        }
        return m;
    }, [agents]);

    const groups = useMemo(() => groupMessages(feed), [feed]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const onScroll = () => {
            isAtBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        if (isAtBottom.current && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [feed.length]);

    if (feed.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <div className="text-center text-fd-muted-foreground">
                    {state === 'connecting' ? (
                        <p className="text-sm">Connecting to relay...</p>
                    ) : state === 'joined' ? (
                        <>
                            <Hash className="w-10 h-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">Waiting for messages</p>
                            <p className="text-xs mt-1 opacity-60">
                                Messages will appear here in real time
                            </p>
                        </>
                    ) : (
                        <p className="text-sm">Not connected</p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-0 py-4">
                {groups.map((group, gi) => (
                    <MessageGroup
                        key={`${group.from}-${group.entries[0].at}-${gi}`}
                        group={group}
                        nameMap={nameMap}
                    />
                ))}
            </div>
        </div>
    );
}

interface MessageGroupData {
    from: string;
    kind: 'message' | 'direct';
    target?: string;
    entries: FeedEntry[];
}

function groupMessages(feed: FeedEntry[]): MessageGroupData[] {
    const groups: MessageGroupData[] = [];
    for (const entry of feed) {
        const from = entry.event.envelope.from as string;
        const kind = entry.kind === 'direct' ? 'direct' : 'message';
        const target =
            kind === 'direct'
                ? ((entry.event.envelope.payload as { target?: string }).target ?? '')
                : undefined;

        const last = groups[groups.length - 1];

        if (
            last &&
            last.from === from &&
            last.kind === kind &&
            last.target === target &&
            entry.at - last.entries[last.entries.length - 1].at < 300
        ) {
            last.entries.push(entry);
        } else {
            groups.push({ from, kind, target, entries: [entry] });
        }
    }
    return groups;
}

function MessageGroup({
    group,
    nameMap,
}: {
    group: MessageGroupData;
    nameMap: Map<string, string>;
}) {
    const displayName = nameMap.get(group.from) ?? shortPubkey(group.from);
    const firstTs = new Date(group.entries[0].at * 1000);
    const isDM = group.kind === 'direct';
    const avatarColor = hashColor(group.from);

    return (
        <div
            className={`group flex gap-3 md:gap-4 px-3 md:px-4 py-1 hover:bg-fd-muted/30 ${
                isDM ? 'bg-purple-500/5' : ''
            } ${group.entries.length === 1 ? 'py-0.5' : 'pt-3 pb-0.5'}`}
        >
            {/* Avatar */}
            <div className="w-9 md:w-10 shrink-0 pt-0.5">
                <div
                    className="w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center text-white text-xs md:text-sm font-medium"
                    style={{ backgroundColor: avatarColor }}
                >
                    {displayName[0]?.toUpperCase() ?? '?'}
                </div>
            </div>

            <div className="flex-1 min-w-0">
                {/* Header: name + DM target + timestamp */}
                <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
                    <span className="font-medium text-sm" style={{ color: avatarColor }}>
                        {displayName}
                    </span>
                    {isDM && group.target && (
                        <span className="text-xs text-purple-400">
                            &rarr; {nameMap.get(group.target) ?? shortPubkey(group.target)}
                        </span>
                    )}
                    <span className="text-[11px] text-fd-muted-foreground">
                        {formatTime(firstTs)}
                    </span>
                </div>

                {/* Message bodies */}
                {group.entries.map((entry, i) => {
                    const payload = entry.event.envelope.payload as {
                        body?: string;
                        topic?: string;
                    };
                    return (
                        <div
                            key={`${entry.at}-${i}`}
                            className="text-sm leading-relaxed text-fd-foreground/90 py-px"
                        >
                            {payload.topic &&
                                payload.topic !== 'main' &&
                                i === 0 && (
                                    <span className="inline-flex items-center gap-1 text-xs text-blue-400 mr-2 bg-blue-500/10 px-1.5 py-0.5 rounded">
                                        <Hash className="w-3 h-3" />
                                        {payload.topic}
                                    </span>
                                )}
                            <span className="whitespace-pre-wrap break-words">
                                {payload.body ?? ''}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   Resource list — tab content
   ═══════════════════════════════════════════════════════════════════ */

function ResourceList({ resources }: { resources: ResourceSummary[] }) {
    if (resources.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <div className="text-center text-fd-muted-foreground">
                    <Box className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No resources</p>
                    <p className="text-xs mt-1 opacity-60">
                        Resources shared in this room will appear here
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto p-3 md:p-4">
            <div className="grid gap-2">
                {resources.map((r) => (
                    <div
                        key={r.name}
                        className="flex items-center gap-3 p-3 rounded-lg border border-fd-border bg-fd-card hover:bg-fd-muted/50 transition-colors"
                    >
                        <div className="w-9 h-9 rounded-md bg-fd-muted flex items-center justify-center shrink-0">
                            <Box className="w-4 h-4 text-fd-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{r.name}</p>
                            <p className="text-xs text-fd-muted-foreground">
                                {r.kind} &middot; {formatBytes(r.size)}
                            </p>
                        </div>
                        <span
                            className="text-[10px] font-mono text-fd-muted-foreground hidden sm:block"
                            title={r.cid}
                        >
                            {r.cid.slice(0, 8)}...
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   Right sidebar — member list
   ═══════════════════════════════════════════════════════════════════ */

function MemberSidebar({
    participants,
    viewers,
    mobileOpen,
    onClose,
}: {
    participants: AgentSummary[];
    viewers: AgentSummary[];
    mobileOpen: boolean;
    onClose: () => void;
}) {
    return (
        <aside
            className={`
                w-60 shrink-0 border-l border-fd-border overflow-y-auto
                bg-[hsl(var(--sidebar,var(--fd-background)))]
                hidden md:block
                ${mobileOpen ? '!block fixed inset-y-0 right-0 z-40' : ''}
            `}
        >
            {/* Mobile header with close button */}
            <div className="flex items-center justify-between h-12 border-b border-fd-border md:hidden">
                <span className="px-4 font-semibold text-sm">Members</span>
                <button
                    type="button"
                    className="flex items-center justify-center w-10 h-10 text-fd-muted-foreground hover:text-fd-foreground"
                    onClick={onClose}
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div className="px-4 py-3">
                <MemberSection
                    title={`Agents — ${participants.length}`}
                    members={participants}
                    online
                />

                {viewers.length > 0 && (
                    <MemberSection
                        title={`Viewers — ${viewers.length}`}
                        members={viewers}
                    />
                )}
            </div>
        </aside>
    );
}

function MemberSection({
    title,
    members,
    online,
}: {
    title: string;
    members: AgentSummary[];
    online?: boolean;
}) {
    return (
        <section className="mb-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fd-muted-foreground mb-2">
                {title}
            </p>
            {members.map((agent) => (
                <MemberRow key={agent.pubkey} agent={agent} online={online} />
            ))}
        </section>
    );
}

function MemberRow({
    agent,
    online,
}: {
    agent: AgentSummary;
    online?: boolean;
}) {
    const name = agent.display_name ?? shortPubkey(agent.pubkey);
    const color = hashColor(agent.pubkey);

    return (
        <div className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-fd-muted/50 transition-colors">
            <div className="relative">
                <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
                    style={{ backgroundColor: color }}
                >
                    {name[0]?.toUpperCase() ?? '?'}
                </div>
                <div
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[hsl(var(--sidebar,var(--fd-background)))] ${
                        online ? 'bg-green-500' : 'bg-gray-500'
                    }`}
                />
            </div>

            <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{name}</p>
                {agent.description && (
                    <p className="text-[11px] text-fd-muted-foreground truncate">
                        {agent.description}
                    </p>
                )}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════════════════════════════ */

function shortPubkey(pub: string): string {
    if (pub.length <= 12) return pub;
    return `${pub.slice(0, 6)}...${pub.slice(-4)}`;
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function hashColor(key: string): string {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = key.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}, 55%, 55%)`;
}
