# CrewBlocks — model & agent architecture

Every decision, settled. One row per choice, with the reason it beat the alternative.
This is the spec the code follows; when the code and this file disagree, one of them is a bug.

---

## 1. Models

| Tier | Model | Runtime | When it runs |
|------|-------|---------|--------------|
| **Cloud** | `qwen/qwen3-vl-8b-instruct` | OpenRouter | Default. Everything, unless Private Mode is on. |
| **Local** | `mlx-community/Qwen3-VL-4B-Instruct-4bit` | `mlx_vlm.server` on `127.0.0.1:8081` | Private Mode. Nothing leaves the machine. |
| **Legacy** | `gemini-flash-latest`, `gemini-pro-latest` | `@google/genai` | Kept working. Existing agents don't break. |

**Why Qwen3-VL.** It is trained for GUI control and 2D grounding, it is open-weights so the *same
family* runs in both tiers, and both sizes are served over an OpenAI-compatible API — so switching
tiers is a base-URL change and nothing else.

**Why 8B cloud / 4B local.** The demo machine is a fanless 16 GB M4 Air. Budget:

```
macOS                       ~4.0 GB
Chrome + page + extension   ~3–5 GB
Next dev server             ~1.0 GB
                            ────────
                            ~9–10 GB before the model loads

8B-4bit @ ~1300 img tokens   ~6.0 GB peak  → 15–16 GB → swap → thermal cliff
4B-4bit @ ~1300 img tokens   ~3.5 GB peak  → ~13 GB    → holds
```

Cloud gets the bigger model because cloud has the headroom. Local gets the model that survives a
five-minute agent run on a machine with no fan.

**The cost of that asymmetry:** a prompt tuned on 8B can silently degrade on 4B — the 4B does
measurably worse at following the `ASK` protocol (§7). Mitigation is a golden set of recorded page
states with known-correct actions, run against both tiers whenever the prompt changes.

Note though that the most dangerous failure found so far is **not** a size problem: both tiers
click through a purchase confirmation at the same rate (§7). Upgrading the model does not fix it,
which is why anything that must not fail is enforced in code rather than requested in the prompt.

**Provider routing** lives in `Studio/src/lib/providers.ts`. Model id prefix decides the client:
`gemini-*` → Google GenAI, everything else → OpenAI-compatible chat completions.

### Switching tiers

The side panel header carries a **Cloud / Local** toggle. It overrides the stack's Model
block for that session and nothing else — the agent's configuration is untouched, only where it
runs changes.

A session switch rather than a stack edit, because *"should this particular run leave my machine"*
is a decision about the page in front of you, not a property of the agent. Buying something on a
personal account and summarising a public article want different answers on the same agent.

The toggle health-checks `127.0.0.1:8081` when switched on and turns red if the model server is not
answering, rather than letting the failure land mid-task — the worst moment to discover a
background process is not running. Every reply also carries `ranOn`, so the panel reflects where
the turn actually executed rather than where it was asked to.

---

## 2. Vision — how the model sees a page

**Decision: Set-of-Mark. Not raw coordinates, not an object detector.**

```
1. content.js tags every visible interactive element with data-1e-id  (already existed)
2. content.js also returns each element's bounding box                (added)
3. sidebar.js draws a numbered badge at each box onto the screenshot
4. The model receives: marked image + the id → {role, name, box} table
5. The model replies {"action":"CLICK","elementId":23}
6. content.js resolves 23 via querySelector('[data-1e-id="23"]')      (already existed)
```

**Why marks beat pixel coordinates**

| | Set-of-Mark | Raw coordinates |
|---|---|---|
| Page reflows between screenshot and click | Still correct — you click the node | Clicks the wrong thing |
| Model invents an element | Rejected — id not in the closed set | Clicks empty space |
| Scroll offset handling | Free | Manual, error-prone |
| Verification | `id ∈ elements` is a one-line check | None possible |

**Why no YOLO / OmniParser.** The detector exists to find clickable things in pixels. The DOM
already knows where they are, exactly, with roles and accessible names attached. A detector would
be a second, worse source of the same truth — plus ~15 MB and a whole pipeline stage. Cut.

**Fallback** for `<canvas>`, cross-origin `<iframe>`, closed shadow DOM — content with no DOM node:
the model returns raw coordinates and we click via `document.elementFromPoint(x, y)`. Rare path,
and the only reason the VLM's native grounding still matters.

**Screenshot budget.** Viewport only, never full page. Downscaled to 1280 px on the long edge
(~1300 vision tokens). Retina 2× would trip 4× the prefill cost for grounding accuracy the marks
already provide. **When** a screenshot is taken at all is a separate and more important
question — see §6.

---

## 2.1 Element extraction — the table the model actually reads

Set-of-Mark is only as good as the element table behind it. The badge is a pointer; the table is
the map. This section is about the map, because for a week the map was the thing that was broken.

### What was measured

A Gmail-shaped page — 50 inbox rows, plus a `position: fixed` compose dialog with To / Subject /
Body / Send — run through the real `extractContext`:

| | Before | After |
|---|---|---|
| Send button reaches the model | **no** — position 155, cap was 150 | yes |
| To / Subject named | `"to"` / `"subjectbox"` | `"To recipients"` / `"Subject"` |
| 50 row checkboxes named | `"on"` ×50 | `"Select"` ×50 |
| Input vs button distinguishable | no | `kind: "input" \| "clickable" \| "image"` |

Three defects, all in the extractor, none in the model:

1. **Accessible names were read last.** The order was `placeholder || name || id || value ||
   innerText || aria-label`. Gmail and WhatsApp Web put the real name in `aria-label` and leave
   `value` as an internal token, so every row checkbox arrived as `"on"` — fifty elements the
   model could not tell apart. `labelFor()` now reads `aria-labelledby` → `aria-label` →
   `placeholder` → `title` → `alt` → `value` → `name` → `id`, and ignores `value` on checkboxes
   and radios.
