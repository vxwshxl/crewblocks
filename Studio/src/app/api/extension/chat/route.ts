import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import {
    compileStack,
    readStack,
    validateStack,
    getModel,
    MODEL_CATALOG,
    type CompiledStack,
} from '@/lib/blocks';
import { runModel, ModelError, type AgentMessage } from '@/lib/providers';
import { webSearch, readUrl, SearchError } from '@/lib/search';

/**
 * The action vocabulary. This is fixed, not stack-dependent — what varies per
 * agent is compiled in `compileStack` and lands above this in the prompt.
 *
 * SEARCH and READ_URL never reach the extension. They are resolved here and
 * fed back to the model, so the side panel only ever sees browser actions.
 */
const actionProtocol = `You are the CrewBlocks agentic engine. You act on the user's current web page and answer questions about the wider world.

You MUST respond ONLY in valid JSON. One action per turn.

AVAILABLE ACTIONS:
CLICK     - Click something. Requires 'elementId' from the ELEMENTS table.
TYPE      - Enter text into an input. Requires 'elementId' and 'text'.
            Add "submit": true to press Enter afterwards. A search box needs this —
            typing alone fills the field and nothing happens.
SCROLL    - Scroll the page. Requires 'direction' ("UP" or "DOWN").
NAVIGATE  - Go to a URL. Requires 'url'.
TRANSLATE - Translate the page in place. Requires 'language' ('as','bn','brx','hi','en').
SEARCH    - Look something up on the live web. Requires 'query'. Results come back to you.
READ_URL  - Read one page's text. Requires 'url'. The text comes back to you.
SEE       - Ask for a screenshot of the page. Only when the ELEMENTS table genuinely cannot
            tell you what you need — a canvas, a chart, an image to read. Costs several
            seconds, so never use it out of habit. Requires 'text' saying why.
ASK       - Pause and ask the user for something only they can supply. The run SUSPENDS and
            resumes with their reply — you keep your progress, so prefer this over giving up.
            Requires 'text'. Add 'expecting' to shape the input, and 'options' for a choice:
              "confirmation" - yes/no. Use before anything irreversible.
              "choice"       - one of 'options' (2-4 short strings). Use when you need them to pick.
              "otp"          - a one-time code.
              "number"       - a quantity, a price cap, a count.
              "text"         - anything else. This is the default.
ANSWER    - The task is finished, or you are permanently blocked. This ENDS the run.

CRITICAL RULES:
1. If the user is making conversation, greeting you, or asking something you can answer
   from what you know or from the page text already in front of you, reply with ANSWER
   on the very first turn. Do NOT touch the page. Greetings like "hi", "thanks", "who are
   you", and questions about the page's content are all ANSWER, never CLICK. Only act on
   the page when the user actually asked for something to be done to it.
2. Read the ELEMENTS table before choosing. Each entry has a "kind":
     kind "input"     - a text field. Use TYPE. Clicking it changes nothing.
     kind "clickable" - a button or link. Use CLICK.
     kind "image"     - readable content, not a target. Never CLICK or TYPE it.
   Using the wrong action for a kind is the single most common way to get stuck.
3. CLICK and TYPE must use an elementId that appears in the current ELEMENTS table. Never target by fuzzy text, never invent a number.
4. When a screenshot has numbered badges, the badge number IS the elementId. Read it off the badge.
5. If what you need is not on screen, SCROLL. If several scrolls have not revealed it, stop and ANSWER saying what you could not find.
6. Never repeat an action that did not change the page. Try something else, or ANSWER explaining that you are stuck.
7. CAPTCHAS: never attempt one. ASK with expecting "text" for the user to read it out, then TYPE their reply.
8. OTPs: never invent one. After triggering send, ASK with expecting "otp", then TYPE their reply.
9. ASK only for what you genuinely cannot get: a code sent to their phone, a choice
   only they can make, confirmation before something irreversible. Anything already
   stated in the request — a recipient, an address, a subject, a quantity, a name — is
   yours to use. Asking for it again wastes the run and reads as not listening.
10. The page you are on may simply be the wrong page. If it cannot do what was asked,
    NAVIGATE to a site that can instead of hunting through its elements. But never
    re-NAVIGATE to a page you are already on.
11. Do not give legal or medical advice. Point to official sources instead.
12. Credit any tool you used in a 'usedTool' field.
13. Only claim a task is done when the confirmation is actually visible on the page.

EXAMPLES:
{"action":"CLICK","elementId":15}
{"action":"TYPE","elementId":12,"text":"Search query","submit":true}
{"action":"SCROLL","direction":"DOWN"}
{"action":"NAVIGATE","url":"https://example.com"}
{"action":"TRANSLATE","language":"as"}
{"action":"SEARCH","query":"latest Qwen3-VL release date"}
{"action":"READ_URL","url":"https://example.com/changelog"}
{"action":"SEE","text":"The result is drawn on a canvas, I need to look."}
{"action":"ASK","text":"What is the 6-digit code?","expecting":"otp"}
{"action":"ASK","text":"Place the order for 2,499?","expecting":"confirmation"}
{"action":"ASK","text":"Which size?","expecting":"choice","options":["M","L","XL"]}
{"action":"ANSWER","text":"...","citations":[{"claim":"...","url":"..."}]}

Respond in valid JSON only:`;

