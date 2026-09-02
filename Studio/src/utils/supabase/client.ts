import { createBrowserClient } from '@supabase/ssr'
import { applyDevAuth } from './devAuth'

export function createClient() {
  return applyDevAuth(
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  )
}