2. **The cap truncated in DOM order.** Fifty checkboxes ate the 150-element budget and the Send
   button fell off the end. The model could not have sent the mail if it had chosen to. Elements
   are now ranked before the cut — inputs first, then short-labelled controls, then long-labelled
   content links, then images — and the budget is 200.
3. **Kind was stripped.** Inputs and buttons arrived as one undifferentiated list, so `CLICK` on a
   search box looked as reasonable as `TYPE`. That is exactly the loop the agent died in on
   Amazon and on Gmail: click a text field, nothing changes, `NO_PROGRESS_LOOP`.

**The lesson to keep:** every one of these looked like a model failure in the transcript. All three
were the harness handing the model an unusable map. Before blaming the tier, dump the element table
the model actually received.

### What browser-use does, and what of it we can have

`browser-use` (MIT) is the extractor behind A5-Browser-Use and the reason that project looks
seamless. A5 itself is a FastAPI server plus a sidebar; the automation is all library.

It no longer ships the injected `buildDomTree.js` it was once known for. Current `main` fuses
**three CDP sources**, keyed by `backendNodeId`:

| Source | CDP call | What it contributes |
|---|---|---|
| DOM tree | `DOM.getDocument` | structure, attributes |
| Accessibility tree | `Accessibility.getFullAXTree` | real roles and computed accessible names |
| Layout snapshot | `DOMSnapshot.captureSnapshot` | visibility, `cursor`, `pointer-events`, boxes |
| Frames | `Page.getFrameTree` | per-frame targets, so iframes are not invisible |
| Listeners | `Runtime.getProperties` on listener objects | whether a node is *actually* wired to a click |

Plus `paint_order.py` for occlusion — which element is genuinely on top — and a 55 KB serializer
that turns the fused tree into the text the model sees.

**The constraint that decides everything: `DOMSnapshot` and `Accessibility.getFullAXTree` are not
reachable from an MV3 content script.** A content script has DOM APIs and nothing else. Real
event-listener enumeration is likewise devtools-only.

### The three ways to close the gap

| | Path | Keeps MV3 | Extra runtime | Verdict |
|---|---|---|---|---|
| **A** | Port the *techniques* into `content.js` with plain DOM APIs | yes | none | **doing this** |
| **B** | `chrome.debugger` from the extension, real CDP | yes | none | held in reserve |
| **C** | A5's stack: Python + browser-use + Chrome on port 9222 | no | Python, CDP port | **rejected** |

**A** gets most of the value with no architectural cost. Accessible names, `cursor: pointer`,
`pointer-events`, visibility and occlusion via `elementFromPoint` are all computable in a content
script. What it cannot have is the true AX tree and real listener enumeration; those get
approximated from `role`, `onclick`, and cursor style.

**B** is the honest ceiling for an extension. MV3 *can* call `chrome.debugger.attach` and issue the
same CDP commands browser-use uses, with no external process. The cost is the permanent *"CrewAgent
is debugging this browser"* infobar and a conflict with DevTools being open — a real liability in a
live demo, which is why it is reserve rather than plan.

**C is rejected on arithmetic, not taste.** A5's local tier is
`qwen2.5:32b-instruct-q4_K_M` — roughly 20 GB of weights. §1 already established that an 8B-4bit at
~6 GB peak pushes this 16 GB Air into swap. A 32B does not load at all. Adopting A5's stack would
not buy A5's results; it would buy A5's stack driven by a 4B, and since browser-use is a text-DOM
pipeline we would also lose the Set-of-Mark vision fallback that §2 exists for. Worse on both axes,
plus a Python process and a debugging port on the demo machine.

**That is also the answer to "is our model too small".** A5 is seamless partly because it is
running a model eight times the size of ours. That is not a gap we can close on this hardware, so
the extractor has to be good enough that a 4B does not need to guess — and the cloud 8B stays the
default path.

### Workflow

Staged, each step independently verifiable against the same recorded page:

```
1. Accessible names           labelFor()                          DONE
2. Rank before capping        elementRank()                       DONE
3. Kind by accepted action    kindOf() — input | clickable        DONE
4. Interactivity filter       isActionable()                      DONE
5. Occlusion                  isOccluded()                        DONE
6. Iframes                    all_frames + per-frame routing      DONE
7. Golden set                 eval/ — 3 cases, 3 passing          DONE
```

**3. Kind is decided by what an element accepts, not by its tag family.** `<input>` is not one
thing: a text box takes `TYPE`, while a submit button, a checkbox and a radio take `CLICK`. Filing
all of them under `input` told the model to type into a Send button. The golden set caught that on
its first run, which is the whole argument for having one.

**4. `isActionable()`** requires a real signal before an element is listed: an interactive tag, an
actionable ARIA role, an `onclick`, `contenteditable`, or `cursor: pointer`. It rejects
`pointer-events: none`, `aria-disabled`, `aria-hidden`, zero opacity — and it drops wrappers, so a
`<li>` containing a link is not offered alongside the link. The wide net stays (real sites are full
of hand-rolled controls); the layout it used to drag in does not.

**5. `isOccluded()`** casts `elementFromPoint` at each box centre and drops anything painted over.
A button under a cookie scrim is in the DOM, passes every style check, and cannot be clicked —
listing it is an invitation to click it, see nothing happen, and loop. Only applied inside the
viewport, because `boxOf` already returns null off-screen and those elements are legitimately
reachable after a scroll. On the cookie-banner fixture this takes the table from 3 elements to 1.

