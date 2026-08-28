# CrewBlocks

CrewBlocks is an interactive, visual drag-and-drop AI agent workflow builder. It empowers users to create, configure, and orchestrate autonomous AI agents in a dynamic workspace.

## Features

- **Interactive Canvas Builder**: Seamlessly drag and drop nodes (Agents, Start points, Conditions, Custom Functions, Sticky Notes) using a powerful canvas engine.
- **Agent Orchestration**: Connect multiple AI nodes together visually to create robust and complex collaborative AI workflows.
- **Detailed Node Configurations**: Easy-to-use configuration side-panels for adjusting your agent's specific instructions, chosen LLM Models, tools, and custom execution functions.
- **Interactive Spotlight Tutorial**: A built-in, animated tutorial that intelligently tracks UI elements around the DOM and guides new users step-by-step through creating their first workflow.
- **Persistent Edge State**: Workflows, agents, node positions, and API keys are continuously auto-saved purely on the client so you don't lose any progress.

## Tech Stack

The application relies on a modern, robust, and highly scalable stack:

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **UI Library**: [React](https://react.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Node Canvas Engine**: [React Flow](https://reactflow.dev/) (`@xyflow/react`)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/) (with Auto-Persist)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Components**: [shadcn/ui](https://ui.shadcn.com/) inspired minimalist components architecture

## Getting Started

First, install the dependencies for the application:

```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

Then, run the local development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the complete dashboard. If it's your first time opening the app, the interactive tour guide will automatically walk you through your first steps!
