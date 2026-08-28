# CrewBlocks — project instructions

Workspace standards in `/Users/vee/Web Dev/CLAUDE.md` and `standards/` apply. This file covers
only what is true of CrewBlocks specifically.

## What this is

Two deployables in one repo:

- `Studio/` — Next.js App Router app: landing, dashboard, block editor, and the API the extension
  talks to.
- `BlockAgent/` — Chrome MV3 side-panel extension, vanilla JS. It captures page context and
  executes the actions the API returns.

CrewBlocks began as a clone of CrewSpace, which built agents on a React Flow canvas. **The canvas
is gone.** Do not reintroduce nodes, edges, or `@xyflow/react`.

## The block system is the product

An agent is an **ordered stack of blocks**. Position in the stack is the wiring — there is no
graph, no connections, no coordinates.

`Studio/src/lib/blocks.ts` is the single source of truth. Anything touching agent configuration
goes through it:

- `BLOCK_SPECS` — what the editor renders from. Add a block kind here and the add menu, the icon,
  the accent and the collapsed summary all follow.
- `TOOL_LIBRARY` — tools and their config fields. A new tool is a data entry, not a new component.
- `createBlock` — the only way to make a block. AI-generated blocks are rebuilt through it so a
  hallucinated field cannot reach the stack.
- `validateStack` — errors block the run, warnings do not.
- `compileStack` — turns a stack into the system prompt. **Section order is load-bearing**: later
  text loses to earlier text when the model has to choose. Read the comments before reordering.
- `readStack` — tolerates the retired node-graph payload and flattens it into blocks. Keep it.

**Never call `createBlock` during render.** It generates random ids, so an SSR render and a client
render would disagree and hydration would fail. Call it from event handlers and effects only.

### Persistence

The stack is stored whole in `chatflows.data` as `{ version: 2, blocks: [...] }` and saved with a
debounced full-document upsert. Collaboration broadcasts the whole stack too, so **last write
wins** — that is deliberate for a document this small and this explicit. Do not add field-level
merging without a reason.

Table and column names still say `chatflow` (`chatflows`, `chatflow_id`, `chatflow_memory`). That
is storage-layer legacy, kept so an existing Supabase project works without migration. Everything
user-facing says *agent*.

## Design language

The landing page and dashboard predate the house standards and are **dark-only** — `<html>` has a
hard-coded `class="dark"`, there is no next-themes and no light palette. This is drift from the
three-mode rule in the workspace standards; it is knowingly kept so the landing stays untouched.
Do not "fix" it as a side effect of another change.

New code — anything under `components/blocks/` — is written to the standards:

- `globals.css` ends with a **house standards layer** defining the `--ds-*` semantic tier, the
  block-kind accents, and the elevation/motion scales. Raw values live there and nowhere else.
- **`bg-card` in this app equals `bg-background`** — the legacy `--card` was never lifted. Block
  surfaces use `bg-elevated` (`--ds-bg-elevated`) so elevation reads in dark mode.
- Per-block colour comes from `BLOCK_SPECS[kind].accentVar` / `.washVar`, applied as inline
  custom properties. That is the one sanctioned inline style — it is a token reference, not a value.
- 4 px grid, `shadow-e0`–`e3`, `duration-[120ms]` with `ease-[cubic-bezier(0.2,0,0,1)]`.

## Accessibility is already there — keep it

The block editor was built to the a11y baseline and regressions are easy to introduce:

- Every block card carries `aria-label="{Kind} block, {n} of {total}"`.
- Reorder works by pointer **and** by <kbd>Alt</kbd> + arrow keys, with focus following the moved
  block.
- Controls that fade in on hover (drag handle, duplicate, remove, the enable switch) all keep
  `focus-visible:opacity-100`. Never drop that when adding another hover-revealed control.
- The enable switch is hidden when a block is on and shown when it is off, alongside a "Skipped"
  label — the off state is the news.
- `ChoiceRow` is one tab stop with arrow-key navigation. Use it instead of a native select for
  short option sets.

## Conventions

- `pnpm` only. `pnpm typecheck` before you call anything done.
- `pnpm lint` reports ~140 problems inherited from the legacy CrewSpace files. **New code must be
  clean**: `npx eslint src/components/blocks src/lib/blocks.ts src/app/agent`.
- The extension's contract with the app: `TOGGLE_BLOCKAGENT` / `SYNC_BLOCKAGENT` window messages,
  the `crewblocks-storage-v1` localStorage key, and the `?chatflowId=` query param on the history
  and memory routes. Change one side and you must change the other.
- The side panel sends the agent's id in the request's `model` field. Legacy naming; leave it.
