# CrewBlocks — the browser surface

Plan, not spec. `model.md` records decisions already made; this records decisions
**proposed**, with the reason each one beats its alternative. Nothing here is built yet.

Question it answers: *can the agent live in a browser-shaped web app instead of a forked
browser, and instead of an extension?*

**Short answer: yes — but the browser has to be real.** The part that is impossible is the
part that sounds easiest.

---

## 1. What is not possible, and why

The picture in the question is a page on `crewblocks.com` with a tab strip, an address bar, and
the site in a frame below it, driven by our JS. That cannot be built. Three independent walls,
any one of which is fatal:

| Wall | Effect |
|---|---|
| `X-Frame-Options: DENY` / CSP `frame-ancestors` | Google, Gmail, Amazon, YouTube, every bank simply refuse to render. The frame stays blank. There is no flag, no header, no proxy trick that is not also a ToS violation. |
| Same-origin policy | Even on a site that *does* allow framing, `iframe.contentDocument` throws. No `querySelectorAll`, so no element table. No `data-1e-id` tagging. No `dispatchEvent`, so no click. No `getBoundingClientRect`, so no marks. |
| No privileged APIs | No `chrome.tabs`, no `chrome.scripting`, no cross-origin cookies, no screenshot of another origin. |

Every primitive `content.js` depends on is unavailable to page JS across an origin boundary.
**That is the entire reason the extension exists**, and it is why BrowserOS forked Chromium
rather than shipping a website. The web platform is built specifically to prevent one site from
doing to another site exactly what this agent does.

A CORS/rewriting proxy — fetch the site server-side, rewrite its URLs, serve it from our origin
— is the classic workaround and it is a trap. It breaks on every SPA, every OAuth redirect,
every `SameSite` cookie, every CSP, every WebSocket, and every service worker. It works on
Wikipedia and nothing anyone actually uses. Cut it now rather than after a week.

**So the browser must be a real browser.** The only open question is *whose machine it runs on.*

---

## 2. The three real options

| | **A · Remote browser** | **B · Desktop shell** | **C · Extension as driver** |
|---|---|---|---|
| What it is | A real Chromium in our container, driven over CDP, streamed into a `<canvas>` on the web app | Electron/Tauri app wrapping `WebContentsView` — a browser, but not a Chromium fork | The web app becomes the whole UI; the extension shrinks to a headless driver |
| Feels like a browser | **Yes** — tabs, omnibox, viewport, all ours | Yes | No — it is a side panel on someone else's browser |
| Works on every site | Yes | Yes | Yes |
| User's existing logins | **No** — must sign in inside it | Yes, its own profile | **Yes**, their real session |
| Install friction | **None. A URL.** | An app download, notarisation, auto-update | An extension install |
| Cost per active session | ~1 GB RAM + a CPU share, always on | Zero | Zero |
| Bot detection | Datacenter IP — the hard case | Clean | Clean |
| Build effort | Large but bounded | Medium, plus a release pipeline forever | Small |

**Recommendation: build A as the product, keep C as the second driver.**

A is the only option that answers the actual question — a browser-like UI on a website, no
install, works on every site. C is what makes A survivable: when the task is *"pay this bill in
my bank"* or *"clear my inbox"*, nobody is signing into their bank inside a rented container,
and they should not. B is rejected because its cost is the same install friction as the
extension plus a permanent release-engineering burden, in exchange for a benefit C already has.

Two drivers is not a hedge. It is the honest shape of the problem: some tasks want a fresh
disposable browser, some want *your* browser, and the agent should not care which.

### We do not build a browser. We rent one.

Worth stating flatly, because "the browser has to be real" reads like "so build a browser," and it
is the opposite.

| | Fork Chromium (BrowserOS) | **Website + rented Chromium (this plan)** |
|---|---|---|
| What we ship | a browser, for download | a URL |
| What we maintain | a Chromium fork, rebased on every upstream security release, roughly fortnightly, forever | a Next app and a container image |
| Language of the work | C++ patches against a 30M-line tree | the TypeScript already in this repo |
| Reuse of what exists today | ~none | `content.js`, the loop, the protocol, the blocks, the theme |
| Install friction | download and trust a whole browser | none |
| Compute per run | best — the agent is in-process | worst — we pay for a Chromium and stream its pixels |
| Who pays for that compute | the user's own machine | **us** |

So "more efficient" splits by axis, and the split is the whole decision:

