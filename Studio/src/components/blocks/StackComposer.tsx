'use client';

import React, { useEffect, useState } from 'react';
import { ArrowUp, Loader2, Sparkles } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import {
    TOOL_LIBRARY,
    createBlock,
    type Block,
    type ConditionBlock,
    type InstructionBlock,
    type MemoryBlock,
    type ModelBlock,
    type NoteBlock,
    type ToolBlock,
    type TriggerBlock,
    type VisionBlock,
} from '@/lib/blocks';

interface StackComposerProps {
    /** Called with blocks to append to the stack. */
    onGenerate: (blocks: Block[]) => void;
    onError: (message: string) => void;
}

const SYSTEM_PROMPT = `You turn a plain-language description of a browser agent into a stack of blocks.

Reply with ONLY a JSON object of this shape:
{ "blocks": [ ... ] }

Block shapes — use exactly these fields, nothing else:

{"kind":"trigger","title":"Trigger","when":"message"|"page-open"|"selection","urlContains":"amazon.in" or ""}
{"kind":"model","title":"Model","model":"qwen/qwen3-vl-8b-instruct","tone":"short phrase","temperature":0.0-1.0,"responseFormat":"markdown"|"plain"}
{"kind":"vision","title":"Vision","sight":"off"|"auto"|"always","marks":true,"redaction":"standard","autonomy":"supervised"|"autonomous","allowlist":"gmail.com, amazon.in" or "","maxSteps":5-60,"maxSeconds":60-900}
{"kind":"instruction","title":"short name","text":"one thing the agent must do","priority":"normal"|"critical"}
{"kind":"tool","title":"tool name","toolId":"ID FROM LIST","config":{}}
{"kind":"memory","title":"Memory","recall":10,"write":true}
{"kind":"condition","title":"short name","when":"situation in plain words","then":"what to do","otherwise":"what to do instead, or empty"}
{"kind":"note","title":"Note","text":"a reminder for the human"}

Valid toolId values, and nothing else:
TOOL_IDS

Rules:
- Start with exactly one trigger block, then exactly one model block.
- Add exactly one vision block whenever the agent has to DO things on a page rather
  than only answer questions. Keep "marks" true — it is what lets the agent click
  reliably. Use sight "auto" unless the description is about reading charts or canvases
  ("always"), or is purely text work ("off") — "always" makes every step several times
  slower. Use "autonomous" only when the description says to run without asking.
- Set allowlist when the description names specific sites. Leave it "" otherwise.
- Give each instruction ONE job. Three focused instructions beat one long one.
- Mark an instruction "critical" only when breaking it would be harmful or costly.
- Add a tool block only when the description actually needs that capability.
- Add a memory block only if the agent should remember the user between sessions.
- Titles are 1-3 words, sentence case.
- Write instruction text the way someone briefs a new colleague. No prompt-engineering jargon.`;

const EXAMPLES = [
    'A shopping agent that buys my usual size and never pays without asking',
    'A research agent that fact-checks the article I am reading',
    'An inbox agent that drafts replies in my voice',
    'A study agent that summarises any page into flashcards',
];

const VALID_KINDS = [
    'trigger',
    'model',
    'vision',
    'instruction',
    'tool',
    'memory',
    'condition',
    'note',
];

/**
 * Takes whatever the model returned and rebuilds it through `createBlock`, so a
 * malformed or hallucinated field can never reach the stack. Anything that does
 * not map onto a real block is dropped rather than guessed at.
 */
