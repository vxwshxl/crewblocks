'use client';

import React, { useState } from 'react';
import AnimatedLoader from '@/components/AnimatedLoader';
import Sidebar, { TabType } from '@/components/dashboard/Sidebar';
import ChatflowsList from '@/components/dashboard/ChatflowsList';
import ApiKeysList from '@/components/dashboard/ApiKeysList';
import CrewserPanel from '@/components/dashboard/CrewserPanel';
import { Key, BookOpen, ShoppingCart, Settings } from 'lucide-react';
import TutorialsList from '@/components/dashboard/TutorialsList';
import MarketplaceList from '@/components/dashboard/MarketplaceList';
import SettingsList from '@/components/dashboard/SettingsList';
import SquadsList from '@/components/dashboard/SquadsList';
import PricingsList from '@/components/dashboard/PricingsList';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

export default function DashboardPage() {
    const [activeTab, setActiveTab] = useState<TabType>('agents');
    const [mounted, setMounted] = useState(false);
    const [showLoader, setShowLoader] = useState(true);
    const [isMobile, setIsMobile] = useState(false);
    const [userProfile, setUserProfile] = useState<{ name: string; avatarUrl: string | null }>({ name: 'Guest Captain', avatarUrl: null });
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const router = useRouter();
    const supabase = createClient();

    React.useEffect(() => {
        setMounted(true);
        const timer = setTimeout(() => setShowLoader(false), 3000);
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 1024);
        };
        
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                // Read from user_metadata for name and picture (from Google OAuth or traditional signup)
                const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Crew Member';
                const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
                setUserProfile({ name, avatarUrl });
            }
        };

        checkMobile();
        fetchUser();
        window.addEventListener('resize', checkMobile);

        return () => {
             window.removeEventListener('resize', checkMobile);
             clearTimeout(timer);
        };
    }, []);

    return (
        <>
            {(!mounted || showLoader) && <AnimatedLoader type="dashboard" />}
            
            {mounted && (
                isMobile ? (
                    <div className="flex flex-col items-center justify-center h-screen w-screen bg-background text-foreground p-8 text-center" style={{fontFamily: 'Host Grotesk, sans-serif'}}>
                        <div className="w-16 h-16 bg-muted/20 border border-border rounded-2xl flex items-center justify-center mb-6 text-muted-foreground">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
                        </div>
                        <h1 className="text-2xl font-bold text-white mb-2">Desktop Recommended</h1>
                        <p className="text-muted-foreground max-w-sm mx-auto leading-relaxed">
                            The block editor needs room to work. Switch to a desktop or laptop to build an agent.
                        </p>
                    </div>
                ) : (
                    <div className="flex h-screen w-screen overflow-hidden bg-background">
                        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

                        <main className="flex-1 overflow-y-auto">
                            <header className="h-14 border-b border-border bg-card/50 flex items-center justify-between px-6 sticky top-0 z-10 backdrop-blur w-full">
                                {/* Left side empty or reserved for potential title/breadcrumbs */}
                                <div></div>

                                {/* Right side - User Profile */}
                                <div className="relative">
                                    <div 
                                        className="flex items-center gap-3 cursor-pointer hover:bg-white/5 p-2 rounded-full transition-colors"
                                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                    >
                                        <span className="text-sm font-semibold text-white">{userProfile.name}</span>
                                        <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 flex items-center justify-center text-muted-foreground border border-border">
                                            {userProfile.avatarUrl ? (
                                                <Image src={userProfile.avatarUrl} alt={userProfile.name} width={32} height={32} className="object-cover" />
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
                                                    <circle cx="12" cy="7" r="4"/>
                                                </svg>
                                            )}
                                        </div>
                                    </div>

                                    {/* Dropdown Menu */}
                                    {isDropdownOpen && (
                                        <div className="absolute right-0 mt-2 w-48 bg-card border border-border rounded-lg shadow-xl py-1 z-50 overflow-hidden transform origin-top-right transition-all">
                                            <div className="px-4 py-3 border-b border-border">
                                                <p className="text-sm text-white font-medium truncate">{userProfile.name}</p>
                                            </div>
                                            <button 
                                                onClick={async () => {
                                                    await supabase.auth.signOut();
                                                    router.push('/login');
                                                }}
                                                className="w-full text-left px-4 py-2 text-sm text-destructive hover:bg-destructive/10 hover:text-red-400 transition-colors flex items-center gap-2"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
                                                Log out
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </header>

                            <div className="min-h-[calc(100vh-3.5rem)]">
                                {activeTab === 'agents' && <ChatflowsList />}
                                {activeTab === 'apikeys' && <ApiKeysList />}
                                {activeTab === 'crewser' && <CrewserPanel />}
                                {activeTab === 'squads' && <SquadsList />}
                                {activeTab === 'marketplace' && <MarketplaceList />}
                                {activeTab === 'pricings' && <PricingsList />}
                                {activeTab === 'tutorials' && <TutorialsList />}
                                {activeTab === 'settings' && <SettingsList onProfileUpdate={() => {
                                    // Re-fetch user to sync navbar
                                    const fetchUser = async () => {
                                        const { data: { user } } = await supabase.auth.getUser();
                                        if (user) {
                                            const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Crew Member';
                                            const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
                                            setUserProfile({ name, avatarUrl });
                                        }
                                    };
                                    fetchUser();
                                }} />}
                            </div>
                        </main>
                    </div>
                )
            )}
        </>
    );
}
