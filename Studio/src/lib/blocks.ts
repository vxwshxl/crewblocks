/**
 * The block system.
 *
 * An agent is an ordered stack of blocks. There are no wires and no canvas —
 * position in the stack IS the wiring, and the compiler walks the stack top to
 * bottom to build the system prompt the browser agent runs on.
 *
 * This file is the single source of truth for what a block is. The editor
 * renders from `BLOCK_SPECS`, the API compiles from `compileStack`, and both
 * validate through `validateStack`.
 */

import type { LucideIcon } from 'lucide-react';
import {
    Zap,
    Sparkles,
    PenLine,
    Wrench,
    Database,
    GitBranch,
    StickyNote,
    Eye,
} from 'lucide-react';

/* ---------------------------------------------------------------- kinds -- */

export const BLOCK_KINDS = [
    'trigger',
    'model',
    'vision',
    'instruction',
    'tool',
    'memory',
    'condition',
    'note',
] as const;

export type BlockKind = (typeof BLOCK_KINDS)[number];

/* ---------------------------------------------------------------- shape -- */

interface BlockCommon {
    id: string;
    /** User-facing name shown on the block header. Always editable. */
    title: string;
    /** A disabled block stays in the stack but is skipped by the compiler. */
    enabled: boolean;
}

export interface TriggerBlock extends BlockCommon {
    kind: 'trigger';
    /** What wakes the agent up. */
    when: 'message' | 'page-open' | 'selection';
    /** Optional filter — only fire on pages whose URL contains this. */
    urlContains: string;
}

export interface ModelBlock extends BlockCommon {
    kind: 'model';
    model: string;
    /** Named tone, or free text when the user writes their own. */
    tone: string;
    /** 0–1, stepped by 0.1. Higher is looser. */
    temperature: number;
    responseFormat: 'markdown' | 'plain';
}

/**
 * How the agent perceives the page, and how far it may go on its own.
 *
 * Screenshots are what make a page legible when the DOM alone is not — canvas,
 * cross-origin iframes, anything drawn rather than marked up. `marks` overlays
 * a numbered badge on every interactable element so the model answers with an
 * element id it can be held to, instead of a pixel coordinate it cannot.
 */
export interface VisionBlock extends BlockCommon {
    kind: 'vision';
    /**
     * When to spend a screenshot.
     *
     * Measured on the local 4B tier: a turn with an image costs ~5.6s, the same
     * turn on the element table alone costs ~0.8s. Vision is seven times the
     * price of the whole rest of the step, so "always" is the wrong default —
     * `auto` sends one only when the DOM is not enough.
     */
    sight: 'off' | 'auto' | 'always';
    /** Legacy: the boolean this replaced. Read on load, never written. */
    screenshot?: boolean;
    /** Draw numbered badges over interactables before sending. Needs screenshot. */
    marks: boolean;
    /** How hard to scrub before anything leaves the device. */
    redaction: 'off' | 'standard' | 'strict';
    /** Whether irreversible actions stop and ask. */
    autonomy: 'supervised' | 'autonomous';
    /** Comma-separated hosts the agent may navigate to. Empty means anywhere. */
    allowlist: string;
    /** Hard ceiling on loop turns before the run aborts. */
    maxSteps: number;
    /** Hard ceiling in seconds. */
    maxSeconds: number;
}

export interface InstructionBlock extends BlockCommon {
    kind: 'instruction';
    text: string;
    /** Raises this instruction above the others in the compiled prompt. */
    priority: 'normal' | 'critical';
}

export interface ToolBlock extends BlockCommon {
    kind: 'tool';
    /** Matches an entry in TOOL_LIBRARY. */
    toolId: string;
    config: Record<string, string>;
}

export interface MemoryBlock extends BlockCommon {
    kind: 'memory';
    /** How many past memories to load into the prompt. */
    recall: number;
    /** Whether the agent may write new memories. */
    write: boolean;
}

export interface ConditionBlock extends BlockCommon {
    kind: 'condition';
    /** Plain-language condition — the model evaluates it, not a JS engine. */
    when: string;
    then: string;
    otherwise: string;
}

export interface NoteBlock extends BlockCommon {
    kind: 'note';
    text: string;
}

export type Block =
    | TriggerBlock
    | ModelBlock
    | VisionBlock
    | InstructionBlock
    | ToolBlock
    | MemoryBlock
    | ConditionBlock
    | NoteBlock;

/** What lands in `agents.data` in Postgres. */
export interface BlockStack {
    version: 2;
    blocks: Block[];
}

/* -------------------------------------------------------------- library -- */

export interface ToolSpec {
    id: string;
    name: string;
    description: string;
    /** Fields the user fills in to configure this tool. */
    fields: ToolField[];
}

