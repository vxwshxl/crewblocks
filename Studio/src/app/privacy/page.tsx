import React from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How CrewBlocks collects, uses and protects your data, your agent workflows and your API keys.',
  alternates: { canonical: '/privacy' },
  openGraph: { type: 'article', url: '/privacy', title: 'Privacy Policy', description: 'How CrewBlocks collects, uses and protects your data, your agent workflows and your API keys.', images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title: 'Privacy Policy', description: 'How CrewBlocks collects, uses and protects your data, your agent workflows and your API keys.', images: ['/twitter-image'] },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] font-sans text-[#141414] p-8 lg:p-24">
      <div className="max-w-3xl mx-auto space-y-12">
        <Link href="/signup" className="inline-flex items-center gap-2 text-sm font-bold opacity-60 hover:opacity-100 transition-opacity">
          <ChevronLeft className="w-4 h-4" />
          Back to Signup
        </Link>
        
        <header className="space-y-4">
          <h1 className="text-5xl font-black tracking-tight leading-tight">Privacy Policy</h1>
          <p className="text-xl font-medium opacity-70">Last updated: March 11, 2026</p>
        </header>

        <section className="space-y-8 text-lg leading-relaxed opacity-80">
          <div className="space-y-4">
            <h2 className="text-2xl font-bold opacity-100 text-[#141414]">1. Information Collection</h2>
            <p>
              We collect information you provide directly to us, such as when you create an account, build agents, or communicate with us. This includes your name, email address, and any configuration data for your AI crew.
            </p>
          </div>

          <div className="space-y-4">
            <h2 className="text-2xl font-bold opacity-100 text-[#141414]">2. How We Use Data</h2>
            <p>
              We use the collected data to provide, maintain, and improve our services, personalized your experience, and develop new features for autonomous agent coordination.
            </p>
          </div>

          <div className="space-y-4">
            <h2 className="text-3xl font-bold opacity-100 text-[#141414]">3. Data Sharing</h2>
            <p>
              We do not share your personal information with third parties except as required by law or to provide the core functionality of the AI agents you deploy (e.g., interacting with external APIs you authorize).
            </p>
          </div>

          <div className="space-y-4">
            <h2 className="text-2xl font-bold opacity-100 text-[#141414]">4. Security</h2>
            <p>
              We take reasonable measures to protect your information from loss, theft, misuse, and unauthorized access. However, no internet transmission is ever completely secure.
            </p>
          </div>
        </section>

        <footer className="pt-12 border-t border-[#141414]/10">
          <p className="text-sm font-medium opacity-60 text-center">
            Team &copy; 2026 CrewBlocks.
          </p>
        </footer>
      </div>
    </div>
  );
}
