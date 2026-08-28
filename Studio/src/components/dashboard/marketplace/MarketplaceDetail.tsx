'use client';

import React from 'react';
import { X, Star, Download, ShoppingCart, Lock, CheckCircle2, User, Activity } from 'lucide-react';
import { Workflow } from '@/lib/marketplaceData';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { createClient } from '@/utils/supabase/client';
import ConfirmModal from '../ConfirmModal';

interface MarketplaceDetailProps {
  workflow: Workflow | null;
  onClose: () => void;
  onInstall: (workflow: Workflow) => void;
  onDelete: (id: string) => void;
}

export default function MarketplaceDetail({ workflow, onClose, onInstall, onDelete }: MarketplaceDetailProps) {
  const [hasInstalled, setHasInstalled] = React.useState(false);
  const [userRating, setUserRating] = React.useState<number | null>(null);
  const [isHoveringRating, setIsHoveringRating] = React.useState<number | null>(null);
  const [isSubmittingRating, setIsSubmittingRating] = React.useState(false);
  const [liveRating, setLiveRating] = React.useState<number>(0);
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = React.useState(false);
  const supabase = createClient();

  React.useEffect(() => {
    if (workflow) {
      setLiveRating(workflow.rating || 0);
    }
  }, [workflow]);

  React.useEffect(() => {
    if (!workflow) return;
    
    const checkUserInstall = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      // 1. Check if user has this installed in their chatflows
      const { data: chatflows } = await supabase
        .from('chatflows')
        .select('id')
        .eq('user_id', user.id)
        .eq('name', workflow.name)
        .limit(1);

      if (chatflows && chatflows.length > 0) {
        setHasInstalled(true);
        // 2. Check if user already rated it
        if (workflow.id && workflow.id.length > 20) {
           const { data: existingRating } = await supabase
              .from('marketplace_ratings')
              .select('rating')
              .eq('workflow_id', workflow.id)
              .eq('user_id', user.id)
              .single();
           if (existingRating) {
              setUserRating(existingRating.rating);
           }
        }
      } else {
        setHasInstalled(false);
        setUserRating(null);
      }
    };

    checkUserInstall();
  }, [workflow, supabase]);

  const handleRate = async (ratingValue: number) => {
    if (!hasInstalled || !workflow?.id || workflow.id.length <= 20 || isSubmittingRating) return;
    
    setIsSubmittingRating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      if (userRating === ratingValue) {
         // Delete rating if clicking the same one again (unrate)
         await supabase.from('marketplace_ratings').delete().eq('workflow_id', workflow.id).eq('user_id', user.id);
         setUserRating(null);
      } else if (userRating) {
         // Update existing
         await supabase.from('marketplace_ratings').update({ rating: ratingValue }).eq('workflow_id', workflow.id).eq('user_id', user.id);
         setUserRating(ratingValue);
      } else {
         // Insert new
         await supabase.from('marketplace_ratings').insert({ workflow_id: workflow.id, user_id: user.id, rating: ratingValue });
         setUserRating(ratingValue);
      }
      
      // Let the user know it succeeded visually and instantly update average
      const { data: wfData } = await supabase.from('marketplace_workflows').select('rating').eq('id', workflow.id).single();
      if (wfData) {
         setLiveRating(wfData.rating || 0);
      }
    } catch (e) {
      console.error("Failed to submit rating", e);
    } finally {
      setIsSubmittingRating(false);
    }
  };

  const performDelete = async () => {
    if (!workflow || workflow.id.length <= 20) return;
    setIsDeleting(true);
    setShowConfirmDelete(false);
    try {
      await supabase.from('marketplace_workflows').delete().eq('id', workflow.id);
      onDelete(workflow.id);
    } catch (err) {
      console.error("Failed to delete", err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDelete = async () => {
    if (!workflow || workflow.id.length <= 20 || isDeleting) return;
    setShowConfirmDelete(true);
  };

  if (!workflow) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-6">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-md animate-in fade-in duration-300" 
        onClick={onClose} 
      />
      
      {/* Modal Container */}
      <div className="relative w-full max-w-5xl bg-card border border-border rounded-none overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in zoom-in-95 fade-in duration-300 flex flex-col md:flex-row h-full md:h-auto md:max-h-[85vh]">
        
        {/* Close Button Mobile */}
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 z-20 p-2 bg-black/20 text-white transition-all md:hidden"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Info Column (Left) */}
        <div className="w-full md:w-[340px] bg-muted/20 p-8 flex flex-col border-b md:border-b-0 md:border-r border-border/50">
          <div className="w-20 h-20 bg-card rounded-xl flex items-center justify-center text-4xl shadow-inner border border-border mb-8">
            {workflow.icon}
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-2 leading-tight">
            {workflow.name}
          </h2>
          <div className="flex items-center gap-2 mb-8">
            <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider rounded-full border border-primary/20">
              {workflow.category}
            </span>
            {workflow.isPremium && (
              <span className="px-2 py-0.5 bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase tracking-wider rounded-full border border-amber-500/20">
                Premium
              </span>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4 mb-10 border-y border-border/30 py-6">
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">Rating</p>
              <div className="text-xl font-bold text-white flex items-center gap-1.5">
                {Number(liveRating).toFixed(1)} <Star className="w-4 h-4 text-amber-500 fill-current" />
              </div>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">Users</p>
              <div className="text-xl font-bold text-white">
                {workflow.installs > 1000 ? (workflow.installs/1000).toFixed(1) + 'k' : workflow.installs}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 mt-auto">
            <Button 
              className="w-full h-12 rounded-full font-bold bg-primary text-primary-foreground hover:opacity-90 transition-all text-sm shadow-lg shadow-primary/10"
              onClick={() => onInstall(workflow)}
            >
              {workflow.isPremium ? (
                <span className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4" />
                  Buy for ₹{workflow.price}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Install Template
                </span>
              )}
            </Button>
            
            {currentUserId === workflow.userId && workflow.id.length > 20 && (
              <Button 
                variant="destructive"
                className="w-full h-12 rounded-full font-bold transition-all text-sm shadow-lg shadow-red-500/10"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                Remove from Marketplace
              </Button>
            )}
            
            <p className="text-[10px] text-muted-foreground text-center mt-2 px-4 italic">
              Template data will be added to your local library instantly.
            </p>
          </div>
          
          <div className="mt-12 flex flex-col gap-4">
            <div className="flex items-center justify-between group cursor-pointer">
              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Architect</span>
              <span className="text-white text-xs font-semibold transition-colors">{workflow.creator}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Published</span>
              <span className="text-white text-xs font-semibold">{workflow.createdAt || 'March 2024'}</span>
            </div>
          </div>
        </div>

        {/* Content Column (Right) */}
        <div className="flex-1 overflow-y-auto p-10 md:p-12 custom-scrollbar relative bg-card">
           {/* Close Button Desktop */}
           <button 
            onClick={onClose}
            className="hidden md:flex absolute top-10 right-10 p-2 text-muted-foreground transition-all duration-300"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="max-w-3xl">
            <section className="mb-12">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1 h-4 bg-primary rounded-full" />
                <h4 className="text-[10px] font-bold text-white uppercase tracking-widest">Blueprint Overview</h4>
              </div>
              <p className="text-muted-foreground leading-relaxed text-lg font-medium">
                {workflow.longDescription || workflow.description}
              </p>
            </section>

            <section className="mb-12">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-1 h-4 bg-primary rounded-full" />
                <h4 className="text-[10px] font-bold text-white uppercase tracking-widest">Core Capabilities</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {workflow.features.map((feature, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-4 bg-muted/10 border border-border transition-colors">
                    <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span className="text-white text-sm font-medium">{feature}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Interactive Rating Section - Integrated into content for better flow */}
            {hasInstalled && (
              <section className="mb-12 p-8 bg-muted/5 border-2 border-dashed border-border flex flex-col items-center">
                <h4 className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-4">How is this workflow performing?</h4>
                <div className="flex items-center gap-2" onMouseLeave={() => setIsHoveringRating(null)}>
                  {[1, 2, 3, 4, 5].map((starIdx) => {
                    const isFilled = isHoveringRating ? starIdx <= isHoveringRating : (userRating && starIdx <= userRating);
                    return (
                      <button
                        key={starIdx}
                        disabled={isSubmittingRating}
                        onMouseEnter={() => setIsHoveringRating(starIdx)}
                        onClick={() => handleRate(starIdx)}
                        className="p-2 transition-all disabled:opacity-50"
                      >
                        <Star className={cn("w-7 h-7 transition-colors", isFilled ? "fill-amber-500 text-amber-500" : "text-border")} />
                      </button>
                    )
                  })}
                </div>
                {userRating && (
                  <p className="text-primary text-[10px] font-bold uppercase tracking-widest mt-4">Thank you for your feedback!</p>
                )}
              </section>
            )}

            {workflow.exampleOutput && (
              <section className="mb-12">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-1 h-4 bg-primary rounded-full" />
                  <h4 className="text-[10px] font-bold text-white uppercase tracking-widest">System Response Preview</h4>
                </div>
                <div className="bg-black/60 border border-border p-6 font-mono text-sm overflow-hidden relative group">
                  <div className="absolute top-4 right-4 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500/50" />
                    <div className="w-2 h-2 rounded-full bg-amber-500/50" />
                    <div className="w-2 h-2 rounded-full bg-emerald-500/50" />
                  </div>
                  <div className="text-zinc-400 whitespace-pre-wrap leading-relaxed">
                    {workflow.exampleOutput}
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
                </div>
              </section>
            )}

            <div className="pt-8 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
               <div className="flex items-center gap-3">
                 <Activity className="w-4 h-4 text-primary" />
                 Compatible with Gemini Flash 2.0
               </div>
               <span className="opacity-50">v1.2.4</span>
            </div>
          </div>
        </div>
      </div>
      
      <ConfirmModal
        isOpen={showConfirmDelete}
        title="Delete Workflow"
        description="Are you sure you want to permanently delete this workflow from the Marketplace? This cannot be undone."
        confirmText="Remove from Marketplace"
        destructive={true}
        loading={isDeleting}
        onConfirm={performDelete}
        onCancel={() => setShowConfirmDelete(false)}
      />
    </div>
  );
}