**6. Frames.** `all_frames: true` plus `match_about_blank`, and `webNavigation.getAllFrames` to
enumerate. Each frame still numbers from 1, so the panel renumbers everything into one sequence and
keeps `frameRouting: globalId → {frameId, localId}`; acting on id 42 dispatches to the frame that
owns it with the id that frame knows. **The model never learns frames exist.** One deliberate
limit: a sub-frame reports boxes in its own coordinate space, so sub-frame elements are sent
without a `box` and get no Set-of-Mark badge. They are in the table, which is where the value is.

### Generalising past the sites we happened to test on

The first three fixtures were named after the sites they came from — Gmail, Amazon, a cookie
banner — and that framing hid how narrow the extractor actually was. Auditing it against patterns
rather than brands turned up five defects, each of which broke *any* page with that shape:

| Defect | What it broke | Sites affected |
|---|---|---|
| `<label for>` never read | fields named by the standard HTML mechanism reached the model as `f_2` | any hand-written form |
| `querySelectorAll` stops at shadow boundaries | element table came back **empty**, agent reported a blank page | anything built from web components |
| `offsetParent !== null` used as the visibility test | `position: fixed` is *specified* to return null — sticky bars, floating buttons and modals were all dropped | most product and checkout pages |
| `elementFromPoint` + `Node.contains` for occlusion | neither crosses a shadow boundary, so shadow content looked covered by its own host | same as above |
| inputs collector never checked `disabled` | dead fields offered as TYPE targets, spending the error budget on actions that could never succeed | multi-step checkouts |

The fixes are all in `content.js`: `labelElementText` for explicit and wrapping labels,
`queryAllDeep` to walk open shadow roots, `isVisible` to test `position: fixed` properly,
`sharesLineage` to follow the host chain, and an inert check on inputs covering `disabled`,
`readOnly` and `aria-disabled`.

The golden set is now **nine fixtures, named by the DOM pattern they exercise rather than by the
site they came from** — a labelled form, a web component, a pinned action bar, an icon-only
toolbar, a hand-rolled dropdown with inert controls, a 300-item result list. Amazon and Gmail stay
as the two cases that came from real failures, but they are examples of a shape, not the shapes we
support. **9 / 9 passing.**

### The golden set

`eval/index.html` — open it in Chrome, no model, no keys, no network. It fetches the shipped
`content.js` and `sidebar.js` and runs the **real** `extractContext` and `elementsForModel` against
recorded pages, so it cannot pass against code the extension does not run.

| Case | Guards against |
|---|---|
| Gmail — compose and send | the Send button falling off the end of the budget |
| Amazon — search from the box | typing and clicking being indistinguishable |
| Cookie banner covering the page | offering controls that are painted over |

Each fixture carries its own expectations in a JSON block: which labels must reach the model, with
which `kind`, and which junk must not. Adding a case is one HTML file.

**What it does not do yet:** it measures the *table*, not the model. Running 4B against 8B on the
same fixtures with known-correct actions is the remaining half, and it is what §11's parity
question actually needs. The extractor half is worth having on its own — three of the four defects
found so far were visible without a model at all.

**Where the code lives.** Extraction is `BlockAgent/content.js` (`labelFor`, `extractContext`).
The budget and ranking are `BlockAgent/sidebar.js` (`elementRank`, `elementsForModel`) — panel-side
on purpose, so the cap can change without a content-script reinjection.

---

## 3. Web access

**Provider: Tavily, with Brave and DuckDuckGo behind the same interface.**

Brave was the first choice and was dropped on contact with its dashboard: the free plan exists, but
it will not issue a key until you activate a plan with a card on file. Tavily's free tier is 1000
calls a month with **no card at all**, and it returns extracted page content rather than a
one-line snippet — which often settles a fact without a second `READ_URL`.

| Provider | Free tier | Card | Quality |
|---|---|---|---|
| **Tavily** (default) | 1000/month, resets monthly | No | Agent-shaped, returns extracted content |
| Brave | 2000/month | **Yes**, to issue a key | Real ranked results, independent index |
| DuckDuckGo | Unlimited | No key at all | Instant Answer only — see below |

`activeProvider()` picks by whichever key is present — Tavily, then Brave, then DuckDuckGo — so
adding a key *is* the switch. `SEARCH_PROVIDER` forces one explicitly.

**The DuckDuckGo fallback is deliberately weak, and measured:**

```
"python programming language"   abstract=yes  related=21
"qwen3-vl release date"         abstract=NO   related=0
"who is the CEO of Vercel"      abstract=NO   related=0
```

It is an Instant Answer API, not a web index. It answers "what is X" for well-known entities and
returns literally nothing for anything current — which is most of what an agent needs. It exists so
the agent degrades to *something* with no key configured, and when it is active the model is told
so explicitly, so it says "I could not confirm that" instead of filling the gap from memory.

**Two tools, both server-side in Studio, never in the extension** — browser-origin search requests
get CORS-blocked and rate-limited, and every query must land in the provenance log anyway.

```
web_search(query, count?, freshness?)  → [{title, url, snippet, age}]
web_read(url)                          → extracted main text, capped ~4k tokens
```

`web_read` is not optional. Snippets rarely settle a fact; without it the model reasons from
titles and calls it verification.

**Beating a stale training cutoff** — three rules, compiled into the prompt:

1. Today's date is injected on every request.
2. *"Your weights predate today. Any claim about current prices, versions, availability or events
   must be preceded by a `web_search` call."*
3. Web-grounded answers must carry `citations: [{claim, url}]`. A missing citation fails schema
   validation and is sent back once.

Rule 3 is what makes it verification rather than decoration — the model cannot skip the check
without failing the response schema.

**Leak vector, closed:** search queries pass the same PII gate as screenshots. A model that reads
an email address off the page and helpfully searches for it is an exfiltration path, and it is the
one people forget.

