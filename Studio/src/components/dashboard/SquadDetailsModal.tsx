'use client';

import React, { useState, useEffect } from 'react';
import { X, Users, Workflow as WorkflowIcon, Calendar, Crown, ExternalLink, Plus, Check } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import gsap from 'gsap';
import Link from 'next/link';
import ConfirmModal from './ConfirmModal';
import { readStack } from '@/lib/blocks';

interface SquadDetailsModalProps {
    isOpen: boolean;
    squadId: string | null;
    onClose: () => void;
    onJoin?: (id: string) => Promise<void> | void;
}

export default function SquadDetailsModal({ isOpen, squadId, onClose, onJoin }: SquadDetailsModalProps) {
    const [squad, setSquad] = useState<any>(null);
    const [members, setMembers] = useState<any[]>([]);
    const [chatflows, setChatflows] = useState<any[]>([]);
    const [workflowCount, setWorkflowCount] = useState(0);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'workflows' | 'members'>('workflows');
    const [confirmLeave, setConfirmLeave] = useState(false);
    const [confirmMemberRemove, setConfirmMemberRemove] = useState<string | null>(null);
    const [confirmWorkflowRemove, setConfirmWorkflowRemove] = useState<string | null>(null);
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [availableChatflows, setAvailableChatflows] = useState<any[]>([]);
    const [selectedChatflowId, setSelectedChatflowId] = useState('');
    const supabase = createClient();
    
    const modalRef = React.useRef<HTMLDivElement>(null);
    const overlayRef = React.useRef<HTMLDivElement>(null);

    async function fetchSquadDetails() {
        setLoading(true);
        if (!squadId) return;

        // Fetch Squad Info & current user
        const { data: { user } } = await supabase.auth.getUser();
        if (user) setCurrentUser(user);

        const { data: squadData } = await supabase.from('squads').select('*').eq('id', squadId).single();
        if (squadData) setSquad(squadData);

        // Fetch Members using secure RPC to get names/emails
        const { data: membersData } = await supabase.rpc('get_squad_members_details', { p_squad_id: squadId });
        if (membersData) setMembers(membersData);

        const { count } = await supabase
            .from('squad_chatflows')
            .select('*', { count: 'exact', head: true })
            .eq('squad_id', squadId);

        setWorkflowCount(count || 0);

        // Fetch visible chatflows for the current user
        const { data: chatflowsData } = await supabase
            .from('squad_chatflows')
            .select(`
                chatflow_id,
                added_at,
                chatflows (*)
            `)
            .eq('squad_id', squadId);
            
        if (chatflowsData) {
            setChatflows(chatflowsData.map((d: any) => d.chatflows).filter(Boolean));
        }

        if (user) {
            const { data: ownChatflows } = await supabase
                .from('chatflows')
                .select('id, name, updated_at')
                .eq('user_id', user.id)
                .order('updated_at', { ascending: false });

            if (ownChatflows) {
                const sharedIds = new Set((chatflowsData || []).map((d: any) => d.chatflow_id));
                const addableChatflows = ownChatflows.filter((chatflow: any) => !sharedIds.has(chatflow.id));
                setAvailableChatflows(addableChatflows);
                setSelectedChatflowId((currentId) => {
                    if (currentId && addableChatflows.some((chatflow: any) => chatflow.id === currentId)) {
                        return currentId;
                    }
                    return addableChatflows[0]?.id || '';
                });
            } else {
                setAvailableChatflows([]);
                setSelectedChatflowId('');
            }
        }

        setLoading(false);
    }

    useEffect(() => {
        if (isOpen && squadId) {
            gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3 });
            gsap.fromTo(modalRef.current, { y: 20, opacity: 0, scale: 0.95 }, { y: 0, opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(1.5)' });
            
            void fetchSquadDetails();
        } else {
            setSquad(null);
            setMembers([]);
            setChatflows([]);
            setWorkflowCount(0);
        }
    }, [isOpen, squadId]);

    const isMember = members.some(m => m.user_id === currentUser?.id);
    const canAccessWorkflows = Boolean(currentUser?.id && (currentUser.id === squad?.owner_id || isMember));
    const canManageWorkflows = canAccessWorkflows;

    const performLeaveSquad = async () => {
        if (!squad || !squadId || !currentUser) return;
        setIsActionLoading(true);
        if (currentUser.id === squad.owner_id) {
            await supabase.from('squads').delete().eq('id', squadId);
        } else {
            await supabase.from('squad_members').delete().eq('squad_id', squadId).eq('user_id', currentUser.id);
        }
        setIsActionLoading(false);
        setConfirmLeave(false);
        onClose();
    };

    const handleLeaveSquad = async () => {
        if (!squad || !squadId || !currentUser) return;
        setConfirmLeave(true);
    };

    const performRemoveMember = async () => {
        if (!squadId || !currentUser || currentUser.id !== squad?.owner_id || !confirmMemberRemove) return;
        setIsActionLoading(true);
        await supabase.from('squad_members').delete().eq('squad_id', squadId).eq('user_id', confirmMemberRemove);
        setMembers(members.filter(m => m.user_id !== confirmMemberRemove));
        setIsActionLoading(false);
        setConfirmMemberRemove(null);
    };

    const handleRemoveMember = async (memberId: string) => {
        setConfirmMemberRemove(memberId);
    };

    const performRemoveWorkflow = async () => {
        if (!squadId || !currentUser || !canManageWorkflows || !confirmWorkflowRemove) return;
        setIsActionLoading(true);
        await supabase.from('squad_chatflows').delete().eq('squad_id', squadId).eq('chatflow_id', confirmWorkflowRemove);
        const removedWorkflow = chatflows.find(cf => cf.id === confirmWorkflowRemove);
        setChatflows(chatflows.filter(cf => cf.id !== confirmWorkflowRemove));
        setWorkflowCount((count) => Math.max(0, count - 1));
        if (removedWorkflow?.user_id === currentUser.id) {
            const nextChatflows = [...availableChatflows, removedWorkflow].sort(
                (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
            );
            setAvailableChatflows(nextChatflows);
            setSelectedChatflowId((currentId) => currentId || removedWorkflow.id);
        }
        setIsActionLoading(false);
        setConfirmWorkflowRemove(null);
    };

    const handleRemoveWorkflow = (e: React.MouseEvent, workflowId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setConfirmWorkflowRemove(workflowId);
    };

    const handleClose = () => {
        gsap.to(overlayRef.current, { opacity: 0, duration: 0.2 });
        gsap.to(modalRef.current, { y: 20, opacity: 0, scale: 0.95, duration: 0.2, onComplete: onClose });
    };

    const handleJoinSquad = async () => {
        if (!squad?.id || !onJoin || isActionLoading) return;
        setIsActionLoading(true);
        await onJoin(squad.id);
        await fetchSquadDetails();
        setIsActionLoading(false);
    };

    const handleAddWorkflow = async () => {
        if (!squadId || !currentUser || !canManageWorkflows || !selectedChatflowId || isActionLoading) return;
        setIsActionLoading(true);
        const { error } = await supabase.from('squad_chatflows').insert({
            squad_id: squadId,
            chatflow_id: selectedChatflowId,
            added_by: currentUser.id
        });

        if (!error) {
            await fetchSquadDetails();
        }

        setIsActionLoading(false);
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div ref={overlayRef} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
            <div ref={modalRef} className="relative w-full max-w-3xl bg-card border border-border shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {loading ? (
                    <div className="flex flex-col items-center justify-center p-20">
                        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4"></div>
                        <p className="text-muted-foreground text-sm">Loading squad details...</p>
                    </div>
                ) : squad ? (
                    <>
                        <div className="px-8 py-6 border-b border-border/50 flex items-start justify-between bg-card shrink-0">
                            <div>
                                <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full border-2 border-primary/30 bg-primary/10 flex items-center justify-center">
                                        <Users className="w-5 h-5 text-primary" />
                                    </div>
                                    {squad.name}
                                </h2>
                                {squad.description && (
                                    <p className="text-sm text-muted-foreground mt-3 max-w-xl leading-relaxed">{squad.description}</p>
                                )}
                                <div className="flex items-center gap-4 mt-4">
                                    <span className="text-xs font-semibold px-2.5 py-1 bg-white/5 border border-white/10 rounded-full text-white flex items-center gap-1.5">
                                        <Calendar className="w-3.5 h-3.5 text-muted-foreground" /> Created {new Date(squad.created_at).toLocaleDateString()}
                                    </span>
                                    {squad.is_public ? (
                                        <span className="text-xs font-semibold px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full">
                                            Public Squad
                                        </span>
                                    ) : (
                                        <span className="text-xs font-semibold px-2.5 py-1 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-full">
                                            Private Squad
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-2 shrink-0">
                                <button onClick={handleClose} className="p-2 text-muted-foreground hover:text-white hover:bg-white/5 rounded-full transition-colors self-end">
                                    <X className="w-6 h-6" />
                                </button>
                                {isMember ? (
                                    <button onClick={handleLeaveSquad} className="text-xs font-bold px-4 py-2 mt-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors border border-red-500/20 rounded-full">
                                        {currentUser?.id === squad.owner_id ? 'Delete Squad' : 'Leave Squad'}
                                    </button>
                                ) : (
                                    <button onClick={handleJoinSquad} disabled={isActionLoading} className="text-xs font-bold px-4 py-2 mt-2 bg-primary text-primary-foreground hover:bg-[#9d6bff] transition-colors rounded-full shadow-lg shadow-primary/10 tracking-tight disabled:opacity-60 disabled:cursor-not-allowed">
                                        {isActionLoading ? 'Joining...' : 'Join Squad'}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="flex border-b border-border/50 px-8 pt-4 bg-card/50 shrink-0">
                            <button 
                                onClick={() => setTab('workflows')}
                                className={`px-5 py-3 font-semibold text-sm border-b-2 transition-colors ${tab === 'workflows' ? 'border-primary text-white' : 'border-transparent text-muted-foreground hover:text-white'}`}
                            >
                                <div className="flex items-center gap-2">
                                    <WorkflowIcon className="w-4 h-4" />
                                    Workflows ({workflowCount})
                                </div>
                            </button>
                            <button 
                                onClick={() => setTab('members')}
                                className={`px-5 py-3 font-semibold text-sm border-b-2 transition-colors ${tab === 'members' ? 'border-primary text-white' : 'border-transparent text-muted-foreground hover:text-white'}`}
                            >
                                <div className="flex items-center gap-2">
                                    <Users className="w-4 h-4" />
                                    Captains ({members.length})
                                </div>
                            </button>
                        </div>

                        <div className="p-8 overflow-y-auto flex-1 bg-background">
                            {tab === 'workflows' && (
                                <div className="space-y-4">
                                    {canManageWorkflows && (
                                        <div className="rounded-xl border border-border bg-card p-4">
                                            <div className="flex items-start justify-between gap-4">
                                                <div>
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-white">Add Chatflow</p>
                                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                                        Share one of your personal chatflows with this squad.
                                                    </p>
                                                </div>
                                                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                                                    {availableChatflows.length} available
                                                </span>
                                            </div>

                                            {availableChatflows.length > 0 ? (
                                                <div className="mt-4 flex flex-col gap-3 md:flex-row">
                                                    <select
                                                        value={selectedChatflowId}
                                                        onChange={(e) => setSelectedChatflowId(e.target.value)}
                                                        className="h-11 flex-1 rounded-xl border border-border bg-background px-4 text-xs text-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                                                    >
                                                        {availableChatflows.map((chatflow) => (
                                                            <option key={chatflow.id} value={chatflow.id}>
                                                                {chatflow.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        onClick={handleAddWorkflow}
                                                        disabled={!selectedChatflowId || isActionLoading}
                                                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-colors hover:bg-[#9d6bff] disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        <Plus className="h-4 w-4" />
                                                        {isActionLoading ? 'Adding...' : 'Add Chatflow'}
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
                                                    <Check className="h-4 w-4 text-primary" />
                                                    All of your personal chatflows are already shared here.
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {chatflows.length === 0 ? (
                                        <div className="text-center py-12 border border-dashed border-border rounded-xl">
                                            <WorkflowIcon className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
                                            <p className="text-white font-medium">
                                                {workflowCount > 0 && !isMember ? 'Join squad to view workflows' : 'No workflows found'}
                                            </p>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                {workflowCount > 0 && !isMember
                                                    ? `This squad has ${workflowCount} shared workflow${workflowCount === 1 ? '' : 's'}. Join to access them.`
                                                    : "This squad doesn't have any shared workflows yet."}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {chatflows.map(cf => {
                                                const cardClasses = `group p-5 rounded-xl border bg-card transition-all flex flex-col h-full relative overflow-hidden ${
                                                    canAccessWorkflows
                                                        ? 'border-border hover:border-primary/50'
                                                        : 'border-border/70 opacity-90'
                                                }`;

                                                const cardContent = (
                                                    <>
                                                        <div className="flex justify-between items-start mb-3">
                                                            <div className="min-w-0 pr-3">
                                                                <h4 className={`text-lg font-bold text-white truncate ${canAccessWorkflows ? 'group-hover:text-primary transition-colors' : ''}`}>
                                                                    {cf.name}
                                                                </h4>
                                                                <p className="mt-2 text-sm text-zinc-400">
                                                                    {readStack(cf.data).blocks.length} blocks
                                                                </p>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {canManageWorkflows && (
                                                                  <button 
                                                                      onClick={(e) => handleRemoveWorkflow(e, cf.id)}
                                                                      className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-all opacity-0 group-hover:opacity-100"
                                                                      title="Remove from squad"
                                                                  >
                                                                      <X className="w-4 h-4" />
                                                                  </button>
                                                                )}
                                                                <ExternalLink className={`w-4 h-4 text-muted-foreground transition-opacity ${canAccessWorkflows ? 'opacity-0 group-hover:opacity-100' : 'opacity-40'}`} />
                                                            </div>
                                                        </div>
                                                        {!canAccessWorkflows && (
                                                            <p className="mb-3 text-[11px] font-medium text-primary">
                                                                Join this squad to open this workflow.
                                                            </p>
                                                        )}
                                                        <div className="mt-auto pt-4 flex items-center justify-between text-[11px] text-muted-foreground border-t border-white/5">
                                                            <span>Updated {new Date(cf.updated_at).toLocaleDateString()}</span>
                                                        </div>
                                                    </>
                                                );

                                                if (!canAccessWorkflows) {
                                                    return (
                                                        <div
                                                            key={cf.id}
                                                            className={cardClasses}
                                                            aria-disabled="true"
                                                        >
                                                            {cardContent}
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <Link href={`/agent/${cf.id}`} key={cf.id} className={cardClasses}>
                                                        {cardContent}
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {tab === 'members' && (
                                <div className="space-y-3">
                                    {members.map(member => (
                                        <div key={member.user_id} className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                                    <Users className="w-5 h-5 text-primary" />
                                                </div>
                                                <div>
                                                    <p className="font-medium text-white flex items-center gap-2">
                                                        {member.user_name || 'Crew Captain'}
                                                        {member.user_id === squad.owner_id && <Crown className="w-3.5 h-3.5 text-yellow-500" />}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate max-w-[200px] md:max-w-none">
                                                        {member.user_id === squad.owner_id ? 'Squad Creator' : 'Crew Captain'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-1.5">
                                                <span className="text-xs font-semibold uppercase tracking-wider px-2.5 py-1 bg-white/5 rounded-md text-muted-foreground">
                                                    {member.role === 'owner' || member.user_id === squad.owner_id ? 'OWNER' : 'MEMBER'}
                                                </span>
                                                {currentUser?.id === squad.owner_id && member.user_id !== squad.owner_id && (
                                                    <button 
                                                        onClick={() => handleRemoveMember(member.user_id)}
                                                        className="text-[10px] font-bold text-red-400/80 hover:text-red-400 uppercase underline decoration-red-400/30 underline-offset-2 transition-colors"
                                                    >
                                                        Remove
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="p-8 text-center text-red-400">Failed to load squad details.</div>
                )}
            </div>
        </div>

        <ConfirmModal
            isOpen={confirmLeave}
            title={currentUser?.id === squad?.owner_id ? "Delete Squad" : "Leave Squad"}
            description={currentUser?.id === squad?.owner_id 
                ? "Are you sure you want to permanently delete this squad? This will tear down the collaborative space for all members."
                : "Are you sure you want to leave this squad? You will lose access to its shared workflows."}
            confirmText={currentUser?.id === squad?.owner_id ? "Delete Squad" : "Leave Squad"}
            destructive={true}
            onConfirm={performLeaveSquad}
            onCancel={() => setConfirmLeave(false)}
            loading={isActionLoading}
        />
        
        <ConfirmModal
            isOpen={!!confirmMemberRemove}
            title="Remove Member"
            description="Are you sure you want to kick this member from the squad? They will lose access to collaboratively edit the shared chatflows."
            confirmText="Remove"
            destructive={true}
            onConfirm={performRemoveMember}
            onCancel={() => setConfirmMemberRemove(null)}
            loading={isActionLoading}
        />

        <ConfirmModal
            isOpen={!!confirmWorkflowRemove}
            title="Unlink Workflow"
            description="Are you sure you want to remove this workflow from the squad? It will no longer be visible to squad members."
            confirmText="Remove"
            destructive={true}
            onConfirm={performRemoveWorkflow}
            onCancel={() => setConfirmWorkflowRemove(null)}
            loading={isActionLoading}
        />
        </>
    );
}
