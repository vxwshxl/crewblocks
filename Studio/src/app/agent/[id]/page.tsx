'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/client';
import BlockStackEditor from '@/components/blocks/BlockStackEditor';
import StackTopBar, { type Peer, type SaveState } from '@/components/blocks/StackTopBar';
import AnimatedLoader from '@/components/AnimatedLoader';
import Toast, { type ToastMessage } from '@/components/blocks/Toast';
import {
    emptyStack,
    readStack,
    validateStack,
    type BlockStack,
} from '@/lib/blocks';

/** Presence colours. Distinct hues, all legible on the dark surface. */
const PEER_COLORS = ['#F5A524', '#7C93FF', '#3ECF8E', '#FF6B60', '#E879F9', '#22D3EE'];

interface PresenceState {
    name: string;
    color: string;
    /** Which block this peer currently has focus in, if any. */
    focusedBlockId: string | null;
}

export default function AgentPage() {
    const params = useParams();
    const id = params.id as string;
    const supabase = useMemo(() => createClient(), []);

    const [stack, setStack] = useState<BlockStack>(emptyStack);
    const [name, setName] = useState('New agent');
    const [loading, setLoading] = useState(true);
    const [saveState, setSaveState] = useState<SaveState>('saved');
    const [toast, setToast] = useState<ToastMessage | null>(null);
    const [peers, setPeers] = useState<Record<string, PresenceState>>({});

    const channelRef = useRef<RealtimeChannel | null>(null);
    const selfIdRef = useRef<string>('');
    /** Guards the save effect against echoing a peer's change straight back. */
    const remoteRef = useRef(false);
    /** Skips the save that would otherwise fire on first render. */
    const loadedRef = useRef(false);

    const notify = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
        setToast({ text, tone, key: Date.now() });
    }, []);

    /* ---------------------------------------------------------- load + rt -- */

    useEffect(() => {
        let channel: RealtimeChannel | null = null;
        let cancelled = false;

        const load = async () => {
            const { data: row, error } = await supabase
                .from('chatflows')
                .select('name, data')
                .eq('id', id)
                .single();

            if (cancelled) return;

            if (error) {
                notify('Could not open this agent. Check the link and try again.', 'error');
                setLoading(false);
                return;
            }

            setName(row.name ?? 'New agent');
            setStack(readStack(row.data));

            const {
                data: { user },
            } = await supabase.auth.getUser();

            const selfId = user?.id ?? `guest-${Math.random().toString(36).slice(2, 10)}`;
            selfIdRef.current = selfId;

            const displayName =
                user?.user_metadata?.full_name ??
                user?.user_metadata?.name ??
                user?.email?.split('@')[0] ??
                'Guest';

            const color = PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)];

            if (cancelled) return;

            setLoading(false);
            loadedRef.current = true;

            channel = supabase.channel(`agent-${id}`, {
                config: { presence: { key: selfId }, broadcast: { self: false } },
            });
            channelRef.current = channel;

            channel
                .on('presence', { event: 'sync' }, () => {
                    const state = channel!.presenceState<PresenceState>();
                    const next: Record<string, PresenceState> = {};

                    for (const [key, entries] of Object.entries(state)) {
                        if (key === selfId) continue;
                        const entry = entries[0];
                        if (entry?.name) {
                            next[key] = {
                                name: entry.name,
                                color: entry.color,
                                focusedBlockId: entry.focusedBlockId ?? null,
                            };
                        }
                    }
                    setPeers(next);
                })
                .on('broadcast', { event: 'stack' }, (message) => {
                    // A peer saved; adopt their stack wholesale. Last write wins,
                    // which is right for a stack this small and this explicit.
                    remoteRef.current = true;
                    setStack(message.payload as BlockStack);
                    window.setTimeout(() => {
                        remoteRef.current = false;
                    }, 50);
                })
                .on('broadcast', { event: 'name' }, (message) => {
                    remoteRef.current = true;
                    setName(String(message.payload?.name ?? ''));
                    window.setTimeout(() => {
                        remoteRef.current = false;
                    }, 50);
                })
                .subscribe(async (status) => {
                    if (status === 'SUBSCRIBED') {
                        await channel!.track({ name: displayName, color, focusedBlockId: null });
                    }
                });
        };

        load();

        return () => {
            cancelled = true;
            channel?.unsubscribe();
            channelRef.current = null;
        };
    }, [id, supabase, notify]);

    /* -------------------------------------------------------------- save -- */

    // Debounced write-behind. The stack is small, so a whole-document upsert
    // is simpler and safer than diffing, and it matches the last-write-wins
    // model the broadcast above already assumes.
    useEffect(() => {
        if (!loadedRef.current || remoteRef.current) return;

        setSaveState('saving');
        const timer = window.setTimeout(async () => {
            const {
                data: { user },
            } = await supabase.auth.getUser();

            if (!user) {
                setSaveState('error');
                return;
            }

            const { error } = await supabase.from('chatflows').upsert({
                id,
                user_id: user.id,
                name,
                data: stack,
                updated_at: new Date().toISOString(),
            });

            if (error) {
                setSaveState('error');
                notify('Your last change did not save. Check your connection.', 'error');
                return;
            }

            setSaveState('saved');
            // Tell the side panel to pick up the new blocks.
            window.postMessage({ type: 'SYNC_BLOCKAGENT' }, '*');
        }, 800);

        return () => window.clearTimeout(timer);
    }, [stack, name, id, supabase, notify]);

    /* ----------------------------------------------------------- handlers -- */

    const onStackChange = useCallback((next: BlockStack) => {
        setStack(next);
        channelRef.current?.send({ type: 'broadcast', event: 'stack', payload: next });
    }, []);

    const onNameChange = useCallback((next: string) => {
        setName(next);
        channelRef.current?.send({ type: 'broadcast', event: 'name', payload: { name: next } });
    }, []);

    const onFocusBlock = useCallback((blockId: string | null) => {
        const channel = channelRef.current;
        if (!channel) return;
        const current = channel.presenceState<PresenceState>()[selfIdRef.current]?.[0];
        if (!current) return;
        channel.track({ ...current, focusedBlockId: blockId });
    }, []);

    /** blockId → the peer editing it, for the badge on the block header. */
    const editors = useMemo(() => {
        const map: Record<string, { name: string; color: string }> = {};
        for (const peer of Object.values(peers)) {
            if (peer.focusedBlockId) {
                map[peer.focusedBlockId] = { name: peer.name, color: peer.color };
            }
        }
        return map;
    }, [peers]);

    const peerList: Peer[] = useMemo(
        () => Object.entries(peers).map(([id, peer]) => ({ id, ...peer })),
        [peers]
    );

    const errorCount = useMemo(
        () => validateStack(stack).filter((i) => i.severity === 'error').length,
        [stack]
    );

    if (loading) return <AnimatedLoader type="flow" />;

    return (
        <div className="min-h-screen bg-background">
            <StackTopBar
                title={name}
                onTitleChange={onNameChange}
                saveState={saveState}
                errorCount={errorCount}
                peers={peerList}
            />

            <main>
                <BlockStackEditor
                    stack={stack}
                    onChange={onStackChange}
                    editors={editors}
                    onFocusBlock={onFocusBlock}
                    onError={(message) => notify(message, 'error')}
                    onNotice={(message) => notify(message, 'info')}
                />
            </main>

            <Toast message={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