export interface ToolField {
    key: string;
    label: string;
    placeholder: string;
    type: 'text' | 'textarea' | 'choice' | 'secret';
    /** Only for type 'choice'. */
    options?: string[];
    /** Show this field only when another field holds this value. */
    showWhen?: { key: string; equals: string };
}

export const TOOL_LIBRARY: ToolSpec[] = [
    {
        // Id kept from the pre-Brave version so existing stacks keep working.
        id: 'web-search',
        name: 'Web search',
        description: 'Look things up on the live web before answering.',
        fields: [
            {
                key: 'count',
                label: 'Results per search',
                placeholder: '',
                type: 'choice',
                options: ['3', '5', '10'],
            },
            {
                key: 'freshness',
                label: 'How recent',
                placeholder: '',
                type: 'choice',
                options: ['Any time', 'Past day', 'Past week', 'Past month', 'Past year'],
            },
            {
                key: 'citations',
                label: 'Require citations',
                placeholder: '',
                type: 'choice',
                options: ['Yes', 'No'],
            },
        ],
    },
    {
        id: 'translate',
        name: 'Translate page',
        description: 'Rewrite the page in another Indian language, in place.',
        fields: [
            {
                key: 'language',
                label: 'Translate into',
                placeholder: '',
                type: 'choice',
                options: ['Assamese', 'Bengali', 'Bodo', 'Hindi', 'English'],
            },
        ],
    },
    {
        id: 'summarizer',
        name: 'Summarizer',
        description: 'Condense the page, an article, or a long thread.',
        fields: [
            {
                key: 'tone',
                label: 'Tone',
                placeholder: '',
                type: 'choice',
                options: ['Professional', 'Casual', 'Enthusiastic', 'Informative', 'Witty'],
            },
            {
                key: 'shape',
                label: 'Shape',
                placeholder: 'Bullet points, a paragraph, an executive brief…',
                type: 'textarea',
            },
        ],
    },
    {
        id: 'news-authenticity',
        name: 'Source checker',
        description: 'Vet a page or claim for credibility and bias.',
        fields: [
            {
                key: 'logic',
                label: 'What to check for',
                placeholder: 'Author bias, emotional language, missing citations…',
                type: 'textarea',
            },
            {
                key: 'source',
                label: 'What to check',
                placeholder: 'The URL in the active tab',
                type: 'text',
            },
        ],
    },
    {
        id: 'gmail',
        name: 'Gmail',
        description: 'Compose and send mail on your behalf.',
        fields: [
            { key: 'name', label: 'Your name', placeholder: 'Jordan Rivera', type: 'text' },
            { key: 'email', label: 'Send from', placeholder: 'you@example.com', type: 'text' },
            { key: 'company', label: 'Company', placeholder: 'Acme Corp', type: 'text' },
            { key: 'position', label: 'Job title', placeholder: 'Head of Sales', type: 'text' },
            { key: 'phone', label: 'Phone', placeholder: '+1 234 567 8900', type: 'text' },
            {
                key: 'templates',
                label: 'Templates',
                placeholder: 'Hi [Name],\n\nThanks for…',
                type: 'textarea',
            },
        ],
    },
    {
        id: 'shopping',
        name: 'Shopping',
        description: 'Run a checkout end to end using your saved details.',
        fields: [
            { key: 'address', label: 'Delivery address', placeholder: 'Street, city, state', type: 'textarea' },
            { key: 'pincode', label: 'Pincode', placeholder: '781001', type: 'text' },
            { key: 'color', label: 'Preferred colour', placeholder: 'Black', type: 'text' },
            {
                key: 'shirtSize',
                label: 'Shirt size',
                placeholder: '',
                type: 'choice',
                options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
            },
            { key: 'pantSize', label: 'Pant size', placeholder: '32', type: 'text' },
            { key: 'shoeSize', label: 'Shoe size', placeholder: '9', type: 'text' },
            {
                key: 'payment',
                label: 'Pay with',
                placeholder: '',
                type: 'choice',
                options: ['UPI', 'Card'],
            },
            {
                key: 'upiId',
                label: 'UPI ID',
                placeholder: 'you@bank',
                type: 'text',
                showWhen: { key: 'payment', equals: 'UPI' },
            },
            {
                key: 'cardNumber',
                label: 'Card number',
                placeholder: '0000 0000 0000 0000',
                type: 'secret',
                showWhen: { key: 'payment', equals: 'Card' },
            },
            {
                key: 'cardExpiry',
                label: 'Expiry',
                placeholder: 'MM/YY',
                type: 'text',
                showWhen: { key: 'payment', equals: 'Card' },
            },
        ],
    },
    {
        id: 'todo-manager',
        name: 'To-do manager',
        description: 'Keep a running task list across sessions.',
        fields: [
            { key: 'defaultList', label: 'List name', placeholder: 'My tasks', type: 'text' },
            {
                key: 'initialTasks',
                label: 'Starting tasks',
                placeholder: 'Review PRs, update docs, sync with team',
                type: 'textarea',
            },
        ],
    },
    {
        id: 'calculator',
        name: 'Calculator',
        description: 'Do arithmetic reliably instead of estimating.',
        fields: [],
    },
    {
        id: 'code-interpreter',
        name: 'Code reader',
        description: 'Read and explain code on the page.',
        fields: [],
    },
    {
        id: 'file-upload',
        name: 'File upload',
        description: 'Let you attach images and files in the side panel.',
        fields: [],
    },
];

