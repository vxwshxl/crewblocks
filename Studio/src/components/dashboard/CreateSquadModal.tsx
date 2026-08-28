'use client';

import React, { useState, useEffect } from 'react';
import { X, Users, Globe, Lock, Search, Plus, Check } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import gsap from 'gsap';

interface Chatflow {
    id: string;
    name: string;
    updated_at: string;
}

interface CreateSquadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function CreateSquadModal({ isOpen, onClose, onSuccess }: CreateSquadModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isPublic, setIsPublic] = useState(false);
    const [myChatflows, setMyChatflows] = useState<Chatflow[]>([]);
    const [selectedChatflows, setSelectedChatflows] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);
    const supabase = createClient();
    const modalRef = React.useRef<HTMLDivElement>(null);
    const overlayRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3 });
            gsap.fromTo(modalRef.current, { y: 20, opacity: 0, scale: 0.95 }, { y: 0, opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(1.5)' });
            
            const fetchChatflows = async () => {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const { data } = await supabase.from('chatflows').select('id, name, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false });
                if (data) setMyChatflows(data);
                setFetching(false);
            };
            fetchChatflows();
        }
    }, [isOpen]);

    const handleClose = () => {
        gsap.to(overlayRef.current, { opacity: 0, duration: 0.2 });
        gsap.to(modalRef.current, { y: 20, opacity: 0, scale: 0.95, duration: 0.2, onComplete: onClose });
    };

    const toggleChatflow = (id: string) => {
        setSelectedChatflows(prev => prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id]);
    };

    const handleCreate = async () => {
        if (!name.trim()) return;
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoading(false); return; }

        // Create squad
        const { data: squadData, error: squadError } = await supabase.from('squads').insert({
            name: name.trim(),
            description: description.trim(),
            owner_id: user.id,
            is_public: isPublic
        }).select().single();

        if (squadError) {
            console.error('Error creating squad:', squadError);
            setLoading(false);
            return;
        }

        // Add owner as a member
        await supabase.from('squad_members').insert({
            squad_id: squadData.id,
            user_id: user.id,
            role: 'owner'
        });

        // Add selected chatflows
        if (selectedChatflows.length > 0) {
            const chatflowInserts = selectedChatflows.map(id => ({
                squad_id: squadData.id,
                chatflow_id: id,
                added_by: user.id
            }));
            await supabase.from('squad_chatflows').insert(chatflowInserts);
        }

        setLoading(false);
        onSuccess();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div ref={overlayRef} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
            <div ref={modalRef} className="relative w-full max-w-2xl bg-card border border-border shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="px-6 py-5 border-b border-border/50 flex items-center justify-between bg-card shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Users className="w-5 h-5 text-primary" />
                            Create a Squad
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">Assemble your team and workflows</p>
                    </div>
                    <button onClick={handleClose} className="p-2 text-muted-foreground hover:text-white hover:bg-white/5 rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    <div className="space-y-4">
                        <div>
                            <label className="text-sm font-medium text-white mb-1.5 block">Squad Name</label>
                            <input 
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Core System Ops"
                                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium text-white mb-1.5 block">Description <span className="text-muted-foreground font-normal">(Optional)</span></label>
                            <textarea 
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="What is the purpose of this squad?"
                                rows={2}
                                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none"
                            />
                        </div>
                    </div>

                    <div className="p-4 rounded-xl border border-border bg-background space-y-4">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h4 className="text-sm font-medium text-white">Privacy Setting</h4>
                                <p className="text-xs text-muted-foreground mt-0.5">Control who can see and join your squad.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setIsPublic(false)}
                                className={`flex flex-col items-center text-center p-4 rounded-xl border transition-all ${!isPublic ? 'bg-primary/10 border-primary text-white ring-1 ring-primary/50' : 'bg-card border-border text-muted-foreground hover:bg-white/5'}`}
                            >
                                <Lock className="w-6 h-6 mb-2" />
                                <span className="text-sm font-medium mb-1">Private</span>
                                <span className="text-xs opacity-70">Invite link only</span>
                            </button>
                            <button
                                onClick={() => setIsPublic(true)}
                                className={`flex flex-col items-center text-center p-4 rounded-xl border transition-all ${isPublic ? 'bg-primary/10 border-primary text-white ring-1 ring-primary/50' : 'bg-card border-border text-muted-foreground hover:bg-white/5'}`}
                            >
                                <Globe className="w-6 h-6 mb-2" />
                                <span className="text-sm font-medium mb-1">Public</span>
                                <span className="text-xs opacity-70">Anyone can join</span>
                            </button>
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-medium text-white">Include Workflows</h4>
                            <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-md">{selectedChatflows.length} selected</span>
                        </div>
                        
                        {fetching ? (
                            <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-3"></div>
                                <span className="text-xs">Loading workflows...</span>
                            </div>
                        ) : myChatflows.length === 0 ? (
                            <div className="p-6 text-center border border-border bg-background rounded-xl border-dashed">
                                <p className="text-sm text-muted-foreground">You don&apos;t have any workflows to add.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[240px] overflow-y-auto pr-2 custom-scrollbar">
                                {myChatflows.map(cf => {
                                    const isSelected = selectedChatflows.includes(cf.id);
                                    return (
                                        <button
                                            key={cf.id}
                                            onClick={() => toggleChatflow(cf.id)}
                                            className={`text-left p-3 rounded-xl border flex items-center justify-between transition-all ${isSelected ? 'bg-primary/5 border-primary/50 ring-1 ring-primary/20' : 'bg-background border-border hover:border-muted-foreground/30'}`}
                                        >
                                            <div className="flex-1 min-w-0 pr-3">
                                                <p className={`text-sm font-medium truncate ${isSelected ? 'text-white' : 'text-gray-300'}`}>{cf.name}</p>
                                                <p className="text-xs text-muted-foreground mt-0.5">Updated {new Date(cf.updated_at).toLocaleDateString()}</p>
                                            </div>
                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center border shrink-0 transition-colors ${isSelected ? 'bg-primary border-primary text-white' : 'border-muted-foreground/30 bg-transparent'}`}>
                                                {isSelected && <Check className="w-3 h-3" />}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-5 border-t border-border/50 bg-card flex justify-end gap-3 shrink-0">
                    <button onClick={handleClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">
                        Cancel
                    </button>
                    <button 
                        onClick={handleCreate} 
                        disabled={!name.trim() || loading}
                        className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Creating...' : 'Create Squad'}
                    </button>
                </div>
            </div>
        </div>
    );
}