---

## 3.1 Translation

Translation does **not** go through Qwen3-VL or any other LLM. It calls **Bhashini** — the
Government of India's Dhruva NMT pipeline at `dhruva-api.bhashini.gov.in` — because for
Assamese, Bodo, Bengali and Hindi it is both the better translator and the one an Indian public
deployment should be using. The model tiers in §1 have nothing to do with it.

So "run translation on cloud instead" was never the lever: it was always a remote cloud API. The
latency was ours.

**What was actually slow.** Text nodes are chunked 50 to a request to stay under Bhashini's 413
limit, which was right. Those chunks then ran one after another in a `for` loop with an `await`
inside it, so a 900-node page was 18 sequential round trips to a remote API and the user waited for
all of them end to end.

The chunks now run through a **pool of 6**. Not an unbounded `Promise.all`: firing eighteen
requests at a government endpoint earns a 429, not a speed-up.

| 300 nodes → Hindi, 6 batches | Wall clock |
|---|---|
| Serial (before) | 19.5 s |
| Pooled, 6 in flight (after) | 3.4 s |
| | **5.8×** |

*Distinct corpora per run and the pooled run measured first, because an identical payload comes
back from Bhashini's cache in 0.4 s and would have reported a fictional 44×.*

**Two correctness bugs fixed in the same pass.** Results were `push`ed in completion order, so a
batch that came back short shifted every later translation onto the wrong node for the rest of the
page — they are written into indexed slots now, and a failed batch backfills with the original
English so alignment survives. And `performTranslation` called `replacePageTextNodes` twice with
the same array, rewriting the whole page a second time and posting "Translation complete" twice.

**Still open:** results arrive as one array at the end, so the page changes all at once. Streaming
each batch to the content script as it lands would make the first text change in ~600 ms instead of
3.4 s. Worth doing only if 3.4 s still reads as slow.

---

## 4. The agent loop

Replaces the unbounded `while (isAgentRunning && !userRequestedStop)` in `sidebar.js`, which had a
manual stop as its only exit.

```
maxSteps 25 · maxWallClock 5 min · maxConsecutiveErrors 3 · actionTimeout 10 s
```

| Guard | Fires when | Error code |
|---|---|---|
| Step budget | 25 steps elapsed | `STEP_BUDGET_EXCEEDED` |
| Working time | 5 minutes of *working* time — time spent waiting on a person does not count (§5) | `TIME_BUDGET_EXCEEDED` |
| **State repeat** | identical state 3× nudges the model, 8× stops the run | `NO_PROGRESS_LOOP` |
| Action repeat | same action + id **3 times**, state unchanged, each retry told the last did nothing | `REPEATED_ACTION` |
| Error streak | 3 failed actions in a row | `CONSECUTIVE_ERRORS` |
| Action timeout | 10 s with no DOM settle | `ACTION_TIMEOUT` |
| Bad element | id not in the current element set | `ELEMENT_NOT_FOUND` |
| Schema | reply unparseable, then unparseable again after one repair turn | `VALIDATION_FAILED` |
| Domain | navigation outside the allowlist | `BLOCKED_DOMAIN` |
| No answer | a suspended run waited 20 min unanswered (§5) | `INPUT_TIMEOUT` |

**The agent could not see its own typing.** This was the single biggest cause of a run dying
mid-task, and it was invisible because two separate pieces of the harness had the same blind spot.

A field's contents live in `.value`. That appears in neither the DOM structure nor
`body.innerText`. So:

- The **element table** sent to the model listed `id`, `kind`, `name`, `type`, `role` — and no
  value. After a successful TYPE the table was byte-for-byte what it had been before, so the model
  had no evidence its typing worked, and retyped.
- The **state signature** was `href | scrollY | element count | text length`. None of those move
  when you fill a form, so a successful TYPE counted as *"the page did not change"*.

Together those two turned every form-filling flow into a guaranteed loop: type, see no change,
type again, and the repeat guard would kill the run on a task that was actually going fine.
Observed on Gmail with the recipient **already correctly filled in** on screen.

Inputs now carry `value`, and the signature folds in a djb2 hash of everything typed. The protocol
tells the model what `value` means and that a field already holding the right thing is a step
already done.

**Secrets are never read.** `valueOf` returns nothing for a password field, an
`autocomplete="cc-number"` field, or a `name` containing `cardnumber` — otherwise this change would
have shipped whatever is typed in them to the model on every turn, purely for being on the page.
Values are also capped at 120 characters, and the signature hashes them rather than storing them,
so page contents do not accumulate in the run's `seen` map.

Verified in a real browser against the real `extractContext`: a typed recipient appears, a
contenteditable body appears, the signature moves, and neither a password nor a card number reaches
the payload. `eval/field-state.test.mjs` holds the 14 unit cases.

**Sensitive fields are refused per action, not per page.** An earlier draft of this
spec hard-stopped the whole run whenever a password field existed anywhere on the
page. That is wrong: it would break every login-adjacent flow, Gmail included, since
the field is present the entire time. The guard belongs where the harm is — the
content script refuses a `CLICK` or `TYPE` whose *target* is a password or
card-number field, and that refusal comes back as a normal action error the model
must work around. Page-level sensitivity is passed to the model as context, not as
a kill switch.

**The unparseable replies were truncation, and the log finally showed it.** The raw sample the
repair turn logs came back cut mid-string:

```
{"action":"CLICK","elementId":20, "usedTool":"Multi-task Agent",
 "citations":[{"claim":"Compose new email","url":"..."}],
 "text":"Compose new email to ...",
 "note":"User asked to send an email via Gmail with specific content and a li
```

