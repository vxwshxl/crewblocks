import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * OAuth / magic-link / password-reset landing.
 *
 * Email+password signup logs the user straight in, so the happy path never
 * comes through here. It exists so a Supabase redirect that carries a `code`
 * (password recovery, or email confirmation if it is ever turned on) can be
 * exchanged for a session and sent on to the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Where to land after a successful exchange; defaults to the dashboard.
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // No code, or the exchange failed — bounce to login rather than a blank page.
  return NextResponse.redirect(`${origin}/login?error=auth_callback`)
}