/**
 * Decides whether a message is a job for the browser at all, and if so, where
 * that job starts.
 *
 * Two decisions in one turn, because they need the same inputs and neither
 * needs the ELEMENTS table:
 *
 *  - kind. Rule 1 of the action protocol asks the model to answer conversation
 *    with ANSWER instead of touching the page, and on the 4B tier it measurably
 *    does not: "hi" came back as CLICK on element #2.
 *  - startUrl. Nothing in the action protocol told the model the page in front
 *    of it might simply be the wrong page. Asked to send mail while sitting on
 *    a GitHub repo, it worked that repo's elements until the no-progress guard
 *    stopped the run. Picking the destination here, before a table of
 *    irrelevant buttons is in front of the model, is the fix.
 *
 * Same reasoning as the irreversible-action gate in the side panel: a guard the
 * model can skip by choosing to is not a guard.
 */
function triagePrompt(url: string, title: string): string {
    return `You decide whether a message needs browser automation, and where it should happen.

THE USER IS CURRENTLY LOOKING AT:
${title || '(untitled)'}
${url || '(no page)'}

Respond ONLY in valid JSON, in one of these three shapes:

{"kind":"chat","text":"your reply"}
    Conversation, a greeting, or a question you can answer from your own
    knowledge. Nothing needs to happen in a browser.

{"kind":"task"}
    The user wants something done TO THE PAGE ABOVE: summarise it, translate it,
    fill this form, click something on it, pull data out of it.

{"kind":"task","startUrl":"https://..."}
    The user wants something done that the page above cannot do. Give the URL
    where the work actually starts. It opens in a NEW TAB, so the user keeps
    whatever they were reading.

The user is usually just standing wherever they happened to be. A task that
names a service, a destination, or an errand almost always needs a startUrl —
being on a page is not a reason to believe the job belongs to it.

Land as close to the job as you are sure of:
  email / mail someone      -> https://mail.google.com/mail/u/0/#inbox?compose=new
  message someone           -> https://web.whatsapp.com/
  buy / order / find a product -> https://www.amazon.in/
  look something up         -> https://www.google.com/search?q=URL+ENCODED+QUERY
  watch / find a video      -> https://www.youtube.com/results?search_query=URL+ENCODED+QUERY
Otherwise use the site's plain homepage. Never invent a deep link you are not
sure of: a homepage the agent can navigate from beats a 404 it cannot.

Examples, given the page above:
"hi"                                -> {"kind":"chat","text":"Hi! What would you like me to do?"}
"who are you"                       -> {"kind":"chat","text":"I am CrewAgent, I can act on web pages for you."}
"what is the capital of France"     -> {"kind":"chat","text":"Paris."}
"summarise this page"               -> {"kind":"task"}
"fill this form"                    -> {"kind":"task"}
"star this repo"                    -> {"kind":"task"}
"mail sam@example.com the update"   -> {"kind":"task","startUrl":"https://mail.google.com/mail/u/0/#inbox?compose=new"}
"tell priya on whatsapp im late"    -> {"kind":"task","startUrl":"https://web.whatsapp.com/"}
"order dog food"                    -> {"kind":"task","startUrl":"https://www.amazon.in/"}

Unsure whether it is chat or a task? Choose "task".
Unsure whether the current page can do the job? Give a startUrl.

Respond in valid JSON only:`;
}

