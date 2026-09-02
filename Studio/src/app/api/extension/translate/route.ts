import { NextRequest, NextResponse } from 'next/server';

const BHASHINI_ENDPOINT = "https://dhruva-api.bhashini.gov.in/services/inference/pipeline";
const BHASHINI_KEY = process.env.BHASHINI_SUBSCRIPTION_KEY || "KbA_dh-JvZvKpjo152OjtWmHPGindblWZNX-Usvx0SxqP0l0pzGgWoWcRwQ-WuoE";

export async function POST(req: NextRequest) {
    const origin = req.headers.get('origin');

    try {
        const { texts, targetLanguage } = await req.json();

        if (!texts || !Array.isArray(texts)) {
            return corsHeaders(
                NextResponse.json({ error: "texts array is required" }, { status: 400 }),
                origin
            );
        }

        const targetLang = targetLanguage || 'as';

        // 50 inputs per call keeps the payload under Bhashini's 413 limit.
        const BATCH_SIZE = 50;
        // Batches in flight at once. The batches were always there; running them
        // one after another was the cost — a 900-node page is 18 round trips to a
        // remote API, serialised, which is where the wait came from. Six is a
        // pool rather than an unbounded Promise.all: firing eighteen requests at
        // a government endpoint earns a 429, not a speed-up.
        const CONCURRENCY = 6;

        // Indexed writes, not pushes. A batch that comes back short used to shift
        // every later translation onto the wrong node for the rest of the page.
        const translatedTexts: string[] = new Array(texts.length);

        const offsets: number[] = [];
        for (let i = 0; i < texts.length; i += BATCH_SIZE) offsets.push(i);

        const runBatch = async (offset: number) => {
            const batch: string[] = texts.slice(offset, offset + BATCH_SIZE);
            try {
                const outputs = await translateBatch(batch, targetLang);
                for (let j = 0; j < batch.length; j++) {
                    translatedTexts[offset + j] = outputs[j] ?? batch[j];
                }
            } catch (error) {
                console.error('Bhashini API Error:', error);
                // Alignment matters more than completeness: an untranslated
                // string in the right place beats a translated one in the wrong.
                for (let j = 0; j < batch.length; j++) {
                    translatedTexts[offset + j] = batch[j];
                }
            }
        };

        let cursor = 0;
        await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, offsets.length) }, async () => {
                while (cursor < offsets.length) {
                    await runBatch(offsets[cursor++]);
                }
            })
        );

        if (!translatedTexts || translatedTexts.length === 0) {
            throw new Error("Translation failed");
        }

        return corsHeaders(NextResponse.json({ translated_texts: translatedTexts }), origin);

    } catch (error) {
        console.error("Translate endpoint error:", error);
        return corsHeaders(
            NextResponse.json({
                error: "Translation failed. CrewBlocks may be incorrect. Please verify important information."
            }, { status: 500 }),
            origin
        );
    }
}

/** One Bhashini pipeline call. Returns the translations in input order. */
async function translateBatch(batch: string[], targetLang: string): Promise<string[]> {
    const response = await fetch(BHASHINI_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: BHASHINI_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            pipelineTasks: [
                {
                    taskType: 'translation',
                    config: {
                        language: { sourceLanguage: 'en', targetLanguage: targetLang },
                    },
                },
            ],
            inputData: { input: batch.map((text) => ({ source: text })) },
        }),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const output = data?.pipelineResponse?.[0]?.output;
    if (!Array.isArray(output)) throw new Error('Invalid response, missing output array');

    return output.map((item: { target?: string }) => item.target ?? '');
}

/** The side panel is a chrome-extension:// origin, so it needs these to read a reply. */
function corsHeaders(response: NextResponse, origin: string | null): NextResponse {
    response.headers.set('Access-Control-Allow-Origin', origin ?? '*');
    response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    return response;
}

export async function OPTIONS(req: NextRequest) {
    return corsHeaders(new NextResponse(null, { status: 204 }), req.headers.get('origin'));
}
