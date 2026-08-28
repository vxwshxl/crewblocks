# CrewBlocks Studio

The Next.js half of CrewBlocks: the landing page, the dashboard, the block editor, and the API the
[`BlockAgent`](../BlockAgent/) extension talks to.

For the product overview, the block reference, and the deployment guide, see the
[root README](../README.md).

## The block editor

An agent is an ordered stack of blocks. Position in the stack is the wiring — there is no canvas
and there are no connections. [`src/lib/blocks.ts`](src/lib/blocks.ts) is the single source of
truth: the editor renders from `BLOCK_SPECS`, the API compiles through `compileStack`, and both
check `validateStack`.

| Path | What lives there |
|---|---|
| `src/lib/blocks.ts` | Block model, tool library, validator, prompt compiler, legacy reader |
| `src/components/blocks/` | `BlockStackEditor` · `BlockCard` · `BlockBody` · `AddBlockMenu` · `StackComposer` |
| `src/app/agent/[id]/` | The editor route — load, autosave, realtime presence |
| `src/app/api/extension/` | The bridge the side panel calls |

Adding a **tool** is a data entry in `TOOL_LIBRARY`, not a new component. Adding a **block kind**
means an entry in `BLOCK_SPECS`, a case in `createBlock`, and a body in `BlockBody`.

## Tech stack

- **Framework**: [Next.js](https://nextjs.org/) 16 (App Router)
- **UI**: [React](https://react.dev/) 19 · [TypeScript](https://www.typescriptlang.org/) strict
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) v4 with `--ds-*` design tokens
- **Components**: [shadcn/ui](https://ui.shadcn.com/) primitives over [Base UI](https://base-ui.com/)
- **Data**: [Supabase](https://supabase.com/) — Postgres, Auth, Realtime, RLS
- **State**: [Zustand](https://zustand-demo.pmnd.rs/), persisted for the extension to read
- **Icons**: [Lucide](https://lucide.dev/)

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in your Supabase project
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Sign up, add a Gemini key under
**API Keys**, then create your first agent. A guided tour runs on first visit.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm typecheck` | `tsc --noEmit` — must be clean |
| `pnpm lint` | ESLint across the app |

`pnpm lint` reports problems inherited from this codebase's origin. New code must be clean on its
own:

```bash
npx eslint src/components/blocks src/lib/blocks.ts src/app/agent
```
