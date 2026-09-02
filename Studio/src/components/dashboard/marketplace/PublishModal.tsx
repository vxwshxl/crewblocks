'use client';

import React, { useState } from 'react';
import { X, Globe, CheckCircle2, ArrowRight, Sparkles, Tag, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORIES } from '@/lib/marketplaceData';

interface PublishModalProps {
  workflow: any | null;
  onClose: () => void;
  onConfirm: (details: PublishDetails) => void;
}

export interface PublishDetails {
  id: string;
  name: string;
  description: string;
  category: string;
  isPremium: boolean;
  price: number;
  icon: string;
}

export default function PublishModal({ workflow, onClose, onConfirm }: PublishModalProps) {
  const [name, setName] = useState(workflow?.name || '');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Marketing');
  const [isPremium, setIsPremium] = useState(false);
  const [price, setPrice] = useState(299);
  const [isPublishing, setIsPublishing] = useState(false);

  React.useEffect(() => {
    if (workflow) {
      setName(workflow.name || '');
    }
  }, [workflow]);

  if (!workflow) return null;

  const handlePublish = () => {
    if (!name.trim() || !description.trim()) return;
    setIsPublishing(true);
    
    // Simulate minor delay
    setTimeout(() => {
      onConfirm({
        id: workflow.id,
        name,
        description,
        category,
        isPremium,
        price: isPremium ? price : 0,
        icon: ''
      });
      setIsPublishing(false);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/95 backdrop-blur-sm duration-200" 
        onClick={!isPublishing ? onClose : undefined} 
      />
      
      {/* Modal Container */}
      <div className="relative w-full max-w-lg bg-card border border-border shadow-2xl rounded-2xl overflow-hidden duration-200">
        
        <div className="p-8">
          <div className="flex justify-between items-start mb-6">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center border border-primary/20">
              <Globe className="w-5 h-5 text-primary" />
            </div>
            {!isPublishing && (
              <button 
                onClick={onClose}
                className="p-2 text-muted-foreground hover:text-white hover:bg-white/5 rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <h3 className="text-xl font-bold tracking-tight text-white mb-2">Publish to Marketplace</h3>
          <p className="text-zinc-500 text-xs mb-8 leading-relaxed">
            Share your masterpiece with the CrewBlocks community. Your workflow will be visible in the public library for others to discover and install.
          </p>

          <div className="space-y-5 mb-8">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold ml-1">Marketplace Name</Label>
                <Input 
                  placeholder="Viral Script Generator" 
                  className="!h-12 bg-black/40 border-white/10 focus:border-primary/50 text-white text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isPublishing}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold ml-1">Category</Label>
                <Select value={category} onValueChange={(val) => val && setCategory(val)} disabled={isPublishing}>
                  <SelectTrigger className="!h-12 w-full bg-black/40 border-white/10 rounded-full text-white text-sm focus:ring-primary/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent side="bottom" sideOffset={12} align="start" className="bg-[#050505] border border-white/10 rounded-[28px] text-white z-[100] p-3 shadow-3xl min-w-[240px] max-h-[220px] overflow-y-auto custom-scrollbar">
                    {CATEGORIES.filter(c => c !== 'All').map(c => (
                      <SelectItem key={c} value={c} className="rounded-xl py-3 px-5 focus:bg-white/10 focus:text-primary transition-all cursor-pointer mb-1 last:mb-0 text-sm font-bold">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold ml-1">Short Description</Label>
              <Textarea 
                placeholder="Briefly explain what this workflow achieves..." 
                className="bg-black/40 border-white/10 rounded-xl focus:border-primary/50 text-white text-sm min-h-[80px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isPublishing}
              />
            </div>

            <div className="flex items-center gap-6 p-4 bg-white/5 rounded-xl border border-white/10">
              <div className="flex-1">
                <h4 className="text-xs font-bold text-white mb-1">Pricing Model</h4>
                <p className="text-[10px] text-zinc-500">Choose if this is a free or premium workflow</p>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsPremium(false)}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${!isPremium ? 'bg-white/10 text-white border-white/20' : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}
                >
                  Free
                </button>
                <button 
                  onClick={() => setIsPremium(true)}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${isPremium ? 'bg-primary/10 text-primary border-primary/30' : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}
                >
                  Premium
                </button>
              </div>
            </div>

            {isPremium && (
              <div className="space-y-2 duration-200">
                <Label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold ml-1">Price (₹)</Label>
                <div className="relative">
                  <Input 
                    type="number"
                    className="h-10 bg-black/40 border-white/10 rounded-xl pl-8 focus:border-primary/50 text-white text-sm"
                    value={price}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    disabled={isPublishing}
                  />
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                </div>
              </div>
            )}
          </div>

          <Button 
            className="w-full h-12 rounded-full font-bold text-sm bg-primary text-primary-foreground hover:bg-[#9d6bff] active:scale-95 transition-all shadow-lg group overflow-hidden"
            onClick={handlePublish}
            disabled={!name.trim() || !description.trim() || isPublishing}
          >
            {isPublishing ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                <span>Publishing...</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span>{isPremium ? `Publish for ₹${price}` : 'Publish Workflow'}</span>
                <Sparkles className="w-4 h-4 group-hover:rotate-12 transition-transform" />
              </div>
            )}
          </Button>

          <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-center gap-2 text-[9px] text-zinc-600 font-bold uppercase tracking-tight">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/80" />
            Verified Captain submission
          </div>
        </div>
      </div>
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
