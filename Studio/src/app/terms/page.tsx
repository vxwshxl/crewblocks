import React from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'The terms that govern your use of CrewBlocks, its agent canvas and the BlockAgent browser extension.',
  alternates: { canonical: '/terms' },
  openGraph: { type: 'article', url: '/terms', title: 'Terms of Use', description: 'The terms that govern your use of CrewBlocks, its agent canvas and the BlockAgent browser extension.', images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title: 'Terms of Use', description: 'The terms that govern your use of CrewBlocks, its agent canvas and the BlockAgent browser extension.', images: ['/twitter-image'] },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] font-sans text-[#141414] p-8 lg:p-24">
      <div className="max-w-3xl mx-auto space-y-12">
        <Link href="/signup" className="inline-flex items-center gap-2 text-sm font-bold opacity-60 hover:opacity-100 transition-opacity">
          <ChevronLeft className="w-4 h-4" />
          Back to Signup
        </Link>
        
        <header className="space-y-4">
          <h1 className="text-5xl font-black tracking-tight leading-tight">Terms of Use</h1>
          <p className="text-xl font-medium opacity-70">Last updated: March 11, 2026</p>
        </header>

        <section className="space-y-8 text-lg leading-relaxed opacity-80">
          <div className="space-y-4">
            <h2 className="text-2xl font-bold opacity-100 text-[#141414]">1. Acceptance of Terms</h2>
            <p>
              By accessing and using CrewBlocks, you agree to comply with and be bound by these Terms of Use. If you do not agree to these terms, please do not use our services.
            </p>
          </div>

          <div className="space-y-4">
            <h2 className="text-2xl font-bold opacity-100 text-[#141414]">2. User Accounts</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized use of your account.
            </p>
          </div>

          <div className="space-y-4">
            <h2 className="text-2xl font-bold opacity-100 text-[#141414]">3. AI Agent Usage</h2>
            <p>
              CrewBlocks provides tools to build and deploy AI agents. You are solely responsible for the actions, outputs, and consequences of any agents you create or deploy through our platform.
            </p>
          </div>

          <div className="space-y-4">
            <h2 className="text-2xl font-bold opacity-100 text-[#141414]">4. Prohibited Activities</h2>
            <p>
              You agree not to use CrewBlocks for any illegal or unauthorized purpose, including but not limited to harassment, data scraping without permission, or deploying agents that violate the rights of others.
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
