'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronLeft, Check, Loader2, AlertTriangle, PanelRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SaveState = 'saved' | 'saving' | 'error';

export interface Peer {
    id: string;
    name: string;
    color: string;
}

interface StackTopBarProps {
    title: string;
    onTitleChange: (title: string) => void;
    saveState: SaveState;
    /** Blocking problems with the stack, surfaced as a count. */
    errorCount: number;
    peers: Peer[];
}

const SAVE_COPY: Record<SaveState, string> = {
    saved: 'All changes saved',
    saving: 'Saving…',
    error: 'Could not save',
};

export default function StackTopBar({
    title,
    onTitleChange,
    saveState,
    errorCount,
    peers,
}: StackTopBarProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(title);
    const inputRef = useRef<HTMLInputElement>(null);

    // A peer can rename the agent mid-edit. Re-sync during render rather than
    // in an effect, so the field never shows one frame of the stale name.
    const [syncedTitle, setSyncedTitle] = useState(title);
    if (syncedTitle !== title) {
        setSyncedTitle(title);
        if (!editing) setDraft(title);
    }

    const commit = () => {
        setEditing(false);
        const next = draft.trim();
        if (next && next !== title) onTitleChange(next);
        else setDraft(title);
    };

    return (
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-xl">
            <div className="flex min-w-0 items-center gap-2">
                <Link
                    href="/dashboard"
                    aria-label="Back to your agents"
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                    <ChevronLeft className="size-4" />
                </Link>

                <Image src="/logoCS.png" alt="" width={24} height={24} className="shrink-0" />

                {editing ? (
                    <input
                        ref={inputRef}
                        autoFocus
                        value={draft}
                        aria-label="Agent name"
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') commit();
                            if (event.key === 'Escape') {
                                setDraft(title);
                                setEditing(false);
                            }
                        }}
                        className="ml-1 w-48 border-b border-primary bg-transparent text-sm font-medium text-foreground outline-none"
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="ml-1 truncate rounded-sm px-1 text-sm font-medium text-foreground transition-colors duration-[120ms] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                        {title}
                    </button>
                )}
            </div>

            <div className="flex shrink-0 items-center gap-3">
                {errorCount > 0 && (
                    <span className="hidden items-center gap-1.5 rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-medium text-danger sm:inline-flex">
                        <AlertTriangle className="size-3" aria-hidden />
                        {errorCount} to fix
                    </span>
                )}

                <span
                    aria-live="polite"
                    className={cn(
                        'hidden items-center gap-1.5 text-xs sm:inline-flex',
                        saveState === 'error' ? 'text-danger' : 'text-muted-foreground'
                    )}
                >
                    {saveState === 'saving' ? (
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                    ) : saveState === 'error' ? (
                        <AlertTriangle className="size-3" aria-hidden />
                    ) : (
                        <Check className="size-3" aria-hidden />
                    )}
                    {SAVE_COPY[saveState]}
                </span>

                {peers.length > 0 && (
                    <ul
                        aria-label={`${peers.length} other ${peers.length === 1 ? 'person' : 'people'} editing`}
                        className="flex -space-x-2"
                    >
                        {peers.slice(0, 4).map((peer) => (
                            <li
                                key={peer.id}
                                title={peer.name}
                                className="flex size-7 items-center justify-center rounded-full border-2 border-background text-[11px] font-semibold uppercase text-background"
                                style={{ background: peer.color }}
                            >
                                {peer.name.slice(0, 1)}
                            </li>
                        ))}
                        {peers.length > 4 && (
                            <li className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[11px] font-semibold text-muted-foreground">
                                +{peers.length - 4}
                            </li>
                        )}
                    </ul>
                )}

                <button
                    type="button"
                    onClick={() => window.postMessage({ type: 'TOGGLE_BLOCKAGENT' }, '*')}
                    className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-[opacity,transform] duration-[120ms] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95"
                >
                    <PanelRight className="size-3.5" aria-hidden />
                    Run it
                </button>
            </div>
        </header>
    );
}