/**
 * A model-supplied URL is about to be opened in the user's own browser, so only
 * http(s) survives. `javascript:` and `data:` must never reach chrome.tabs.create,
 * and a hallucinated fragment like "a" must fail here rather than as a navigation.
 */
function safeStartUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const parsed = new URL(value.trim());
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

/** How many SEARCH/READ_URL turns we resolve before forcing a real answer. */
const MAX_RESEARCH_HOPS = 3;

interface AgentRuntime extends CompiledStack {
    userId: string;
    geminiKey: string;
    /** A blocking problem with the stack, phrased for the side panel. */
    blocked: string | null;
}

/** Why an agent could not be loaded. The two causes need different advice. */
type LoadFailure = 'no-session' | 'not-found';

async function loadAgent(agentId: string): Promise<AgentRuntime | LoadFailure> {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return 'no-session';

    const { data: row, error } = await supabase
        .from('chatflows')
        .select('name, data')
        .eq('id', agentId)
        .eq('user_id', user.id)
        .single();

    if (error || !row) return 'not-found';

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
        geminiKey: keyRow?.key ?? '',
        blocked: blockingIssue?.message ?? null,
    };
}

interface IncomingMessage {
    role: string;
    content: string;
    image_data?: string | string[];
}

/** Normalises the side panel's history into what the provider layer expects. */
function toAgentMessages(messages: IncomingMessage[]): AgentMessage[] {
    return messages.map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content ?? '',
        images: message.image_data
            ? Array.isArray(message.image_data)
                ? message.image_data.filter(Boolean)
                : [message.image_data]
            : undefined,
    }));
}

function browserState(
    pageContent: string,
    elements: unknown,
    url: string,
    title: string,
    command: string,
    hasMarkedScreenshot: boolean
): string {
    return `[BROWSER STATE]
URL: ${url}
TITLE: ${title}
TODAY: ${new Date().toISOString().slice(0, 10)}

CONTENT:
${pageContent ? pageContent.slice(0, 2000) : 'No page text captured.'}

ELEMENTS (the only ids you may act on).
Each has a "kind": "input" takes TYPE, "clickable" takes CLICK, "image" is content only:
${JSON.stringify(elements)}
${
    hasMarkedScreenshot
        ? '\nThe attached screenshot has a numbered badge on each of these elements. The badge number is the elementId.'
        : ''
}
[BROWSER STATE END]

COMMAND: ${command}`;
}