export function getTool(toolId: string): ToolSpec | undefined {
    return TOOL_LIBRARY.find((t) => t.id === toolId);
}

/* --------------------------------------------------------------- models -- */

export type ModelProvider = 'openai-compatible' | 'gemini';

export interface ModelSpec {
    id: string;
    label: string;
    /** Decides which client in `providers.ts` handles the call. */
    provider: ModelProvider;
    /** Whether this model can be sent a screenshot at all. */
    vision: boolean;
    /** Runs on the user's own machine — nothing leaves the device. */
    local: boolean;
    /** One line for the picker, saying what the trade is. */
    note: string;
}

/**
 * Both Qwen entries are the same model family over the same OpenAI-compatible
 * API, so moving between them is a base-URL change. The sizes differ because
 * the machines do: the cloud has headroom, a fanless laptop does not.
 */
export const MODEL_CATALOG: ModelSpec[] = [
    {
        id: 'qwen/qwen3-vl-8b-instruct',
        label: 'Qwen3-VL 8B · cloud',
        provider: 'openai-compatible',
        vision: true,
        local: false,
        note: 'Best grounding. Screenshots leave the device, so redaction applies.',
    },
    {
        // Must be the exact repo `scripts/model-server.sh` serves with --model.
        // mlx_vlm.server treats an unknown model name as a HuggingFace repo to
        // download, so a mismatch fails as "Repository Not Found", not as a
        // routing error.
        id: 'mlx-community/Qwen3-VL-4B-Instruct-4bit',
        label: 'Qwen3-VL 4B · local',
        provider: 'openai-compatible',
        vision: true,
        local: true,
        note: 'Nothing leaves the device. Slower, and needs the local model server running.',
    },
    {
        id: 'gemini-flash-latest',
        label: 'Gemini Flash',
        provider: 'gemini',
        vision: true,
        local: false,
        note: 'Fast and cheap. Needs a Gemini key under API keys.',
    },
    {
        id: 'gemini-pro-latest',
        label: 'Gemini Pro',
        provider: 'gemini',
        vision: true,
        local: false,
        note: 'Stronger reasoning, slower. Needs a Gemini key under API keys.',
    },
];

/** Ids that older stacks were saved with, mapped to their current spec. */
const MODEL_ALIASES: Record<string, string> = {
    'qwen3-vl-4b-instruct': 'mlx-community/Qwen3-VL-4B-Instruct-4bit',
};

export function getModel(id: string): ModelSpec | undefined {
    const resolved = MODEL_ALIASES[id] ?? id;
    return MODEL_CATALOG.find((m) => m.id === resolved);
}

export const MODELS = MODEL_CATALOG.map((m) => m.id);

export const TONES = [
    'Helpful assistant',
    'Direct and brief',
    'Warm and patient',
    'Strict professional',
    'Playful',
] as const;

/* ---------------------------------------------------------------- specs -- */

export interface BlockSpec {
    kind: BlockKind;
    /** Singular noun as it appears in the add menu and on the block header. */
    label: string;
    /** One line, sentence case, says what the block does for the agent. */
    description: string;
    icon: LucideIcon;
    /** CSS custom properties defined in globals.css. */
    accentVar: string;
    washVar: string;
    /** Blocks the stack may hold only one of. */
    singleton: boolean;
    /** A one-line summary rendered on the collapsed header. */
    summary: (block: Block) => string;
}

