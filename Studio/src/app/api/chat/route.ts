import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { provider, model, apiKey, messages } = body;

        if (!provider || !apiKey || !messages) {
            return NextResponse.json(
                { error: 'Missing required fields: provider, apiKey, messages' },
                { status: 400 }
            );
        }

        if (provider === 'gemini') {
            const geminiModel = model.includes('gemini') ? model : 'gemini-pro-latest';
            // Convert messages to Gemini format
            const geminiMessages = messages
                .filter((m: any) => m.role !== 'system')
                .map((m: any) => ({
                    role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                }));

            // If there's a system message, we extract it for systemInstruction payload
            const systemMessage = messages.find((m: any) => m.role === 'system')?.content;

            const payload: any = { contents: geminiMessages };
            if (systemMessage) {
                payload.systemInstruction = {
                    role: "user",
                    parts: [{ text: systemMessage }]
                };
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.text();
                return NextResponse.json({ error: `Gemini API error: ${errorData}` }, { status: response.status });
            }

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return NextResponse.json({ text });

        } else if (provider === 'openai') {
            const openaiModel = model.includes('gpt') ? model : 'gpt-4o';
            const url = 'https://api.openai.com/v1/chat/completions';

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: openaiModel,
                    messages: messages,
                }),
            });

            if (!response.ok) {
                const errorData = await response.text();
                return NextResponse.json({ error: `OpenAI API error: ${errorData}` }, { status: response.status });
            }

            const data = await response.json();
            const text = data.choices?.[0]?.message?.content || '';
            return NextResponse.json({ text });
        } else if (provider === 'anthropic') {
            const anthropicModel = model.includes('claude') ? model : 'claude-3-opus-20240229';
            const systemMessages = messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
            const chatMessages = messages.filter((m: any) => m.role !== 'system');

            const url = 'https://api.anthropic.com/v1/messages';
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: anthropicModel,
                    system: systemMessages || undefined,
                    messages: chatMessages,
                    max_tokens: 4096,
                }),
            });

            if (!response.ok) {
                const errorData = await response.text();
                return NextResponse.json({ error: `Anthropic API error: ${errorData}` }, { status: response.status });
            }

            const data = await response.json();
            const text = data.content?.[0]?.text || '';
            return NextResponse.json({ text });
        } else {
            return NextResponse.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
        }
    } catch (error) {
        return NextResponse.json(
            { error: `API request failed: ${error instanceof Error ? error.message : String(error)}` },
            { status: 500 }
        );
    }
}
