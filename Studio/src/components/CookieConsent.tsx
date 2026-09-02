'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';

/**
 * Cookie consent — functional, not decorative.
 *
 * The choice is written to BOTH a real first-party cookie (`cb_cookie_consent`,
 * one year, so the server or any later request can read it) and a localStorage
 * mirror (so the client can decide instantly without waiting on a round-trip).
 * Once a choice exists the banner never shows again until it is cleared.
 *
 * CrewBlocks ships no third-party trackers today, so "reject" simply records
 * the refusal; `hasConsent()` is exported as the single gate any future
 * non-essential cookie / analytics must pass before it runs.
 */

const KEY = 'cb_cookie_consent';
type Choice = 'accepted' | 'rejected';

function readChoice(): Choice | null {
  if (typeof document === 'undefined') return null;
  // localStorage is the fast path; fall back to the cookie if it was cleared.
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'accepted' || stored === 'rejected') return stored;
  } catch {
    // Private mode etc. — fall through to the cookie.
  }
  const match = document.cookie.match(/(?:^|;\s*)cb_cookie_consent=(accepted|rejected)/);
  return (match?.[1] as Choice | undefined) ?? null;
}

function writeChoice(choice: Choice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Ignore; the cookie below is the source of truth the server can see.
  }
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${KEY}=${choice}; path=/; max-age=${oneYear}; samesite=lax`;
}

/** Has the user accepted non-essential cookies? Safe to call anywhere. */
export function hasConsent(): boolean {
  return readChoice() === 'accepted';
}

/** True only on the client, without a setState-in-effect. Renders `false`
 *  during SSR/hydration so server and client agree, then flips on commit. */
function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export default function CookieConsent() {
  const isClient = useIsClient();
  const [dismissed, setDismissed] = useState(false);

  const choose = (choice: Choice) => {
    writeChoice(choice);
    setDismissed(true);
  };

  // localStorage/cookie are only readable on the client, so gate the read on
  // isClient — that also keeps SSR output (nothing) matching first hydration.
  if (!isClient || dismissed || readChoice() !== null) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie consent"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-2xl rounded-2xl border border-white/10 bg-[#141414] p-4 text-[#F8F6F0] shadow-2xl sm:inset-x-4 sm:bottom-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed">
          We use essential cookies to keep you signed in. With your consent we
          may also use cookies to improve CrewBlocks. See our{' '}
          <Link href="/privacy" className="font-bold text-[#FF6B35] underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => choose('rejected')}
            className="rounded-full border border-white/25 px-4 py-2 text-sm font-bold text-[#F8F6F0] transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF6B35]"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => choose('accepted')}
            className="rounded-full bg-[#FF6B35] px-5 py-2 text-sm font-black text-[#141414] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF6B35]"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
