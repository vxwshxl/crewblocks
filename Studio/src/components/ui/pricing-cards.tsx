'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface PricingPlan {
  title: string;
  price: string;
  description: string;
  features: string[];
  highlight?: string;
  isPro?: boolean;
}

interface PricingCardProps {
  plan: PricingPlan;
}

export default function PricingCard({ plan }: PricingCardProps) {
  const glowClass = plan.highlight === 'Most popular'
    ? 'ring-2 ring-amber-400/70 shadow-[0_0_28px_rgba(250,204,21,0.6)] hover:shadow-[0_0_40px_rgba(250,204,21,0.8)]'
    : plan.title === 'Free'
    ? 'ring-1 ring-green-400/60 shadow-[0_0_12px_rgba(74,222,128,0.35)] hover:shadow-[0_0_20px_rgba(74,222,128,0.55)]'
    : plan.title === 'Starter'
    ? 'ring-1 ring-cyan-400/65 shadow-[0_0_14px_rgba(34,211,238,0.35)] hover:shadow-[0_0_24px_rgba(34,211,238,0.55)]'
    : plan.title === 'Scale'
    ? 'ring-1 ring-violet-400/65 shadow-[0_0_16px_rgba(129,140,248,0.35)] hover:shadow-[0_0_26px_rgba(129,140,248,0.55)]'
    : plan.title === 'Custom'
    ? 'ring-1 ring-fuchsia-400/65 shadow-[0_0_16px_rgba(236,72,153,0.35)] hover:shadow-[0_0_26px_rgba(236,72,153,0.55)]'
    : plan.isPro
    ? 'ring-2 ring-blue-400/60 shadow-[0_0_20px_rgba(59,130,246,0.45)] hover:shadow-[0_0_30px_rgba(59,130,246,0.65)]'
    : plan.title.toLowerCase().includes('squad')
    ? 'ring-1 ring-purple-400/35 shadow-[0_0_12px_rgba(139,92,246,0.3)] hover:shadow-[0_0_20px_rgba(139,92,246,0.45)]'
    : 'ring-1 ring-white/10 hover:shadow-[0_0_14px_rgba(255,255,255,0.15)]';

  return (
    <div className={`bg-card border border-border rounded-2xl overflow-hidden transition-all duration-200 cursor-default ${glowClass}`}>
      <div className="p-6 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-white">{plan.title}</h3>
            <p className={`text-sm text-muted-foreground mt-1 ${plan.isPro ? 'whitespace-nowrap' : ''}`}>{plan.description}</p>
          </div>
          {plan.highlight && (
            <Badge
              className="px-2 py-1 text-xs font-bold uppercase tracking-wide !bg-amber-500 !text-black"
              variant={plan.highlight === 'Most popular' ? 'secondary' : 'default'}
            >
              {plan.highlight}
            </Badge>
          )}
        </div>

        <div className="mt-4">
          <p className="text-3xl font-extrabold text-white">{plan.price}</p>
        </div>
      </div>

      <div className="p-6 space-y-2 border-b border-border">
        {plan.features.map((feature, idx) => (
          <div key={idx} className="flex items-start gap-2">
            <span className="w-2 h-2 mt-2 rounded-full bg-emerald-400" />
            <span className="text-sm text-muted-foreground">{feature}</span>
          </div>
        ))}
      </div>

      <div className="p-6 border-t border-border">
        <Button size="sm" variant={plan.isPro ? 'secondary' : 'default'}>
          {plan.isPro ? 'Upgrade' : 'Choose'}
        </Button>
      </div>
    </div>
  );
}
