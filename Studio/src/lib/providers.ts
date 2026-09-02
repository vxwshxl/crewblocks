/**
 * Where a model call actually goes.
 *
 * The block editor stores a model id and nothing else. This file turns that id
 * into a request against the right service, so the rest of the app never has to
 * know whether the model is a local process, OpenRouter, or Google.
 *
 * Both Qwen tiers speak the same OpenAI-compatible API, so switching between
 * "on this Mac" and "cloud" is a base-URL change and nothing more. That is the
 * whole reason the catalog only holds one model family.
 */

import { GoogleGenAI } from '@google/genai';
import { getModel, type ModelSpec } from '@/lib/blocks';

/** Where a locally served model listens. Started by `pnpm dev:model`. */
const LOCAL_BASE_URL = process.env.LOCAL_MODEL_URL ?? 'http://127.0.0.1:8081/v1';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface AgentMessage {
    role: 'user' | 'assistant';
    content: string;
    /** Data URLs. Ignored by models without vision. */
    images?: string[];
}

export interface ModelRequest {
    systemPrompt: string;
    messages: AgentMessage[];
    model: string;
    temperature: number;
    /** Only used by the Gemini path, which needs a per-user key. */
    geminiKey?: string;
}

/** Anything the caller can act on. `raw` is kept for the activity log. */
export interface ModelResult {
    payload: Record<string, unknown>;
    raw: string;
}

export class ModelError extends Error {
    constructor(
        message: string,
        readonly code: 'NO_KEY' | 'LOCAL_SERVER_DOWN' | 'UPSTREAM' | 'BAD_JSON'
    ) {
        super(message);
        this.name = 'ModelError';
    }
}

/**
 * Models answer in JSON, but not always cleanly — a fenced block or a leading
 * sentence is common. Salvage what we can rather than failing the whole turn.
 */
function parseModelJson(text: string): Record<string, unknown> {
    let cleaned = text.trim();

    if (cleaned.startsWith('```')) {
        cleaned = cleaned
            .replace(/^```(?:json)?/i, '')
            .replace(/```$/, '')
            .trim();
    }

    try {
        return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
        // Fall back to the outermost braces, which survives a stray preamble.
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end > start) {
            try {
                return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
            } catch {
                /* fall through to the throw below */
            }
        }
        throw new ModelError('The model did not return usable JSON.', 'BAD_JSON');
    }
}

/* ------------------------------------------------------- openai-compatible -- */

interface OpenAIContentPart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
}

function toOpenAIMessages(request: ModelRequest, spec: ModelSpec) {
    const messages: Array<{ role: string; content: string | OpenAIContentPart[] }> = [
        { role: 'system', content: request.systemPrompt },
    ];

    for (const message of request.messages) {
        const images = spec.vision ? (message.images ?? []).filter(Boolean) : [];

        if (!images.length) {
            messages.push({ role: message.role, content: message.content });
            continue;
        }

        const parts: OpenAIContentPart[] = [{ type: 'text', text: message.content }];
        for (const image of images) {
            parts.push({ type: 'image_url', image_url: { url: image } });
        }
        messages.push({ role: message.role, content: parts });
    }

    return messages;
}

async function runOpenAICompatible(request: ModelRequest, spec: ModelSpec): Promise<ModelResult> {
    const baseUrl = spec.local ? LOCAL_BASE_URL : OPENROUTER_BASE_URL;
    const apiKey = spec.local ? null : process.env.OPENROUTER_API_KEY;

    if (!spec.local && !apiKey) {
        throw new ModelError(
            'No OpenRouter key is set. Add OPENROUTER_API_KEY to .env.local, or switch the Model block to the on-device model.',
            'NO_KEY'
        );
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    let response: Response;
    try {
        response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: spec.id,
                messages: toOpenAIMessages(request, spec),
                temperature: request.temperature,
                max_tokens: 1024,
                response_format: { type: 'json_object' },
            }),
        });
    } catch {
        if (spec.local) {
            throw new ModelError(
                `The on-device model is not answering on ${LOCAL_BASE_URL}. Start it with "pnpm dev:model", or switch the Model block to a cloud model.`,
                'LOCAL_SERVER_DOWN'
            );
        }
        throw new ModelError('Could not reach the model service.', 'UPSTREAM');
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new ModelError(
            `The model service returned ${response.status}. ${detail.slice(0, 200)}`,
            'UPSTREAM'
        );
    }

    const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? '';

    if (!text.trim()) {
        throw new ModelError('The model returned an empty response.', 'BAD_JSON');
    }

    return { payload: parseModelJson(text), raw: text };
}

/* ------------------------------------------------------------------ gemini -- */

async function runGemini(request: ModelRequest, spec: ModelSpec): Promise<ModelResult> {
    if (!request.geminiKey) {
        throw new ModelError(
            'Add a Gemini key under API keys in CrewBlocks, then message me again.',
            'NO_KEY'
        );
    }

    const ai = new GoogleGenAI({ apiKey: request.geminiKey });

    // Gemini rejects two turns in the same role back to back.
    const merged: AgentMessage[] = [];
    for (const message of request.messages) {
        const previous = merged[merged.length - 1];
        if (previous && previous.role === message.role) {
            previous.content += `\n${message.content}`;
            previous.images = [...(previous.images ?? []), ...(message.images ?? [])];
        } else {
            merged.push({ ...message });
        }
    }

    const contents = merged.map((message) => {
        const parts: Array<Record<string, unknown>> = [];
        if (message.content) parts.push({ text: message.content });

        if (spec.vision) {
            for (const image of message.images ?? []) {
                const match = image?.match(/^data:(image\/[^;]+);base64,(.*)$/);
                if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
        }

        return { role: message.role === 'assistant' ? 'model' : 'user', parts };
    });

    try {
        const response = await ai.models.generateContent({
            model: spec.id,
            contents,
            config: {
                systemInstruction: { parts: [{ text: request.systemPrompt }] },
                temperature: request.temperature,
                topP: 0.95,
                responseMimeType: 'application/json',
            },
        });

        const text = (response.text ?? '').trim();
        if (!text) throw new ModelError('The model returned an empty response.', 'BAD_JSON');

        return { payload: parseModelJson(text), raw: text };
    } catch (error) {
        if (error instanceof ModelError) throw error;
        throw new ModelError('Gemini rejected the request.', 'UPSTREAM');
    }
}

/* -------------------------------------------------------------------- entry -- */

/** Runs one turn against whichever service owns this model id. */
export async function runModel(request: ModelRequest): Promise<ModelResult> {
    const spec = getModel(request.model);

    if (!spec) {
        throw new ModelError(
            `"${request.model}" is not a model this build knows. Open the agent and pick one from the Model block.`,
            'UPSTREAM'
        );
    }

    return spec.provider === 'gemini'
        ? runGemini(request, spec)
        : runOpenAICompatible(request, spec);
}