function adoptBlocks(raw: unknown): Block[] {
    if (!Array.isArray(raw)) return [];

    const blocks: Block[] = [];

    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const candidate = item as Record<string, unknown>;
        const kind = String(candidate.kind ?? '');
        if (!VALID_KINDS.includes(kind)) continue;

        const title = typeof candidate.title === 'string' ? candidate.title.slice(0, 60) : undefined;

        switch (kind) {
            case 'trigger': {
                const block = createBlock('trigger') as TriggerBlock;
                if (['message', 'page-open', 'selection'].includes(String(candidate.when))) {
                    block.when = candidate.when as TriggerBlock['when'];
                }
                if (typeof candidate.urlContains === 'string') {
                    block.urlContains = candidate.urlContains;
                }
                if (title) block.title = title;
                blocks.push(block);
                break;
            }
            case 'model': {
                const block = createBlock('model') as ModelBlock;
                if (typeof candidate.tone === 'string' && candidate.tone.trim()) {
                    block.tone = candidate.tone.slice(0, 80);
                }
                const temperature = Number(candidate.temperature);
                if (Number.isFinite(temperature)) {
                    block.temperature = Math.min(1, Math.max(0, Math.round(temperature * 10) / 10));
                }
                if (candidate.responseFormat === 'plain') block.responseFormat = 'plain';
                if (title) block.title = title;
                blocks.push(block);
                break;
            }
            case 'vision': {
                const block = createBlock('vision') as VisionBlock;
                if (['off', 'auto', 'always'].includes(String(candidate.sight))) {
                    block.sight = candidate.sight as VisionBlock['sight'];
                }
                if (typeof candidate.marks === 'boolean') block.marks = candidate.marks;
                if (['off', 'standard', 'strict'].includes(String(candidate.redaction))) {
                    block.redaction = candidate.redaction as VisionBlock['redaction'];
                }
                if (['supervised', 'autonomous'].includes(String(candidate.autonomy))) {
                    block.autonomy = candidate.autonomy as VisionBlock['autonomy'];
                }
                if (typeof candidate.allowlist === 'string') {
                    block.allowlist = candidate.allowlist.slice(0, 200);
                }
                // Clamp rather than trust: a hallucinated budget of 5000 steps
                // would defeat the point of having a budget at all.
                const maxSteps = Number(candidate.maxSteps);
                if (Number.isFinite(maxSteps)) {
                    block.maxSteps = Math.min(60, Math.max(5, Math.round(maxSteps)));
                }
                const maxSeconds = Number(candidate.maxSeconds);
                if (Number.isFinite(maxSeconds)) {
                    block.maxSeconds = Math.min(900, Math.max(60, Math.round(maxSeconds)));
                }
                if (title) block.title = title;
                blocks.push(block);
                break;
            }
            case 'instruction': {
                if (typeof candidate.text !== 'string' || !candidate.text.trim()) break;
                const block = createBlock('instruction') as InstructionBlock;
                block.text = candidate.text.trim();
                if (candidate.priority === 'critical') block.priority = 'critical';
                if (title) block.title = title;
                blocks.push(block);
                break;
            }
            case 'tool': {
                const spec = TOOL_LIBRARY.find((t) => t.id === candidate.toolId);
                if (!spec) break;
                const block = createBlock('tool', spec.id) as ToolBlock;
                if (candidate.config && typeof candidate.config === 'object') {
                    const allowed = new Set(spec.fields.map((f) => f.key));
                    block.config = Object.fromEntries(
                        Object.entries(candidate.config as Record<string, unknown>)
                            .filter(([key]) => allowed.has(key))
                            .map(([key, value]) => [key, String(value ?? '')])
                    );
                }
                blocks.push(block);
                break;
            }
            case 'memory': {
                const block = createBlock('memory') as MemoryBlock;
                const recall = Number(candidate.recall);
                if (Number.isFinite(recall)) {
                    block.recall = Math.min(50, Math.max(1, Math.round(recall)));
                }
                block.write = candidate.write !== false;
                if (title) block.title = title;
                blocks.push(block);
                break;
            }
            case 'condition': {
                if (typeof candidate.when !== 'string' || !candidate.when.trim()) break;
                const block = createBlock('condition') as ConditionBlock;
                block.when = candidate.when.trim();
                block.then = typeof candidate.then === 'string' ? candidate.then.trim() : '';
                block.otherwise =
                    typeof candidate.otherwise === 'string' ? candidate.otherwise.trim() : '';
                if (title) block.title = title;
                blocks.push(block);
                break;
            }
            case 'note': {
                if (typeof candidate.text !== 'string' || !candidate.text.trim()) break;
                const block = createBlock('note') as NoteBlock;
                block.text = candidate.text.trim();
                if (title) block.title = title;
                blocks.push(block);
                break;
            }
        }
    }

    return blocks;
}

