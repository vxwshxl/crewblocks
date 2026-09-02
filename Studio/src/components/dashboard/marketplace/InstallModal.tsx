'use client';

import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, Workflow, ArrowRight } from 'lucide-react';
import { Workflow as WorkflowData } from '@/lib/marketplaceData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface InstallModalProps {
  workflow: WorkflowData | null;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export default function InstallModal({ workflow, onClose, onConfirm }: InstallModalProps) {
  const [name, setName] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    if (workflow) {
      setName(workflow.name);
    }
  }, [workflow]);

  if (!workflow) return null;

  const handleInstall = () => {
    if (!name.trim()) return;
    setIsInstalling(true);
    // Simulate slight delay for effect
    setTimeout(() => {
      onConfirm(name.trim());
      setIsInstalling(false);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/90 backdrop-blur-sm duration-200" 
        onClick={!isInstalling ? onClose : undefined} 
      />
      
      {/* Modal Container - Minimal & Consistent */}
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl overflow-hidden shadow-2xl duration-200">
        
        <div className="p-8">
          <div className="flex justify-between items-start mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center border border-primary/20">
              <Workflow className="w-5 h-5 text-primary" />
            </div>
            {!isInstalling && (
              <button 
                onClick={onClose}
                className="p-2 text-muted-foreground hover:text-white hover:bg-white/5 transition-colors rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <h3 className="text-xl font-bold tracking-tight text-white mb-2">Install Workflow</h3>
          <p className="text-zinc-500 text-xs mb-8 leading-relaxed">
            You are creating a new instance of <span className="text-zinc-300 font-bold">{workflow.name}</span>. Give it a personal name in your workspace.
          </p>

          <div className="space-y-6 mb-4">
            <div className="space-y-2">
              <Label htmlFor="workflow-name" className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold ml-1">Workflow Name</Label>
              <Input 
                id="workflow-name" 
                placeholder="e.g. My Marketing Flow" 
                className="h-11 bg-black/40 border-white/10 rounded-xl focus:border-primary/50 text-white text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                disabled={isInstalling}
                onKeyDown={(e) => e.key === 'Enter' && handleInstall()}
              />
            </div>
          </div>

          <Button 
            className="w-full h-11 bg-primary hover:bg-[#9d6bff] text-primary-foreground rounded-full font-bold text-sm shadow-lg shadow-primary/10 group overflow-hidden"
            onClick={handleInstall}
            disabled={!name.trim() || isInstalling}
          >
            {isInstalling ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                <span>Creating flow...</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span>Add to Workspace</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            )}
          </Button>

          <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-center gap-2 text-[9px] text-zinc-600 font-bold uppercase tracking-tight">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/80" />
            Every block arrives configured
          </div>
        </div>
      </div>
    </div>
  );
}
