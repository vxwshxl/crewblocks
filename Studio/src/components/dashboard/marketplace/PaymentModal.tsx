'use client';

import React, { useState } from 'react';
import { X, CreditCard, ShieldCheck, Zap, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Workflow } from '@/lib/marketplaceData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PaymentModalProps {
  workflow: Workflow | null;
  onClose: () => void;
  onSuccess: (workflow: Workflow) => void;
}

export default function PaymentModal({ workflow, onClose, onSuccess }: PaymentModalProps) {
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

  const [step, setStep] = useState<'checkout' | 'processing' | 'success'>('checkout');

  if (!workflow) return null;
  const palette = getColors(workflow.name);

  const handlePayment = () => {
    setStep('processing');
    // Simulate payment delay
    setTimeout(() => {
      setStep('success');
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/90 backdrop-blur-sm duration-200" 
        onClick={step !== 'processing' ? onClose : undefined} 
      />
      
      {/* Modal Container */}
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl overflow-hidden shadow-2xl duration-200">
        
        {step === 'checkout' && (
          <div className="p-8">
            <div className="flex justify-between items-start mb-8">
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">Checkout</h3>
                <p className="text-zinc-500 text-xs mt-1">Unlock premium AI workflows instantly</p>
              </div>
              <button 
                onClick={onClose}
                className="p-2 text-muted-foreground hover:text-white hover:bg-white/5 transition-colors rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Product Summary */}
            <div className="flex items-center gap-4 p-4 bg-black/20 rounded-xl border border-white/5 mb-8">
              <div className={`w-12 h-12 rounded-full border-2 border-card ${palette[0]} flex items-center justify-center shrink-0`}>
                <span className="text-xl font-bold text-white uppercase">{workflow.name.substring(0, 1)}</span>
              </div>
              <div className="flex-1">
                <div className="text-white font-semibold text-sm">{workflow.name}</div>
                <div className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">{workflow.category}</div>
              </div>
              <div className="text-zinc-200 font-bold text-base">
                ₹{workflow.price}
              </div>
            </div>

            {/* Form */}
            <div className="space-y-4 mb-8">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold ml-1">Email Address</Label>
                <Input id="email" placeholder="captain@crewblocks.ai" className="h-10 bg-black/40 border-white/10 rounded-xl focus:border-primary/50 text-white text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="card" className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold ml-1">Card Details</Label>
                <div className="relative">
                  <Input id="card" placeholder="0000 0000 0000 0000" className="h-10 bg-black/40 border-white/10 rounded-xl pl-10 focus:border-primary/50 text-white text-sm" />
                  <CreditCard className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                </div>
              </div>
            </div>

            <Button 
              className="w-full h-11 bg-primary hover:bg-[#9d6bff] text-primary-foreground rounded-full font-bold text-sm shadow-lg shadow-primary/10 group"
              onClick={handlePayment}
            >
              Pay ₹{workflow.price}
              <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>

            <div className="mt-8 flex items-center justify-center gap-6 border-t border-white/5 pt-6">
              <div className="flex items-center gap-1.5 text-[9px] text-zinc-600 font-bold uppercase tracking-tight">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80" />
                Secure Payment
              </div>
              <div className="flex items-center gap-1.5 text-[9px] text-zinc-600 font-bold uppercase tracking-tight">
                <Zap className="w-3.5 h-3.5 text-primary/80" />
                Instant Delivery
              </div>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="p-20 flex flex-col items-center justify-center text-center">
            <div className="relative w-12 h-12 mb-6">
              <div className="absolute inset-0 border-2 border-primary/10 rounded-full" />
              <div className="absolute inset-0 border-2 border-primary rounded-full border-t-transparent animate-spin" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">Authorizing</h3>
            <p className="text-zinc-500 text-xs">Securing your purchase...</p>
          </div>
        )}

        {step === 'success' && (
          <div className="p-12 flex flex-col items-center justify-center text-center duration-300">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mb-6 text-emerald-500 border border-emerald-500/20">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Purchase Successful</h3>
            <p className="text-zinc-500 text-sm mb-8 leading-relaxed px-4">The <b>{workflow.name}</b> workflow has been added to your account collection.</p>
            <Button 
              className="w-full h-11 bg-white hover:bg-zinc-200 text-black rounded-full font-bold text-sm"
              onClick={() => {
                onSuccess(workflow);
                onClose();
              }}
            >
              Install Workflow
            </Button>
          </div>
        )}

      </div>
    </div>
  );
}
