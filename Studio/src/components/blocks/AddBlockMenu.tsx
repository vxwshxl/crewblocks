'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    ADD_MENU_ORDER,
    BLOCK_SPECS,
    TOOL_LIBRARY,
    type BlockKind,
} from '@/lib/blocks';

interface AddBlockMenuProps {
    /** Kinds already in the stack that only allow one instance. */
    takenSingletons: BlockKind[];
    onAdd: (kind: BlockKind, toolId?: string) => void;
    /** 'full' is the button under the stack; 'inline' is the gap inserter. */
    variant?: 'full' | 'inline';
    label?: string;
}

export default function AddBlockMenu({
    takenSingletons,
    onAdd,
    variant = 'full',
    label = 'Add block',
}: AddBlockMenuProps) {
    const [open, setOpen] = useState(false);
    const [toolPicker, setToolPicker] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;

        const onPointerDown = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setOpen(false);
                setToolPicker(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
                setToolPicker(false);
                triggerRef.current?.focus();
            }
        };

        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const choose = (kind: BlockKind, toolId?: string) => {
        onAdd(kind, toolId);
        setOpen(false);
        setToolPicker(false);
    };

    return (
        <div ref={containerRef} className="relative">
            <button
                ref={triggerRef}
                type="button"
                onClick={() => {
                    setOpen((value) => !value);
                    setToolPicker(false);
                }}
                aria-expanded={open}
                aria-haspopup="menu"
                className={cn(
                    'flex items-center justify-center gap-2 rounded-md font-medium',
                    'transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    variant === 'full'
                        ? 'h-11 w-full border border-dashed border-border-strong text-sm text-muted-foreground hover:border-primary hover:bg-accent-subtle hover:text-foreground'
                        : 'size-6 border border-border bg-elevated text-muted-fg opacity-0 hover:border-primary hover:text-foreground focus-visible:opacity-100 group-hover/gap:opacity-100'
                )}
            >
                <Plus className={variant === 'full' ? 'size-4' : 'size-3'} aria-hidden />
                {variant === 'full' ? label : <span className="sr-only">{label}</span>}
            </button>

            {open && (
                <div
                    role="menu"
                    aria-label="Block types"
                    className={cn(
                        'animate-block-enter absolute z-50 w-[320px] overflow-hidden rounded-lg bg-elevated p-2 shadow-e3',
                        variant === 'full'
                            ? 'bottom-full left-1/2 mb-2 -translate-x-1/2'
                            : 'left-1/2 top-full mt-2 -translate-x-1/2'
                    )}
                >
                    {toolPicker ? (
                        <>
                            <div className="flex items-center gap-2 px-2 pb-2 pt-1">
                                <button
                                    type="button"
                                    onClick={() => setToolPicker(false)}
                                    className="rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                >
                                    ← Back
                                </button>
                                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-fg">
                                    Pick a tool
                                </span>
                            </div>
                            <div className="max-h-[320px] overflow-y-auto">
                                {TOOL_LIBRARY.map((tool) => (
                                    <button
                                        key={tool.id}
                                        type="button"
                                        role="menuitem"
                                        onClick={() => choose('tool', tool.id)}
                                        className="flex w-full min-h-11 flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors duration-[120ms] hover:bg-muted focus-visible:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                                    >
                                        <span className="text-xs font-medium text-foreground">
                                            {tool.name}
                                        </span>
                                        <span className="text-xs leading-4 text-muted-foreground">
                                            {tool.description}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : (
                        ADD_MENU_ORDER.map((kind) => {
                            const spec = BLOCK_SPECS[kind];
                            const Icon = spec.icon;
                            const taken = spec.singleton && takenSingletons.includes(kind);

                            return (
                                <button
                                    key={kind}
                                    type="button"
                                    role="menuitem"
                                    disabled={taken}
                                    onClick={() =>
                                        kind === 'tool' ? setToolPicker(true) : choose(kind)
                                    }
                                    className="flex w-full min-h-11 items-start gap-3 rounded-md px-3 py-2 text-left transition-colors duration-[120ms] hover:bg-muted focus-visible:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                                >
                                    <span
                                        aria-hidden
                                        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm"
                                        style={{ background: spec.washVar, color: spec.accentVar }}
                                    >
                                        <Icon className="size-3.5" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-1.5">
                                            <span className="text-xs font-medium text-foreground">
                                                {spec.label}
                                            </span>
                                            {taken && (
                                                <Check className="size-3 text-muted-fg" aria-hidden />
                                            )}
                                        </span>
                                        <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                                            {taken ? 'Already in this stack' : spec.description}
                                        </span>
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}
