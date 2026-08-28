'use client';

import React, { useState, useEffect } from 'react';
import { 
  User, 
  Shield, 
  Key, 
  Bell, 
  CreditCard, 
  Trash2, 
  Save, 
  Camera, 
  Mail, 
  Lock, 
  Copy, 
  RefreshCw,
  Plus,
  Settings,
  MoreVertical,
  AlertTriangle,
  Globe,
  Loader2,
  CheckCircle2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';

type SettingsTab = 'profile' | 'account' | 'security' | 'api' | 'notifications' | 'billing' | 'danger';

export default function SettingsList({ onProfileUpdate }: { onProfileUpdate?: () => void }) {
    const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
    const [loading, setLoading] = useState(false);
    const [successToast, setSuccessToast] = useState<string | null>(null);
    const supabase = createClient();

    const showToast = (message: string) => {
        setSuccessToast(message);
        setTimeout(() => setSuccessToast(null), 3000);
    };

    // Keyboard shortcut for saving (Ctrl+S)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                // Trigger save in active component if applicable
                const saveButton = document.getElementById('save-settings-btn');
                if (saveButton) saveButton.click();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTab]);

    return (
        <div className="flex h-full text-white overflow-hidden relative">
            {/* Success Toast */}
            {successToast && (
                <div className="fixed top-20 left-1/2 -translate-x-1/2 z-100 bg-emerald-500 text-white px-5 py-2.5 rounded-full shadow-lg flex items-center gap-3 font-semibold text-sm duration-300">
                    <CheckCircle2 className="w-4 h-4" />
                    {successToast}
                </div>
            )}

            {/* Left Content Area (Moved from Right) */}
            <main className="flex-1 overflow-y-auto custom-scrollbar p-10">
                <div className="max-w-3xl mx-auto">
                    {activeTab === 'profile' && <ProfileSection onSave={() => {
                        showToast("Profile updated successfully");
                        if (onProfileUpdate) onProfileUpdate();
                    }} />}
                    {activeTab === 'account' && <AccountSection />}
                    {activeTab === 'security' && <SecuritySection onSave={() => showToast("Security settings updated")} />}
                    {activeTab === 'api' && <ApiAccessSection onSave={() => showToast("API key generated")} />}
                    {activeTab === 'notifications' && <NotificationsSection onSave={() => showToast("Notification settings saved")} />}
                    {activeTab === 'billing' && <BillingSection />}
                    {activeTab === 'danger' && <DangerZoneSection />}
                </div>
            </main>

            {/* Right Sidebar Navigation (Moved from Left) */}
            <div className="w-72 border-l border-white/5 bg-black/20 flex flex-col p-9 pt-10 shrink-0">

                <nav className="space-y-1.5 px-1">
                    <SettingsNavItem 
                        icon={<User className="w-4.5 h-4.5" />} 
                        label="Profile" 
                        active={activeTab === 'profile'} 
                        onClick={() => setActiveTab('profile')} 
                    />
                    <SettingsNavItem 
                        icon={<Mail className="w-4.5 h-4.5" />} 
                        label="Account" 
                        active={activeTab === 'account'} 
                        onClick={() => setActiveTab('account')} 
                    />
                    <SettingsNavItem 
                        icon={<Shield className="w-4.5 h-4.5" />} 
                        label="Security" 
                        active={activeTab === 'security'} 
                        onClick={() => setActiveTab('security')} 
                    />
                    <SettingsNavItem 
                        icon={<Key className="w-4.5 h-4.5" />} 
                        label="API Access" 
                        active={activeTab === 'api'} 
                        onClick={() => setActiveTab('api')} 
                    />
                    <SettingsNavItem 
                        icon={<Bell className="w-4.5 h-4.5" />} 
                        label="Notifications" 
                        active={activeTab === 'notifications'} 
                        onClick={() => setActiveTab('notifications')} 
                    />
                    <SettingsNavItem 
                        icon={<CreditCard className="w-4.5 h-4.5" />} 
                        label="Billing" 
                        active={activeTab === 'billing'} 
                        onClick={() => setActiveTab('billing')} 
                    />
                    
                    <div className="pt-5 mt-5 border-t border-white/5">
                        <SettingsNavItem 
                            icon={<AlertTriangle className="w-4.5 h-4.5" />} 
                            label="Danger Zone" 
                            active={activeTab === 'danger'} 
                            onClick={() => setActiveTab('danger')}
                            variant="danger"
                        />
                    </div>
                </nav>
            </div>

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { width: 5px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.1); }
            `}</style>
        </div>
    );
}

function SettingsNavItem({ icon, label, active, onClick, variant = 'default' }: { 
    icon: React.ReactNode; 
    label: string; 
    active: boolean; 
    onClick: () => void;
    variant?: 'default' | 'danger';
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "w-full flex items-center gap-4 px-4 py-3 rounded-full text-sm transition-all duration-200 group",
                active 
                    ? variant === 'danger' 
                        ? "bg-red-500/15 text-red-500" 
                        : "bg-white/10 text-white font-bold shadow-sm" 
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5",
                variant === 'danger' && !active && "hover:text-red-400 hover:bg-red-500/5"
            )}
        >
            <span className={cn(
                "transition-colors",
                active ? "text-white" : "text-zinc-500 group-hover:text-zinc-300",
                variant === 'danger' && active && "text-red-500"
            )}>
                {icon}
            </span>
            <span className="tracking-tight">{label}</span>
        </button>
    );
}

// --- Sections ---

function ProfileSection({ onSave }: { onSave: () => void }) {
    const [loading, setLoading] = useState(false);
    const [profile, setProfile] = useState({
        user_id: '',
        full_name: '',
        username: '',
        bio: '',
        location: '',
        website: '',
        avatar_url: null as string | null
    });
    const supabase = createClient();

    useEffect(() => {
        const getProfile = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                setProfile({
                    user_id: user.id,
                    full_name: user.user_metadata?.full_name || '',
                    username: user.user_metadata?.username || user.email?.split('@')[0] || '',
                    bio: user.user_metadata?.bio || '',
                    location: user.user_metadata?.location || '',
                    website: user.user_metadata?.website || '',
                    avatar_url: user.user_metadata?.avatar_url || null
                });
            }
        };
        getProfile();
    }, []);

    const handleSave = async () => {
        setLoading(true);
        const { error } = await supabase.auth.updateUser({
            data: {
                full_name: profile.full_name,
                username: profile.username,
                bio: profile.bio,
                location: profile.location,
                website: profile.website,
                avatar_url: profile.avatar_url
            }
        });
        setLoading(false);
        if (!error) onSave();
    };

    return (
        <div className="space-y-10 duration-300">
            <header>
                <h2 className="text-3xl font-bold tracking-tight text-white mb-1">Profile</h2>
                <p className="text-muted-foreground text-sm">Manage your public presence and personal information.</p>
            </header>

            <div className="bg-white/2 border border-white/5 rounded-none p-8 space-y-8">
                {/* Avatar Section */}
                <div className="flex items-center gap-8 pb-8 border-b border-white/5">
                    <div className="relative group">
                        <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
                            {profile.avatar_url ? (
                                <img src={profile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                                <User className="w-10 h-10 text-zinc-700" />
                            )}
                        </div>
                        <button className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Camera className="w-6 h-6 text-white" />
                        </button>
                    </div>
                    <div>
                        <div className="flex gap-2 mb-2">
                            <Button variant="outline" size="sm" className="bg-white/5 border-white/10 h-8 text-xs font-bold uppercase tracking-tight rounded-full">Upload New</Button>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="bg-transparent border-white/5 text-zinc-600 hover:text-red-400 h-8 text-xs font-bold uppercase tracking-tight"
                                onClick={() => setProfile({...profile, avatar_url: null})}
                            >
                                Remove
                            </Button>
                        </div>
                        <p className="text-[10px] text-zinc-600 font-medium leading-relaxed uppercase tracking-wider">
                            Recommended: Square image, 400x400px. Max size 2MB.
                        </p>
                    </div>
                </div>

                {/* Form Fields */}
                <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <Label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold ml-1">Full Name</Label>
                        <Input 
                            value={profile.full_name}
                            onChange={(e) => setProfile({...profile, full_name: e.target.value})}
                            className="bg-black/40 border-white/10 focus:border-blue-500/50 h-10 rounded-none" 
                            placeholder="John Doe" 
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold ml-1">Username</Label>
                        <Input 
                            value={profile.username}
                            onChange={(e) => setProfile({...profile, username: e.target.value})}
                            className="bg-black/40 border-white/10 focus:border-blue-500/50 h-10 rounded-none" 
                            placeholder="johndoe" 
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold ml-1">Bio</Label>
                    <Textarea 
                        value={profile.bio}
                        onChange={(e) => setProfile({...profile, bio: e.target.value})}
                        className="bg-black/40 border-white/10 focus:border-blue-500/50 min-h-[100px] rounded-none" 
                        placeholder="Tell the community about yourself..." 
                    />
                </div>

                <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <Label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold ml-1">Location</Label>
                        <Input 
                            value={profile.location}
                            onChange={(e) => setProfile({...profile, location: e.target.value})}
                            className="bg-black/40 border-white/10 focus:border-blue-500/50 h-10 rounded-none" 
                            placeholder="San Francisco, CA" 
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold ml-1">Website</Label>
                        <Input 
                            value={profile.website}
                            onChange={(e) => setProfile({...profile, website: e.target.value})}
                            className="bg-black/40 border-white/10 focus:border-blue-500/50 h-10 rounded-none" 
                            placeholder="https://example.com" 
                        />
                    </div>
                </div>

                <div className="pt-4 border-t border-white/5 flex justify-end">
                    <Button 
                        id="save-settings-btn"
                        onClick={handleSave}
                        className="bg-blue-600 hover:bg-blue-500 font-bold text-xs h-10 px-6 rounded-full uppercase tracking-widest"
                        disabled={loading}
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                        Save Changes
                    </Button>
                </div>
            </div>
        </div>
    );
}

function AccountSection() {
    const [user, setUser] = useState<any>(null);
    const supabase = createClient();

    useEffect(() => {
        supabase.auth.getUser().then(({data}) => setUser(data.user));
    }, []);

    if (!user) return null;

    return (
        <div className="space-y-10 duration-300">
            <header>
                <h2 className="text-3xl font-bold tracking-tight text-white mb-1">Account</h2>
                <p className="text-muted-foreground text-sm">Update your email and manage account identification.</p>
            </header>

            <div className="space-y-6">
                <div className="bg-white/2 border border-white/5 rounded-none p-8 space-y-6">
                    <div className="space-y-4">
                        <Label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold ml-1">Email Address</Label>
                        <div className="flex gap-3">
                            <Input value={user.email} readOnly className="flex-1 bg-black/40 border-white/10 text-zinc-500 cursor-not-allowed rounded-none" />
                            <Button variant="outline" className="bg-white/5 border-white/10 text-xs font-bold uppercase tracking-tight rounded-full">Change Email</Button>
                        </div>
                        <p className="text-[10px] text-zinc-600">You must verify your new email address before the change takes effect.</p>
                    </div>
                </div>

                <div className="bg-white/2 border border-white/5 rounded-none p-8 grid grid-cols-2 gap-8 font-mono">
                    <div>
                        <Label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2 block">Account ID</Label>
                        <div className="text-xs text-zinc-300 bg-black/40 p-2 rounded border border-white/5 select-all">{user.id}</div>
                    </div>
                    <div>
                        <Label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2 block">Joined CrewBlocks</Label>
                        <div className="text-xs text-zinc-300 bg-black/40 p-2 rounded border border-white/5">
                            {new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                        </div>
                    </div>
                </div>

                <div className="bg-white/2 border border-white/5 rounded-none p-8 flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-bold text-white mb-1">Current Plan</h4>
                        <p className="text-xs text-zinc-500">You are currently on the Free tier.</p>
                    </div>
                    <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest">Free Plan</Badge>
                </div>
            </div>
        </div>
    );
}

function SecuritySection({ onSave }: { onSave: () => void }) {
    const [loading, setLoading] = useState(false);
    const [tfa, setTfa] = useState(false);
    const supabase = createClient();

    const handlePasswordUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        // Logic for password update via Supabase auth
        setLoading(false);
        onSave();
    };

    return (
        <div className="space-y-10 duration-300">
            <header>
                <h2 className="text-3xl font-bold tracking-tight text-white mb-1">Security</h2>
                <p className="text-muted-foreground text-sm">Secure your account with multi-factor authentication and strong credentials.</p>
            </header>

            <div className="space-y-6">
                <div className="bg-white/2 border border-white/5 rounded-none p-8">
                    <h3 className="text-sm font-bold text-white mb-6 flex items-center gap-2">
                        <Lock className="w-4 h-4 text-blue-500" />
                        Update Password
                    </h3>
                    <form onSubmit={handlePasswordUpdate} className="space-y-5 max-w-sm">
                        <div className="space-y-2">
                            <Label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold ml-1">Current Password</Label>
                            <Input type="password" required className="bg-black/40 border-white/10 h-10 rounded-none" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold ml-1">New Password</Label>
                            <Input type="password" required className="bg-black/40 border-white/10 h-10 rounded-none" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold ml-1">Confirm New Password</Label>
                            <Input type="password" required className="bg-black/40 border-white/10 h-10 rounded-none" />
                        </div>
                        <Button className="w-full bg-white/5 border border-white/10 hover:bg-white/10 font-bold text-xs h-10 uppercase tracking-widest rounded-full" disabled={loading}>
                            Update Password
                        </Button>
                    </form>
                </div>

                <div className="bg-white/2 border border-white/5 rounded-none p-8 flex items-center justify-between">
                    <div className="max-w-md">
                        <h4 className="text-sm font-bold text-white mb-1">Two-Factor Authentication (2FA)</h4>
                        <p className="text-xs text-zinc-500 leading-relaxed">
                            Protect your account by requiring an additional verification code from an authenticator app.
                        </p>
                    </div>
                    <Switch checked={tfa} onCheckedChange={(val) => {
                        setTfa(val);
                        if (val) onSave();
                    }} />
                </div>

                {tfa && (
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-none p-8 flex gap-8 items-start">
                         <div className="w-32 h-32 bg-white p-2 rounded-none flex items-center justify-center border border-white/10">
                            {/* QR Placeholder */}
                            <div className="w-full h-full bg-slate-100 flex items-center justify-center text-black font-black text-2xl">QR</div>
                         </div>
                         <div className="flex-1 space-y-4">
                            <h5 className="font-bold text-white text-sm">Scan with your Authenticator app</h5>
                            <p className="text-xs text-zinc-400 leading-relaxed">
                                Use apps like Google Authenticator or Authy to scan this code. If you can't scan, use the manual setup key below.
                            </p>
                            <div className="bg-black/40 border border-white/5 p-3 rounded-lg flex items-center justify-between">
                                <span className="font-mono text-xs text-blue-400 font-bold">ABCD EFGH IJKL MNOP</span>
                                <Copy className="w-3.5 h-3.5 text-zinc-600 hover:text-white cursor-pointer" />
                            </div>
                         </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function ApiAccessSection({ onSave }: { onSave: () => void }) {
    const [keys, setKeys] = useState<any[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [keyName, setKeyName] = useState('');
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);

    const handleCreateKey = () => {
        const fullKey = `crew_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;
        const newKey = {
            id: Math.random().toString(36).substring(2, 9),
            name: keyName || 'My New Key',
            prefix: 'crew_xxxx',
            full: fullKey,
            created_at: new Date().toISOString()
        };
        setKeys([newKey, ...keys]);
        setGeneratedKey(fullKey);
        setIsGenerating(false);
        setKeyName('');
        onSave();
    };

    return (
        <div className="space-y-10 duration-300">
            <header className="flex justify-between items-end">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-white mb-1">API Access</h2>
                    <p className="text-muted-foreground text-sm">Control how other apps interact with your workflows.</p>
                </div>
                {!isGenerating && !generatedKey && (
                    <Button 
                        onClick={() => {
                            setIsGenerating(true);
                            setGeneratedKey(null);
                        }} 
                        className="bg-blue-600 hover:bg-blue-500 font-bold text-[10px] h-9 px-4 rounded-full uppercase tracking-widest shadow-lg shadow-blue-900/10"
                    >
                        <Plus className="w-3.5 h-3.5 mr-1.5" /> Generate Key
                    </Button>
                )}
            </header>

            {isGenerating && (
                <div className="bg-white/2 border border-blue-500/30 rounded-none p-8 duration-200">
                    <h3 className="text-sm font-bold text-white mb-6 flex items-center gap-2">
                        <Key className="w-4 h-4 text-blue-500" />
                        New Personal Access Token
                    </h3>
                    <div className="space-y-4 max-w-sm">
                        <div className="space-y-2">
                            <Label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold ml-1">Key Name</Label>
                            <Input 
                                autoFocus
                                value={keyName}
                                onChange={(e) => setKeyName(e.target.value)}
                                className="bg-black/40 border-white/10 h-10 rounded-none" 
                                placeholder="Production App" 
                            />
                        </div>
                        <div className="flex gap-2">
                            <Button className="flex-1 bg-blue-600 hover:bg-blue-500 font-bold text-xs h-10 rounded-full" onClick={handleCreateKey}>Generate</Button>
                            <Button variant="outline" className="flex-1 bg-transparent border-white/5 text-zinc-500 font-bold text-xs h-10 rounded-full" onClick={() => setIsGenerating(false)}>Cancel</Button>
                        </div>
                    </div>
                </div>
            )}

            {generatedKey && (
                <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-none p-8">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm mb-3">
                        <CheckCircle2 className="w-4 h-4" /> Secret Key Generated
                    </div>
                    <p className="text-xs text-zinc-500 mb-6 leading-relaxed">
                        Copy this key now. For security purposes, it will not be shown again once you close this section.
                    </p>
                    <div className="bg-black/60 border border-white/10 p-4 rounded-none flex items-center justify-between group">
                        <span className="font-mono text-sm text-zinc-200">{generatedKey}</span>
                        <Button 
                            variant="ghost" 
                            className="h-8 w-8 p-0 hover:bg-emerald-500/20 text-zinc-500 hover:text-emerald-400 transition-all"
                            onClick={() => {
                                navigator.clipboard.writeText(generatedKey);
                                alert("Copied to clipboard!");
                            }}
                        >
                            <Copy className="w-4 h-4" />
                        </Button>
                    </div>
                    <Button variant="link" className="text-[10px] text-zinc-600 uppercase font-bold mt-4 h-auto p-0" onClick={() => setGeneratedKey(null)}>Close Generator</Button>
                </div>
            )}

            <div className="bg-[#161b22] border border-white/5 rounded-none overflow-hidden shadow-sm">
                <table className="w-full text-left">
                    <thead className="bg-black/20 border-b border-white/5">
                        <tr>
                            <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-zinc-600">Key Name</th>
                            <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-zinc-600">Prefix</th>
                            <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-zinc-600">Created</th>
                            <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-zinc-600 text-right pr-10">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {keys.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-6 py-12 text-center text-zinc-700 font-medium text-sm">
                                    No active API keys found.
                                </td>
                            </tr>
                        ) : (
                            keys.map(k => (
                                <tr key={k.id} className="group hover:bg-white/1 transition-colors">
                                    <td className="px-6 py-5 font-bold text-sm text-zinc-200">{k.name}</td>
                                    <td className="px-6 py-5 font-mono text-xs text-zinc-500 uppercase tracking-tighter">{k.prefix}</td>
                                    <td className="px-6 py-5 text-xs text-zinc-600 font-medium">{new Date(k.created_at).toLocaleDateString()}</td>
                                    <td className="px-6 py-5 text-right flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity pr-6">
                                        <button className="p-2 text-zinc-600 hover:text-blue-400 hover:bg-blue-500/5 rounded-none transition-all" title="Regenerate">
                                            <RefreshCw className="w-3.5 h-3.5" />
                                        </button>
                                        <button className="p-2 text-zinc-600 hover:text-red-400 hover:bg-red-500/5 rounded-none transition-all" title="Delete">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function NotificationsSection({ onSave }: { onSave: () => void }) {
    const [prefs, setPrefs] = useState({
        email: true,
        runs: true,
        marketplace: false,
        security: true
    });

    return (
        <div className="space-y-10 duration-300">
            <header>
                <h2 className="text-3xl font-bold tracking-tight text-white mb-1">Notifications</h2>
                <p className="text-muted-foreground text-sm">Decide how and when you want to be notified about activity.</p>
            </header>

            <div className="bg-white/2 border border-white/5 rounded-none p-8 space-y-8">
                <div className="space-y-6">
                    <NotificationToggle 
                        title="Email Notifications" 
                        desc="Receive digest and status updates via email." 
                        checked={prefs.email} 
                        onChange={(v) => setPrefs({...prefs, email: v})} 
                    />
                    <NotificationToggle 
                        title="Workflow Run Alerts" 
                        desc="Be notified immediately when a critical workflow run completes or fails." 
                        checked={prefs.runs} 
                        onChange={(v) => setPrefs({...prefs, runs: v})} 
                    />
                    <NotificationToggle 
                        title="Marketplace Updates" 
                        desc="Get notified when someone installs your workflow or releases a new trend." 
                        checked={prefs.marketplace} 
                        onChange={(v) => setPrefs({...prefs, marketplace: v})} 
                    />
                    <NotificationToggle 
                        title="Security Alerts" 
                        desc="Critical security notifications regarding login and key changes." 
                        checked={prefs.security} 
                        onChange={(v) => setPrefs({...prefs, security: v})} 
                    />
                </div>

                <div className="pt-6 border-t border-white/5 flex justify-end">
                    <Button className="bg-white/5 border border-white/10 hover:bg-white/10 font-bold text-xs h-10 px-8 uppercase tracking-widest rounded-full" onClick={onSave}>
                        Save Preferences
                    </Button>
                </div>
            </div>
        </div>
    );
}

function NotificationToggle({ title, desc, checked, onChange }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between group">
            <div className="space-y-0.5">
                <h4 className="text-sm font-bold text-white transition-colors group-hover:text-blue-400">{title}</h4>
                <p className="text-xs text-zinc-600">{desc}</p>
            </div>
            <Switch checked={checked} onCheckedChange={onChange} />
        </div>
    );
}

function BillingSection() {
    return (
        <div className="space-y-10 duration-300">
            <header>
                <h2 className="text-3xl font-bold tracking-tight text-white mb-1">Billing & Subscription</h2>
                <p className="text-muted-foreground text-sm">View your current usage, plans, and download invoices.</p>
            </header>

            <div className="grid grid-cols-3 gap-6">
                <div className="col-span-2 space-y-6">
                    <div className="bg-white/2 border border-white/5 rounded-none p-8 flex items-start justify-between">
                        <div>
                            <div className="bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest inline-block mb-3">Professional</div>
                            <h3 className="text-xl font-bold text-white mb-1">Elite Captain Plan</h3>
                            <p className="text-xs text-muted-foreground mb-6">Billed annually • Next payment March 20, 2026</p>
                            <div className="flex gap-3">
                                <Button className="bg-blue-600 hover:bg-blue-500 text-[10px] font-bold h-9 uppercase tracking-widest rounded-full">Upgrade Plan</Button>
                                <Button variant="outline" className="bg-white/5 border-white/10 text-[10px] font-bold h-9 uppercase tracking-widest rounded-full">Manage</Button>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-3xl font-black text-white">₹299</div>
                            <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Per Month</div>
                        </div>
                    </div>

                    <div className="bg-white/2 border border-white/5 rounded-none p-8">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-6">Usage Summary</h4>
                        <div className="space-y-6">
                            <UsageBar label="Workflow Executions" used={1420} total={5000} />
                            <UsageBar label="API Tokens" used={0.8} total={2} suffix="M" />
                            <UsageBar label="AI Agents" used={8} total={12} />
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="bg-black/40 border border-white/5 rounded-none p-6 font-mono">
                         <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-700 mb-4">Quick Stats</h4>
                         <div className="space-y-4">
                            <div>
                                <div className="text-[10px] text-zinc-600 uppercase mb-0.5">Active Subs</div>
                                <div className="text-sm font-bold text-zinc-300">1</div>
                            </div>
                            <div>
                                <div className="text-[10px] text-zinc-600 uppercase mb-0.5">Total Spent</div>
                                <div className="text-sm font-bold text-zinc-300">₹11,490</div>
                            </div>
                         </div>
                    </div>
                    <Button variant="outline" className="w-full bg-transparent border-white/5 text-zinc-500 hover:text-white text-[10px] font-bold uppercase tracking-widest h-10 rounded-full">
                        Download Invoices
                    </Button>
                </div>
            </div>
        </div>
    );
}

function UsageBar({ label, used, total, suffix = '' }: { label: string; used: number; total: number; suffix?: string }) {
    const percent = Math.min(100, (used / total) * 100);
    return (
        <div className="space-y-2">
            <div className="flex justify-between items-end">
                <span className="text-xs font-bold text-zinc-400">{label}</span>
                <span className="text-[10px] text-zinc-600 font-black font-mono">
                    {used}{suffix} / {total}{suffix} ({Math.round(percent)}%)
                </span>
            </div>
            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div 
                    className="h-full bg-blue-500/50 rounded-full transition-all duration-1000" 
                    style={{ width: `${percent}%` }}
                />
            </div>
        </div>
    );
}

function DangerZoneSection() {
    const [confirming, setConfirming] = useState(false);
    return (
        <div className="space-y-10 duration-300">
            <header>
                <h2 className="text-3xl font-bold tracking-tight text-white mb-1">Danger Zone</h2>
                <p className="text-muted-foreground text-sm">Irreversible actions regarding your CrewBlocks account.</p>
            </header>

            <div className="border border-red-500/30 rounded-none overflow-hidden shadow-[0_0_40px_rgba(239,68,68,0.05)]">
                <div className="bg-red-500/5 p-8 flex items-center justify-between">
                    <div className="max-w-md">
                        <h3 className="text-sm font-bold text-red-500 mb-1 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            Delete Account
                        </h3>
                        <p className="text-xs text-zinc-500 leading-relaxed">
                            Deleting your account will permanently remove all your chatflows, API keys, and workspace data. This action cannot be undone.
                        </p>
                    </div>
                    <Button 
                        variant="outline" 
                        className="bg-transparent border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white font-bold text-xs h-10 px-6 uppercase tracking-widest transition-all rounded-full"
                        onClick={() => setConfirming(true)}
                    >
                        Delete Account
                    </Button>
                </div>
            </div>

            {confirming && (
                <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={() => setConfirming(false)} />
                    <div className="relative w-full max-w-md bg-[#0b0f14] border border-red-500/30 rounded-none p-8 shadow-2xl duration-200">
                        <h4 className="text-xl font-black text-white mb-4 tracking-tight">Are you absolutely certain?</h4>
                        <p className="text-sm text-zinc-500 leading-relaxed mb-8">
                            This will completely wipe your account from the CrewBlocks universe. To proceed, please type your email below to confirm.
                        </p>
                        <Input placeholder="Enter your email" className="bg-black/40 border-white/10 mb-6 h-11 rounded-none" />
                        <div className="flex gap-3">
                            <Button className="flex-1 bg-red-600 hover:bg-red-500 font-bold h-11 uppercase text-xs tracking-widest rounded-full">Confirm Deletion</Button>
                            <Button variant="outline" className="flex-1 bg-transparent border-white/5 font-bold h-11 uppercase text-xs tracking-widest rounded-full" onClick={() => setConfirming(false)}>Cancel</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
