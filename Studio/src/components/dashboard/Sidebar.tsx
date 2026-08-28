'use client';

import React from 'react';
import Link from 'next/link';
import { Blocks, Key, BookOpen, ShoppingCart, Settings, Users, Tag } from 'lucide-react';

export type TabType = 'agents' | 'apikeys' | 'squads' | 'marketplace' | 'pricings' | 'tutorials' | 'settings';

interface SidebarProps {
    activeTab: TabType;
    onTabChange: (tab: TabType) => void;
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
    return (
        <div className="w-64 h-full border-r bg-black/40 border-border flex flex-col">
            <Link href="/" className="h-14 flex items-center px-4 border-b border-border gap-2 hover:bg-white/5 transition-colors cursor-pointer">
                <div className="w-6 h-6 rounded bg-black flex items-center justify-center">
                    <img src="/logoCS.png" alt="Logo" className="w-full h-full rounded" />
                </div>
                <span className="font-semibold text-white tracking-wide text-sm">CrewBlocks</span>
            </Link>

            <nav className="flex-1 py-6 px-3 space-y-[6px] overflow-y-auto custom-scrollbar">
                {/* Unified Sidebar Items */}
                {[
                    { id: 'agents', label: 'Agents', icon: Blocks },
                    { id: 'apikeys', label: 'API Keys', icon: Key },
                    { id: 'squads', label: 'Squads', icon: Users },
                    { type: 'divider' },
                    { id: 'marketplace', label: 'Marketplace', icon: ShoppingCart },
                    { id: 'pricings', label: 'Pricing', icon: Tag },
                    { id: 'tutorials', label: 'Tutorials', icon: BookOpen },
                    { id: 'settings', label: 'Profile Settings', icon: Settings },
                ].map((item, idx) => {
                    if ('type' in item && item.type === 'divider') {
                        return <div key={`div-${idx}`} className="my-3 mx-4 border-t border-white/5 pt-3" />;
                    }
                    
                    const menuBtn = item as { id: TabType; label: string; icon: any };
                    const Icon = menuBtn.icon;
                    const isActive = activeTab === menuBtn.id;
                    
                    return (
                        <button
                            key={menuBtn.id}
                            onClick={() => onTabChange(menuBtn.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm font-semibold transition-all duration-150 group ${isActive
                                ? 'bg-secondary text-secondary-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-white/6 hover:text-zinc-200'
                                }`}
                        >
                            <Icon className={`w-4 h-4 transition-colors ${isActive ? 'text-secondary-foreground' : 'text-muted-foreground group-hover:text-zinc-200'}`} />
                            {menuBtn.label}
                        </button>
                    );
                })}
            </nav>
        </div>
    );
}
