'use client';

import React from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Field, ChoiceRow, Stepper } from './Field';
import {
    MODELS,
    TONES,
    TOOL_LIBRARY,
    getTool,
    type Block,
    type ConditionBlock,
    type InstructionBlock,
    type MemoryBlock,
    type ModelBlock,
    type NoteBlock,
    type ToolBlock,
    type TriggerBlock,
} from '@/lib/blocks';

interface BlockBodyProps {
    block: Block;
    onChange: (block: Block) => void;
}

const TRIGGER_OPTIONS = [
    { value: 'message', label: 'When I send a message' },
    { value: 'page-open', label: 'When I open a page' },
    { value: 'selection', label: 'When I select text' },
] as const;

/** The settings for one block. Every kind renders through here. */
export default function BlockBody({ block, onChange }: BlockBodyProps) {
    switch (block.kind) {
        case 'trigger':
            return <TriggerBody block={block} onChange={onChange} />;
        case 'model':
            return <ModelBody block={block} onChange={onChange} />;
        case 'instruction':
            return <InstructionBody block={block} onChange={onChange} />;
        case 'tool':
            return <ToolBody block={block} onChange={onChange} />;
        case 'memory':
            return <MemoryBody block={block} onChange={onChange} />;
        case 'condition':
            return <ConditionBody block={block} onChange={onChange} />;
        case 'note':
            return <NoteBody block={block} onChange={onChange} />;
    }
}

function TriggerBody({
    block,
    onChange,
}: {
    block: TriggerBlock;
    onChange: (block: Block) => void;
}) {
    return (
        <div className="space-y-5">
            <Field label="Wake up" hint="What starts a turn for this agent.">
                {() => (
                    <div className="space-y-2">
                        {TRIGGER_OPTIONS.map((option) => (
                            <label
                                key={option.value}
                                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm transition-colors duration-[120ms] hover:border-border-strong has-[:checked]:border-primary has-[:checked]:bg-accent-subtle"
                            >
                                <input
                                    type="radio"
                                    name={`${block.id}-when`}
                                    value={option.value}
                                    checked={block.when === option.value}
                                    onChange={() => onChange({ ...block, when: option.value })}
                                    className="size-4 accent-primary"
                                />
                                <span className="text-foreground">{option.label}</span>
                            </label>
                        ))}
                    </div>
                )}
            </Field>

            <Field
                label="Only on these pages"
                hint="Leave empty to run everywhere. Otherwise, part of a URL — amazon.in, gmail.com."
            >
                {(id) => (
                    <Input
                        id={id}
                        value={block.urlContains}
                        placeholder="amazon.in"
                        onChange={(event) =>
                            onChange({ ...block, urlContains: event.target.value })
                        }
                        className="h-9 font-mono text-xs"
                    />
                )}
            </Field>
        </div>
    );
}

function ModelBody({ block, onChange }: { block: ModelBlock; onChange: (block: Block) => void }) {
    return (
        <div className="space-y-5">
            <Field label="Model" hint="Which model does the thinking.">
                {() => (
                    <ChoiceRow
                        label="Model"
                        options={MODELS}
                        value={block.model}
                        onChange={(model) => onChange({ ...block, model })}
                    />
                )}
            </Field>

            <Field label="Manner" hint="How it talks to you. Pick one or write your own below.">
                {() => (
                    <div className="space-y-3">
                        <ChoiceRow
                            label="Manner"
                            options={TONES}
                            value={block.tone}
                            onChange={(tone) => onChange({ ...block, tone })}
                        />
                        <Input
                            value={TONES.includes(block.tone as (typeof TONES)[number]) ? '' : block.tone}
                            placeholder="Or describe the manner yourself…"
                            aria-label="Custom manner"
                            onChange={(event) => onChange({ ...block, tone: event.target.value })}
                            className="h-9 text-xs"
                        />
                    </div>
                )}
            </Field>

            <Field
                label="Looseness"
                hint="Low sticks close to the facts. High takes more creative swings."
            >
                {(id) => (
                    <Stepper
                        id={id}
                        label="Looseness"
                        value={block.temperature}
                        min={0}
                        max={1}
                        step={0.1}
                        format={(value) =>
                            value <= 0.3 ? `${value.toFixed(1)} tight` : value >= 0.8 ? `${value.toFixed(1)} loose` : value.toFixed(1)
                        }
                        onChange={(temperature) => onChange({ ...block, temperature })}
                    />
                )}
            </Field>

            <Field label="Answer style">
                {() => (
                    <ChoiceRow
                        label="Answer style"
                        options={['markdown', 'plain']}
                        value={block.responseFormat}
                        renderLabel={(option) =>
                            option === 'markdown' ? 'Formatted' : 'Plain sentences'
                        }
                        onChange={(value) =>
                            onChange({ ...block, responseFormat: value as ModelBlock['responseFormat'] })
                        }
                    />
                )}
            </Field>
        </div>
    );
}

