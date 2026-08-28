import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@/utils/supabase/server';
import { compileStack, readStack, validateStack, type CompiledStack } from '@/lib/blocks';

const actionProtocol = `You are the CrewBlocks agentic engine. You act on the user's current web page and answer questions about the wider world.

You MUST respond ONLY in valid JSON.

AVAILABLE ACTIONS:
CLICK       - Click a button or link. Requires 'elementId'.
SCROLL      - Scroll the page. Requires 'direction' ("UP" or "DOWN").
TYPE        - Enter text. Requires 'elementId' and 'text'.
NAVIGATE    - Go to a URL. Requires 'url'.
TRANSLATE   - Translate the page. Requires 'language' ('as', 'bn', 'brx', 'hi', 'en').
ANSWER      - Talk to the user, answer a question, or ask for input such as an OTP.

CRITICAL RULES:
1. To touch the DOM (CLICK, TYPE) you MUST use an 'elementId' from the CURRENT BROWSER CONTEXT. Never target by fuzzy text.
2. For a general question, reply with ANSWER and use your search capability to ground it. Ignore the browser state entirely.
3. When you need something only the user has (an OTP, a captcha's text, a confirmation), return ANSWER asking for it, then wait.
4. CAPTCHAS: never attempt to solve one. Ask the user to read it out, then TYPE their reply into the field.
5. OTPs: never invent one. After triggering Send OTP, ask the user for it, then TYPE their reply.
6. One action per turn.
7. Do not re-NAVIGATE to a page you are already on. Repeated loads trip rate limits on government portals.
8. If several SCROLLs have not revealed the target, stop scrolling. Pick the best visible option or ANSWER explaining what you could not find. Never invent an element that is not in the DOM.
9. If the user asks you to go to a site in any language, or agrees to a URL you suggested, issue NAVIGATE.
10. Do not give legal or medical advice. Point to official sources instead.
11. Credit any tool you used in a 'usedTool' field.

EXAMPLES:
{"action":"CLICK","elementId":15}
{"action":"SCROLL","direction":"DOWN"}
{"action":"TYPE","elementId":12,"text":"Search query"}
{"action":"NAVIGATE","url":"https://example.com"}
{"action":"TRANSLATE","language":"as"}
{"action":"ANSWER","text":"Your answer goes here..."}

Respond in valid JSON only:`;

interface AgentRuntime extends CompiledStack {
    userId: string;
    apiKey: string;
    /** A blocking problem with the stack, phrased for the side panel. */
    blocked: string | null;
}

/**
 * Loads the agent's block stack and compiles it into everything the model run
 * needs. Returns null when the row does not exist or is not this user's.
 */
async function loadAgent(agentId: string): Promise<AgentRuntime | null> {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    const { data: row, error } = await supabase
        .from('chatflows')
        .select('name, data')
        .eq('id', agentId)
        .eq('user_id', user.id)
        .single();

    if (error || !row) return null;

    const stack = readStack(row.data);
    const compiled = compileStack(stack, row.name ?? 'Agent');

    const blockingIssue = validateStack(stack).find((issue) => issue.severity === 'error');

    const { data: keyRow } = await supabase
        .from('apiKeys')
        .select('key')
        .eq('user_id', user.id)
        .eq('provider', 'gemini')
        .single();

    return {
        ...compiled,
        userId: user.id,
        apiKey: keyRow?.key ?? '',
        blocked: blockingIssue?.message ?? null,
    };
}

interface ChatMessage {
    role: string;
    content: string;
    image_data?: string | string[];
}

