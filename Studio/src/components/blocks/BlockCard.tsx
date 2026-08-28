'use client';

import React, { useRef, useState } from 'react';
import {
    ChevronDown,
    GripVertical,
    Copy,
    Trash2,
    AlertTriangle,
    Pencil,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import BlockBody from './BlockBody';
import { BLOCK_SPECS, type Block, type StackIssue } from '@/lib/blocks';

interface BlockCardProps {
    block: Block;
    index: number;
    total: number;
    expanded: boolean;
    issues: StackIssue[];
    /** Set while another user is editing this block. */
    editedBy: { name: string; color: string } | null;
    dragging: boolean;
    dropTarget: boolean;
    onToggleExpanded: () => void;
    onChange: (block: Block) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onMove: (direction: -1 | 1) => void;
    onDragStart: () => void;
    onDragEnter: () => void;
    onDragEnd: () => void;
}

export default function BlockCard({
    block,
    index,
    total,
    expanded,
    issues,
    editedBy,
    dragging,
    dropTarget,
    onToggleExpanded,
    onChange,
    onDuplicate,
    onDelete,
    onMove,
    onDragStart,
    onDragEnter,
    onDragEnd,
}: BlockCardProps) {
    const spec = BLOCK_SPECS[block.kind];
    const Icon = spec.icon;
    const [renaming, setRenaming] = useState(false);
    const bodyId = `${block.id}-body`;
    const cardRef = useRef<HTMLDivElement>(null);

    const worst = issues.find((i) => i.severity === 'error') ?? issues[0];

    /** Alt + arrow reorders without a mouse. */
    const onKeyDown = (event: React.KeyboardEvent) => {
        if (!event.altKey) return;
        if (event.key === 'ArrowUp' && index > 0) {
            event.preventDefault();
            onMove(-1);
            requestAnimationFrame(() => cardRef.current?.focus());
        }
        if (event.key === 'ArrowDown' && index < total - 1) {
            event.preventDefault();
            onMove(1);
            requestAnimationFrame(() => cardRef.current?.focus());
        }
    };

    return (
        <div
            ref={cardRef}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            onDragEnter={onDragEnter}
            onDragOver={(event) => event.preventDefault()}
            aria-label={`${spec.label} block, ${index + 1} of ${total}`}
            className={cn(
                'group/block rounded-lg bg-elevated shadow-e1 outline-none',
                'transition-[box-shadow,opacity] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
                'focus-visible:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                !block.enabled && 'opacity-60',
                dragging && 'block-dragging',
                dropTarget && 'block-drop-target'
            )}
        >
            {/* Header — the whole row toggles, so the target is generous. */}
            <div className="flex items-start gap-3 p-4">
                <button
                    type="button"
                    draggable
                    onDragStart={(event) => {
                        // Firefox refuses to start a drag without payload.
                        event.dataTransfer.setData('text/plain', block.id);
                        event.dataTransfer.effectAllowed = 'move';
                        onDragStart();
                    }}
                    onDragEnd={onDragEnd}
                    aria-label={`Reorder ${spec.label}. Or press Alt with the arrow keys.`}
                    className="mt-1 flex size-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-fg opacity-0 transition-opacity duration-[120ms] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing group-hover/block:opacity-100 group-focus-within/block:opacity-100"
                >
                    <GripVertical className="size-4" />
                </button>

                <span
                    aria-hidden
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md"
                    style={{ background: spec.washVar, color: spec.accentVar }}
                >
                    <Icon className="size-4" />
                </span>

                <button
                    type="button"
                    onClick={onToggleExpanded}
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                    <span className="flex items-center gap-2">
                        {renaming ? (
                            <input
                                autoFocus
                                value={block.title}
                                aria-label="Block name"
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => onChange({ ...block, title: event.target.value })}
                                onBlur={() => setRenaming(false)}
                                onKeyDown={(event) => {
                                    event.stopPropagation();
                                    if (event.key === 'Enter' || event.key === 'Escape') {
                                        setRenaming(false);
                                    }
                                }}
                                className="w-full border-b border-primary bg-transparent text-sm font-medium text-foreground outline-none"
                            />
                        ) : (
                            <>
                                <span className="truncate text-sm font-medium text-foreground">
                                    {block.title}
                                </span>
                                <span
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Rename ${block.title}`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setRenaming(true);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setRenaming(true);
                                        }
                                    }}
                                    className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-fg opacity-0 transition-opacity duration-[120ms] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring group-hover/block:opacity-100"
                                >
                                    <Pencil className="size-3" />
                                </span>
                            </>
                        )}
                    </span>

                    {!expanded && (
                        <span className="mt-1 block truncate text-xs leading-4 text-muted-foreground">
                            {spec.summary(block)}
                        </span>
                    )}
                </button>

                <div className="flex shrink-0 items-center gap-1">
                    {editedBy && (
                        <span
                            title={`${editedBy.name} is editing this block`}
                            className="mr-1 hidden items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium sm:inline-flex"
                            style={{ background: `${editedBy.color}22`, color: editedBy.color }}
                        >
                            <span
                                aria-hidden
                                className="size-1.5 rounded-full"
                                style={{ background: editedBy.color }}
                            />
                            {editedBy.name}
                        </span>
                    )}

                    {!block.enabled && (
                        <span className="mr-1 hidden rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground sm:inline-block">
                            Skipped
                        </span>
                    )}

                    <Switch
                        size="sm"
                        checked={block.enabled}
                        onCheckedChange={(enabled) => onChange({ ...block, enabled })}
                        aria-label={`${block.enabled ? 'Skip' : 'Use'} ${block.title}`}
                        className={cn(
                            'mt-1.5 transition-opacity duration-[120ms]',
                            block.enabled &&
                                'opacity-0 focus-visible:opacity-100 group-hover/block:opacity-100 group-focus-within/block:opacity-100'
                        )}
                    />

                    <button
                        type="button"
                        onClick={onDuplicate}
                        aria-label={`Duplicate ${block.title}`}
                        className="flex size-8 items-center justify-center rounded-md text-muted-fg opacity-0 transition-[opacity,color,background] duration-[120ms] hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring group-hover/block:opacity-100 group-focus-within/block:opacity-100"
                    >
                        <Copy className="size-3.5" />
                    </button>

                    <button
                        type="button"
                        onClick={onDelete}
                        aria-label={`Remove ${block.title}`}
                        className="flex size-8 items-center justify-center rounded-md text-muted-fg opacity-0 transition-[opacity,color,background] duration-[120ms] hover:bg-destructive/15 hover:text-danger focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring group-hover/block:opacity-100 group-focus-within/block:opacity-100"
                    >
                        <Trash2 className="size-3.5" />
                    </button>

                    <button
                        type="button"
                        onClick={onToggleExpanded}
                        aria-expanded={expanded}
                        aria-controls={bodyId}
                        aria-label={`${expanded ? 'Collapse' : 'Configure'} ${block.title}`}
                        className="flex size-8 items-center justify-center rounded-md text-muted-fg transition-colors duration-[120ms] hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                        <ChevronDown
                            className={cn(
                                'size-4 transition-transform duration-[180ms] ease-[cubic-bezier(0.2,0,0,1)]',
                                expanded && 'rotate-180'
                            )}
                        />
                    </button>
                </div>
            </div>

            {worst && (
                <p
                    className={cn(
                        'flex items-start gap-2 px-4 pb-3 text-xs leading-4',
                        worst.severity === 'error' ? 'text-danger' : 'text-warning'
                    )}
                >
                    <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                    {worst.message}
                </p>
            )}

            {expanded && (
                <div id={bodyId} className="animate-block-enter border-t border-border p-5">
                    <BlockBody block={block} onChange={onChange} />
                </div>
            )}
        </div>
    );
}
