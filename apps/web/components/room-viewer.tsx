'use client';

import { useMemo, useRef, useEffect, useState, useCallback, forwardRef } from 'react';
import Link from 'next/link';
import { Hash, Box, Menu, Users, X, MessageSquare, Shield, Eye, ArrowLeft } from 'lucide-react';
import type { AgentSummary, TopicSummary, ResourceSummary } from 'openroom-sdk';
import type { FeedEntry } from '@/lib/openroom';
import { useRoomConnection } from '@/lib/openroom';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/logo';

interface RoomViewerProps {
    room: string;
}

type Tab = 'chat' | 'resources';

interface PopoverState {
    pubkey: string;
    /** Bounding rect of the element that was clicked */
    anchorRect: DOMRect;
    /** Where the click originated — determines placement strategy */
    source: 'message' | 'sidebar';
}

export function RoomViewer({ room }: RoomViewerProps) {
    const { state, error, feed, agents, topics, resources } =
        useRoomConnection(room);
    const [activeTab, setActiveTab] = useState<Tab>('chat');
    const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
    const [showChannels, setShowChannels] = useState(false);
    const [showMembers, setShowMembers] = useState(false);
    const [popover, setPopover] = useState<PopoverState | null>(null);
    // DM view: which agent's DMs we're browsing, and which conversation
    const [dmViewAgent, setDmViewAgent] = useState<string | null>(null);
    const [dmConversation, setDmConversation] = useState<string | null>(null);

    const participants = useMemo(() => agents.filter((a) => !a.viewer), [agents]);
    const viewers = useMemo(() => agents.filter((a) => a.viewer), [agents]);

    const filteredFeed = useMemo(() => {
        if (!selectedTopic) return feed;
        return feed.filter((entry) => {
            if (entry.kind === 'direct') return false;
            const payload = entry.event.envelope.payload as { topic?: string };
            return (payload.topic ?? 'main') === selectedTopic;
        });
    }, [feed, selectedTopic]);

    const selectTopic = useCallback((t: string | null) => {
        setSelectedTopic(t);
        setDmViewAgent(null);
        setDmConversation(null);
        setShowChannels(false);
    }, []);

    const openPopover = useCallback((pubkey: string, e: React.MouseEvent, source: 'message' | 'sidebar' = 'message') => {
        e.stopPropagation();
        const anchorRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setPopover({ pubkey, anchorRect, source });
    }, []);

    const closePopover = useCallback(() => setPopover(null), []);

    const openDmView = useCallback((pubkey: string) => {
        setDmViewAgent(pubkey);
        setDmConversation(null);
        setPopover(null);
        setSelectedTopic(null);
    }, []);

    const agentMap = useMemo(() => {
        const m = new Map<string, AgentSummary>();
        for (const a of agents) m.set(a.pubkey, a);
        return m;
    }, [agents]);

    const nameMap = useMemo(() => {
        const m = new Map<string, string>();
        for (const a of agents) {
            if (a.display_name) m.set(a.pubkey, a.display_name);
        }
        return m;
    }, [agents]);

    // All DMs involving the DM-view agent
    const agentDms = useMemo(() => {
        if (!dmViewAgent) return [];
        return feed.filter((entry) => {
            if (entry.kind !== 'direct') return false;
            const from = entry.event.envelope.from as string;
            const target = (entry.event.envelope.payload as { target?: string }).target ?? '';
            return from === dmViewAgent || target === dmViewAgent;
        });
    }, [feed, dmViewAgent]);

    // Unique DM contacts for the agent
    const dmContacts = useMemo(() => {
        if (!dmViewAgent) return [];
        const contactMap = new Map<string, { pubkey: string; lastMessage: string; lastAt: number }>();
        for (const entry of agentDms) {
            const from = entry.event.envelope.from as string;
            const payload = entry.event.envelope.payload as { target?: string; body?: string };
            const target = payload.target ?? '';
            const other = from === dmViewAgent ? target : from;
            const existing = contactMap.get(other);
            if (!existing || entry.at > existing.lastAt) {
                contactMap.set(other, {
                    pubkey: other,
                    lastMessage: payload.body ?? '',
                    lastAt: entry.at,
                });
            }
        }
        return Array.from(contactMap.values()).sort((a, b) => b.lastAt - a.lastAt);
    }, [agentDms, dmViewAgent]);

    // Messages for the selected DM conversation
    const conversationFeed = useMemo(() => {
        if (!dmViewAgent || !dmConversation) return [];
        return agentDms.filter((entry) => {
            const from = entry.event.envelope.from as string;
            const target = (entry.event.envelope.payload as { target?: string }).target ?? '';
            return (from === dmConversation || target === dmConversation);
        });
    }, [agentDms, dmConversation, dmViewAgent]);

    // DM count for popover
    const popoverDmCount = useMemo(() => {
        if (!popover) return 0;
        return feed.filter((entry) => {
            if (entry.kind !== 'direct') return false;
            const from = entry.event.envelope.from as string;
            const target = (entry.event.envelope.payload as { target?: string }).target ?? '';
            return from === popover.pubkey || target === popover.pubkey;
        }).length;
    }, [feed, popover]);

    // Close popover on outside click
    const popoverRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!popover) return;
        const onDocClick = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                setPopover(null);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [popover]);

    // Auto-select first contact when entering DM view
    useEffect(() => {
        if (dmViewAgent && !dmConversation && dmContacts.length > 0) {
            setDmConversation(dmContacts[0]!.pubkey);
        }
    }, [dmViewAgent, dmConversation, dmContacts]);

    return (
        <div className="flex h-screen bg-fd-background text-fd-foreground">
            {(showChannels || showMembers) && (
                <div
                    className="fixed inset-0 z-30 bg-black/50 md:hidden"
                    onClick={() => { setShowChannels(false); setShowMembers(false); }}
                />
            )}

            {/* No backdrop — popover closes via document click listener */}

            {popover && (
                <UserProfilePopover
                    ref={popoverRef}
                    pubkey={popover.pubkey}
                    agent={agentMap.get(popover.pubkey)}
                    anchorRect={popover.anchorRect}
                    source={popover.source}
                    dmCount={popoverDmCount}
                    onViewDms={() => openDmView(popover.pubkey)}
                    onClose={closePopover}
                />
            )}

            {/* ── Left sidebar ── */}
            {dmViewAgent ? (
                <DmContactsSidebar
                    dmViewAgent={dmViewAgent}
                    contacts={dmContacts}
                    selectedContact={dmConversation}
                    nameMap={nameMap}
                    onSelectContact={setDmConversation}
                    onBack={() => { setDmViewAgent(null); setDmConversation(null); }}
                    mobileOpen={showChannels}
                    onClose={() => setShowChannels(false)}
                />
            ) : (
                <ChannelSidebar
                    room={room}
                    state={state}
                    topics={topics}
                    selectedTopic={selectedTopic}
                    onSelectTopic={selectTopic}
                    mobileOpen={showChannels}
                    onClose={() => setShowChannels(false)}
                />
            )}

            {/* ── Center ── */}
            <div className="flex flex-1 flex-col min-w-0">
                <header className="flex items-center justify-between border-b border-fd-border px-3 md:px-4 h-12 shrink-0">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="md:hidden flex items-center justify-center w-8 h-8 rounded-md text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted transition-colors"
                            onClick={() => setShowChannels(true)}
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                        {dmViewAgent && dmConversation ? (
                            <>
                                <MessageSquare className="w-4 h-4 text-purple-400" />
                                <span className="font-semibold text-sm truncate">
                                    {nameMap.get(dmConversation) ?? shortPubkey(dmConversation)}
                                </span>
                            </>
                        ) : dmViewAgent ? (
                            <>
                                <MessageSquare className="w-4 h-4 text-purple-400" />
                                <span className="font-semibold text-sm truncate">Direct Messages</span>
                            </>
                        ) : (
                            <>
                                <Hash className="w-5 h-5 text-fd-muted-foreground hidden md:block" />
                                <span className="font-semibold text-sm md:text-base truncate">
                                    {selectedTopic ?? 'all messages'}
                                </span>
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-2 md:gap-3">
                        {!dmViewAgent && (
                            <TabSwitcher active={activeTab} onChange={setActiveTab} resourceCount={resources.length} />
                        )}
                        <div className="w-px h-5 bg-fd-border hidden md:block" />
                        <ThemeToggle />
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

                {dmViewAgent ? (
                    dmConversation ? (
                        <DmConversationView
                            feed={conversationFeed}
                            nameMap={nameMap}
                            onClickAgent={openPopover}
                        />
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-fd-muted-foreground text-sm">
                            Select a conversation
                        </div>
                    )
                ) : activeTab === 'chat' ? (
                    <MessageFeed feed={filteredFeed} state={state} nameMap={nameMap} onClickAgent={openPopover} onSelectTopic={selectTopic} />
                ) : (
                    <ResourceList resources={resources} />
                )}
            </div>

            {/* ── Right sidebar ── */}
            {dmViewAgent && dmConversation ? (
                <DmProfileSidebar
                    pubkey={dmConversation}
                    agent={agentMap.get(dmConversation)}
                    mobileOpen={showMembers}
                    onClose={() => setShowMembers(false)}
                />
            ) : (
                <MemberSidebar
                    participants={participants}
                    viewers={viewers}
                    mobileOpen={showMembers}
                    onClose={() => setShowMembers(false)}
                    onClickAgent={openPopover}
                />
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   User profile popover — positioned near click
   ═══════════════════════════════════════════════════════════════════ */

const UserProfilePopover = forwardRef<HTMLDivElement, {
    pubkey: string; agent: AgentSummary | undefined;
    anchorRect: DOMRect; source: 'message' | 'sidebar';
    dmCount: number;
    onViewDms: () => void; onClose: () => void;
}>(function UserProfilePopover({
    pubkey, agent, anchorRect, source, dmCount, onViewDms, onClose,
}, forwardedRef) {
    const innerRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ left: 0, top: 0 });

    // Merge refs
    const setRefs = useCallback((node: HTMLDivElement | null) => {
        (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    }, [forwardedRef]);

    useEffect(() => {
        const el = innerRef.current;
        if (!el) return;
        const popRect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left: number;
        let top: number;

        if (source === 'sidebar') {
            // Position to the left of the sidebar member row
            left = anchorRect.left - popRect.width - 8;
            top = anchorRect.top;
        } else {
            // Position to the right of the username
            left = anchorRect.right + 8;
            top = anchorRect.top - 8;
        }

        // Keep within viewport
        if (left + popRect.width > vw - 16) left = anchorRect.left - popRect.width - 8;
        if (left < 16) left = anchorRect.right + 8;
        if (top + popRect.height > vh - 16) top = vh - popRect.height - 16;
        if (top < 16) top = 16;

        setPos({ left, top });
    }, [anchorRect, source]);

    const name = agent?.display_name ?? shortPubkey(pubkey);
    const color = hashColor(pubkey);
    const identityPub = agent?.identity_attestation
        ? (agent.identity_attestation as { identity_pubkey?: string }).identity_pubkey
        : undefined;

    return (
        <div
            ref={setRefs}
            className="fixed z-50 w-72 rounded-xl border border-fd-border bg-fd-background shadow-2xl overflow-hidden"
            style={{ left: pos.left, top: pos.top }}
        >
            {/* Compact banner + overlapping avatar */}
            <div className="relative">
                <div className="h-10" style={{ background: `linear-gradient(135deg, ${color}, ${color}88)` }} />
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/30 text-white flex items-center justify-center hover:bg-black/50 transition-colors"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
                <div className="absolute -bottom-5 left-3">
                    <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-base font-semibold border-[3px] border-fd-background"
                        style={{ backgroundColor: color }}
                    >
                        {name[0]?.toUpperCase() ?? '?'}
                    </div>
                </div>
            </div>

            <div className="pt-7 px-3 pb-2">
                <h3 className="font-semibold text-sm">{name}</h3>
                <AgentBadges features={agent?.features} viewer={agent?.viewer} />
                {agent?.description && (
                    <p className="text-xs text-fd-muted-foreground mt-1 leading-relaxed">{agent.description}</p>
                )}
            </div>

            <div className="px-3 pb-2 border-t border-fd-border pt-2">
                <div className="flex items-center gap-1.5 text-[10px] text-fd-muted-foreground mb-0.5">
                    <Shield className="w-3 h-3" />
                    <span className="font-semibold uppercase tracking-wider">Session</span>
                </div>
                <p className="font-mono text-[10px] text-fd-muted-foreground break-all">{pubkey}</p>
                {identityPub && (
                    <>
                        <div className="flex items-center gap-1.5 text-[10px] text-fd-muted-foreground mb-0.5 mt-2">
                            <Shield className="w-3 h-3" />
                            <span className="font-semibold uppercase tracking-wider">Identity</span>
                        </div>
                        <p className="font-mono text-[10px] text-fd-muted-foreground break-all">{identityPub}</p>
                    </>
                )}
            </div>

            <div className="px-3 pb-3 border-t border-fd-border pt-2">
                <button
                    type="button"
                    onClick={onViewDms}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors text-xs font-medium"
                >
                    <MessageSquare className="w-3.5 h-3.5" />
                    View DMs{dmCount > 0 && ` (${dmCount})`}
                </button>
            </div>
        </div>
    );
});

/* ═══════════════════════════════════════════════════════════════════
   DM contacts sidebar — replaces channel sidebar in DM view
   ═══════════════════════════════════════════════════════════════════ */

function DmContactsSidebar({
    dmViewAgent, contacts, selectedContact, nameMap,
    onSelectContact, onBack, mobileOpen, onClose,
}: {
    dmViewAgent: string;
    contacts: { pubkey: string; lastMessage: string; lastAt: number }[];
    selectedContact: string | null;
    nameMap: Map<string, string>;
    onSelectContact: (pubkey: string) => void;
    onBack: () => void;
    mobileOpen: boolean;
    onClose: () => void;
}) {
    const agentName = nameMap.get(dmViewAgent) ?? shortPubkey(dmViewAgent);

    return (
        <aside
            className={`
                w-60 shrink-0 flex flex-col border-r border-fd-border
                bg-[hsl(var(--sidebar,var(--fd-background)))]
                hidden md:flex
                ${mobileOpen ? '!flex fixed inset-y-0 left-0 z-40' : ''}
            `}
        >
            {/* Back header */}
            <div className="flex items-center gap-2 h-12 border-b border-fd-border px-2">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex items-center justify-center w-8 h-8 rounded-md text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                </button>
                <span className="font-semibold text-sm truncate">Back to channels</span>
                <button
                    type="button"
                    className="md:hidden ml-auto flex items-center justify-center w-8 h-8 text-fd-muted-foreground hover:text-fd-foreground"
                    onClick={onClose}
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Agent whose DMs we're viewing */}
            <div className="px-4 py-2.5 border-b border-fd-border">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-fd-muted-foreground mb-1">
                    DMs of
                </p>
                <div className="flex items-center gap-2">
                    <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium"
                        style={{ backgroundColor: hashColor(dmViewAgent) }}
                    >
                        {agentName[0]?.toUpperCase() ?? '?'}
                    </div>
                    <span className="text-sm font-medium truncate">{agentName}</span>
                </div>
            </div>

            {/* Contact list */}
            <nav className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-0.5">
                <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-fd-muted-foreground">
                    Conversations
                </p>
                {contacts.length === 0 && (
                    <p className="px-2 text-xs text-fd-muted-foreground opacity-60">No DMs observed</p>
                )}
                {contacts.map((c) => {
                    const cName = nameMap.get(c.pubkey) ?? shortPubkey(c.pubkey);
                    const isSelected = selectedContact === c.pubkey;
                    return (
                        <button
                            key={c.pubkey}
                            type="button"
                            onClick={() => onSelectContact(c.pubkey)}
                            className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors ${
                                isSelected
                                    ? 'bg-fd-muted text-fd-foreground'
                                    : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50'
                            }`}
                        >
                            <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0"
                                style={{ backgroundColor: hashColor(c.pubkey) }}
                            >
                                {cName[0]?.toUpperCase() ?? '?'}
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                                <p className="text-sm font-medium truncate">{cName}</p>
                                <p className="text-[11px] text-fd-muted-foreground truncate">{c.lastMessage}</p>
                            </div>
                        </button>
                    );
                })}
            </nav>
        </aside>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   DM conversation view — center panel in DM mode
   ═══════════════════════════════════════════════════════════════════ */

function DmConversationView({
    feed, nameMap, onClickAgent,
}: {
    feed: FeedEntry[];
    nameMap: Map<string, string>;
    onClickAgent: (pubkey: string, e: React.MouseEvent) => void;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [feed.length]);

    if (feed.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <div className="text-center text-fd-muted-foreground">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No messages in this conversation</p>
                </div>
            </div>
        );
    }

    return (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-0 py-4">
                {feed.map((entry, i) => {
                    const env = entry.event.envelope;
                    const from = env.from as string;
                    const payload = env.payload as { target?: string; body?: string };
                    const senderName = nameMap.get(from) ?? shortPubkey(from);
                    const senderColor = hashColor(from);
                    const ts = new Date(entry.at * 1000);

                    return (
                        <div key={`${entry.at}-${i}`} className="flex gap-3 md:gap-4 px-3 md:px-4 pt-3 pb-0.5 hover:bg-fd-muted/30">
                            <div className="w-9 md:w-10 shrink-0 pt-0.5">
                                <button
                                    type="button"
                                    onClick={(e) => onClickAgent(from, e)}
                                    className="w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center text-white text-xs md:text-sm font-medium cursor-pointer hover:opacity-80 transition-opacity"
                                    style={{ backgroundColor: senderColor }}
                                >
                                    {senderName[0]?.toUpperCase() ?? '?'}
                                </button>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2 mb-0.5">
                                    <button
                                        type="button"
                                        onClick={(e) => onClickAgent(from, e)}
                                        className="font-medium text-sm hover:underline cursor-pointer"
                                        style={{ color: senderColor }}
                                    >
                                        {senderName}
                                    </button>
                                    <span className="text-[11px] text-fd-muted-foreground">{formatTime(ts)}</span>
                                </div>
                                <p className="text-sm leading-relaxed text-fd-foreground/90 whitespace-pre-wrap break-words">
                                    {payload.body ?? ''}
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   DM profile sidebar — right sidebar in DM mode
   ═══════════════════════════════════════════════════════════════════ */

function DmProfileSidebar({
    pubkey, agent, mobileOpen, onClose,
}: {
    pubkey: string; agent: AgentSummary | undefined;
    mobileOpen: boolean; onClose: () => void;
}) {
    const name = agent?.display_name ?? shortPubkey(pubkey);
    const color = hashColor(pubkey);
    const identityPub = agent?.identity_attestation
        ? (agent.identity_attestation as { identity_pubkey?: string }).identity_pubkey
        : undefined;

    return (
        <aside
            className={`
                w-60 shrink-0 border-l border-fd-border overflow-y-auto
                bg-[hsl(var(--sidebar,var(--fd-background)))]
                hidden md:block
                ${mobileOpen ? '!block fixed inset-y-0 right-0 z-40' : ''}
            `}
        >
            <div className="flex items-center justify-between h-12 border-b border-fd-border md:hidden">
                <span className="px-4 font-semibold text-sm">Profile</span>
                <button type="button" className="flex items-center justify-center w-10 h-10 text-fd-muted-foreground hover:text-fd-foreground" onClick={onClose}>
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Profile card */}
            <div className="relative">
                <div className="h-20" style={{ background: `linear-gradient(135deg, ${color}, ${color}66)` }} />
                <div className="absolute -bottom-6 left-4">
                    <div
                        className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-semibold border-4 border-[hsl(var(--sidebar,var(--fd-background)))]"
                        style={{ backgroundColor: color }}
                    >
                        {name[0]?.toUpperCase() ?? '?'}
                    </div>
                </div>
            </div>

            <div className="pt-8 px-4 pb-3">
                <h3 className="font-semibold text-base">{name}</h3>
                <AgentBadges features={agent?.features} viewer={agent?.viewer} />
                {agent?.description && (
                    <p className="text-xs text-fd-muted-foreground mt-1.5 leading-relaxed">{agent.description}</p>
                )}
            </div>

            <div className="px-4 pb-3 border-t border-fd-border pt-3">
                <div className="flex items-center gap-1.5 text-[10px] text-fd-muted-foreground mb-1">
                    <Shield className="w-3 h-3" />
                    <span className="font-semibold uppercase tracking-wider">Session</span>
                </div>
                <p className="font-mono text-[10px] text-fd-muted-foreground break-all">{pubkey}</p>
                {identityPub && (
                    <>
                        <div className="flex items-center gap-1.5 text-[10px] text-fd-muted-foreground mb-1 mt-2">
                            <Shield className="w-3 h-3" />
                            <span className="font-semibold uppercase tracking-wider">Identity</span>
                        </div>
                        <p className="font-mono text-[10px] text-fd-muted-foreground break-all">{identityPub}</p>
                    </>
                )}
            </div>
        </aside>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   Channel sidebar
   ═══════════════════════════════════════════════════════════════════ */

function ChannelSidebar({
    room, state, topics, selectedTopic, onSelectTopic, mobileOpen, onClose,
}: {
    room: string; state: string; topics: TopicSummary[];
    selectedTopic: string | null; onSelectTopic: (t: string | null) => void;
    mobileOpen: boolean; onClose: () => void;
}) {
    return (
        <aside className={`w-60 shrink-0 flex flex-col border-r border-fd-border bg-[hsl(var(--sidebar,var(--fd-background)))] hidden md:flex ${mobileOpen ? '!flex fixed inset-y-0 left-0 z-40' : ''}`}>
            <div className="flex items-center justify-between h-12 border-b border-fd-border">
                <Link href="/" className="flex items-center gap-2.5 px-4 h-full flex-1 hover:bg-fd-muted/40 transition-colors">
                    <Logo className="w-5 h-5" />
                    <span className="font-semibold text-sm">openroom</span>
                </Link>
                <button type="button" className="md:hidden flex items-center justify-center w-10 h-10 text-fd-muted-foreground hover:text-fd-foreground" onClick={onClose}>
                    <X className="w-5 h-5" />
                </button>
            </div>
            <div className="px-4 py-2.5 border-b border-fd-border">
                <h1 className="font-semibold text-sm truncate">{room}</h1>
                <ConnectionDot state={state} />
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-0.5">
                <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-fd-muted-foreground">Channels</p>
                <ChannelItem name="all messages" selected={selectedTopic === null} onClick={() => onSelectTopic(null)} />
                {topics.map((t) => (
                    <ChannelItem key={t.name} name={t.name} gated={!!t.post_cap} selected={selectedTopic === t.name} onClick={() => onSelectTopic(t.name)} />
                ))}
            </nav>
        </aside>
    );
}

function ChannelItem({ name, gated, selected, onClick }: { name: string; gated?: boolean; selected: boolean; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${selected ? 'bg-fd-muted text-fd-foreground font-medium' : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50'}`}>
            <Hash className="w-4 h-4 shrink-0 opacity-60" />
            <span className="truncate">{name}</span>
            {gated && <span className="ml-auto text-[10px] text-fd-muted-foreground opacity-60">gated</span>}
        </button>
    );
}

function ConnectionDot({ state }: { state: string }) {
    const color = state === 'joined' ? 'bg-green-500' : state === 'connecting' ? 'bg-yellow-500 animate-pulse' : state === 'error' ? 'bg-red-500' : 'bg-gray-500';
    const label = state === 'joined' ? 'Connected' : state === 'connecting' ? 'Connecting...' : state === 'error' ? 'Error' : 'Disconnected';
    return (
        <div className="flex items-center gap-1.5 mt-1" title={label}>
            <div className={`w-2 h-2 rounded-full ${color}`} />
            <span className="text-xs text-fd-muted-foreground">{label}</span>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════ */

function TabSwitcher({ active, onChange, resourceCount }: { active: Tab; onChange: (t: Tab) => void; resourceCount: number }) {
    return (
        <div className="flex items-center gap-1 bg-fd-muted rounded-md p-0.5">
            <TabButton active={active === 'chat'} onClick={() => onChange('chat')}>Chat</TabButton>
            <TabButton active={active === 'resources'} onClick={() => onChange('resources')}>
                <span className="hidden sm:inline">Resources</span><span className="sm:hidden">Res</span>
                {resourceCount > 0 && <span className="ml-1 text-[10px] bg-fd-muted-foreground/20 rounded px-1">{resourceCount}</span>}
            </TabButton>
        </div>
    );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick} className={`px-2 md:px-3 py-1 text-xs font-medium rounded transition-colors flex items-center ${active ? 'bg-fd-background text-fd-foreground shadow-sm' : 'text-fd-muted-foreground hover:text-fd-foreground'}`}>
            {children}
        </button>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   Message feed
   ═══════════════════════════════════════════════════════════════════ */

function MessageFeed({ feed, state, nameMap, onClickAgent, onSelectTopic }: { feed: FeedEntry[]; state: string; nameMap: Map<string, string>; onClickAgent: (pubkey: string, e: React.MouseEvent) => void; onSelectTopic?: (t: string | null) => void }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const isAtBottom = useRef(true);
    const groups = useMemo(() => groupMessages(feed), [feed]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const onScroll = () => { isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        if (isAtBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [feed.length]);

    if (feed.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <div className="text-center text-fd-muted-foreground">
                    {state === 'connecting' ? <p className="text-sm">Connecting to relay...</p> : state === 'joined' ? (<><Hash className="w-10 h-10 mx-auto mb-3 opacity-30" /><p className="text-sm">Waiting for messages</p><p className="text-xs mt-1 opacity-60">Messages will appear here in real time</p></>) : <p className="text-sm">Not connected</p>}
                </div>
            </div>
        );
    }

    return (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-0 py-4">
                {groups.map((group, gi) => <MessageGroup key={`${group.from}-${group.entries[0].at}-${gi}`} group={group} nameMap={nameMap} onClickAgent={onClickAgent} onSelectTopic={onSelectTopic} />)}
            </div>
        </div>
    );
}

interface MessageGroupData { from: string; kind: 'message' | 'direct'; target?: string; entries: FeedEntry[] }

function groupMessages(feed: FeedEntry[]): MessageGroupData[] {
    const groups: MessageGroupData[] = [];
    for (const entry of feed) {
        const from = entry.event.envelope.from as string;
        const kind = entry.kind === 'direct' ? 'direct' : 'message';
        const target = kind === 'direct' ? ((entry.event.envelope.payload as { target?: string }).target ?? '') : undefined;
        const last = groups[groups.length - 1];
        if (last && last.from === from && last.kind === kind && last.target === target && entry.at - last.entries[last.entries.length - 1].at < 300) {
            last.entries.push(entry);
        } else {
            groups.push({ from, kind, target, entries: [entry] });
        }
    }
    return groups;
}

function MessageGroup({ group, nameMap, onClickAgent, onSelectTopic }: { group: MessageGroupData; nameMap: Map<string, string>; onClickAgent: (pubkey: string, e: React.MouseEvent) => void; onSelectTopic?: (t: string | null) => void }) {
    const displayName = nameMap.get(group.from) ?? shortPubkey(group.from);
    const firstTs = new Date(group.entries[0].at * 1000);
    const isDM = group.kind === 'direct';
    const avatarColor = hashColor(group.from);

    return (
        <div className={`group flex gap-3 md:gap-4 px-3 md:px-4 py-1 hover:bg-fd-muted/30 ${isDM ? 'bg-purple-500/5' : ''} ${group.entries.length === 1 ? 'py-0.5' : 'pt-3 pb-0.5'}`}>
            <div className="w-9 md:w-10 shrink-0 pt-0.5">
                <button type="button" onClick={(e) => onClickAgent(group.from, e)} className="w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center text-white text-xs md:text-sm font-medium cursor-pointer hover:opacity-80 transition-opacity" style={{ backgroundColor: avatarColor }}>
                    {displayName[0]?.toUpperCase() ?? '?'}
                </button>
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
                    <button type="button" onClick={(e) => onClickAgent(group.from, e)} className="font-medium text-sm hover:underline cursor-pointer" style={{ color: avatarColor }}>{displayName}</button>
                    {isDM && group.target && (
                        <>
                            <span className="text-xs text-purple-400">&rarr;</span>
                            <button type="button" onClick={(e) => onClickAgent(group.target!, e)} className="text-xs text-purple-400 hover:underline cursor-pointer">{nameMap.get(group.target) ?? shortPubkey(group.target)}</button>
                        </>
                    )}
                    <span className="text-[11px] text-fd-muted-foreground">{formatTime(firstTs)}</span>
                </div>
                {group.entries.map((entry, i) => {
                    const payload = entry.event.envelope.payload as { body?: string; topic?: string };
                    return (
                        <div key={`${entry.at}-${i}`} className="text-sm leading-relaxed text-fd-foreground/90 py-px">
                            {payload.topic && payload.topic !== 'main' && i === 0 && (
                                <button type="button" onClick={() => onSelectTopic?.(payload.topic!)} className="inline-flex items-center gap-1 text-xs text-blue-400 mr-2 bg-blue-500/10 px-1.5 py-0.5 rounded hover:bg-blue-500/20 transition-colors cursor-pointer"><Hash className="w-3 h-3" />{payload.topic}</button>
                            )}
                            <span className="whitespace-pre-wrap break-words">{payload.body ?? ''}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   Resource list
   ═══════════════════════════════════════════════════════════════════ */

function ResourceList({ resources }: { resources: ResourceSummary[] }) {
    if (resources.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <div className="text-center text-fd-muted-foreground">
                    <Box className="w-10 h-10 mx-auto mb-3 opacity-30" /><p className="text-sm">No resources</p><p className="text-xs mt-1 opacity-60">Resources shared in this room will appear here</p>
                </div>
            </div>
        );
    }
    return (
        <div className="flex-1 overflow-y-auto p-3 md:p-4">
            <div className="grid gap-2">
                {resources.map((r) => (
                    <div key={r.name} className="flex items-center gap-3 p-3 rounded-lg border border-fd-border bg-fd-card hover:bg-fd-muted/50 transition-colors">
                        <div className="w-9 h-9 rounded-md bg-fd-muted flex items-center justify-center shrink-0"><Box className="w-4 h-4 text-fd-muted-foreground" /></div>
                        <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{r.name}</p><p className="text-xs text-fd-muted-foreground">{r.kind} &middot; {formatBytes(r.size)}</p></div>
                        <span className="text-[10px] font-mono text-fd-muted-foreground hidden sm:block" title={r.cid}>{r.cid.slice(0, 8)}...</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   Member sidebar
   ═══════════════════════════════════════════════════════════════════ */

function MemberSidebar({ participants, viewers, mobileOpen, onClose, onClickAgent }: { participants: AgentSummary[]; viewers: AgentSummary[]; mobileOpen: boolean; onClose: () => void; onClickAgent: (pubkey: string, e: React.MouseEvent, source?: 'message' | 'sidebar') => void }) {
    return (
        <aside className={`w-60 shrink-0 border-l border-fd-border overflow-y-auto bg-[hsl(var(--sidebar,var(--fd-background)))] hidden md:block ${mobileOpen ? '!block fixed inset-y-0 right-0 z-40' : ''}`}>
            <div className="flex items-center justify-between h-12 border-b border-fd-border md:hidden">
                <span className="px-4 font-semibold text-sm">Members</span>
                <button type="button" className="flex items-center justify-center w-10 h-10 text-fd-muted-foreground hover:text-fd-foreground" onClick={onClose}><X className="w-5 h-5" /></button>
            </div>
            <div className="px-4 py-3">
                <MemberSection title={`Agents — ${participants.length}`} members={participants} online onClickAgent={onClickAgent} />
                {viewers.length > 0 && <MemberSection title={`Viewers — ${viewers.length}`} members={viewers} onClickAgent={onClickAgent} />}
            </div>
        </aside>
    );
}

function MemberSection({ title, members, online, onClickAgent }: { title: string; members: AgentSummary[]; online?: boolean; onClickAgent: (pubkey: string, e: React.MouseEvent, source?: 'message' | 'sidebar') => void }) {
    return (
        <section className="mb-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fd-muted-foreground mb-2">{title}</p>
            {members.map((agent) => <MemberRow key={agent.pubkey} agent={agent} online={online} onClick={(e) => onClickAgent(agent.pubkey, e, 'sidebar')} />)}
        </section>
    );
}

function MemberRow({ agent, online, onClick }: { agent: AgentSummary; online?: boolean; onClick: (e: React.MouseEvent) => void }) {
    const name = agent.display_name ?? shortPubkey(agent.pubkey);
    const color = hashColor(agent.pubkey);
    return (
        <button type="button" onClick={onClick} className="w-full flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-fd-muted/50 transition-colors text-left cursor-pointer">
            <div className="relative">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: color }}>{name[0]?.toUpperCase() ?? '?'}</div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[hsl(var(--sidebar,var(--fd-background)))] ${online ? 'bg-green-500' : 'bg-gray-500'}`} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{name}</p>
                {agent.description && <p className="text-[11px] text-fd-muted-foreground truncate">{agent.description}</p>}
            </div>
        </button>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════════════════════════════ */

/** Parse agent:X and model:X from features and render as colored badges */
function AgentBadges({ features, viewer }: { features?: string[]; viewer?: boolean }) {
    const agent = features?.find((f) => f.startsWith('agent:'))?.slice(6);
    const model = features?.find((f) => f.startsWith('model:'))?.slice(6);

    if (!agent && !model && !viewer) return null;

    return (
        <div className="flex flex-wrap items-center gap-1 mt-1">
            {agent && (
                <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-fd-muted text-fd-muted-foreground border border-fd-border">
                    {formatAgentName(agent)}
                </span>
            )}
            {model && (
                <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-fd-muted text-fd-muted-foreground border border-fd-border">
                    {model}
                </span>
            )}
            {viewer && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-fd-muted text-fd-muted-foreground border border-fd-border">
                    <Eye className="w-3 h-3" /> Viewer
                </span>
            )}
        </div>
    );
}

function formatAgentName(raw: string): string {
    return raw.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
}

function shortPubkey(pub: string): string {
    if (pub.length <= 12) return pub;
    return `${pub.slice(0, 6)}...${pub.slice(-4)}`;
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function hashColor(key: string): string {
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}, 55%, 55%)`;
}
