/**
 * Live web access for the agent.
 *
 * Server-side on purpose. A browser-origin search request gets CORS-blocked and
 * rate-limited, and every query has to land in the run log anyway — so the
 * extension never talks to a search provider directly.
 *
 * Three providers behind one interface. Which one runs is decided by whichever
 * key is present, so adding a key is the whole switch — there is no code change
 * and no redeploy needed to move between them.
 */

import type { CompiledSearch } from '@/lib/blocks';

export interface SearchHit {
    title: string;
    url: string;
    snippet: string;
    /** Human-readable age, when the provider supplies one. */
    age?: string;
}

export type SearchProviderId = 'tavily' | 'brave' | 'duckduckgo';

export class SearchError extends Error {
    constructor(
        message: string,
        readonly code: 'NO_KEY' | 'BLOCKED_QUERY' | 'UPSTREAM'
    ) {
        super(message);
        this.name = 'SearchError';
    }
}

/**
 * A model that reads a personal detail off the page and then searches for it
 * has exfiltrated it just as surely as if it had posted the screenshot. The
 * search box is a send path, so it gets the same gate.
 */
const PII_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
    { label: 'an email address', pattern: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
    { label: 'a card number', pattern: /\b(?:\d[ -]?){13,19}\b/ },
    { label: 'an Aadhaar number', pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/ },
    { label: 'a phone number', pattern: /\b(?:\+91[ -]?)?[6-9]\d{9}\b/ },
    { label: 'a US Social Security number', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
];

/** Returns the reason a query must not be sent, or null when it is safe. */
export function screenQuery(query: string): string | null {
    for (const { label, pattern } of PII_PATTERNS) {
        if (pattern.test(query)) {
            return `That search contains what looks like ${label}. I did not send it.`;
        }
    }
    return null;
}

/**
 * Which provider this deployment uses.
 *
 * Tavily first: its free tier is 1000 calls a month with no card, and it hands
 * back extracted page content rather than a one-line snippet, which is usually
 * enough to settle a fact without a second fetch. Brave is used when its key is
 * present. DuckDuckGo is the last resort — it needs no key at all, and it shows.
 */
export function activeProvider(): SearchProviderId {
    const forced = process.env.SEARCH_PROVIDER?.toLowerCase();
    if (forced === 'tavily' || forced === 'brave' || forced === 'duckduckgo') return forced;

    if (process.env.TAVILY_API_KEY) return 'tavily';
    if (process.env.BRAVE_SEARCH_API_KEY) return 'brave';
    return 'duckduckgo';
}

export async function webSearch(
    query: string,
    config: CompiledSearch | null
): Promise<{ hits: SearchHit[]; provider: SearchProviderId }> {
    const blocked = screenQuery(query);
    if (blocked) throw new SearchError(blocked, 'BLOCKED_QUERY');

    const provider = activeProvider();
    const trimmed = query.slice(0, 400);
    const count = Math.min(config?.count ?? 5, 20);

    const hits =
        provider === 'tavily'
            ? await tavilySearch(trimmed, count, config)
            : provider === 'brave'
              ? await braveSearch(trimmed, count, config)
              : await duckduckgoSearch(trimmed, count);

    return { hits, provider };
}

/* -------------------------------------------------------------- tavily -- */

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

const TAVILY_RANGE: Record<string, string> = {
    day: 'day',
    week: 'week',
    month: 'month',
    year: 'year',
};

async function tavilySearch(
    query: string,
    count: number,
    config: CompiledSearch | null
): Promise<SearchHit[]> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
        throw new SearchError(
            'No Tavily key is set. Add TAVILY_API_KEY to .env.local to let the agent search.',
            'NO_KEY'
        );
    }

    const body: Record<string, unknown> = {
        query,
        max_results: count,
        // "basic" is one round trip and enough for a snippet-level answer;
        // READ_URL exists for when the model needs the whole page.
        search_depth: 'basic',
    };
    if (config?.freshness) body.time_range = TAVILY_RANGE[config.freshness];

    let response: Response;
    try {
        response = await fetch(TAVILY_ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15_000),
        });
    } catch {
        throw new SearchError('Could not reach Tavily.', 'UPSTREAM');
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new SearchError(
            `Tavily returned ${response.status}. ${detail.slice(0, 160)}`,
            'UPSTREAM'
        );
    }

    const data = (await response.json()) as {
        results?: Array<{
            title?: string;
            url?: string;
            content?: string;
            published_date?: string;
        }>;
    };

    return (data.results ?? [])
        .filter((result) => result.url)
        .map((result) => ({
            title: result.title ?? (result.url as string),
            url: result.url as string,
            snippet: stripTags(result.content ?? ''),
            age: result.published_date,
        }));
}