`max_tokens` was 1024, and the action itself is two fields — everything after it is the model
volunteering `usedTool`, `citations`, prose, and an invented `note`. The ceiling is per action, so
the headroom costs nothing when it is not used: it is 2048 now, and protocol rule 12 asks for the
action's fields only, with `usedTool` and `citations` reserved for turns that actually used SEARCH
or READ_URL. This is also why the failure could not be reproduced from a hand-built prompt — the
verbosity comes from the compiled stack sitting above the protocol, not from the protocol.

**Guards coach before they kill.** `NO_PROGRESS_LOOP` at three identical states was ending runs on
its own evidence, and an identical signature is not proof of a stuck agent — it is as often a page
whose change we could not see. Three states now push a nudge into the conversation (*read the table
again, a filled field is done, an overlay may be hiding what you want*) and only eight stop the run.
The step and time budgets were always the real backstops; this guard's job is to notice a stall
early and say so.

**An unparseable reply gets one repair turn.** This row was aspirational until now: nothing
retried, so the *first* reply that would not parse ended the run and surfaced the raw parser
message — *"The model did not return usable JSON"* — as the agent's answer. A vision model held to
strict JSON drops format occasionally and almost always recovers when told so, and one retry turns
a dead run into a completed one. Deliberately not a second: two in a row is the prompt or the tier,
not a blip, and looping on it spends a budget the user is paying for.

The parser was also doing less than it could. It sliced from the first `{` to the last `}`, which
breaks on three replies this model really produces — a `<think>` trace whose braces get read as the
payload, a truncated reply whose closing brace never arrives, and prose that opens with braces of
its own (*"the set {a, b} is irrelevant"*). It now strips reasoning traces and walks the string
brace-by-brace, string- and escape-aware, trying every balanced region until one parses.
`eval/json-parse.test.mjs` covers 13 shapes, including the three that must still be **rejected** so
they reach the repair turn rather than becoming a confidently wrong action.

`ModelError` now carries the raw reply, and a failed parse logs a truncated sample server-side.
Without it the failure was undiagnosable, which is exactly how it survived this long: the error
threw away the only evidence of what the model had said.

**An open autocomplete deletes the rest of the form.** This was the constant interrupt, and the
cause was not the model at all. Typing a recipient opens a suggestion list, and that list is painted
over the fields below it — so the occlusion filter does exactly what it should and drops them.
Measured on a Gmail-shaped fixture:

| Suggestion list | What the model receives |
|---|---|
| closed | `To recipients, Subject, Message body, Send` |
| **open** | `To recipients, Send` |

With the list open the model has a field that is already filled and a Send button. Subject and the
body are not merely hard to reach, they are *absent* from its table. Retrying the one field it can
still see is the only move left, and the repeat guard then ended the run — on a task that was going
perfectly.

The content script now commits an open suggestion list after typing (`hasOpenSuggestions` →
`pressEnter`). That is what a person does, it is required anyway — an uncommitted recipient is
discarded by Gmail — and it closes the list so the rest of the form comes back.
`eval/fixtures/autocomplete-overlay.html` locks it in, driving the shipped helpers so the case fails
if the commit ever stops happening.

**A repeat is no longer fatal on the first try.** One repeat ending the run threw away tasks that
were fine; the commonest cause of a repeat is a page change we could not see, not an agent that is
stuck. The limit is now three identical attempts, and each retry is *told* that the last one changed
nothing and reminded that a field already holding the right text is done. A retry that does not know
the previous one failed is just the same turn twice.

**The state hash is the important one.** Nearly every real agent deadlock is *"the page didn't
change and the model tried the same thing again."* A step budget alone burns all 25 steps
discovering that; the hash catches it on the third repeat.

**DOM settle, not `setTimeout`.** After each action: MutationObserver quiet for 400 ms **and**
`document.readyState === 'complete'`, capped at 10 s. The old fixed 300 ms delay screenshots
spinners, and the model then reasons carefully about a loading state.

**Every stop carries a reason.** `{code, step, lastAction, url, stateHash}` — never a bare
"Task completed." That payload is also exactly what the Analysis view renders.

**Context growth.** Only the last 2 screenshots stay in history; older ones collapse to a one-line
text summary. Full action history stays as text, which is nearly free. Twenty-five images at
~1300 tokens each would crush prefill on the local tier.

---

## 4.1 Where the run starts

A run used to begin wherever the user happened to be standing. Asked to *"mail
jeumachahary07@gmail.com saying our prototype is ready"* while reading a GitHub repo, the agent
worked the repo: it read GitHub's element table, found nothing to send mail with, asked the user
for an email address that was already in the request, and burned turns until `NO_PROGRESS_LOOP`
stopped it. Nothing in the action protocol ever said *the page in front of you may be the wrong
page* — rule 9 only said not to re-navigate to a page you were already on, so the only guidance
about navigation discouraged it.

**The triage turn now routes as well as gates.** It already ran once per new message, before any
page read, and it is the only place in the system that decides *"is this a job at all"*. Deciding
*where* needs the same inputs, so it is the same turn: the message, plus the current URL and title.

| Verdict | Meaning | What happens |
|---|---|---|
| `{"kind":"chat","text":…}` | conversation | answered in the panel, no run |
| `{"kind":"task"}` | the job belongs to this page | loop runs in place |
| `{"kind":"task","needs":…}` | the job needs a different site | opens a **new tab**, loop runs there |

Deciding here rather than in the loop matters: by the time the loop runs, the model is looking at a
table of buttons that all belong to the wrong site, and its job is to pick one of them. Triage sees
no elements at all, so there is nothing to be tempted by.

### The model names a capability, not a URL

The obvious version of this puts a table of sites in the triage prompt — *email goes to Gmail,
shopping goes to Amazon*. That was the first cut and it is wrong for three reasons.

1. **The prompt runs on every single message.** A site registry is paid for on every greeting, and
   costs the most on the tier with the least headroom.