export async function POST(req: NextRequest) {
    const origin = req.headers.get('origin');

    try {
        const body = await req.json();
        const { messages, page_content, elements, url, title, model, screenshot, preferLocal } = body;

        if (!Array.isArray(messages)) {
            return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
        }

        // The side panel sends the selected agent's id in the 'model' field.
        const agentId = model;
        const loaded = await loadAgent(agentId);
        const runtime = typeof loaded === 'string' ? null : loaded;

        // Triage runs before anything reads the page, so it is cheap: no
        // elements, no screenshot, a handful of output tokens.
        if (body.mode === 'triage' && runtime) {
            const latest = (messages as IncomingMessage[])
                .filter((m) => m.role === 'user')
                .slice(-1)[0]?.content ?? '';

            try {
                const verdict = await runModel({
                    systemPrompt: triagePrompt(
                        typeof url === 'string' ? url : '',
                        typeof title === 'string' ? title : ''
                    ),
                    messages: [{ role: 'user', content: latest }],
                    model: runtime.model,
                    temperature: 0,
                    geminiKey: runtime.geminiKey,
                });
                const kind = String(verdict.payload.kind ?? 'task').toLowerCase();
                return corsHeaders(
                    NextResponse.json({
                        kind: kind === 'chat' ? 'chat' : 'task',
                        text: typeof verdict.payload.text === 'string' ? verdict.payload.text : '',
                        // Only meaningful on a task; a chat reply never opens a tab.
                        startUrl: kind === 'chat' ? null : safeStartUrl(verdict.payload.startUrl),
                    }),
                    origin
                );
            } catch {
                // Never let triage block real work — fall through to the run,
                // on the page the user is already on.
                return corsHeaders(
                    NextResponse.json({ kind: 'task', text: '', startUrl: null }),
                    origin
                );
            }
        }

        if (!runtime) {
            return corsHeaders(
                NextResponse.json({
                    action: 'ANSWER',
                    text:
                        loaded === 'no-session'
                            ? 'You are not signed in to CrewBlocks on this origin. Open the dashboard, sign in, then hit the sync button in the panel.'
                            : 'That agent is not in your account any more. Hit the sync button in the panel to refresh the list.',
                    errorCode: loaded === 'no-session' ? 'NO_SESSION' : 'AGENT_NOT_FOUND',
                }),
                origin
            );
        }

        if (runtime.blocked) {
            return corsHeaders(
                NextResponse.json({ action: 'ANSWER', text: runtime.blocked }),
                origin
            );
        }

        const supabase = await createClient();
        let systemPrompt = `${runtime.systemPrompt}\n\n=== ACTION RULES ===\n${actionProtocol}`;

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

        // The panel's tier switch overrides the stack's Model block for this
        // run. The agent's configuration is unchanged — only where it runs is.
        if (preferLocal) {
            const onDevice = MODEL_CATALOG.find((m) => m.local && m.vision);
            if (onDevice) runtime.model = onDevice.id;
        }

        const spec = getModel(runtime.model);
        // The panel decides per turn whether to spend a screenshot; this just
        // respects what it sent.
        const wantsImage = runtime.vision.sight !== 'off' && !!spec?.vision && !!screenshot;

        const working = toAgentMessages(messages as IncomingMessage[]);
        if (!working.length) {
            working.push({ role: 'user', content: 'No explicit goal provided.' });
        }

        // Fold page state into the newest user turn, so the model sees the page
        // it is acting on immediately before the command.
        for (let i = working.length - 1; i >= 0; i--) {
            if (working[i].role !== 'user') continue;
            working[i].content = browserState(
                page_content,
                elements,
                url,
                title,
                working[i].content,
                wantsImage && runtime.vision.marks
            );
            if (wantsImage) {
                working[i].images = [...(working[i].images ?? []), screenshot];
            }
            break;
        }

        // Resolve research actions here rather than bouncing them through the
        // extension. The side panel only ever receives a browser action.
        let payload: Record<string, unknown> = {};
        let usedSearch = false;

        for (let hop = 0; hop <= MAX_RESEARCH_HOPS; hop++) {
            const result = await runModel({
                systemPrompt,
                messages: working,
                model: runtime.model,
                temperature: runtime.temperature,
                geminiKey: runtime.geminiKey,
            });

            payload = result.payload;
            const action = String(payload.action ?? '').toUpperCase();

            if (action !== 'SEARCH' && action !== 'READ_URL') break;

            usedSearch = true;
            working.push({ role: 'assistant', content: result.raw });

            if (hop === MAX_RESEARCH_HOPS) {
                working.push({
                    role: 'user',
                    content:
                        'You have used all your research turns. Answer now with what you have, ' +
                        'or say plainly what you could not confirm.',
                });
                continue;
            }

            working.push({ role: 'user', content: await runResearch(action, payload, runtime) });
        }

        const action = String(payload.action ?? 'ANSWER').toUpperCase();

        await persist(supabase, agentId, runtime, messages as IncomingMessage[], payload);

        return corsHeaders(
            NextResponse.json({
                action,
                elementId: payload.elementId,
                direction: payload.direction,
                text: payload.text,
                url: payload.url,
                language: payload.language,
                memory: payload.memory,
                citations: payload.citations,
                // Shape of the input the panel should render for an ASK.
                expecting: normaliseExpecting(payload),
                options: normaliseOptions(payload),
                usedTool: payload.usedTool ?? (usedSearch ? 'Web search' : undefined),
                ranOn: spec?.local ? 'local' : 'cloud',
                // The side panel enforces these; it needs them every turn in
                // case the user edits the stack mid-run.
                limits: {
                    maxSteps: runtime.vision.maxSteps,
                    maxSeconds: runtime.vision.maxSeconds,
                    autonomy: runtime.vision.autonomy,
                    allowlist: runtime.vision.allowlist,
                    sight: spec?.vision ? runtime.vision.sight : 'off',
                    marks: runtime.vision.marks,
                },
            }),
            origin
        );
    } catch (error) {
        if (error instanceof ModelError) {
            return corsHeaders(
                NextResponse.json({ action: 'ANSWER', text: error.message, errorCode: error.code }),
                origin
            );
        }

        console.error('Chat endpoint error:', error);
        return corsHeaders(
            NextResponse.json(
                {
                    action: 'ANSWER',
                    text: 'CrewBlocks may be incorrect. Please verify important information.',
                },
                { status: 500 }
            ),
            origin
        );
    }
}