- **Per agent run**, a fork wins outright. Nothing beats being inside the browser already.
- **Per engineer-hour and per user acquired**, the website wins by an order of magnitude — and
  those are the two budgets this project actually has.

The Chromium in §4 is infrastructure, the same way Postgres is: a process we start, use and kill,
not a product with a version number and a download page. Nobody installs it and nobody sees it.
The thing the user opens is still a website.

The cost of that choice is honest and bounded — roughly a gigabyte of RAM for as long as someone
is looking at the page (§9). The cost of the fork is a browser to maintain for as long as the
product exists.

---

## 3. The seam that makes it one product and not two

The good news, and the reason this is a refactor rather than a rewrite: **the loop is already
transport-agnostic.** `Studio/src/app/api/extension/chat/route.ts` holds the protocol, resolves
`SEARCH` / `READ_URL` server-side, and hands back one browser action. It never touches Chrome.
`content.js` is the driver. `sidebar.js` is the UI plus the loop runner.

So the whole job is: name the seam that already exists, then write a second implementation of it.

```ts
// Studio/src/lib/driver.ts
export interface BrowserDriver {
  extractContext(): Promise<PageContext>;      // { elements, text, url, title }
  screenshot(): Promise<string>;               // data URL, 1280px long edge
  execute(cmd: AgentCommand): Promise<ActionResult>;
  waitForSettle(timeoutMs: number): Promise<void>;
  navigate(url: string): Promise<void>;
}
```

Two implementations:

- **`ExtensionDriver`** — `chrome.tabs.sendMessage`. Today's `content.js`, untouched.
- **`RemoteDriver`** — CDP/Playwright against the container browser.

### The extractor is shared source, not a reimplementation

`RemoteDriver` must not grow its own element extractor. §2.1 of `model.md` is the whole argument:
three separate agent failures that all looked like model failures were the harness handing the
model an unusable map — accessible-name ordering, rank-before-cut, `kind` on every element. That
knowledge is ~40 KB of hard-won `content.js`.

So the remote browser loads **the same file**:

```ts
await context.addInitScript({ path: 'BlockAgent/content.js' });
const ctx = await page.evaluate(() => window.__crewblocks.extractContext());
```

`content.js` gets a small guard so it no-ops its `chrome.runtime` listeners when `chrome` is
undefined, and exposes its functions on a namespace. That is the extent of the change. One map,
two browsers — if the ranking rule changes, it changes in one place and both tiers move together.

Getting this wrong is the single most expensive mistake available in this plan.

### Where the loop runs

Today the loop is in `sidebar.js`, in the panel. Moving to A, it should move **server-side**,
next to the driver — the browser is already there, and a round trip per step through the client
is latency for nothing. With C, it stays client-side.

Resolution: the loop becomes a module (`lib/agent/loop.ts`) parameterised by a `BrowserDriver`,
imported by both the server session runner and (bundled) the panel. All nine guards in §4 of
`model.md` — step budget, wall clock, state repeat, action repeat, error streak, timeout, bad
element, schema, domain — move with it and stay shared. They are not re-implemented per driver.

---

## 4. The remote browser service

Not Vercel. A serverless function cannot hold a Chromium across requests, and this needs a
long-lived stateful process with a WebSocket. **New deploy target — this is the largest hidden
cost in the plan** and should be priced before Phase 1 starts.

```
crewblocks.com (Vercel)                     browser.crewblocks.com (Fly.io / Railway)
┌─────────────────────────┐                 ┌──────────────────────────────────────┐
│  /browse                │                 │  session manager                     │
│   chrome UI (React)     │◄──── WSS ──────►│   ├─ Chromium (Playwright)           │
│   <canvas> viewport     │  frames ▲       │   ├─ CDP: Page.startScreencast       │
│   input events          │  input  ▼       │   ├─ CDP: Input.dispatch*Event       │
│   step log / side panel │                 │   ├─ content.js injected             │
└──────────┬──────────────┘                 │   └─ agent loop + BrowserDriver      │
           │ REST                           └──────────────┬───────────────────────┘
           ▼                                               │ model calls
   /api/extension/chat  ◄───────────────────────────────────┘
   (unchanged: protocol, SEARCH, READ_URL, redaction gate)
```

