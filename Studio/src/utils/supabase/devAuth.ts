import type { SupabaseClient, User } from '@supabase/supabase-js'

/**
 * Local-only sign-in bypass.
 *
 * When `NEXT_PUBLIC_DEV_AUTH_BYPASS=1` and we are NOT in a production build,
 * the app behaves as if a fixed dev user is signed in: `auth.getUser()` returns
 * DEV_USER without a network round-trip, and the middleware stops redirecting
 * protected routes to /login.
 *
 * This only fakes *authentication*. Data still comes from Supabase under RLS,
 * so with a placeholder Supabase URL the dashboard renders but lists come back
 * empty. It exists to browse the UI without standing up a Supabase project.
 *
 * The `NODE_ENV !== 'production'` guard means this can never be active in a
 * production build even if the env var leaks into one.
 */
export const DEV_AUTH_BYPASS =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === '1'

export const DEV_USER: User = {
  id: '00000000-0000-0000-0000-000000000000',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'dev@localhost',
  app_metadata: { provider: 'dev', providers: ['dev'] },
  user_metadata: { name: 'Dev Captain', full_name: 'Dev Captain' },
  identities: [],
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
}

/**
 * Overrides `auth.getUser()` on a Supabase client so it resolves to DEV_USER.
 * No-op unless DEV_AUTH_BYPASS is on. Returns the same client for chaining.
 */
export function applyDevAuth<T extends SupabaseClient>(client: T): T {
  if (!DEV_AUTH_BYPASS) return client

  client.auth.getUser = async () => ({
    data: { user: DEV_USER },
    error: null,
  })

  return client
}