function InstructionBody({
    block,
    onChange,
}: {
    block: InstructionBlock;
    onChange: (block: Block) => void;
}) {
    return (
        <div className="space-y-5">
            <Field label="Instruction" hint="Write it the way you would tell a new colleague.">
                {(id) => (
                    <Textarea
                        id={id}
                        value={block.text}
                        placeholder="Always check the delivery date before adding anything to the cart."
                        onChange={(event) => onChange({ ...block, text: event.target.value })}
                        className="min-h-24 resize-y text-sm leading-6"
                    />
                )}
            </Field>

            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
                <span className="space-y-1">
                    <span className="block text-xs font-medium text-foreground">
                        Treat this as non-negotiable
                    </span>
                    <span className="block text-xs leading-4 text-muted-foreground">
                        Moves it above everything else, so it wins any conflict.
                    </span>
                </span>
                <Switch
                    checked={block.priority === 'critical'}
                    onCheckedChange={(checked) =>
                        onChange({ ...block, priority: checked ? 'critical' : 'normal' })
                    }
                />
            </label>
        </div>
    );
}

function ToolBody({ block, onChange }: { block: ToolBlock; onChange: (block: Block) => void }) {
    const spec = getTool(block.toolId);

    const setConfig = (key: string, value: string) =>
        onChange({ ...block, config: { ...block.config, [key]: value } });

    return (
        <div className="space-y-5">
            <Field label="Tool" hint="What this block lets the agent do.">
                {() => (
                    <div className="grid gap-2 sm:grid-cols-2">
                        {TOOL_LIBRARY.map((tool) => {
                            const selected = tool.id === block.toolId;
                            return (
                                <button
                                    key={tool.id}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() =>
                                        onChange({
                                            ...block,
                                            toolId: tool.id,
                                            title: tool.name,
                                            config: {},
                                        })
                                    }
                                    className={`min-h-11 rounded-md border px-3 py-2 text-left transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                                        selected
                                            ? 'border-primary bg-accent-subtle'
                                            : 'border-border hover:border-border-strong'
                                    }`}
                                >
                                    <span className="block text-xs font-medium text-foreground">
                                        {tool.name}
                                    </span>
                                    <span className="mt-1 block text-xs leading-4 text-muted-foreground">
                                        {tool.description}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </Field>

            {spec && spec.fields.length > 0 && (
                <div className="space-y-5 border-t border-border pt-5">
                    {spec.fields.map((field) => {
                        if (
                            field.showWhen &&
                            block.config[field.showWhen.key] !== field.showWhen.equals
                        ) {
                            return null;
                        }

                        return (
                            <Field key={field.key} label={field.label}>
                                {(id) => {
                                    if (field.type === 'choice' && field.options) {
                                        return (
                                            <ChoiceRow
                                                label={field.label}
                                                options={field.options}
                                                value={block.config[field.key] ?? ''}
                                                onChange={(value) => setConfig(field.key, value)}
                                            />
                                        );
                                    }
                                    if (field.type === 'textarea') {
                                        return (
                                            <Textarea
                                                id={id}
                                                value={block.config[field.key] ?? ''}
                                                placeholder={field.placeholder}
                                                onChange={(event) =>
                                                    setConfig(field.key, event.target.value)
                                                }
                                                className="min-h-20 resize-y text-xs leading-5"
                                            />
                                        );
                                    }
                                    return (
                                        <Input
                                            id={id}
                                            type={field.type === 'secret' ? 'password' : 'text'}
                                            value={block.config[field.key] ?? ''}
                                            placeholder={field.placeholder}
                                            onChange={(event) =>
                                                setConfig(field.key, event.target.value)
                                            }
                                            className="h-9 text-xs"
                                        />
                                    );
                                }}
                            </Field>
                        );
                    })}
                </div>
            )}

            {spec && spec.fields.length === 0 && (
                <p className="text-xs leading-5 text-muted-foreground">
                    Nothing to configure — the agent reaches for this on its own when it helps.
                </p>
            )}
        </div>
    );
}

function MemoryBody({ block, onChange }: { block: MemoryBlock; onChange: (block: Block) => void }) {
    return (
        <div className="space-y-5">
            <Field
                label="How much it recalls"
                hint="Memories loaded at the start of every turn. More context, longer prompt."
            >
                {(id) => (
                    <Stepper
                        id={id}
                        label="How much it recalls"
                        value={block.recall}
                        min={1}
                        max={50}
                        step={1}
                        format={(value) => `${value} item${value === 1 ? '' : 's'}`}
                        onChange={(recall) => onChange({ ...block, recall })}
                    />
                )}
            </Field>

            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
                <span className="space-y-1">
                    <span className="block text-xs font-medium text-foreground">
                        Let it write new memories
                    </span>
                    <span className="block text-xs leading-4 text-muted-foreground">
                        Off means it only reads what is already stored.
                    </span>
                </span>
                <Switch
                    checked={block.write}
                    onCheckedChange={(write) => onChange({ ...block, write })}
                />
            </label>
        </div>
    );
}

function ConditionBody({
    block,
    onChange,
}: {
    block: ConditionBlock;
    onChange: (block: Block) => void;
}) {
    return (
        <div className="space-y-5">
            <Field
                label="If"
                hint="Describe the situation in plain words. The agent judges it from the page."
            >
                {(id) => (
                    <Input
                        id={id}
                        value={block.when}
                        placeholder="the page is a checkout"
                        onChange={(event) => onChange({ ...block, when: event.target.value })}
                        className="h-9 text-sm"
                    />
                )}
            </Field>

            <Field label="Then">
                {(id) => (
                    <Textarea
                        id={id}
                        value={block.then}
                        placeholder="read the total back to me and wait for a yes"
                        onChange={(event) => onChange({ ...block, then: event.target.value })}
                        className="min-h-16 resize-y text-sm leading-6"
                    />
                )}
            </Field>

            <Field label="Otherwise" hint="Optional. Leave empty to just carry on.">
                {(id) => (
                    <Textarea
                        id={id}
                        value={block.otherwise}
                        placeholder="keep going as normal"
                        onChange={(event) => onChange({ ...block, otherwise: event.target.value })}
                        className="min-h-16 resize-y text-sm leading-6"
                    />
                )}
            </Field>
        </div>
    );
}

function NoteBody({ block, onChange }: { block: NoteBlock; onChange: (block: Block) => void }) {
    return (
        <Field label="Note" hint="For you and your squad. Never reaches the agent.">
            {(id) => (
                <Textarea
                    id={id}
                    value={block.text}
                    placeholder="Remember to swap the UPI ID before sharing this agent."
                    onChange={(event) => onChange({ ...block, text: event.target.value })}
                    className="min-h-20 resize-y text-sm leading-6"
                />
            )}
        </Field>
    );
}