export const BLOCK_SPECS: Record<BlockKind, BlockSpec> = {
    trigger: {
        kind: 'trigger',
        label: 'Trigger',
        description: 'Decides when the agent wakes up.',
        icon: Zap,
        accentVar: 'var(--ds-block-trigger)',
        washVar: 'var(--ds-block-trigger-wash)',
        singleton: true,
        summary: (b) => {
            const t = b as TriggerBlock;
            const when =
                t.when === 'message'
                    ? 'When you send a message'
                    : t.when === 'page-open'
                      ? 'When a page opens'
                      : 'When you select text';
            return t.urlContains ? `${when} on ${t.urlContains}` : when;
        },
    },
    model: {
        kind: 'model',
        label: 'Model',
        description: 'The brain doing the thinking, and how loose it runs.',
        icon: Sparkles,
        accentVar: 'var(--ds-block-model)',
        washVar: 'var(--ds-block-model-wash)',
        singleton: true,
        summary: (b) => {
            const m = b as ModelBlock;
            return `${m.model} · ${m.tone.toLowerCase()}`;
        },
    },
    vision: {
        kind: 'vision',
        label: 'Vision',
        description: 'Lets the agent see the page, and sets how far it goes alone.',
        icon: Eye,
        accentVar: 'var(--ds-block-vision)',
        washVar: 'var(--ds-block-vision-wash)',
        singleton: true,
        summary: (b) => {
            const v = b as VisionBlock;
            const sight =
                v.sight === 'off'
                    ? 'Reads the page structure only'
                    : v.sight === 'always'
                      ? (v.marks ? 'Always looks, with numbered marks' : 'Always looks')
                      : (v.marks ? 'Looks when needed, with marks' : 'Looks when needed');
            const reach =
                v.autonomy === 'autonomous' ? 'runs on its own' : 'asks before anything risky';
            return `${sight} · ${reach}`;
        },
    },
    instruction: {
        kind: 'instruction',
        label: 'Instruction',
        description: 'Something the agent must always do, in your words.',
        icon: PenLine,
        accentVar: 'var(--ds-block-instruction)',
        washVar: 'var(--ds-block-instruction-wash)',
        singleton: false,
        summary: (b) => {
            const i = b as InstructionBlock;
            if (!i.text.trim()) return 'Empty — write what the agent should do';
            const oneLine = i.text.replace(/\s+/g, ' ').trim();
            return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine;
        },
    },
    tool: {
        kind: 'tool',
        label: 'Tool',
        description: 'A capability the agent can reach for.',
        icon: Wrench,
        accentVar: 'var(--ds-block-tool)',
        washVar: 'var(--ds-block-tool-wash)',
        singleton: false,
        summary: (b) => {
            const t = b as ToolBlock;
            const spec = getTool(t.toolId);
            if (!spec) return 'Pick a tool';
            const filled = Object.values(t.config).filter((v) => v && v.trim()).length;
            if (!spec.fields.length) return spec.description;
            return filled
                ? `${spec.name} · ${filled} of ${spec.fields.length} details set`
                : `${spec.name} · not configured yet`;
        },
    },
    memory: {
        kind: 'memory',
        label: 'Memory',
        description: 'Lets the agent remember you between sessions.',
        icon: Database,
        accentVar: 'var(--ds-block-memory)',
        washVar: 'var(--ds-block-memory-wash)',
        singleton: true,
        summary: (b) => {
            const m = b as MemoryBlock;
            const read = `Recalls the last ${m.recall}`;
            return m.write ? `${read} · writes new ones` : `${read} · read only`;
        },
    },
    condition: {
        kind: 'condition',
        label: 'Condition',
        description: 'Branches the agent’s behaviour on a situation.',
        icon: GitBranch,
        accentVar: 'var(--ds-block-condition)',
        washVar: 'var(--ds-block-condition-wash)',
        singleton: false,
        summary: (b) => {
            const c = b as ConditionBlock;
            return c.when.trim() ? `If ${c.when.trim()}` : 'Describe the situation to branch on';
        },
    },
    note: {
        kind: 'note',
        label: 'Note',
        description: 'A reminder for you. The agent never sees it.',
        icon: StickyNote,
        accentVar: 'var(--ds-block-note)',
        washVar: 'var(--ds-block-note-wash)',
        singleton: false,
        summary: (b) => {
            const n = b as NoteBlock;
            if (!n.text.trim()) return 'Empty note';
            const oneLine = n.text.replace(/\s+/g, ' ').trim();
            return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine;
        },
    },
};

/** The order blocks appear in the add menu. */
export const ADD_MENU_ORDER: BlockKind[] = [
    'instruction',
    'tool',
    'vision',
    'memory',
    'condition',
    'model',
    'trigger',
    'note',
];

/* ------------------------------------------------------------- creation -- */