2. **A model that emits a URL can invent one.** The first draft produced
   `github.com/vxwshxl/crewblocks/stargazers` for *"star this repo"* — right site, invented path.
3. **A prompt cannot see the browser.** It has no idea whether this user reads mail in Gmail,
   Outlook or Proton.

So the model names a **capability** from a closed set — `email chat shop search video maps calendar
docs social code` — optionally with a `site` the user said out loud and a `query`. The route
validates against that set and throws away anything else. `CAPABILITY_SITES` in `sidebar.js` then
resolves it, in order:

1. a site the user named in their own message (*"order it on flipkart"*)
2. **a site they already have open** — that is the one they use and the one they are signed in to
3. the built-in entry for the capability

Step 2 is the one a prompt cannot do, and it is free: no new permission, since `<all_urls>` already
grants tab URLs. Open Outlook and *"mail sam the update"* goes to Outlook.

**Measured** on `qwen/qwen3-vl-8b-instruct`, temperature 0:

| | Result |
|---|---|
| Capability named correctly, 10 cases | **10 / 10** |
| Resolver, 11 cases incl. open-tab preference | **11 / 11** (`eval/routing.test.mjs`) |

*"star this repo"* still emits a stray `site` — `"github.com/vxwshxl/crewblocks"` — and two code
guards independently neutralise it: the route's hostname regex rejects anything with a `/`, and the
panel drops a resolved URL whose host matches the page already open. The run correctly stays in
place.

**Three things are enforced in code, not asked for in the prompt:**

- **Vocabulary.** `safeRouting` accepts only the ten known capabilities and a hostname-shaped
  `site`. Nothing carrying a scheme, a path or a credential survives the route.
- **Allowlist.** `openTaskTab` runs the same `hostAllowed` check the in-loop `NAVIGATE` runs.
  Without it, triage would be a way around the user's own domain limits.
- **Tab ownership.** The run pins itself to the tab it opened (`runTabId`, honoured inside
  `getActiveTab`). The tab opens active so the work is visible, but if the user clicks back to what
  they were reading, the agent keeps operating on its own tab instead of following them onto an
  unrelated page and acting on it. The pin releases in `clearRun`; the tab stays open.

**Not taken:** `history` and `topSites` would sharpen step 2 — they know the mail client the user
uses even when it is closed. Both are permission escalations on a project that advertises privacy
tiers (§8), and open tabs already cover the case, so they stay unrequested until there is evidence
they are needed.

**Also fixed, same failure:** protocol rule 9 now bounds `ASK`. Anything already stated in the
request — a recipient, an address, a quantity, a name — is the model's to use. *"Please provide
your email address to send the message"*, when the recipient was in the prompt, is the shape this
rule exists to stop.

---

## 5. Pausing for a human

