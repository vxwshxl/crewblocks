import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Block } from './blocks';

export interface Agent {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    blocks: Block[];
}

export interface ApiKey {
    id: string;
    provider: string; // e.g., 'openai', 'anthropic', 'gemini'
    name: string;
    key: string;
    createdAt: number;
}

interface AppState {
    agents: Agent[];
    apiKeys: ApiKey[];

    // Actions
    addAgent: (agent: Omit<Agent, 'createdAt' | 'updatedAt'>) => void;
    updateAgent: (id: string, updates: Partial<Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>>) => void;
    deleteAgent: (id: string) => void;

    addApiKey: (apiKey: Omit<ApiKey, 'id' | 'createdAt'>) => void;
    deleteApiKey: (id: string) => void;
    setAgents: (agents: Agent[]) => void;
}

export const useStore = create<AppState>()(
    persist(
        (set) => ({
            agents: [],
            apiKeys: [],

            setAgents: (agents) => set({ agents }),

            addAgent: (agent) => set((state) => {
                if (state.agents.some((f) => f.id === agent.id)) {
                    return state;
                }
                return {
                    agents: [
                        { ...agent, createdAt: Date.now(), updatedAt: Date.now() },
                        ...state.agents
                    ]
                };
            }),

            updateAgent: (id, updates) => set((state) => ({
                agents: state.agents.map((flow) =>
                    flow.id === id
                        ? { ...flow, ...updates, updatedAt: Date.now() }
                        : flow
                )
            })),

            deleteAgent: (id) => set((state) => ({
                agents: state.agents.filter((flow) => flow.id !== id)
            })),

            addApiKey: (apiKey) => set((state) => ({
                apiKeys: [
                    ...state.apiKeys,
                    {
                        ...apiKey,
                        id: crypto.randomUUID(),
                        createdAt: Date.now(),
                    }
                ]
            })),

            deleteApiKey: (id) => set((state) => ({
                apiKeys: state.apiKeys.filter((key) => key.id !== id)
            })),
        }),
        {
            name: 'crewblocks-storage-v1',
            version: 1,
        }
    )
);


// Removed auto-sync to /api/sync/store as it was destructive and conflicted with direct DB persistence.