async function runGemini(
    messages: ChatMessage[],
    pageContent: string,
    elements: unknown,
    url: string,
    title: string,
    runtime: AgentRuntime
) {
    const ai = new GoogleGenAI({ apiKey: runtime.apiKey });
    const working: ChatMessage[] = messages.map((message) => ({ ...message }));

    if (!working.length) {
        working.push({ role: 'user', content: 'No explicit goal provided.' });
    }

    // Fold the browser state into the newest user turn, so the model always
    // sees the page it is acting on immediately before the command.
    for (let i = working.length - 1; i >= 0; i--) {
        if (working[i].role !== 'user') continue;

        const command = working[i].content || '';
        working[i].content = `[BROWSER STATE START] (Ignore this entirely if the COMMAND is a general question or a search. Use it only for page-level work.)
URL: ${url}
TITLE: ${title}

CONTENT:
${pageContent ? pageContent.substring(0, 2000) : 'No context provided'}

ELEMENTS:
${JSON.stringify(elements)}
[BROWSER STATE END]

COMMAND: ${command}

If the COMMAND is a general knowledge question, ignore the browser state completely, use Google Search, and return a JSON ANSWER.`;
        break;
    }

    // Gemini rejects two turns in the same role back to back.
    const merged: ChatMessage[] = [];
    for (const message of working) {
        const previous = merged[merged.length - 1];
        if (previous && previous.role === message.role) {
            previous.content += `\n${message.content}`;
            if (message.image_data) {
                const existing = previous.image_data
                    ? Array.isArray(previous.image_data)
                        ? previous.image_data
                        : [previous.image_data]
                    : [];
                const incoming = Array.isArray(message.image_data)
                    ? message.image_data
                    : [message.image_data];
                previous.image_data = [...existing, ...incoming];
            }
        } else {
            merged.push(message);
        }
    }

    const contents = merged.map((message) => {
        const parts: Array<Record<string, unknown>> = [];
        if (message.content) parts.push({ text: message.content });

        if (message.image_data) {
            const images = Array.isArray(message.image_data)
                ? message.image_data
                : [message.image_data];

            for (const image of images) {
                if (!image) continue;
                const match = image.match(/^data:(image\/[^;]+);base64,(.*)$/);
                if (match) {
                    parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                }
            }
        }

        return { role: message.role === 'assistant' ? 'model' : 'user', parts };
    });

    try {
        const response = await ai.models.generateContent({
            model: runtime.model,
            contents,
            config: {
                systemInstruction: {
                    parts: [
                        { text: `${runtime.systemPrompt}\n\n=== ACTION RULES ===\n${actionProtocol}` },
                    ],
                },
                temperature: runtime.temperature,
                topP: 0.95,
                topK: 64,
                responseMimeType: 'application/json',
                tools: [{ googleSearch: {} }],
            },
        });

        let text = (response.text ?? '').trim();
        if (!text) {
            return {
                action: 'ANSWER',
                text: 'I could not work that one out. Try telling me more about what you need.',
            };
        }

        if (text.startsWith('```json')) {
            text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        }

        return JSON.parse(text);
    } catch (error) {
        console.error('Gemini API error:', error);
        return {
            action: 'ANSWER',
            text: 'CrewBlocks may be incorrect. Please verify important information.',
        };
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { messages, page_content, elements, url, title, model } = body;

        if (!Array.isArray(messages)) {
            return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
        }

        // The side panel sends the selected agent's id in the 'model' field.
        const agentId = model;
        const runtime = await loadAgent(agentId);

        if (!runtime) {
            return NextResponse.json({
                action: 'ANSWER',
                text: 'I could not find that agent. Open it in CrewBlocks and check it is still there.',
            });
        }

        if (runtime.blocked) {
            return NextResponse.json({ action: 'ANSWER', text: runtime.blocked });
        }

        if (!runtime.apiKey) {
            return NextResponse.json({
                action: 'ANSWER',
                text: 'Add a Gemini key under API keys in CrewBlocks, then message me again.',
            });
        }

        const supabase = await createClient();
        let systemPrompt = runtime.systemPrompt;

        if (runtime.memory) {
            const { data: memories } = await supabase
                .from('chatflow_memory')
                .select('content')
                .eq('chatflow_id', agentId)
                .order('created_at', { ascending: false })
                .limit(runtime.memory.recall);

            if (memories?.length) {
                systemPrompt += `\n\nWHAT YOU ALREADY KNOW\n${memories
                    .reverse()
                    .map((memory) => `- ${memory.content}`)
                    .join('\n')}`;
            }
        }

        const result = await runGemini(
            messages,
            page_content,
            elements,
            url,
            title,
            { ...runtime, systemPrompt }
        );

        try {
            const rows = [];
            const lastUserMessage = messages[messages.length - 1];

            if (lastUserMessage?.role === 'user') {
                // The agentic loop re-prompts itself; those turns are not history.
                const isInternal =
                    typeof lastUserMessage.content === 'string' &&
                    lastUserMessage.content.includes(
                        'What is the next logical action to achieve the USER GOAL?'
                    );

                if (!isInternal) {
                    rows.push({
                        chatflow_id: agentId,
                        user_id: runtime.userId,
                        role: 'user',
                        content: lastUserMessage.content,
                        image_data: lastUserMessage.image_data ?? null,
                    });
                }
            }

            rows.push({
                chatflow_id: agentId,
                user_id: runtime.userId,
                role: 'assistant',
                content: result.text ?? '',
            });

            await supabase.from('chat_history').insert(rows);
        } catch (error) {
            console.error('Failed to save chat history:', error);
        }

        if (result.memory && runtime.memory?.write) {
            try {
                await supabase.from('chatflow_memory').insert({
                    chatflow_id: agentId,
                    user_id: runtime.userId,
                    content: result.memory,
                });
            } catch (error) {
                console.error('Failed to save memory:', error);
            }
        }

        return NextResponse.json({
            action: result.action ?? 'ANSWER',
            elementId: result.elementId,
            direction: result.direction,
            text: result.text,
            url: result.url,
            language: result.language,
            memory: result.memory,
        });
    } catch (error) {
        console.error('Chat endpoint error:', error);
        return NextResponse.json(
            {
                action: 'ANSWER',
                text: 'CrewBlocks may be incorrect. Please verify important information.',
            },
            { status: 500 }
        );
    }
}