| Decision | Choice | Why not the alternative |
|---|---|---|
| Automation lib | **Playwright** | Puppeteer is equivalent; Playwright's context/storage-state API is what §4.4 profiles need, and it ships the CDP session raw when we want it. |
| Pixels to the client | **`Page.startScreencast`** — JPEG frames over WebSocket into a `<canvas>` | WebRTC (headful Chromium under Xvfb + `getDisplayMedia`) is lower latency and much better video, and is three times the machinery. Screencast at ~10 fps / q60 on a 1280×800 viewport is a few hundred KB/s and is what Browserbase and Steel ship. Revisit only if take-over feels bad. |
| Human input | Canvas events → `Input.dispatchMouseEvent` / `dispatchKeyEvent` | The human and the agent then drive the same page through the same channel. This is what makes "take over" a one-line feature instead of a mode. |
| Isolation | One browser **context** per session, one container per N sessions | A container per session is cleaner and costs far more. Contexts are the right first cut; move to container-per-session only for paid tiers. |
| Lifecycle | Idle reap at 5 min, hard cap at 30 min, per-user concurrency 1 | Build this in Phase 1, not later. A leaked headless Chromium is ~1 GB that nothing reclaims, and the failure mode is the bill. |

### Profiles — the thing that makes it usable twice

A remote browser with no memory means signing into everything on every run. So: Playwright
`storageState` (cookies + localStorage) per user per site, encrypted, in R2, restored on session
start.

Say the consequence out loud: **that is custody of other people's live sessions.** Encrypt at
rest with a per-user key, scope each blob to one origin, expire on a schedule, make deletion
one click, and never restore a profile into a session the user did not start. Anything the user
would not put in a password manager should be steered to the extension driver instead.

---

## 5. Privacy tiers, honestly restated

§8 of `model.md` says Private Mode means *nothing leaves the device*. A cloud browser cannot
honour that, and pretending otherwise would be the worst thing in this document. So the tiers
become two axes — **where the browser runs** × **where the model runs** — and Private requires
both to be local:

| Tier | Browser | Model | What leaves the device |
|---|---|---|---|
| **Cloud** | our container | OpenRouter | The page itself, plus everything on it |
| **Hybrid** | yours (extension) | OpenRouter | Element table + screenshot, through the existing redaction gate |
| **Private** | yours (extension) | `127.0.0.1` | Nothing |

The redaction gate (§8, fail-closed) applies unchanged on the Cloud and Hybrid rows. The Cloud
row is strictly more exposed than anything today, and the UI must say so at the point of
choosing — not in a settings page.

**A hosted page can still reach a local model.** `http://127.0.0.1:11434` counts as a
potentially-trustworthy origin, so Chrome exempts it from mixed-content blocking: HTTPS page,
plain-HTTP localhost fetch, allowed. Ollama needs `OLLAMA_ORIGINS=https://crewblocks.com`;
LM Studio has the equivalent toggle. The catch is that on the local tier the model call has to
be made **from the client**, not from `providers.ts` on the server — so `runModel` needs a
client-side twin for local-tier requests. That is a real, contained piece of work, not a footnote.

---

## 6. BrowserOS feature parity

Everything BrowserOS advertises, and what it costs us. Most of it is cheaper for us than for
them, because they had to patch a browser and we are writing a web app.

| BrowserOS | How we do it | Cost |
|---|---|---|
| Chromium fork, agent built into the browser | Remote Chromium + web UI. No fork, no download, no signing, no update channel. | — (this is the win) |
| **11+ providers, BYOK** | `MODEL_CATALOG` in `blocks.ts` is a list; `providers.ts` already routes on id prefix. Add OpenAI, Anthropic, Groq (already a dependency), Ollama, LM Studio. Per-user keys, encrypted, server-side only, never `NEXT_PUBLIC_*`. | S |
| Local models (Ollama / LM Studio) | Client-side transport (§5). Discovery by probing `:11434` and `:1234`, then reading each server's model list — so the picker shows what they actually have. | M |
| ChatGPT-Pro-style OAuth sign-in | Skip. BYOK covers it and OAuth-to-a-consumer-plan is a moving target. | — |
| 20+ built-in tools | `TOOL_LIBRARY` is data. There are 10 today; adding one is an entry, not a component. | S each |
| 40+ app integrations (Gmail, Slack, GitHub, Linear, Notion) | Two mechanisms, deliberately: **(a)** real OAuth connectors server-side for the handful worth first-class treatment; **(b)** for the long tail, the agent just *uses the web app* in the remote browser with the saved profile. (b) is free and is the whole argument for a browser agent. | (a) M each · (b) 0 |
| MCP server — "control from Claude Code" | `/api/mcp` streamable-HTTP endpoint exposing `run_agent`, `browse`, `extract`, `screenshot`. The loop and the session manager already exist by then; this is a protocol wrapper. Genuinely cheap, and it makes CrewBlocks a tool other agents call. | S |
| Scheduled tasks | The `trigger` block already exists. Add a headless runner: cron → start a session with no viewer attached → run the stack → store the transcript. Falls out of the server-side loop for free. | S |
| Cowork with files | Per-session R2 workspace mounted into the container; `file-upload` tool already in `TOOL_LIBRARY`. Downloads in the remote browser land there too. | M |
| New tab / side panel / agent mode | Surfaces, not products: `/browse` is the browser, the side panel is a column inside it, `/agent/[id]` is unchanged. | — |
| Local-first privacy | §5. Ours is weaker on the Cloud row and identical on the Private row. Say which is which. | — |