/* --------------------------------------------------------------- brave -- */

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

const BRAVE_FRESHNESS: Record<string, string> = {
    day: 'pd',
    week: 'pw',
    month: 'pm',
    year: 'py',
};

async function braveSearch(
    query: string,
    count: number,
    config: CompiledSearch | null
): Promise<SearchHit[]> {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) {
        throw new SearchError('No Brave key is set.', 'NO_KEY');
    }

    const params = new URLSearchParams({ q: query, count: String(count) });
    if (config?.freshness) params.set('freshness', BRAVE_FRESHNESS[config.freshness]);

    let response: Response;
    try {
        response = await fetch(`${BRAVE_ENDPOINT}?${params}`, {
            headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
            signal: AbortSignal.timeout(15_000),
        });
    } catch {
        throw new SearchError('Could not reach Brave Search.', 'UPSTREAM');
    }

    if (!response.ok) {
        throw new SearchError(`Brave Search returned ${response.status}.`, 'UPSTREAM');
    }

    const data = (await response.json()) as {
        web?: {
            results?: Array<{ title?: string; url?: string; description?: string; age?: string }>;
        };
    };

    return (data.web?.results ?? [])
        .filter((result) => result.url)
        .map((result) => ({
            title: result.title ?? (result.url as string),
            url: result.url as string,
            snippet: stripTags(result.description ?? ''),
            age: result.age,
        }));
}

/* ---------------------------------------------------------- duckduckgo -- */

/**
 * The no-key fallback, and genuinely weak.
 *
 * DuckDuckGo's free endpoint is an Instant Answer API, not a web index: it
 * returns an abstract and a list of related topics, so it answers "what is X"
 * and cannot answer "what changed this week". It exists so the agent degrades
 * to something rather than erroring when no key is configured — not as a
 * provider to choose on purpose.
 */
async function duckduckgoSearch(query: string, count: number): Promise<SearchHit[]> {
    const params = new URLSearchParams({
        q: query,
        format: 'json',
        no_html: '1',
        no_redirect: '1',
        skip_disambig: '1',
    });

    let response: Response;
    try {
        response = await fetch(`https://api.duckduckgo.com/?${params}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        throw new SearchError('Could not reach DuckDuckGo.', 'UPSTREAM');
    }

    if (!response.ok) {
        throw new SearchError(`DuckDuckGo returned ${response.status}.`, 'UPSTREAM');
    }

    const data = (await response.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: unknown[] }>;
    };

    const hits: SearchHit[] = [];

    if (data.AbstractText && data.AbstractURL) {
        hits.push({
            title: data.Heading ?? query,
            url: data.AbstractURL,
            snippet: data.AbstractText,
        });
    }

    for (const topic of data.RelatedTopics ?? []) {
        if (hits.length >= count) break;
        // Nested groups have no URL of their own; skip rather than flatten.
        if (!topic.FirstURL || !topic.Text) continue;
        hits.push({ title: topic.Text.slice(0, 90), url: topic.FirstURL, snippet: topic.Text });
    }

    return hits;
}

/* ------------------------------------------------------------ reading -- */

function stripTags(html: string): string {
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Fetches one page and hands back its readable text.
 *
 * Snippets rarely settle a fact on their own — without this the model reasons
 * from titles and calls it verification.
 */
export async function readUrl(url: string, maxChars = 12000): Promise<string> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new SearchError('That is not a URL I can open.', 'UPSTREAM');
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new SearchError('I can only open http and https pages.', 'UPSTREAM');
    }

    // Refuse anything pointing back inside the network this server sits on.
    if (isPrivateHost(parsed.hostname)) {
        throw new SearchError('That address is not reachable from here.', 'UPSTREAM');
    }

    let response: Response;
    try {
        response = await fetch(parsed.toString(), {
            headers: { 'User-Agent': 'CrewBlocks/1.0 (+https://crewblocks.vercel.app)' },
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        throw new SearchError(`Could not open ${parsed.hostname}.`, 'UPSTREAM');
    }

    if (!response.ok) {
        throw new SearchError(`${parsed.hostname} returned ${response.status}.`, 'UPSTREAM');
    }

    const html = await response.text();
    return extractReadableText(html).slice(0, maxChars);
}

/** Blocks loopback and RFC1918 targets so READ_URL cannot probe the host. */
function isPrivateHost(hostname: string): boolean {
    const host = hostname.toLowerCase();

    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
        return true;
    }

    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])];
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 192 && b === 168) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 169 && b === 254) return true;
    }

    return host === '::1' || host.startsWith('fc') || host.startsWith('fd');
}

function extractReadableText(html: string): string {
    return stripTags(
        html
            .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
            .replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    );
}
