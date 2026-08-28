'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Blocks, AlertTriangle } from 'lucide-react';
import BlockCard from './BlockCard';
import AddBlockMenu from './AddBlockMenu';
import StackComposer from './StackComposer';
import {
    BLOCK_SPECS,
    createBlock,
    validateStack,
    type Block,
    type BlockKind,
    type BlockStack,
} from '@/lib/blocks';

interface BlockStackEditorProps {
    stack: BlockStack;
    onChange: (stack: BlockStack) => void;
    /** blockId → who is editing it, from Supabase presence. */
    editors: Record<string, { name: string; color: string }>;
    /** Announces which block this user is on, so peers see it. */
    onFocusBlock: (blockId: string | null) => void;
    onError: (message: string) => void;
    onNotice: (message: string) => void;
}

export default function BlockStackEditor({
    stack,
    onChange,
    editors,
    onFocusBlock,
    onError,
    onNotice,
}: BlockStackEditorProps) {
    const [expanded, setExpanded] = useState<string | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);

    const issues = useMemo(() => validateStack(stack), [stack]);
    const stackIssues = issues.filter((i) => !i.blockId);
    const errorCount = issues.filter((i) => i.severity === 'error').length;

    const takenSingletons = useMemo(
        () =>
            stack.blocks
                .filter((b) => BLOCK_SPECS[b.kind].singleton)
                .map((b) => b.kind),
        [stack.blocks]
    );

    const setBlocks = useCallback(
        (blocks: Block[]) => onChange({ ...stack, blocks }),
        [onChange, stack]
    );

    const updateBlock = useCallback(
        (next: Block) => {
            setBlocks(stack.blocks.map((b) => (b.id === next.id ? next : b)));
        },
        [setBlocks, stack.blocks]
    );

    const addBlock = useCallback(
        (kind: BlockKind, toolId?: string, atIndex?: number) => {
            const block = createBlock(kind, toolId);
            const blocks = [...stack.blocks];
            blocks.splice(atIndex ?? blocks.length, 0, block);
            setBlocks(blocks);
            setExpanded(block.id);
        },
        [setBlocks, stack.blocks]
    );

    const duplicateBlock = useCallback(
        (id: string) => {
            const index = stack.blocks.findIndex((b) => b.id === id);
            if (index < 0) return;

            const source = stack.blocks[index];
            if (BLOCK_SPECS[source.kind].singleton) {
                onNotice(`An agent can only have one ${BLOCK_SPECS[source.kind].label} block.`);
                return;
            }

            const copy = {
                ...structuredClone(source),
                id: `${source.kind}-${Math.random().toString(36).slice(2, 10)}`,
            };
            const blocks = [...stack.blocks];
            blocks.splice(index + 1, 0, copy);
            setBlocks(blocks);
        },
        [onNotice, setBlocks, stack.blocks]
    );

    const deleteBlock = useCallback(
        (id: string) => {
            const removed = stack.blocks.find((b) => b.id === id);
            setBlocks(stack.blocks.filter((b) => b.id !== id));
            if (expanded === id) setExpanded(null);
            if (removed) onNotice(`${removed.title} removed.`);
        },
        [expanded, onNotice, setBlocks, stack.blocks]
    );

    const moveBlock = useCallback(
        (id: string, direction: -1 | 1) => {
            const from = stack.blocks.findIndex((b) => b.id === id);
            const to = from + direction;
            if (from < 0 || to < 0 || to >= stack.blocks.length) return;

            const blocks = [...stack.blocks];
            [blocks[from], blocks[to]] = [blocks[to], blocks[from]];
            setBlocks(blocks);
        },
        [setBlocks, stack.blocks]
    );

    /** Pointer reorder: drop the dragged block where the hovered one sits. */
    const commitDrag = useCallback(() => {
        if (!draggingId || !dropTargetId || draggingId === dropTargetId) {
            setDraggingId(null);
            setDropTargetId(null);
            return;
        }

        const from = stack.blocks.findIndex((b) => b.id === draggingId);
        const to = stack.blocks.findIndex((b) => b.id === dropTargetId);
        if (from >= 0 && to >= 0) {
            const blocks = [...stack.blocks];
            const [moved] = blocks.splice(from, 1);
            blocks.splice(to, 0, moved);
            setBlocks(blocks);
        }

        setDraggingId(null);
        setDropTargetId(null);
    }, [draggingId, dropTargetId, setBlocks, stack.blocks]);

    const appendGenerated = useCallback(
        (generated: Block[]) => {
            // A generated trigger or model would collide with one already here.
            const filtered = generated.filter(
                (b) => !(BLOCK_SPECS[b.kind].singleton && takenSingletons.includes(b.kind))
            );
            setBlocks([...stack.blocks, ...filtered]);
            const skipped = generated.length - filtered.length;
            onNotice(
                skipped
                    ? `Added ${filtered.length} blocks. Skipped ${skipped} you already have.`
                    : `Added ${filtered.length} blocks.`
            );
        },
        [onNotice, setBlocks, stack.blocks, takenSingletons]
    );

    return (
        <div className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-8 sm:px-6">
            <StackComposer onGenerate={appendGenerated} onError={onError} />

            {stackIssues.length > 0 && (
                <ul className="mt-6 space-y-2" aria-label="Problems with this agent">
                    {stackIssues.map((issue, index) => (
                        <li
                            key={index}
                            className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs leading-5 ${
                                issue.severity === 'error'
                                    ? 'bg-destructive/10 text-danger'
                                    : 'bg-warning/10 text-warning'
                            }`}
                        >
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            {issue.message}
                        </li>
                    ))}
                </ul>
            )}

            {stack.blocks.length === 0 ? (
                <EmptyStack takenSingletons={takenSingletons} onAdd={addBlock} />
            ) : (
                <div
                    className="mt-8"
                    onDragEnd={commitDrag}
                    onDrop={(event) => {
                        event.preventDefault();
                        commitDrag();
                    }}
                >
                    {stack.blocks.map((block, index) => (
                        <div key={block.id} className="block-row">
                            {index > 0 && (
                                <div className="group/gap relative flex h-5 items-center justify-center">
                                    <div className="block-connector absolute inset-y-0" />
                                    <div className="relative z-10">
                                        <AddBlockMenu
                                            variant="inline"
                                            label="Insert a block here"
                                            takenSingletons={takenSingletons}
                                            onAdd={(kind, toolId) => addBlock(kind, toolId, index)}
                                        />
                                    </div>
                                </div>
                            )}

                            <div
                                onFocusCapture={() => onFocusBlock(block.id)}
                                onBlurCapture={() => onFocusBlock(null)}
                            >
                                <BlockCard
                                    block={block}
                                    index={index}
                                    total={stack.blocks.length}
                                    expanded={expanded === block.id}
                                    issues={issues.filter((i) => i.blockId === block.id)}
                                    editedBy={editors[block.id] ?? null}
                                    dragging={draggingId === block.id}
                                    dropTarget={
                                        dropTargetId === block.id && draggingId !== block.id
                                    }
                                    onToggleExpanded={() =>
                                        setExpanded((current) =>
                                            current === block.id ? null : block.id
                                        )
                                    }
                                    onChange={updateBlock}
                                    onDuplicate={() => duplicateBlock(block.id)}
                                    onDelete={() => deleteBlock(block.id)}
                                    onMove={(direction) => moveBlock(block.id, direction)}
                                    onDragStart={() => setDraggingId(block.id)}
                                    onDragEnter={() => setDropTargetId(block.id)}
                                    onDragEnd={commitDrag}
                                />
                            </div>
                        </div>
                    ))}

                    <div className="mt-5">
                        <AddBlockMenu takenSingletons={takenSingletons} onAdd={addBlock} />
                    </div>

                    <p className="mt-4 text-center text-xs text-muted-fg">
                        Drag a block by its handle to reorder, or hold Alt and press the arrow keys.
                        {errorCount === 0 && ' This agent is ready to run.'}
                    </p>
                </div>
            )}
        </div>
    );
}

function EmptyStack({
    takenSingletons,
    onAdd,
}: {
    takenSingletons: BlockKind[];
    onAdd: (kind: BlockKind, toolId?: string) => void;
}) {
    return (
        <div className="mt-8 rounded-lg border border-dashed border-border-strong px-6 py-16 text-center">
            <span
                aria-hidden
                className="mx-auto flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            >
                <Blocks className="size-6" />
            </span>

            <h2 className="mt-5 text-base font-medium text-foreground">
                Start with a block
            </h2>
            <p className="mx-auto mt-2 max-w-[42ch] text-sm leading-6 text-muted-foreground">
                An agent is a stack of blocks read top to bottom. Describe what you want above and
                the blocks get written for you, or place the first one yourself.
            </p>

            <div className="mx-auto mt-6 flex max-w-[280px] flex-col gap-3">
                <button
                    type="button"
                    onClick={() => onAdd('model')}
                    className="h-11 rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-[opacity,transform] duration-[120ms] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95"
                >
                    Add a Model block
                </button>
                <AddBlockMenu
                    takenSingletons={takenSingletons}
                    onAdd={onAdd}
                    label="Or pick another block"
                />
            </div>
        </div>
    );
}