function newId(kind: BlockKind): string {
    return `${kind}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createBlock(kind: BlockKind, toolId?: string): Block {
    const base = { id: newId(kind), enabled: true };

    switch (kind) {
        case 'trigger':
            return { ...base, kind, title: 'Trigger', when: 'message', urlContains: '' };
        case 'model':
            return {
                ...base,
                kind,
                title: 'Model',
                model: MODELS[0],
                tone: TONES[0],
                temperature: 0.7,
                responseFormat: 'markdown',
            };
        case 'vision':
            return {
                ...base,
                kind,
                title: 'Vision',
                sight: 'auto',
                marks: true,
                redaction: 'standard',
                autonomy: 'supervised',
                allowlist: '',
                maxSteps: 25,
                maxSeconds: 300,
            };
        case 'instruction':
            return { ...base, kind, title: 'Instruction', text: '', priority: 'normal' };
        case 'tool': {
            const spec = toolId ? getTool(toolId) : undefined;
            return {
                ...base,
                kind,
                title: spec?.name ?? 'Tool',
                toolId: toolId ?? TOOL_LIBRARY[0].id,
                config: {},
            };
        }
        case 'memory':
            return { ...base, kind, title: 'Memory', recall: 10, write: true };
        case 'condition':
            return { ...base, kind, title: 'Condition', when: '', then: '', otherwise: '' };
        case 'note':
            return { ...base, kind, title: 'Note', text: '' };
    }
}

/** The stack a brand-new agent opens with — enough to run, nothing to delete. */
export function starterStack(): BlockStack {
    const trigger = createBlock('trigger');
    const model = createBlock('model');
    const vision = createBlock('vision');
    const instruction = createBlock('instruction') as InstructionBlock;
    instruction.text = 'Be concise. Ask before doing anything that costs money.';

    return { version: 2, blocks: [trigger, model, vision, instruction] };
}

export function emptyStack(): BlockStack {
    return { version: 2, blocks: [] };
}

/* ------------------------------------------------------------ migration -- */

/**
 * Reads whatever is in `agents.data` and always hands back a stack.
 *
 * Rows written by the old node canvas carry `{ nodes, edges }`. Rather than
 * stranding them, we flatten the graph: the agent node's config becomes the
 * model and instruction blocks, and every tool node connected to it becomes a
 * tool block. Edges are dropped — order in the stack replaces them.
 */
/** The shape the retired node canvas wrote. Read here, written nowhere. */
interface LegacyNode {
    type?: string;
    data?: {
        content?: unknown;
        agentConfig?: {
            id?: string;
            name?: string;
            model?: string;
            personality?: string;
            prompt?: string;
            messages?: Array<{ role: string; content: string }>;
            toolConfig?: Record<string, unknown>;
        };
    };
}

export function readStack(data: unknown): BlockStack {
    if (!data || typeof data !== 'object') return emptyStack();

    const record = data as Record<string, unknown>;

    if (Array.isArray(record.blocks)) {
        return { version: 2, blocks: record.blocks as Block[] };
    }

    if (!Array.isArray(record.nodes)) return emptyStack();

    const nodes = record.nodes as LegacyNode[];
    const blocks: Block[] = [];

    blocks.push(createBlock('trigger'));

    const agentNode = nodes.find((n) => n.type === 'agent');
    const agentConfig = agentNode?.data?.agentConfig;

    const model = createBlock('model') as ModelBlock;
    const modelNode = nodes.find((n) => n.type === 'model');
    const modelConfig = modelNode?.data?.agentConfig;
    if (modelConfig?.model) model.model = modelConfig.model;
    if (modelConfig?.personality) model.tone = modelConfig.personality;
    blocks.push(model);

    if (agentConfig?.prompt?.trim()) {
        const instruction = createBlock('instruction') as InstructionBlock;
        instruction.text = agentConfig.prompt;
        blocks.push(instruction);
    }

    for (const msg of modelConfig?.messages ?? []) {
        if (!msg?.content?.trim()) continue;
        const instruction = createBlock('instruction') as InstructionBlock;
        instruction.title = `Instruction · ${msg.role}`;
        instruction.text = msg.content;
        instruction.priority = msg.role === 'system' ? 'critical' : 'normal';
        blocks.push(instruction);
    }

    for (const node of nodes.filter((n) => n.type === 'tool')) {
        const config = node.data?.agentConfig;
        if (!config) continue;
        const spec = TOOL_LIBRARY.find(
            (t) =>
                t.id === config.id ||
                t.name.toLowerCase() === String(config.name ?? '').toLowerCase()
        );
        const tool = createBlock('tool', spec?.id) as ToolBlock;
        tool.title = spec?.name ?? config.name ?? 'Tool';
        if (config.toolConfig && typeof config.toolConfig === 'object') {
            tool.config = Object.fromEntries(
                Object.entries(config.toolConfig).map(([k, v]) => [k, String(v ?? '')])
            );
        }
        blocks.push(tool);
    }

    if (nodes.some((n) => n.type === 'memory')) {
        blocks.push(createBlock('memory'));
    }

    for (const node of nodes.filter((n) => n.type === 'sticky')) {
        const text = node.data?.content;
        if (!text) continue;
        const note = createBlock('note') as NoteBlock;
        note.text = String(text);
        blocks.push(note);
    }

    return { version: 2, blocks };
}

/* ----------------------------------------------------------- validation -- */

export interface StackIssue {
    /** `null` when the issue is about the stack as a whole. */
    blockId: string | null;
    severity: 'error' | 'warning';
    message: string;
}

/**
 * Everything standing between this stack and a working agent.
 * Errors block the run; warnings are worth fixing but the agent still answers.
 */
export function validateStack(stack: BlockStack): StackIssue[] {
    const issues: StackIssue[] = [];
    const live = stack.blocks.filter((b) => b.enabled);

    if (!live.length) {
        issues.push({
            blockId: null,
            severity: 'error',
            message: 'This agent has no blocks yet, so there is nothing to run.',
        });
        return issues;
    }

    if (!live.some((b) => b.kind === 'model')) {
        issues.push({
            blockId: null,
            severity: 'error',
            message: 'Add a Model block — the agent needs a brain before it can answer.',
        });
    }

    if (!live.some((b) => b.kind === 'trigger')) {
        issues.push({
            blockId: null,
            severity: 'warning',
            message: 'No Trigger block, so the agent only runs when you message it.',
        });
    }

    for (const block of live) {
        if (block.kind === 'instruction' && !block.text.trim()) {
            issues.push({
                blockId: block.id,
                severity: 'warning',
                message: 'This instruction is empty and will be skipped.',
            });
        }
        if (block.kind === 'condition' && !block.when.trim()) {
            issues.push({
                blockId: block.id,
                severity: 'warning',
                message: 'This condition has no situation to check, so it will be skipped.',
            });
        }
        if (block.kind === 'tool') {
            const spec = getTool(block.toolId);
            if (!spec) {
                issues.push({
                    blockId: block.id,
                    severity: 'warning',
                    message: 'This tool is no longer available and will be skipped.',
                });
            }
        }
    }

    return issues;
}

/* ------------------------------------------------------------- compiler -- */

export interface CompiledStack {
    /** The system prompt, assembled top to bottom. */
    systemPrompt: string;
    model: string;
    temperature: number;
    /** Present only when a memory block is live. */
    memory: { recall: number; write: boolean } | null;
    /** Tool names, for the "used tool" credit in the side panel. */
    toolNames: string[];
    /** Whether the side panel should offer a file picker. */
    hasFileUpload: boolean;
    /** What the side panel must capture, and how far it may go unattended. */
    vision: CompiledVision;
    /** Live web search, when a Web search tool block is on the stack. */
    search: CompiledSearch | null;
}

export interface CompiledVision {
    sight: 'off' | 'auto' | 'always';
    marks: boolean;
    redaction: 'off' | 'standard' | 'strict';
    autonomy: 'supervised' | 'autonomous';
    /** Hostnames the agent may navigate to. Empty means anywhere. */
    allowlist: string[];
    maxSteps: number;
    maxSeconds: number;
}

export interface CompiledSearch {
    count: number;
    /** Provider-neutral recency window, or null for any time. */
    freshness: 'day' | 'week' | 'month' | 'year' | null;
    citations: boolean;
}

/** What a stack with no Vision block runs on: DOM only, supervised, bounded. */
export const DEFAULT_VISION: CompiledVision = {
    sight: 'off',
    marks: false,
    redaction: 'standard',
    autonomy: 'supervised',
    allowlist: [],
    maxSteps: 25,
    maxSeconds: 300,
};

const FRESHNESS_CODES: Record<string, CompiledSearch['freshness']> = {
    'Past day': 'day',
    'Past week': 'week',
    'Past month': 'month',
    'Past year': 'year',
};

const LANGUAGE_CODES: Record<string, string> = {
    Assamese: 'as',
    Bengali: 'bn',
    Bodo: 'brx',
    Hindi: 'hi',
    English: 'en',
};

/**
 * Turns a stack into the prompt the browser agent runs on.
 *
 * The order is deliberate: identity and tone first, then critical instructions,
 * then tools, then normal instructions, then branches. Notes never compile.
 */
export function compileStack(stack: BlockStack, agentName: string): CompiledStack {
    const live = stack.blocks.filter((b) => b.enabled);

    const modelBlock = live.find((b): b is ModelBlock => b.kind === 'model');
    const visionBlock = live.find((b): b is VisionBlock => b.kind === 'vision');
    const memoryBlock = live.find((b): b is MemoryBlock => b.kind === 'memory');
    const triggerBlock = live.find((b): b is TriggerBlock => b.kind === 'trigger');
    const instructions = live.filter((b): b is InstructionBlock => b.kind === 'instruction');
    const toolBlocks = live.filter((b): b is ToolBlock => b.kind === 'tool');
    const conditions = live.filter((b): b is ConditionBlock => b.kind === 'condition');

    const sections: string[] = [];

    sections.push(
        [
            `You are "${agentName}", an agent the user assembled from blocks.`,
            modelBlock ? `Your manner is: ${modelBlock.tone}.` : null,
            modelBlock?.responseFormat === 'plain'
                ? 'Write in plain sentences. Do not use Markdown formatting.'
                : 'Use Markdown when it helps the answer read more clearly.',
        ]
            .filter(Boolean)
            .join('\n')
    );

    if (triggerBlock?.urlContains.trim()) {
        sections.push(
            `SCOPE\nYou are meant for pages whose URL contains "${triggerBlock.urlContains.trim()}". ` +
                'On any other page, say so plainly before helping.'
        );
    }

    const critical = instructions.filter((i) => i.priority === 'critical' && i.text.trim());
    if (critical.length) {
        sections.push(
            `NON-NEGOTIABLE RULES\n${critical
                .map((i) => `- ${i.text.trim()}`)
                .join('\n')}\nThese override anything below that conflicts with them.`
        );
    }

    // Perception and limits compile high on purpose. They describe what the
    // model is allowed to do at all, so nothing written below can argue past
    // them — later text loses to earlier text when the model has to choose.
    const vision: CompiledVision = visionBlock
        ? {
              // Blocks saved before `sight` existed carry the old boolean.
              sight: visionBlock.sight ?? (visionBlock.screenshot ? 'always' : 'off'),
              marks: visionBlock.marks,
              redaction: visionBlock.redaction,
              autonomy: visionBlock.autonomy,
              allowlist: visionBlock.allowlist
                  .split(',')
                  .map((host) => host.trim().toLowerCase())
                  .filter(Boolean),
              maxSteps: visionBlock.maxSteps,
              maxSeconds: visionBlock.maxSeconds,
          }
        : DEFAULT_VISION;

    if (vision.sight !== 'off') {
        const seeing = [
            'HOW YOU SEE THE PAGE',
            'Every turn you get an ELEMENTS table: the id, role and label of everything you can',
            'act on. That is usually enough, and it is by far the fastest way to work.',
        ];

        if (vision.marks) {
            seeing.push(
                '',
                'When a screenshot is attached it has a numbered badge drawn on each of those',
                'elements. The badge number IS the elementId — read it off the badge.',
                '- Only ever use a number that appears in the ELEMENTS table.',
                '- Never guess a number, and never invent pixel coordinates.'
            );
        } else {
            seeing.push('', 'When a screenshot is attached, still act only through elementIds.');
        }

        if (vision.sight === 'auto') {
            seeing.push(
                '',
                'You will NOT get a screenshot every turn — looking is slow, and the element table',
                'is usually enough. When the table genuinely does not tell you what you need — a',
                'canvas, a chart, an image you must read, a layout you cannot infer — reply',
                '{"action":"SEE","text":"why you need to look"} and the next turn will include one.',
                'Do not use SEE out of habit. Every SEE makes the run several times slower.'
            );
        }

        sections.push(seeing.join('\n'));
    }

    const limits: string[] = [
        'LIMITS ON THIS RUN',
        `- You have at most ${vision.maxSteps} actions and ${Math.round(vision.maxSeconds / 60)} minutes of working time.`,
        '- If an action does not change the page, do not repeat it. Try something else or stop.',
        '- If you are missing something only the user can give — a code, a preference, a decision —',
        '  use ASK. The run pauses and resumes with their reply, so you keep everything you have',
        '  done so far. Waiting does not spend your time budget. Prefer ASK over guessing.',
        '- Use ANSWER only when the task is finished, or when you are blocked in a way the user',
        '  cannot resolve by replying. ANSWER ends the run.',
    ];

    if (vision.allowlist.length) {
        limits.push(`- You may only NAVIGATE to: ${vision.allowlist.join(', ')}.`);
    }

    limits.push(
        vision.autonomy === 'autonomous'
            ? '- Work through the whole task without checking in, except where a rule below stops you.'
            : '- Before anything irreversible — sending, buying, deleting, submitting — use ASK with\n' +
              '  expecting "confirmation" and wait for a yes. Do not proceed on your own judgement.'
    );

    limits.push(
        '- Never type into or near a password field, and never fill card details the user did not give you.',
        '- Never attempt a captcha or invent an OTP. Ask the user to read it out.'
    );

    sections.push(limits.join('\n'));

    if (toolBlocks.length) {
        const lines: string[] = ['TOOLS AVAILABLE TO YOU'];

        for (const block of toolBlocks) {
            const spec = getTool(block.toolId);
            if (!spec) continue;

            lines.push(`\n${spec.name} — ${spec.description}`);

            for (const field of spec.fields) {
                const value = block.config[field.key];
                if (!value?.trim()) continue;
                if (field.showWhen && block.config[field.showWhen.key] !== field.showWhen.equals) {
                    continue;
                }
                lines.push(`  ${field.label}: ${value.trim()}`);
            }

            if (spec.id === 'web-search') {
                lines.push(
                    '  Your training data stops well before today. For anything that can change —',
                    '  prices, versions, availability, news, who holds a role — you MUST issue',
                    '  {"action":"SEARCH","query":"..."} and wait for the results before you assert it.',
                    '  Use {"action":"READ_URL","url":"..."} when a snippet is not enough to settle it.'
                );
                if (block.config.citations !== 'No') {
                    lines.push(
                        '  Every web-grounded claim in your final ANSWER must carry its source URL in',
                        '  a "citations" array: [{"claim":"...","url":"..."}]. No citation, no claim.'
                    );
                }
            }
            if (spec.id === 'translate') {
                const language = block.config.language || 'Assamese';
                const code = LANGUAGE_CODES[language] ?? 'as';
                lines.push(
                    `  When the user asks for the page in ${language}, or in a language you cannot`,
                    `  write yourself, return {"action":"TRANSLATE","language":"${code}"}.`,
                    '  Do not translate the page by retyping it. The action does it in place.'
                );
            }
            if (spec.id === 'news-authenticity') {
                lines.push(
                    '  Act as a fact-checking analyst. Judge the source against the criteria above, ' +
                        'then close with a bold "**Final thoughts:**" verdict.'
                );
            }
            if (spec.id === 'gmail') {
                lines.push(
                    '  Complete the whole send: compose, recipient, subject, body, then click send. ' +
                        'Never stop with fields unfilled.'
                );
            }
            if (spec.id === 'shopping') {
                lines.push(
                    '  Complete the whole checkout: cart, address, payment, place order. ' +
                        'Use the details above to fill fields. Do not stop at "add to cart".'
                );
            }
        }

        lines.push(
            '\nWhen a request matches one of these tools, carry out the real workflow on the page ' +
                'with NAVIGATE, CLICK and TYPE. Do not substitute an ANSWER for work you can do. ' +
                'Credit the tool you used in the "usedTool" field of your response.'
        );

        sections.push(lines.join('\n'));
    }

    const normal = instructions.filter((i) => i.priority === 'normal' && i.text.trim());
    if (normal.length) {
        sections.push(`HOW TO BEHAVE\n${normal.map((i) => `- ${i.text.trim()}`).join('\n')}`);
    }

    const liveConditions = conditions.filter((c) => c.when.trim());
    if (liveConditions.length) {
        const lines = liveConditions.map((c) => {
            const parts = [`If ${c.when.trim()}:`];
            if (c.then.trim()) parts.push(`  then ${c.then.trim()}`);
            if (c.otherwise.trim()) parts.push(`  otherwise ${c.otherwise.trim()}`);
            return parts.join('\n');
        });
        sections.push(
            `BRANCHES\nJudge each of these yourself from the page and the conversation.\n\n${lines.join('\n\n')}`
        );
    }

    if (memoryBlock?.write) {
        sections.push(
            'MEMORY\nWhen you learn something durable about the user, or finish a task worth ' +
                'remembering, include a "memory" field in your JSON response with one short sentence.'
        );
    }

    const searchBlock = toolBlocks.find((b) => b.toolId === 'web-search');

    return {
        systemPrompt: sections.join('\n\n'),
        model: modelBlock?.model ?? MODELS[0],
        temperature: modelBlock?.temperature ?? 0.7,
        memory: memoryBlock ? { recall: memoryBlock.recall, write: memoryBlock.write } : null,
        toolNames: toolBlocks.map((b) => getTool(b.toolId)?.name).filter((n): n is string => !!n),
        hasFileUpload: toolBlocks.some((b) => b.toolId === 'file-upload'),
        vision,
        search: searchBlock
            ? {
                  count: Number(searchBlock.config.count) || 5,
                  freshness: FRESHNESS_CODES[searchBlock.config.freshness ?? ''] ?? null,
                  citations: searchBlock.config.citations !== 'No',
              }
            : null,
    };
}
