'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, ShoppingCart, CheckCircle2, Package, Globe, Plus } from 'lucide-react';
import gsap from 'gsap';
import { WORKFLOWS, CATEGORIES, Workflow } from '@/lib/marketplaceData';
import MarketplaceCard from './marketplace/MarketplaceCard';
import MarketplaceDetail from './marketplace/MarketplaceDetail';
import PaymentModal from './marketplace/PaymentModal';
import InstallModal from './marketplace/InstallModal';
import PublishModal, { PublishDetails } from './marketplace/PublishModal';
import WorkflowSelector from './marketplace/WorkflowSelector';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createClient } from '@/utils/supabase/client';
import { useRouter } from 'next/navigation';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { emptyStack } from '@/lib/blocks';

export default function MarketplaceList() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortBy, setSortBy] = useState('trending');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSearchFocused || searchQuery) {
      gsap.to(searchContainerRef.current, {
        width: 240,
        duration: 0.4,
        ease: 'power3.out'
      });
    } else {
      gsap.to(searchContainerRef.current, {
        width: 200,
        duration: 0.4,
        ease: 'power3.out'
      });
    }
  }, [isSearchFocused, searchQuery]);

  const [allWorkflows, setAllWorkflows] = useState<Workflow[]>(WORKFLOWS);
  
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [workflowToBuy, setWorkflowToBuy] = useState<Workflow | null>(null);
  const [workflowToInstall, setWorkflowToInstall] = useState<Workflow | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Publishing State
  const [showSelector, setShowSelector] = useState(false);
  const [selectedLocalWorkflow, setSelectedLocalWorkflow] = useState<any | null>(null);

  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    fetchMarketplaceWorkflows();
  }, []);

  const fetchMarketplaceWorkflows = async () => {
    try {
      const { data, error } = await supabase
        .from('marketplace_workflows')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        // Map database records to Workflow interface
        const dynamicWorkflows: Workflow[] = data.map((item: any) => ({
          id: item.id,
          userId: item.user_id,
          name: item.name,
          description: item.description,
          category: item.category,
          icon: item.icon || '🤖',
          rating: item.rating || 0, 
          reviews: item.reviews || 0,
          installs: item.installs || 0,
          creator: item.creator_name,
          createdAt: new Date(item.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
          isPremium: item.is_premium,
          price: item.price,
          features: ["Community Submitted", "Verified Logic"],
          templateData: item.template_data,
          trending: false,
          new: true
        }));

        setAllWorkflows([...WORKFLOWS, ...dynamicWorkflows]);
      }
    } catch (err) {
      console.error("Error fetching dynamic workflows:", err);
      // Fallback to static data if table doesn't exist yet
      setAllWorkflows(WORKFLOWS);
    }
  };

  const filteredWorkflows = useMemo(() => {
    return allWorkflows
      .filter(w => {
        const matchesSearch = w.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                             w.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'All' || w.category === selectedCategory;
        return matchesSearch && matchesCategory;
      })
      .sort((a, b) => {
        if (sortBy === 'trending') return (b.trending ? 1 : 0) - (a.trending ? 1 : 0) || b.rating - a.rating;
        if (sortBy === 'most-installed') return b.installs - a.installs;
        if (sortBy === 'newest') {
          // Sort dynamically added workflows by their authentic creation date, fallback to static "new" tag if none
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : (a.new ? Date.now() : 0);
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : (b.new ? Date.now() : 0);
          return bTime - aTime;
        }
        return 0;
      });
  }, [searchQuery, selectedCategory, sortBy, allWorkflows]);

  const handleInstallClick = (workflow: Workflow) => {
    if (workflow.isPremium) {
      setWorkflowToBuy(workflow);
    } else {
      setWorkflowToInstall(workflow);
    }
  };

  const handleDeleteWorkflow = (id: string) => {
    setAllWorkflows((prev) => prev.filter((w) => w.id !== id));
    if (selectedWorkflow?.id === id) {
      setSelectedWorkflow(null);
    }
  };

  const handleConfirmInstall = async (name: string) => {
    if (!workflowToInstall) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert("Please login to install workflows.");
        return;
      }

      const { error } = await supabase.from('chatflows').insert({
        user_id: user.id,
        name: name,
        data: workflowToInstall.templateData || emptyStack()
      });

      if (error) throw error;

      // Increment installs if it's a dynamic workflow (identified by having a normal Supabase UUID format)
      if (workflowToInstall.id && workflowToInstall.id.length > 20) {
          const newInstalls = (workflowToInstall.installs || 0) + 1;
          await supabase.from('marketplace_workflows')
            .update({ installs: newInstalls })
            .eq('id', workflowToInstall.id);
          
          // Optionally update local state too
          setAllWorkflows(prev => 
            prev.map(w => w.id === workflowToInstall.id ? { ...w, installs: newInstalls } : w)
          );
      }

      setSuccessToast("Done, added to your chatflow");
      setWorkflowToInstall(null);
      setSelectedWorkflow(null);
      
      setTimeout(() => setSuccessToast(null), 4000);
    } catch (err) {
      console.error("Installation failed:", err);
      alert("Installation failed. Please try again.");
    }
  };

  const handlePurchaseSuccess = async (workflow: Workflow) => {
    setWorkflowToBuy(null);
    setWorkflowToInstall(workflow);
  };

  const handleConfirmPublish = async (details: PublishDetails) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { error } = await supabase.from('marketplace_workflows').insert({
            user_id: user.id,
            name: details.name,
            description: details.description,
            category: details.category,
            price: details.price,
            is_premium: details.isPremium,
            icon: details.icon,
            template_data: selectedLocalWorkflow.data,
            creator_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous'
        });

        if (error) throw error;

        setSuccessToast("Workflow published to Marketplace!");
        setSelectedLocalWorkflow(null);
        fetchMarketplaceWorkflows(); // Refresh list
        
        setTimeout(() => setSuccessToast(null), 4000);
    } catch (err) {
        console.error("Publishing failed:", err);
        alert("Failed to publish workflow. Ensure the marketplace table exists.");
    }
  };

  return (
    <div className="flex flex-col h-full text-white">
      {/* Success Toast - Minimalist */}
      {successToast && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-100 bg-emerald-500 text-white px-5 py-2.5 rounded-full shadow-lg flex items-center gap-3 font-semibold text-sm animate-in slide-in-from-top-5 duration-300">
          <CheckCircle2 className="w-4 h-4" />
          {successToast}
        </div>
      )}

      {/* Header */}
      <div className="pt-8 pl-8 pr-8 pb-0">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              <Package className="w-8 h-8 text-primary" />
              Marketplace
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Discover and share workflows created by the community.
            </p>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto overflow-hidden">
            <Button 
                onClick={() => setShowSelector(true)}
                className="hidden md:flex items-center gap-2 bg-secondary text-secondary-foreground hover:bg-[#D8D8D8] transition-all shadow-sm rounded-full h-11 px-5 text-sm font-semibold group"
            >
                <Globe className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                Publish Your Flow
            </Button>
            
            <div ref={searchContainerRef} className="relative flex-none" style={{ width: 200 }}>
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                  type="text"
                  placeholder="Search community..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setIsSearchFocused(false)}
                  className="w-full h-11 pl-10 pr-5 bg-muted/50 border border-border rounded-full text-sm focus:outline-none caret-primary text-white transition-shadow"
              />
            </div>
            
            <Select value={sortBy} onValueChange={(val) => val && setSortBy(val)}>
              <SelectTrigger className="px-5 !h-12 w-40 bg-muted/50 border border-border rounded-full text-white text-sm font-medium hover:bg-muted/70 transition-colors shadow-sm outline-none focus:ring-0">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent 
                align="end"
                side="bottom"
                sideOffset={8}
                alignItemWithTrigger={false}
                className="bg-card border-border text-zinc-300 rounded-[20px] shadow-2xl p-1.5 min-w-[160px] z-50 overflow-hidden"
              >
                <SelectItem value="trending" className="focus:bg-white/10 focus:text-white cursor-pointer rounded-xl text-sm transition-colors py-2.5 px-4 font-medium mb-1 last:mb-0">Trending</SelectItem>
                <SelectItem value="most-installed" className="focus:bg-white/10 focus:text-white cursor-pointer rounded-xl text-sm transition-colors py-2.5 px-4 font-medium mb-1 last:mb-0">Most Installed</SelectItem>
                <SelectItem value="newest" className="focus:bg-white/10 focus:text-white cursor-pointer rounded-xl text-sm transition-colors py-2.5 px-4 font-medium">Newest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>


      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto pt-0 pl-8 pr-8 pb-8 custom-scrollbar">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {filteredWorkflows.map((workflow) => (
            <MarketplaceCard 
              key={workflow.id} 
              workflow={workflow} 
              onViewDetails={setSelectedWorkflow}
              onInstall={handleInstallClick}
            />
          ))}
        </div>
        
        {filteredWorkflows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-4 text-zinc-700 border border-white/5">
              <Search className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-zinc-300">No results found</h3>
            <p className="text-zinc-500 text-xs mt-1">Try broadening your search or choosing another category.</p>
          </div>
        )}
      </div>

      {/* Overlays */}
      <MarketplaceDetail 
        workflow={selectedWorkflow} 
        onClose={() => setSelectedWorkflow(null)}
        onInstall={handleInstallClick}
        onDelete={handleDeleteWorkflow}
      />
      <PaymentModal 
        workflow={workflowToBuy}
        onClose={() => setWorkflowToBuy(null)}
        onSuccess={handlePurchaseSuccess}
      />
      <InstallModal 
        workflow={workflowToInstall}
        onClose={() => setWorkflowToInstall(null)}
        onConfirm={handleConfirmInstall}
      />

      {/* Publishing Overlays */}
      {showSelector && (
          <WorkflowSelector 
            onClose={() => setShowSelector(false)}
            onSelect={(w) => {
                setSelectedLocalWorkflow(w);
                setShowSelector(false);
            }}
          />
      )}
      <PublishModal 
        workflow={selectedLocalWorkflow}
        onClose={() => setSelectedLocalWorkflow(null)}
        onConfirm={handleConfirmPublish}
      />

      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.03);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(59, 130, 246, 0.1); }
      `}</style>
    </div>
  );
}
