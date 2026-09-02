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
        const translatedTexts: string[] = [];
        const BATCH_SIZE = 50; // max inputs per API call to avoid 413 Payload Too Large

        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const batch = texts.slice(i, i + BATCH_SIZE);
            const payloadInputs = batch.map((text: string) => ({ source: text }));

            const payload = {
                pipelineTasks: [
                    {
                        taskType: "translation",
                        config: {
                            language: {
                                sourceLanguage: "en",
                                targetLanguage: targetLang
                            }
                        }
                    }
                ],
                inputData: {
                    input: payloadInputs
                }
            };

            try {
                const response = await fetch(BHASHINI_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        "Authorization": BHASHINI_KEY,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`HTTP error! status: ${response.status} msg: ${errText}`);
                }

                const data = await response.json();

                if (data.pipelineResponse && data.pipelineResponse[0] && data.pipelineResponse[0].output) {
                    const outputs = data.pipelineResponse[0].output;
                    outputs.forEach((outItem: { target?: string }) => {
                        translatedTexts.push(outItem.target ?? '');
                    });
                } else {
                    throw new Error("Invalid response missing output array");
                }

            } catch (error) {
                console.error("Bhashini API Error:", error);
                // Fallback: if a batch fails, push original texts to keep array alignment
                batch.forEach((text: string) => translatedTexts.push(text));
            }
        }

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