const EXPECTING = ['text', 'number', 'otp', 'choice', 'confirmation'] as const;
type Expecting = (typeof EXPECTING)[number];

/**
 * The panel renders a different control per shape, so an unrecognised value
 * has to fall back rather than render nothing. A 'choice' with no options is
 * not a choice — it degrades to a text box instead of an empty chip row.
 */
function normaliseExpecting(payload: Record<string, unknown>): Expecting | undefined {
    if (String(payload.action ?? '').toUpperCase() !== 'ASK') return undefined;

    const raw = String(payload.expecting ?? 'text').toLowerCase();
    const shape = (EXPECTING as readonly string[]).includes(raw) ? (raw as Expecting) : 'text';

    if (shape === 'choice' && !normaliseOptions(payload)?.length) return 'text';
    return shape;
}

function normaliseOptions(payload: Record<string, unknown>): string[] | undefined {
    if (!Array.isArray(payload.options)) return undefined;

    const options = payload.options
        .map((option) => String(option ?? '').trim())
        .filter(Boolean)
        .slice(0, 4);

    return options.length ? options : undefined;
}

/** Runs one SEARCH or READ_URL and phrases the outcome back to the model. */
async function runResearch(
    action: string,
    payload: Record<string, unknown>,
    runtime: AgentRuntime
): Promise<string> {
    try {
        if (action === 'SEARCH') {
            const query = String(payload.query ?? '').trim();
            if (!query) return 'SEARCH needs a "query". Try again.';

            const { hits, provider } = await webSearch(query, runtime.search);
            if (!hits.length) {
                return provider === 'duckduckgo'
                    ? `No results for "${query}". This deployment has no search key set, so it is ` +
                      'falling back to DuckDuckGo, which only answers definitional questions. ' +
                      'Say so plainly rather than guessing.'
                    : `No results for "${query}". Try different wording.`;
            }

            return [
                `SEARCH RESULTS for "${query}":`,
                ...hits.map(
                    (hit, index) =>
                        `${index + 1}. ${hit.title}\n   ${hit.url}${hit.age ? ` · ${hit.age}` : ''}\n   ${hit.snippet}`
                ),
                '',
                'Use READ_URL on one of these if a snippet is not enough to settle it.',
            ].join('\n');
        }

        const target = String(payload.url ?? '').trim();
        if (!target) return 'READ_URL needs a "url". Try again.';

        const text = await readUrl(target);
        return `CONTENT OF ${target}:\n${text}`;
    } catch (error) {
        if (error instanceof SearchError) {
            return `That lookup failed: ${error.message} Answer from what you already have, or say you could not confirm it.`;
        }
        return 'That lookup failed. Answer from what you already have.';
    }
}

/** Chat history and memory. A failure here must not lose the turn. */
async function persist(
    supabase: Awaited<ReturnType<typeof createClient>>,
    agentId: string,
    runtime: AgentRuntime,
    messages: IncomingMessage[],
    payload: Record<string, unknown>
) {
    try {
        const rows = [];
        const lastUserMessage = messages[messages.length - 1];

        if (lastUserMessage?.role === 'user') {
            // The agentic loop re-prompts itself; those turns are not history.
            const isInternal =
                typeof lastUserMessage.content === 'string' &&
                lastUserMessage.content.includes('What is the next logical action');

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
            content: String(payload.text ?? ''),
        });

        await supabase.from('chat_history').insert(rows);
    } catch (error) {
        console.error('Failed to save chat history:', error);
    }

    if (payload.memory && runtime.memory?.write) {
        try {
            await supabase.from('chatflow_memory').insert({
                chatflow_id: agentId,
                user_id: runtime.userId,
                content: String(payload.memory),
            });
        } catch (error) {
            console.error('Failed to save memory:', error);
        }
    }
}

/**
 * The side panel is a chrome-extension:// origin and sends credentials, so the
 * origin has to be echoed back exactly — a wildcard with credentials is
 * rejected by the browser and the request never lands.
 */
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