---

## 7. The UI

### Naming, first

There are three names in the repo for two things: **CrewBlocks** (the product), **BlockAgent**
(the extension folder, the download, the terms page), and **CrewAgent** (`manifest.json`,
the side panel title). The browser surface adds a fourth surface to name, so settle it now
rather than inheriting the drift.

Proposal — one product name, surfaces described rather than branded:

| Thing | Name |
|---|---|
| The product | **CrewBlocks** |
| What you build in it | an **agent** (a stack of blocks) |
| The browser surface | **CrewBlocks Browser**, at `/browse` |
| The extension | **CrewBlocks for Chrome** — folder stays `BlockAgent/`, storage key stays `crewblocks-storage-v1` |
| The MCP tool id other agents call | `crewblocks` |

So yes — where BrowserOS puts its own name on the command, ours says CrewBlocks. But the command
surface is not the thing to copy from them: their command exists because the agent is welded into
a browser they ship, and it is how you reach it. Ours is reachable from a URL, a side panel, an
MCP call from Claude Code, and a cron schedule (§6). Four ways in, none of which needs a
branded invocation.


Layout — one screen, four regions:

```
┌────────────────────────────────────────────────────────────────────────┐
│  ● ● ●   [ tab ]  [ tab ]  +          ⌘  crewblocks.com/browse         │  32px tab strip
├──────┬──────────────────────────────────────────┬──────────────────────┤
│      │  ← → ⟳   https://…                  ⚙︎   │                      │  40px omnibox
│ agent│ ┌──────────────────────────────────────┐ │   side panel         │
│ rail │ │                                      │ │   (today's sidebar,  │
│      │ │        <canvas> viewport             │ │    ported to React)  │
│ 56px │ │                                      │ │                      │
│      │ └──────────────────────────────────────┘ │   264–320px          │
│      ├──────────────────────────────────────────┤                      │
│      │ step log · 6 of 25 · ⏸ take over         │                      │
└──────┴──────────────────────────────────────────┴──────────────────────┘
```

**Theme: the project's, unchanged.** No new palette, no new primitives.

| Surface | Token |
|---|---|
| Page ground | `--ds-bg` |
| Chrome (tab strip, omnibox, rail, panel) | `--ds-bg-elevated` — same reason block cards use it: `bg-card` equals `bg-background` in this app, so elevation has to come from `--ds-bg-elevated` |
| Hairlines | `--ds-border`, `--ds-border-strong` on the focused tab |
| Run / primary | `--primary` (the lime) via `--ds-accent` |
| Step log rows | `BLOCK_SPECS[kind].accentVar` — each step tinted by the block that caused it, so the log reads as the stack executing rather than as console output. The one sanctioned inline style, and it is a token reference. |
| Suspension (`ASK`) | `--ds-warning`; blocked/irreversible `--ds-danger` |
| Elevation, motion, grid | `shadow-e0`–`e3`, `duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]`, 4px grid |

**Dark-only, matching the dashboard.** This is new code, so the three-mode rule in the workspace
standards would normally apply — but a browser chrome that is dark while the dashboard it launched
from is dark and the page inside it is whatever the page is, is the coherent choice. Log it as an
ADR row in `standards/TECH_STACK.md` §16 rather than letting it drift silently.

### Accessibility — the canvas is the problem

A `<canvas>` is an accessibility black hole: no roles, no names, no tab order, nothing for a
screen reader to hold. Ignoring that would undo the baseline the block editor was built to.

The element table is the way out — it is already structured, named, and ranked:

