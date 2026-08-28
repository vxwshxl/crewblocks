import { NextRequest, NextResponse } from 'next/server';

const BHASHINI_ENDPOINT = "https://dhruva-api.bhashini.gov.in/services/inference/pipeline";
const BHASHINI_KEY = process.env.BHASHINI_SUBSCRIPTION_KEY || "KbA_dh-JvZvKpjo152OjtWmHPGindblWZNX-Usvx0SxqP0l0pzGgWoWcRwQ-WuoE";

export async function POST(req: NextRequest) {
    try {
        const { texts, targetLanguage } = await req.json();

        if (!texts || !Array.isArray(texts)) {
            return NextResponse.json({ error: "texts array is required" }, { status: 400 });
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
                    outputs.forEach((outItem: any) => {
                        translatedTexts.push(outItem.target);
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

        return NextResponse.json({ translated_texts: translatedTexts });

    } catch (error) {
        console.error("Translate endpoint error:", error);
        return NextResponse.json({
            error: "Translation failed. CrewBlocks may be incorrect. Please verify important information."
        }, { status: 500 });
    }
}
