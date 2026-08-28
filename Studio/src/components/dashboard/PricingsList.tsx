'use client';

import React from 'react';
import PricingCard, { PricingPlan } from '@/components/ui/pricing-cards';

const individualPlans: PricingPlan[] = [
  {
    title: 'Free',
    price: '₹0',
    description: '5 AI credits/month',
    features: ['5 AI credits', '5 agents per month', 'Access to Basic CrewBlocks built Templates', 'Community support'],
  },
  {
    title: 'Starter',
    price: '₹199/mo',
    description: '50 AI credits/month',
    features: ['50 AI credits', '50 agents per month', 'Access to All CrewBlocks built Templates', 'Email support'],
  },
  {
    title: 'Pro',
    price: '₹299/mo',
    description: '200 AI credits/month',
    features: ['200 AI credits', '200 flows per month', 'Priority support', 'Workflow analytics'],
    isPro: true,
    highlight: 'Most popular',
  },
  {
    title: 'Scale',
    price: '₹399/mo',
    description: 'Pro + API access, advanced features',
    features: ['Pro features', 'API access', 'Advanced control rules', 'Team collaboration']
  },
  {
    title: 'Custom',
    price: 'On request',
    description: 'Beyond Scale — reviewed & custom',
    features: ['Enterprise SLAs', 'Custom onboarding', 'Dedicated success manager', 'Custom integrations'],
  },
];

const teamPlans: PricingPlan[] = [
  {
    title: 'Squad Free',
    price: '₹0',
    description: '2 editors, full access',
    features: ['2 editors', 'Full access', 'Shared workflows', 'Audit log basic'],
  },
  {
    title: 'Squad Pro',
    price: '₹799/mo',
    description: 'Up to 10 editors, 7th member view-only',
    features: ['Up to 10 editors', 'Read-only for 7th member', 'Advanced permissions', 'Team templates'],
    isPro: true,
  },
  {
    title: 'Squad Enterprise',
    price: '₹1,499/mo',
    description: 'Unlimited editors, SSO, audit logs',
    features: ['Unlimited editors', 'SSO and audit logs', 'Custom roles', 'Dedicated support'],
    highlight: 'Enterprise',
  },
];

export default function PricingsList() {
  return (
    <div className="p-6 space-y-8">
      <div className="flex flex-col gap-1 mb-4">
        <h1 className="text-2xl font-bold text-white">Pricing Plans</h1>
        <p className="text-muted-foreground">Choose the best plan for your team and scale with confidence.</p>
      </div>

      <section>
        <h2 className="text-xl font-semibold text-white mb-4">Individual Plans</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {individualPlans.map((plan) => (
            <PricingCard key={plan.title} plan={plan} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-4">Team Plans (Squad)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {teamPlans.map((plan) => (
            <PricingCard key={plan.title} plan={plan} />
          ))}
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-lg font-bold text-white mb-2">3 Revenue Streams</h3>
        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
          <li>SaaS Subscriptions: Recurring individual (₹199–₹399/mo) + team (₹799–₹1499/mo)</li>
          <li>Template Marketplace: 5% buyer fee + 10% creator cut</li>
          <li>Permission Upgrades: Custom pricing for power users beyond Scale</li>
        </ul>
      </section>
    </div>
  );
}