- Render it as a visually-hidden `<ul>` beside the canvas, each item a real `<button>` labelled
  `"{name} — {role}, element {id}"`. A keyboard or screen-reader user acts on elements **by name**,
  through the same `execute()` path the agent uses. This is strictly better than pixel-hunting,
  and it exists because the agent needed it anyway.
- Canvas gets `role="application"` with its keys documented in an accessible instructions block.
- Everything already true stays true: visible focus ring, 44px targets in the chrome,
  `prefers-reduced-motion`, `focus-visible:opacity-100` on every hover-revealed control (the
  take-over button, the tab close, the step-log expander), 4.5:1 body contrast.
- Reuse `ChoiceRow` for the `ASK` `expecting: "choice"` prompt — one tab stop, arrow keys.

---

## 8. Phases

Each phase ends somewhere demoable. No phase is "plumbing you cannot see".

| # | Phase | Ends with | Est. |
|---|---|---|---|
| **0** | **Driver seam.** `BrowserDriver` interface + `ExtensionDriver` wrapping today's messaging. Loop extracted to `lib/agent/loop.ts` with its nine guards. No behaviour change; the extension works exactly as before. | Nothing looks different. `pnpm typecheck` clean, golden set unchanged. Proves the seam before betting on it. | ½–1 d |
| **1** | **Remote browser, no agent.** Playwright container, session manager, screencast → WS → canvas, human input passthrough, idle reaping. | A browser inside a web page that you can *use*. Type a URL, click links, log into something. | 3–4 d |
| **2** | **`RemoteDriver`.** Inject `content.js`, implement the five methods, point the existing loop at it. | The agent runs a task in the cloud browser. **First real demo.** | 2–3 d |
| **3** | **The chrome.** Tabs, omnibox, step log with block-kind tints, inline `ASK`, take-over, hidden element list, full a11y pass. | It looks like a browser and reads like CrewBlocks. | 3–4 d |
| **4** | **Model selection.** Catalog expansion, BYOK with encrypted per-user keys, local-tier client transport, Ollama/LM Studio discovery, per-session tier override in the header. | The BrowserOS model picker, ours. | 2–3 d |
| **5** | **The rest.** Profile persistence, OAuth connectors, `/api/mcp`, scheduled runs, file workspace. | Parity. | ongoing |

Phase 0 is non-negotiable and comes first. Everything after it is parallelisable; Phase 0 is what
makes that true.

---

## 9. What will hurt

Listed because each one is cheaper to plan for than to discover.

- **Bot detection.** Datacenter IPs get Cloudflare-challenged. Cloudflare, Amazon and Google are
  actively hostile to exactly this. Mitigations: residential proxies (cost, and a policy question),
  a real user-agent and viewport, human-shaped input timing — and, when all that fails, *fall back
  to the extension driver*, which is the user's own real browser and has none of this problem.
  There is no clever fix here. The second driver is the fix.
- **Cost.** ~1 GB RAM per live session, held for as long as someone is looking at it. Idle reaping
  and a concurrency cap are load-bearing, not polish. Model this before Phase 1.
- **Credential custody.** §4.4. A different security posture and a different legal posture than
  anything in the repo today.
- **Latency on take-over.** The agent doesn't care — it works from discrete screenshots. A human
  dragging a slider through a 10 fps screencast will feel it. Accept it, or spend the WebRTC budget.
- **CAPTCHAs are already solved, and it is a strength.** §5's suspension protocol pauses the run
  and asks; the human solves it directly in the canvas because their input goes through the same
  CDP channel. Nothing new to build.
- **Ops surface.** Vercel plus a stateful container platform, a WebSocket to keep alive, a browser
  fleet to watch. The repo currently deploys as one Next app. This is the biggest structural
  change in the plan and it is not visible in any screenshot.
- **`model.md` §11 is still open** — the committed Bhashini key. It becomes a worse problem the
  moment a service runs outside our own machine. Close it before Phase 1 ships.

---

## 10. The recommendation, in one paragraph

Do it, as **A + C**: a remote-browser web app at `/browse` with the extension kept as the local
driver, sharing one loop, one element extractor, one set of guards, and one protocol. Do Phase 0
first so that sharing is real rather than aspirational. Do not fork a browser — BrowserOS's fork
buys deep integration at the cost of a browser to maintain forever, and every feature they list
except "the agent lives in the chrome" is reachable from a web app that rents a Chromium.
Be straight in the UI about which privacy tier a run is on, because the cloud tier is genuinely
more exposed than what ships today and that is the one thing a user cannot infer from looking.
