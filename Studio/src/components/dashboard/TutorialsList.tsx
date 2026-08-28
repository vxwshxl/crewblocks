'use client';

import React from 'react';
import { BookOpen, PlayCircle, MousePointer2, ExternalLink, Bot, Workflow, Layers, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function TutorialsList({ onStart }: { onStart?: () => void }) {
    const router = useRouter();

    const handleStartTutorial = () => {
        localStorage.setItem('tutorial_force_start', 'true');
        window.dispatchEvent(new Event('tutorial-start'));
        if (onStart) {
            onStart();
        } else {
            router.push('/dashboard');
        }
    };
    return (
        <div className="p-8 space-y-12 pb-24">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex flex-col gap-2">
                    <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                        <BookOpen className="w-8 h-8 text-primary" /> Tutorials
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        Master the art of building autonomous AI agent workforces.
                    </p>
                </div>
                <button
                    onClick={handleStartTutorial}
                    className="flex items-center gap-2 bg-primary text-primary-foreground h-11 px-5 rounded-full text-sm font-semibold hover:bg-[#A6E63F] transition-all shadow-sm whitespace-nowrap"
                >
                    <Sparkles className="w-4 h-4" /> Start Interactive Tutorial
                </button>
            </div>

            {/* Quick Start Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="group bg-card border border-border rounded-none p-6">
                    <div className="w-12 h-12 rounded-none bg-primary/10 flex items-center justify-center mb-4 pb-0 border border-primary/20">
                        <PlayCircle className="w-6 h-6 text-primary" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Introduction</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        What a block is, how a stack becomes an agent, and why order matters.
                    </p>
                </div>
                <div className="group bg-card border border-border rounded-none p-6">
                    <div className="w-12 h-12 rounded-none bg-blue-500/10 flex items-center justify-center mb-4 pb-0 border border-blue-500/20">
                        <Workflow className="w-6 h-6 text-blue-500" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Your first stack</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        Build a working agent from an empty stack, one block at a time.
                    </p>
                </div>
                <div className="group bg-card border border-border rounded-none p-6">
                    <div className="w-12 h-12 rounded-none bg-green-500/10 flex items-center justify-center mb-4 pb-0 border border-green-500/20">
                        <ExternalLink className="w-6 h-6 text-green-500" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Using Extension</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        Run a finished agent on any page from the browser side panel.
                    </p>
                </div>
            </div>

            {/* Detailed Guides */}
            <div className="space-y-8">
                <h2 className="text-3xl font-bold tracking-tight text-white border-b border-border pb-4">Detailed Core Guides</h2>
                
                <div className="space-y-6">
                    {/* The Dashboard */}
                    <div className="flex flex-col md:flex-row gap-8 items-start">
                        <div className="md:w-2/3 aspect-[16/8] bg-muted border border-border rounded-none overflow-hidden relative group">
                             <img src="/tutorials/1.webp" className="w-full h-full object-cover" alt="Dashboard Guide" />
                             <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                             <span className="absolute bottom-3 right-3 text-[10px] font-mono opacity-90 uppercase tracking-widest text-white bg-black/50 px-2 py-1 backdrop-blur-sm border border-white/10">The Dashboard</span>
                        </div>
                        <div className="flex-1 space-y-4">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <Layers className="w-5 h-5 text-primary" /> 1. Navigating the Dashboard
                            </h3>
                            <ul className="space-y-3 text-muted-foreground list-disc pl-5">
                                <li><strong>Agents:</strong> Where your agents live. Rename, delete, or jump back into a block stack from here.</li>
                                <li><strong>Squads:</strong> Collaborate with others to build and deploy joint AI agent workforces in real-time.</li>
                                <li><strong>Marketplace:</strong> Install a stack someone else published and edit it into your own.</li>
                                <li><strong>API Keys:</strong> Securely manage your Gemini, Groq, or Sarvam keys. These are stored locally in your browser for privacy.</li>
                                {/* <li><strong>Global Styles:</strong> Your platform aesthetics are persistent. Customizing once reflects everywhere.</li> */}
                            </ul>
                        </div>
                    </div>

                    {/* The block editor */}
                    <div className="flex flex-col md:flex-row-reverse gap-8 items-start">
                        <div className="md:w-2/3 aspect-[16/8] bg-muted border border-border rounded-none overflow-hidden relative group">
                             <img src="/tutorials/2.webp" className="w-full h-full object-cover" alt="The block editor" />
                             <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                             <span className="absolute bottom-3 right-3 text-[10px] font-mono opacity-90 uppercase tracking-widest text-white bg-black/50 px-2 py-1 backdrop-blur-sm border border-white/10">The blocks</span>
                        </div>
                        <div className="flex-1 space-y-4">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <MousePointer2 className="w-5 h-5 text-primary" /> 2. Working the block stack
                            </h3>
                            <ul className="space-y-3 text-muted-foreground list-disc pl-5">
                                <li><strong>Add:</strong> Hit &quot;Add block&quot; under the stack, or the small plus between two blocks to slot one in the middle.</li>
                                <li><strong>Order:</strong> Blocks are read top to bottom, so order is the logic. Drag by the handle, or hold Alt and press the arrow keys.</li>
                                <li><strong>Configure:</strong> Click a block to open it. Every setting is inside the block it belongs to — there is no separate panel to hunt for.</li>
                                <li><strong>Try things:</strong> Toggle a block off to see the agent without it. It stays in the stack, just skipped.</li>
                            </ul>
                        </div>
                    </div>

                    {/* Integration */}
                    <div className="flex flex-col md:flex-row gap-8 items-start">
                        <div className="md:w-2/3 aspect-[16/8] bg-muted border border-border rounded-none overflow-hidden relative group">
                             <img src="/tutorials/3.webp" className="w-full h-full object-cover" alt="Integration Guide" />
                             <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                             <span className="absolute bottom-3 right-3 text-[10px] font-mono opacity-90 uppercase tracking-widest text-white bg-black/50 px-2 py-1 backdrop-blur-sm border border-white/10">Integration</span>
                        </div>
                        <div className="flex-1 space-y-4">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <Bot className="w-5 h-5 text-primary" /> 3. Chrome Extension Integration
                            </h3>
                            <p className="text-muted-foreground leading-relaxed">
                                Your stack saves as you build. Open the CrewBlocks side panel on any page, pick your agent from the list, and it goes to work on whatever you are looking at.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
