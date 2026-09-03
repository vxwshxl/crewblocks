# CrewSurf

The second way to run an agent.

The extension drives the Chrome you are already sitting in. CrewSurf is a separate
browser that sits beside it, with its own profile and its own windows — for tasks
you would rather not have take over your tabs.

## What it actually is

A pinned, **unmodified** build of [BrowserOS neo](https://github.com/browseros-ai/BrowserOS)
(`v0.49.3.1`). We do not fork it, patch it, or rebuild it. `install.sh` downloads the
publisher's signed release and copies the app bundle into this folder.

The reasoning for using it as-is rather than forking is in [`../browser.md`](../browser.md):
a Chromium fork costs a rebase against upstream every couple of weeks, forever, and
BrowserOS is AGPL-3.0, so shipping a modified copy would mean publishing our source
under the same licence. Installing it and launching it is plain use — no obligation
attaches. That stops being true the moment we redistribute it, so **do not bundle the
app into a CrewBlocks release** without settling the licence question first.

## Install

```bash
cd CrewSurf && ./install.sh
```

~147 MB, about a minute. It picks the right image for your CPU (Apple silicon, Intel,
or universal), verifies the bundle, and clears the download-quarantine flag so the
first launch does not need a right-click-Open.

Nothing it writes is committed — the `.app`, the `.dmg`, and `.cache/` are all
gitignored. Reinstall over the top with `./install.sh --force`.

macOS only for now. On Linux or Windows, take a build from the
[releases page](https://github.com/browseros-ai/BrowserOS/releases) and point
`CREWSURF_APP_PATH` at it.

## Launching

Dashboard → **CrewSurf** in the sidebar → **Open CrewSurf**.

That button works because in local development the Next server and your desktop are
the same machine, so `/api/crewsurf` can do what the page cannot — a website is not
allowed to start a native app, by design. The route refuses to run on a hosted
deploy, where it would be both useless and a spawn primitive pointed at a server.
On a deployed CrewBlocks the panel says so and asks you to open the app yourself.

## Models

CrewSurf carries its own agent and its own model settings — it does not read
CrewBlocks' API keys. Set them once inside it, under its AI settings. Every model
this repo uses has a home there:

| CrewBlocks model | In CrewSurf |
|---|---|
| `qwen/qwen3-vl-8b-instruct` | **OpenRouter** — same key |
| `mlx-community/Qwen3-VL-4B-Instruct-4bit` | **OpenAI Compatible**, base URL `http://127.0.0.1:8081/v1` (run `pnpm dev:model` first) |
| `gemini-flash-latest` · `gemini-pro-latest` | **Gemini** — same key |

## What this is not

CrewSurf does not run CrewBlocks agents. Your block stacks, tools, and memory stay in
the extension and the Studio app; CrewSurf's agent is BrowserOS's own. Sharing one
loop across both is the `BrowserDriver` seam in [`../browser.md`](../browser.md) §3,
and it is not built yet.
