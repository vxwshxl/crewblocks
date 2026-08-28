'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Users, Plus, Search, MoreVertical, Calendar, Globe, Lock } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import gsap from 'gsap';
import CreateSquadModal from './CreateSquadModal';
import SquadDetailsModal from './SquadDetailsModal';

interface Squad {
    id: string;
    name: string;
    description: string;
    is_public: boolean;
    owner_id: string;
    created_at: string;
    invite_code: string;
    members_count?: number;
    workflows_count?: number;
}

export default function SquadsList() {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const searchContainerRef = useRef<HTMLDivElement>(null);
    const [squads, setSquads] = useState<Squad[]>([]);
    const [publicSquads, setPublicSquads] = useState<Squad[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [selectedSquadId, setSelectedSquadId] = useState<string | null>(null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [tab, setTab] = useState<'my_squads' | 'explore'>('my_squads');

    const supabase = createClient();

    const fetchSquads = async () => {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            setCurrentUserId(user.id);
            // Fetch my squads
            const { data: myData } = await supabase
                .from('squads')
                .select(`*, squad_members!inner(user_id)`)
                .eq('squad_members.user_id', user.id)
                .order('created_at', { ascending: false });

            // Fetch public squads not joined by user
            const { data: pubData } = await supabase
                .from('squads')
                .select('*')
                .eq('is_public', true)
                .order('created_at', { ascending: false });

            const processSquads = async (arr: any[]) => {
                if (!arr) return [];
                return Promise.all(arr.map(async (sq: any) => {
                    const { count: membersCount } = await supabase.from('squad_members').select('*', { count: 'exact', head: true }).eq('squad_id', sq.id);
                    const { count: workflowsCount } = await supabase.from('squad_chatflows').select('*', { count: 'exact', head: true }).eq('squad_id', sq.id);
                    return { ...sq, members_count: membersCount || 0, workflows_count: workflowsCount || 0 };
                }));
            };

            if (myData) setSquads(await processSquads(myData));
            
            if (pubData) {
                // filter out ones I'm already in
                const mySquadIds = new Set(myData?.map((s: any) => s.id));
                const unjoined = pubData.filter((p: any) => !mySquadIds.has(p.id));
                setPublicSquads(await processSquads(unjoined));
            }
        }
        setLoading(false);
    };

    const handleJoinSquad = async (squadId: string) => {
        if (!currentUserId) return;
        await supabase.from('squad_members').insert({ squad_id: squadId, user_id: currentUserId, role: 'member' });
        await fetchSquads();
        setTab('my_squads');
    };

    useEffect(() => {
        fetchSquads();
    }, []);

    useEffect(() => {
        if (isSearchFocused || searchQuery) {
            gsap.to(searchContainerRef.current, {
                width: 230,
                duration: 0.4,
                ease: 'power3.out'
            });
        } else {
            gsap.to(searchContainerRef.current, {
                width: 160,
                duration: 0.4,
                ease: 'power3.out'
            });
        }
    }, [isSearchFocused, searchQuery]);

    const filteredSquads = squads.filter(squad =>
        squad.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const activeSquads = tab === 'my_squads' ? filteredSquads : publicSquads.filter(squad => squad.name.toLowerCase().includes(searchQuery.toLowerCase()));

    const getColors = (name: string) => {
        const colors = [
            ['bg-pink-500', 'bg-purple-500', 'bg-blue-500'],
            ['bg-green-500', 'bg-teal-500', 'bg-cyan-500'],
            ['bg-orange-500', 'bg-yellow-500', 'bg-red-500'],
        ];
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    };

    return (
        <div className="p-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                        <Users className="w-8 h-8 text-primary" />
                        Collaborative Squads
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">Manage groups of Captains to build workflows simultaneously.</p>
                </div>
                
                <div className="flex items-center gap-3 w-full md:w-auto overflow-hidden">
                    <div ref={searchContainerRef} className="relative flex-none" style={{ width: 160 }}>
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Find a squad..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onFocus={() => setIsSearchFocused(true)}
                            onBlur={() => setIsSearchFocused(false)}
                            className="w-full h-11 pl-10 pr-5 bg-muted/50 border border-border rounded-full text-sm focus:outline-none caret-primary text-white transition-shadow"
                        />
                    </div>
                    <button 
                        onClick={() => setIsCreateModalOpen(true)}
                        className="flex items-center gap-2 bg-secondary text-secondary-foreground h-11 px-5 rounded-full text-sm font-semibold hover:bg-[#D8D8D8] transition-all shadow-sm whitespace-nowrap"
                    >
                        <Plus className="w-4 h-4" />
                        Create Squad
                    </button>
                </div>
            </div>

            <div className="flex gap-2 mb-8 border-b border-border/50 pb-px">
                <button 
                    onClick={() => setTab('my_squads')}
                    className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${tab === 'my_squads' ? 'border-primary text-white' : 'border-transparent text-muted-foreground hover:text-white'}`}
                >
                    My Squads
                </button>
                <button 
                    onClick={() => setTab('explore')}
                    className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${tab === 'explore' ? 'border-primary text-white' : 'border-transparent text-muted-foreground hover:text-white'}`}
                >
                    Explore Public Squads
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                    {activeSquads.map((squad) => {
                        const palette = getColors(squad.name);
                        return (
                        <div key={squad.id} className="group bg-card border border-border rounded-2xl p-6 hover:border-primary/50 transition-all shadow-sm hover:shadow-xl cursor-default flex flex-col h-full cursor-pointer"
                             onClick={() => setSelectedSquadId(squad.id)}>
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex -space-x-2">
                                        <div className={`w-10 h-10 rounded-full border-2 border-card ${palette[0]} flex items-center justify-center shrink-0`}>
                                            <span className="text-sm font-bold text-white uppercase">{squad.name.substring(0, 1)}</span>
                                        </div>
                                        {squad.members_count && squad.members_count > 1 && (
                                            <div className="w-10 h-10 rounded-full border-2 border-card bg-muted flex items-center justify-center text-xs font-bold text-white shrink-0">
                                                +{squad.members_count - 1}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex space-x-2">
                                    {squad.is_public ? (
                                        <div className="bg-primary/10 text-primary p-1.5 rounded-md" title="Public Squad">
                                            <Globe className="w-4 h-4" />
                                        </div>
                                    ) : (
                                        <div className="bg-muted text-muted-foreground p-1.5 rounded-md" title="Private Squad">
                                            <Lock className="w-4 h-4" />
                                        </div>
                                    )}
                                    {tab === 'my_squads' && (
                                        <button className="text-muted-foreground hover:text-white p-1 rounded transition-colors opacity-0 group-hover:opacity-100">
                                            <MoreVertical className="w-5 h-5" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            <h3 className="text-xl font-bold text-white mb-1 group-hover:text-primary transition-colors cursor-pointer">
                                {squad.name}
                            </h3>
                            {squad.description && (
                                <p className="text-sm text-gray-400 mb-4 line-clamp-2">
                                    {squad.description}
                                </p>
                            )}
                            <p className="text-sm text-muted-foreground flex items-center gap-2 mb-6 flex-1">
                                <Calendar className="w-3.5 h-3.5" /> Created {new Date(squad.created_at).toLocaleDateString()}
                            </p>

                            <div className="grid grid-cols-2 gap-4 border-t border-border/50 pt-4 mb-4">
                                <div>
                                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Captains</p>
                                    <p className="text-lg font-semibold text-white">{squad.members_count}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Workflows</p>
                                    <p className="text-lg font-semibold text-white">{squad.workflows_count}</p>
                                </div>
                            </div>

                            {tab === 'explore' && (
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedSquadId(squad.id);
                                    }}
                                    className="w-full mt-auto py-2.5 rounded-xl border border-primary text-primary hover:bg-primary/10 font-semibold transition-colors text-sm"
                                >
                                    View Squad
                                </button>
                            )}
                        </div>
                    )})}
                </div>
            )}

            {!loading && activeSquads.length === 0 && (
                <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
                    <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium text-white mb-1">No Squads Found</h3>
                    <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-6">
                        Could not find any collaborative squads. Create a new squad to invite others and collaborate in real-time!
                    </p>
                    <button 
                        onClick={() => setIsCreateModalOpen(true)}
                        className="bg-primary text-primary-foreground px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all inline-flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        Create Squad
                    </button>
                </div>
            )}

            <CreateSquadModal 
                isOpen={isCreateModalOpen} 
                onClose={() => setIsCreateModalOpen(false)} 
                onSuccess={() => {
                    setIsCreateModalOpen(false);
                    fetchSquads();
                }} 
            />

            <SquadDetailsModal
                isOpen={!!selectedSquadId}
                squadId={selectedSquadId}
                onClose={() => setSelectedSquadId(null)}
                onJoin={async (id) => {
                    await handleJoinSquad(id);
                }}
            />
        </div>
    );
}