export default function StackComposer({ onGenerate, onError }: StackComposerProps) {
    const [prompt, setPrompt] = useState('');
    const [busy, setBusy] = useState(false);
    const [placeholder, setPlaceholder] = useState(EXAMPLES[0]);

    const supabase = createClient();

    // Cycle the examples so the field always suggests what to type next.
    useEffect(() => {
        if (prompt) return;
        const timer = setInterval(() => {
            setPlaceholder((current) => {
                const next = (EXAMPLES.indexOf(current) + 1) % EXAMPLES.length;
                return EXAMPLES[next];
            });
        }, 4000);
        return () => clearInterval(timer);
    }, [prompt]);

    const generate = async () => {
        if (!prompt.trim() || busy) return;
        setBusy(true);

        try {
            const {
                data: { user },
            } = await supabase.auth.getUser();
            if (!user) throw new Error('Sign in again to build with AI.');

            const { data: keys } = await supabase
                .from('apiKeys')
                .select('key')
                .eq('user_id', user.id)
                .eq('provider', 'gemini');

            const geminiKey = keys?.[0]?.key;
            if (!geminiKey) {
                throw new Error('Add a Gemini key under API keys, then try again.');
            }

            const instruction = SYSTEM_PROMPT.replace(
                'TOOL_IDS',
                TOOL_LIBRARY.map((t) => `${t.id} — ${t.description}`).join('\n')
            );

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${geminiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        systemInstruction: { parts: [{ text: instruction }] },
                        generationConfig: { responseMimeType: 'application/json' },
                    }),
                }
            );

            if (!response.ok) {
                const error = await response.json().catch(() => null);
                throw new Error(error?.error?.message ?? 'The model could not be reached.');
            }

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error('The model returned nothing. Try describing it differently.');

            const cleaned = text
                .replace(/^\s*```json/i, '')
                .replace(/```\s*$/, '')
                .trim();

            const blocks = adoptBlocks(JSON.parse(cleaned).blocks);
            if (!blocks.length) {
                throw new Error('Nothing usable came back. Try describing the agent differently.');
            }

            setPrompt('');
            onGenerate(blocks);
        } catch (error) {
            onError(error instanceof Error ? error.message : 'Something went wrong.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-lg bg-elevated shadow-e1 transition-shadow duration-[120ms] focus-within:shadow-e2">
            <div className="flex items-center gap-2 px-4 pt-3">
                <Sparkles className="size-3.5 text-primary" aria-hidden />
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    Build with AI
                </span>
            </div>

            <div className="relative p-3">
                <label htmlFor="stack-composer" className="sr-only">
                    Describe the agent you want
                </label>
                <textarea
                    id="stack-composer"
                    value={prompt}
                    rows={2}
                    disabled={busy}
                    placeholder={placeholder}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            generate();
                        }
                    }}
                    className="w-full resize-none bg-transparent pr-12 text-sm leading-6 text-foreground caret-primary outline-none placeholder:text-muted-fg disabled:opacity-50"
                />

                <button
                    type="button"
                    onClick={generate}
                    disabled={busy || !prompt.trim()}
                    aria-label="Build these blocks"
                    className="absolute bottom-3 right-3 flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-[opacity,transform] duration-[120ms] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {busy ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                        <ArrowUp className="size-4" aria-hidden />
                    )}
                </button>
            </div>
        </div>
    );
}
