'use client';

import React, { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Blocks, Plus, Trash2, Pencil, Globe, CheckCircle2, AlertTriangle, X, ChevronDown, ChevronRight, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DownloadExtensionBtn from '@/components/DownloadExtensionBtn';
import { createClient } from '@/utils/supabase/client';
import PublishModal, { PublishDetails } from './marketplace/PublishModal';
import ConfirmModal from './ConfirmModal';
import { readStack, starterStack, BLOCK_SPECS } from '@/lib/blocks';

/** Card subtitle: what this agent is made of, at a glance. */
function describeStack(data: unknown): string {
    const blocks = readStack(data).blocks;
    if (!blocks.length) return 'Empty — open it to add the first block';

    const counts = new Map<string, number>();
    for (const block of blocks) {
        const label = BLOCK_SPECS[block.kind].label.toLowerCase();
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    return [...counts.entries()]
        .map(([label, count]) => (count === 1 ? `1 ${label}` : `${count} ${label}s`))
        .join(' · ');
}


export default function ChatflowsList() {
    const [personalChatflows, setPersonalChatflows] = useState<any[]>([]);
    const [squadChatflows, setSquadChatflows] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isPersonalOpen, setIsPersonalOpen] = useState(true);
    const [isSquadOpen, setIsSquadOpen] = useState(true);
    const [workflowToPublish, setWorkflowToPublish] = useState<any | null>(null);
    const [successToast, setSuccessToast] = useState<string | null>(null);
    const [errorToast, setErrorToast] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [confirmRemoveSquad, setConfirmRemoveSquad] = useState<string | null>(null);
    const [isActionLoading, setIsActionLoading] = useState(false);
    
    const router = useRouter();
    const supabase = createClient();
    const { setAgents: storeSetAgents, deleteAgent: storeDeleteAgent } = useStore();

    useEffect(() => {
        fetchChatflows();
    }, []);

    const fetchChatflows = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        
        // Fetch all chatflows user has access to. A failed read used to render
        // as an empty list, which is indistinguishable from having no agents.
        const { data: allFlows, error: flowsError } = await supabase
            .from('chatflows')
            .select('*')
            .order('updated_at', { ascending: false });

        if (flowsError) {
            console.error('Loading agents failed:', flowsError);
            setErrorToast(`Could not load your agents. ${flowsError.message}`);
            setLoading(false);
            return;
        }

        // Only treat workflows as squad workflows if the current user is a member of that squad.
        const { data: memberships } = await supabase
            .from('squad_members')
            .select('squad_id')
            .eq('user_id', user.id);

        const memberSquadIds = (memberships || []).map((membership) => membership.squad_id);

        let squadFlowIds = new Set<string>();
        if (memberSquadIds.length > 0) {
            const { data: squadAssocs } = await supabase
                .from('squad_chatflows')
                .select('chatflow_id')
                .in('squad_id', memberSquadIds);

            squadFlowIds = new Set((squadAssocs || []).map((assoc) => assoc.chatflow_id));
        }

        if (allFlows) {
            const personal: any[] = [];
            const squad: any[] = [];

            allFlows.forEach(f => {
                if (squadFlowIds.has(f.id)) {
                    squad.push(f);
                } else if (f.user_id === user.id) {
                    personal.push(f);
                }
            });

            setPersonalChatflows(personal);
            setSquadChatflows(squad);

            const accessibleChatflows = [...personal, ...squad];

            // Sync with Zustand store for extension
            storeSetAgents(accessibleChatflows.map(f => ({
                id: f.id,
                name: f.name,
                blocks: readStack(f.data).blocks,
                createdAt: new Date(f.created_at).getTime(),
                updatedAt: new Date(f.updated_at).getTime()
            })));
        }
        setLoading(false);
    };

    /**
     * Creates an agent and opens it.
     *
     * Every failure here used to be swallowed, so a blocked insert looked
     * exactly like a dead button. Each one now says what went wrong instead.
     */
    const handleCreateNew = async () => {
        if (isCreating) return;
        setIsCreating(true);
        setErrorToast(null);

        try {
            const { data: { user }, error: authError } = await supabase.auth.getUser();

            if (authError || !user) {
                setErrorToast('Your session has expired. Log in again to create an agent.');
                return;
            }

            const { data, error } = await supabase
                .from('chatflows')
                .insert({
                    user_id: user.id,
                    name: 'New agent',
                    data: starterStack()
                })
                .select('id')
                .single();

            if (error) {
                console.error('Creating an agent failed:', error);
                setErrorToast(`Could not create the agent. ${error.message}`);
                return;
            }

            if (!data?.id) {
                setErrorToast('The agent was created but could not be opened. Refresh to find it in the list.');
                await fetchChatflows();
                return;
            }

            router.push(`/agent/${data.id}`);
        } catch (err) {
            console.error('Creating an agent failed:', err);
            setErrorToast('Could not reach the server. Check your connection and try again.');
        } finally {
            setIsCreating(false);
        }
    };

    const performDelete = async () => {
        if (!confirmDelete) return;
        setIsActionLoading(true);
        await supabase.from('chatflows').delete().eq('id', confirmDelete);
        storeDeleteAgent(confirmDelete);
        await fetchChatflows();
        setIsActionLoading(false);
        setConfirmDelete(null);
    };

    const performRemoveSquad = async () => {
        if (!confirmRemoveSquad) return;
        setIsActionLoading(true);
        // Specifically remove from the squad_chatflows table so it reverts to personal
        await supabase.from('squad_chatflows').delete().eq('chatflow_id', confirmRemoveSquad);
        await fetchChatflows();
        setIsActionLoading(false);
        setConfirmRemoveSquad(null);
    };

    const handleUpdate = async (id: string, name: string) => {
        await supabase.from('chatflows').update({ name, updated_at: new Date().toISOString() }).eq('id', id);
        fetchChatflows();
    };

    const handleConfirmPublish = async (details: PublishDetails) => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const workflow = [...personalChatflows, ...squadChatflows].find(f => f.id === details.id);
            if (!workflow) return;

            // Submit to marketplace_workflows table
            const { error } = await supabase.from('marketplace_workflows').insert({
                user_id: user.id,
                name: details.name,
                description: details.description,
                category: details.category,
                price: details.price,
                is_premium: details.isPremium,
                icon: details.icon,
                template_data: workflow.data,
                creator_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous'
            });

            if (error) throw error;

            setSuccessToast("Workflow published to Marketplace!");
            setWorkflowToPublish(null);
            
            setTimeout(() => setSuccessToast(null), 4000);
        } catch (err) {
            console.error("Publishing failed:", err);
            alert("Failed to publish workflow. Ensure the marketplace table exists.");
        }
    };

    return (
        <div className="p-8">
            {/* Success Toast */}
            {successToast && (
                <div className="fixed top-8 left-1/2 -translate-x-1/2 z-100 bg-emerald-500 text-white px-5 py-2.5 rounded-full shadow-lg flex items-center gap-3 font-semibold text-sm animate-in slide-in-from-top-5 duration-300">
                    <CheckCircle2 className="w-4 h-4" />
                    {successToast}
                </div>
            )}

            {/* Error Toast */}
            {errorToast && (
                <div
                    role="alert"
                    className="fixed top-8 left-1/2 -translate-x-1/2 z-100 max-w-lg bg-red-500 text-white pl-5 pr-3 py-2.5 rounded-full shadow-lg flex items-center gap-3 font-semibold text-sm animate-in slide-in-from-top-5 duration-300"
                >
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="min-w-0">{errorToast}</span>
                    <button
                        type="button"
                        onClick={() => setErrorToast(null)}
                        aria-label="Dismiss"
                        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                        <Blocks className="w-8 h-8 text-primary" />
                        Agents
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">Every agent here is a stack of blocks you can open and rearrange.</p>
                </div>
                
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <DownloadExtensionBtn />
                    <button
                        onClick={handleCreateNew}
                        disabled={isCreating}
                        className="flex items-center gap-2 bg-secondary text-secondary-foreground h-11 px-5 rounded-full text-sm font-semibold hover:bg-[#D8D8D8] transition-all shadow-sm whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        <Plus className="w-4 h-4" /> {isCreating ? 'Creating…' : 'Add New'}
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="border border-dashed border-white/10 rounded-xl p-12 text-center">
                    <p className="text-muted-foreground">Loading your agents…</p>
                </div>
            ) : personalChatflows.length === 0 && squadChatflows.length === 0 ? (
                <div className="border border-dashed border-white/10 rounded-xl p-12 text-center">
                    <div className="w-12 h-12 rounded-full bg-white/5 text-muted-foreground flex items-center justify-center mx-auto mb-4 border border-white/5">
                        <Blocks className="w-6 h-6" />
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">Build your first agent</h3>
                    <p className="text-muted-foreground mb-6 max-w-sm mx-auto text-sm leading-relaxed">
                        Stack a few blocks — a model, what it should do, the tools it can reach for — and it runs on any page in your browser.
                    </p>
                    <button
                        onClick={handleCreateNew}
                        disabled={isCreating}
                        className="flex items-center gap-2 bg-[#8C52FE] text-white h-11 px-6 rounded-full text-sm font-bold shadow-sm mx-auto disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        <Plus className="w-4 h-4" /> {isCreating ? 'Creating…' : 'Create an agent'}
                    </button>
                </div>
            ) : (
                <div className="space-y-8">
                    {/* Personal Chatflows */}
                    {personalChatflows.length > 0 && (
                        <div>
                            <button 
                                onClick={() => setIsPersonalOpen(!isPersonalOpen)}
                                className="flex items-center gap-2 text-lg font-bold text-white mb-4 hover:text-primary transition-colors"
                            >
                                {isPersonalOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                                Personal
                            </button>
                            
                            {isPersonalOpen && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                     {personalChatflows.map((flow) => (
                                        <ChatflowCard
                                            key={flow.id}
                                            flow={flow}
                                            onDelete={(id) => setConfirmDelete(id)}
                                            onUpdate={(id, updateData) => handleUpdate(id, updateData.name!)}
                                            onPublish={(f) => setWorkflowToPublish(f)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Squad Chatflows */}
                    {squadChatflows.length > 0 && (
                        <div>
                            <button 
                                onClick={() => setIsSquadOpen(!isSquadOpen)}
                                className="flex items-center gap-2 text-lg font-bold text-white mb-4 hover:text-primary transition-colors"
                            >
                                {isSquadOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                                Squad
                            </button>
                            
                            {isSquadOpen && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                     {squadChatflows.map((flow) => (
                                        <ChatflowCard
                                            key={flow.id}
                                            flow={flow}
                                            onDelete={(id) => setConfirmDelete(id)}
                                            onRemoveFromSquad={(id) => setConfirmRemoveSquad(id)}
                                            onUpdate={(id, updateData) => handleUpdate(id, updateData.name!)}
                                            onPublish={(f) => setWorkflowToPublish(f)}
                                            isSquad={true}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            <PublishModal 
                workflow={workflowToPublish}
                onClose={() => setWorkflowToPublish(null)}
                onConfirm={handleConfirmPublish}
            />

            <ConfirmModal
                isOpen={!!confirmDelete}
                title="Delete agent"
                description="This removes the agent and every block in it, for good. Anyone you shared it with loses access too."
                confirmText="Delete agent"
                destructive={true}
                onConfirm={performDelete}
                onCancel={() => setConfirmDelete(null)}
                loading={isActionLoading}
            />

            <ConfirmModal
                isOpen={!!confirmRemoveSquad}
                title="Unlink from Squad"
                description="Are you sure you want to remove this workflow from the collaborative squad? It will instantly be returned to your personal workflows."
                confirmText="Unlink Workflow"
                destructive={true}
                onConfirm={performRemoveSquad}
                onCancel={() => setConfirmRemoveSquad(null)}
                loading={isActionLoading}
            />
        </div>
    );
}

function ChatflowCard({ flow, onDelete, onRemoveFromSquad, onUpdate, onPublish, isSquad }: { 
    flow: any; 
    onDelete: (id: string) => void;
    onRemoveFromSquad?: (id: string) => void;
    onUpdate: (id: string, data: any) => void;
    onPublish: (flow: any) => void;
    isSquad?: boolean;
}) {
    const [isEditing, setIsEditing] = React.useState(false);
    const [editValue, setEditValue] = React.useState(flow.name);

    const handleSave = () => {
        setIsEditing(false);
        if (editValue.trim() && editValue !== flow.name) {
            onUpdate(flow.id, { name: editValue.trim() });
        } else {
            setEditValue(flow.name);
        }
    };

    return (
        <div className="group relative">
            <Link href={`/agent/${flow.id}`} className="block h-full">
                <div className="border border-white/5 p-6 hover:border-white/20 transition-all duration-200 shadow-sm hover:shadow-lg h-full flex flex-col cursor-pointer">
                    <div className="flex-1">
                        {isEditing ? (
                            <input
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={handleSave}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSave();
                                    if (e.key === 'Escape') {
                                        setIsEditing(false);
                                        setEditValue(flow.name);
                                    }
                                }}
                                onClick={(e) => e.preventDefault()}
                                className="text-lg font-bold text-white mb-2 bg-transparent border-b border-primary outline-none w-full"
                            />
                        ) : (
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-2 group-hover:text-primary transition-colors">
                                    <h3 className="text-lg font-bold text-white tracking-tight">{flow.name}</h3>
                                </div>
                                {isSquad && (
                                    <div className="bg-primary/10 p-1.5 rounded-md" title="Squad Workflow">
                                        <Users className="w-4 h-4 text-primary" />
                                    </div>
                                )}
                            </div>
                        )}
                        <p className="text-sm text-zinc-500 leading-relaxed font-medium">
                            {describeStack(flow.data)}
                        </p>
                    </div>
                    <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between text-[11px] text-zinc-600 font-bold uppercase tracking-tight font-mono">
                        <span>Updated {new Date(flow.updated_at || flow.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
            </Link>
            <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <button
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onPublish(flow);
                    }}
                    className="p-1.5 text-zinc-500 hover:text-emerald-400 bg-black/40 backdrop-blur border border-white/5 rounded-lg transition-colors shadow-xl"
                    title="Publish to Marketplace"
                >
                    <Globe className="w-3.5 h-3.5" />
                </button>
                <button
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsEditing(true);
                    }}
                    className="p-1.5 text-zinc-500 hover:text-blue-400 bg-black/40 backdrop-blur border border-white/5 rounded-lg transition-colors shadow-xl"
                    title="Rename"
                >
                    <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isSquad && onRemoveFromSquad) {
                            onRemoveFromSquad(flow.id);
                        } else {
                            onDelete(flow.id);
                        }
                    }}
                    className="p-1.5 text-zinc-500 hover:text-red-400 bg-black/40 backdrop-blur border border-white/5 rounded-lg transition-colors shadow-xl"
                    title={isSquad ? "Remove from Squad" : "Delete"}
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}
