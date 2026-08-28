'use client';

import React from 'react';
import PricingsList from '@/components/dashboard/PricingsList';

export default function PricingsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl p-4 sm:p-8">
        <PricingsList />
      </div>
    </div>
  );
}