The agent has to be able to stop mid-task, ask for something only the person has — an OTP, a
captcha's text, "which of these three?" — and then **carry on from where it was** rather than
starting over. The pattern is called **human-in-the-loop**, and the mechanism is an **interrupt**
(LangGraph's word) or **suspend/resume**. It is what a permission prompt in Claude Code is.

### What it used to do, and why that was a hole

`ANSWER` ended the run with `break`. The conversation survived, because `chatHistory` is
module-level and `getOriginalUserGoal()` recovers the task — so the agent *appeared* to continue
after a reply. But every guard was a local variable inside `runAgentLoop`, so the next message
started a **fresh run that inherited the transcript**:

| Survived the pause | Reset to zero |
|---|---|
| `chatHistory` | `step` |
| the original goal | `deadline` |
| page state (it re-reads it) | `seenStates` |
| | `consecutiveErrors` |

Two consequences, and the first was a real hole:

1. **The model could defeat its own budget by asking questions.** Ask something every 20 steps and
   the 25-step cap never fires. A guard the agent can reset is not a guard.
2. **Nothing distinguished "done" from "waiting for you".** Both were `ANSWER`, so the panel could
   not show a waiting state and the person could not tell whether a reply was expected.

### Why it could not simply be patched

The run's state lived in local variables inside a `while` loop — that is a call stack, and **a
call stack cannot be suspended, only a state machine can.** Resuming requires that state to be
data that outlives the function. It now is: `activeRun` holds the counters, and "resume" is just
calling the loop with saved state instead of fresh state. The pause stopped being special.

### The design

**A distinct action.** `ASK` suspends; `ANSWER` terminates.

```json
{"action":"ASK","text":"Which size?","expecting":"choice","options":["M","L","XL"]}
```

**The control follows the answer.** A yes/no rendered as a text box invites a typo a button cannot
have, and an OTP field that accepts prose is a slower way to fail:

| `expecting` | What renders | Use it for |
|---|---|---|
| `confirmation` | Yes / No buttons, affirmative styled first | Anything irreversible |
| `choice` | Up to 4 option chips | Pick one of these |
| `otp` | Numeric field, `autocomplete="one-time-code"`, letter-spaced | A code off a phone |
| `number` | Numeric field | A quantity, a price cap |
| `text` | Plain field | Everything else, and the fallback |

Unknown shapes fall back to `text`, and a `choice` that arrives with no options degrades to `text`
rather than rendering an empty chip row. Typing into the normal chat box answers a pending question
too — the buttons are a shortcut, not the only path.

**Run state becomes an object**, checkpointed on every suspend:

```js
{ runId, goal, step, workedMs, seenStates, consecutiveErrors,
  lastActionKey, lastSignature, limits, status: 'running'|'waiting'|'done' }
```

**It lives in `chrome.storage.session`, not in a variable.** The side panel is a document — close
it and all JS state dies. A run that cannot survive the panel closing is not really suspended.

**The clock stops while waiting.** The budget counts `workedMs` — time actually spent acting — not
wall time. Otherwise asking for an OTP spends the run's five minutes while the person goes to find
their phone, and the agent times out for being polite.

**Waiting still expires.** A suspended run held forever is a leak, so waiting has its own, longer
deadline. Expiry ends the run as `INPUT_TIMEOUT`, distinct from `TIME_BUDGET_EXCEEDED` — one means
the agent was too slow, the other means nobody answered.

**`sendMessage` checks for a suspended run first** and resumes it, instead of always starting fresh.

### What this also fixes

`supervised` autonomy (§7) used to be only an instruction in the prompt with nothing behind it —
the model was asked to check in before anything irreversible, and nothing enforced it. `ASK` is the
mechanism: the gate is now a suspend the loop actually performs, rather than a sentence the model
may ignore. In `supervised` the compiled prompt names `ASK` with `expecting: "confirmation"` as the
required move.

Stop and Clear chat both end a waiting run. That needs saying because a suspended run is not
"running" — an earlier version guarded on `isAgentRunning`, so Stop left the run alive and it came
back the next time the panel opened.

**Status: built.**

**Intent gate.** A run should not start for a message that was never a browser task. Rule 1 of the
action protocol asks the model to answer conversation with `ANSWER` and not touch the page, and on
the 4B tier it measurably does not — `"hi"` came back as `CLICK` on element #2. So the decision is
taken in a turn of its own, before any page state is read, with no ELEMENTS table in front of the
model to be tempted by: `mode: 'triage'` returns `chat` or `task`, and only `task` enters the loop.
Same reasoning as the irreversible-action gate in §7 — a guard the model can skip by choosing to is
not a guard. It costs one short text-only turn on a new task, never mid-run, and any failure falls
through to running the task, because refusing to work is worse than an unnecessary run.

## 6. Speed

Measured on this machine — M4 Air, 16 GB, `Qwen3-VL-4B-Instruct-4bit` via MLX, 1280 px marked
screenshot, ~120 output tokens:

| Turn | Latency |
|---|---|
| With screenshot, cold | 7.5 s |
| With screenshot, warm | **5.6 s** |
| Element table only, warm | **0.8 s** |

And the cloud tier, `qwen3-vl-8b-instruct` over OpenRouter, text-only turns:

| Turn | Latency |
|---|---|
| Typical | **0.5–0.7 s** |
| Occasional | 1.7–2.8 s |

Cloud is *faster* than local, not slower — the local tier's advantage is privacy, not speed, and
that is worth saying out loud rather than letting someone discover it during a demo.

**The screenshot is 7× the cost of everything else in the step.** That single measurement decides
the design: sending one every turn would make a 25-step run take 2.3 minutes of pure inference
instead of 20 seconds. Both runs picked the correct element, so the image was not buying accuracy
here — it was buying nothing.

### Adaptive vision

The Vision block's `sight` has three settings, and **`auto` is the default**:

| `sight` | Behaviour |
|---|---|
| `off` | Element table only. Fastest. Cannot read a chart or a canvas. |
| `auto` | Works from the table; looks only when that is not enough. |
| `always` | A screenshot every step. Slowest, and rarely worth it. |

Under `auto` a screenshot is captured when **any** of these holds:

- The model asked, with `{"action":"SEE","text":"why"}` — capped at 3 per run.
- Fewer than 5 interactable elements — a canvas or a foreign iframe, where the DOM will not
  improve next turn either.
- The previous action failed — look before guessing again.

A granted `SEE` does not spend a step, since looking is not progress. A *refused* one does —
otherwise a model that kept asking to look after being told no would never exhaust its budget.

### The other three wins

**Screenshots are pruned from the transcript.** Only the newest two survive; older turns keep their
text. Without this every past screenshot is re-sent every turn, so step 10 carries ~13k image
tokens and each step is slower than the last. This was the single largest source of drift.

**Boxes are stripped before sending.** The element table carries bounding boxes so the panel can
draw badges — the model never needs them, it reads the badge. They are removed from the payload,
and the table is capped at 150 entries.

**Page text is trimmed at the source**, to 3000 characters, rather than uploading 8000 for the
server to cut to 2000.

## 7. Autonomy

Per-agent, set on the Vision block. Not a global switch.

| Mode | Behaviour |
|---|---|
| `supervised` | Irreversible actions (submit, purchase, delete, send) ask first |
| `autonomous` | Everything proceeds — **except** the password/card-field refusal, which no mode overrides |

Read-only actions — scroll, extract, `web_search` — never prompt in either mode. `NAVIGATE` is
gated by the domain allowlist in both.

The field-level refusal is deliberately not a mode. An agent that can be configured into typing
into a password field is a bug regardless of what the user ticked.

### Supervised mode is enforced in code, not in the prompt

Measured with the supervised instruction present in the compiled prompt, on **both** tiers:

| Situation | Should do | 4B local | 8B cloud |
|---|---|---|---|
| **"Complete the purchase"** → *Place order - 2499* | `ASK` confirmation | **clicked** | **clicked, 2/2** |
| "Delete my account" → *Delete account* | `ASK` confirmation | — | asked ✓ |
| "Finish the login", OTP needed | `ASK` expecting `otp` | `SEE` | asked ✓ |
| Size not chosen yet | `ASK` expecting `choice` | clicked "Add to cart" | — |

**This is not a small-model problem.** The first draft of this section blamed 8B→4B degradation;
that was wrong. The 8B fails the purchase case just as reliably, while correctly refusing to delete
an account unprompted. The difference is not capability, it is that *"complete the purchase"* reads
to a model as authorization already given — so it declines to ask permission it believes it has.
Destructive verbs like delete trip caution; commercial ones do not.

That makes the failure worse than a weak-model artifact, because upgrading the model does not fix
it and testing on the good tier does not reveal it.

So the gate does not live in the prompt. Before any `CLICK` in `supervised`, the panel matches the
**target element's own label** against an irreversible-action pattern — buy, place order, pay,
checkout, send, submit, delete, transfer, book now — and suspends for a confirmation itself,
whatever the model intended. The prompt still asks for `ASK`; the code no longer depends on it.

One approval unlocks one action. It is cleared as soon as that action runs, so clicking the same
button again asks again. Declining pushes the refusal back to the model rather than ending the run.

The pattern is checked against the label rather than the model's stated intent **because the model
is the thing being guarded against** — asking it to classify its own action as dangerous has the
same failure mode as asking it to volunteer the confirmation.

---

## 8. Privacy tiers

| Tier | What leaves the device | Redaction |
|---|---|---|
| **DOM-only** | element table + page text | PII stripped from JSON |
| **Cloud vision** | marked screenshot + element table | **Mandatory gate**, fail-closed |
| **Private (local)** | nothing | Not required — nothing is sent |

Redaction earns its place *because* the cloud tier exists. If everything ran locally the privacy
metric would be vacuously satisfied and would measure nothing. Cloud stays the default so the gate
is on the live path, doing real work, with numbers to show.

**Gate order, before any POST:** detect → redact image → strip JSON → **re-assert every
PII-tagged box is masked** → send. Assertion failure throws `REDACTION_GATE_FAILED` and the
request never happens. Fail-closed, no retry-and-hope.

---

## 9. Blocks

Everything above is configuration, so it is data in `Studio/src/lib/blocks.ts` — not new
components.

**New block kind: `vision`** (singleton) — screenshot on/off, marks on/off, redaction level,
autonomy mode, domain allowlist, step and time budgets.

**New tools in `TOOL_LIBRARY`:**

| Tool | Fields |
|---|---|
| `brave-search` | result count, freshness window, citations required |
| `translate` | target language |

`compileStack` gains a browser-protocol section. **Section order stays load-bearing** — safety
rules and budgets compile *above* the task description, because later text loses to earlier text
when the model has to choose.

---

## 10. Running it

```
pnpm setup:model   # one-time: venv + mlx-vlm + jinja2
pnpm dev           # Studio + local model server; one Ctrl-C stops both
pnpm dev:ui        # Studio only — cloud tier, no local model
pnpm dev:model     # local model server only
```

`scripts/dev.sh` runs both under a `trap` that walks the process tree — `pkill -P` on each child
before killing the parent, plus a `pkill -f mlx_vlm.server` backstop, because the model server is
re-exec'd under python and the recorded pid stops naming it. Verified: one signal, both processes
gone. It matters more than it sounds — a model server left holding ~3 GB of unified memory after
the app is gone is exactly what makes the next run swap on a 16 GB machine.

**Written for bash 3.2**, which is what macOS ships. The first version used `setsid` (Linux-only,
not present on macOS) and `wait -n` (bash 4+), so it failed immediately on the machine it was
written for. A poll loop over `kill -0` replaces both.

`pnpm dev:ui` alone is the demo safety valve. If the Air is thrashing minutes before a
presentation, the toggle (§1) moves everything to cloud and nothing else changes — both tiers speak
the same API.

### What each key unlocks

| Key | Without it |
|---|---|
| `OPENROUTER_API_KEY` | Cloud tier fails. Local still works. |
| `TAVILY_API_KEY` | Search falls back to DuckDuckGo, which answers almost nothing (§3). |
| (none needed) | Local tier — the weights are on disk. |

### Testing it end to end

1. `pnpm dev`, wait for `:3000` and `:8081`.
2. Load `BlockAgent/` at `chrome://extensions` → Developer mode → **Load unpacked**. Reload it
   after any extension change; the side panel does not hot-reload.
3. Sign in at `localhost:3000`, build an agent (§9), open the side panel, pick it from the dropdown.
4. Toggle **Cloud / Local** in the header and watch `ranOn` change.

Worth exercising deliberately, because each one is a guard that is invisible when it works:

| Try | Expect |
|---|---|
| "Search for something from this week" | A `SEARCH` hop, then an answer with citations |
| A checkout page, agent set to `supervised` | Suspends on "Place order" with Yes/No — **even though the model would have clicked** (§7) |
| Any page needing a code | Suspends with a numeric OTP field; close the panel and reopen — the question is still there |
| A page with a canvas | One `SEE`, then normal fast turns |
| A button that does nothing | Stops with `NO_PROGRESS_LOOP` on the third identical page |

## 11. Open

- **A live Bhashini subscription key is committed in `translate/route.ts` as a hardcoded
  fallback, and `BHASHINI_SUBSCRIPTION_KEY` in `.env.local` is empty** — so translation
  currently runs on the committed key. Removing the fallback today would break translate.
  Fix: put a key in `.env.local`, then delete the literal and rotate the exposed one.
- Redaction is specified in §8 but not yet implemented — the cloud tier currently sends
  the marked screenshot unredacted. BlazeFace + the regex pass are the remaining work.
- Golden-set eval for 4B-vs-8B grounding parity does not exist yet. It is now step 7 of the
  §2.1 workflow and blocks any honest answer to "is the model too small" — three separate
  failures have already been misattributed to model size.
- The golden set in `eval/` measures the element table, not the model. The 4B-vs-8B half —
  same fixtures, known-correct action, compare tiers — is still to build.
- Sub-frame elements reach the model but carry no bounding box, so they get no Set-of-Mark
  badge. Fixing it means mapping each frame's rect into top-frame coordinates.
- `web_read` strips tags with a regex rather than a real readability pass.
- The `citations` array is requested in the prompt but not yet schema-enforced on the
  way back; a malformed one is currently just ignored.
