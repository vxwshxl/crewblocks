import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { sendEmail, welcomeEmail } from '@/lib/email';

/**
 * Sends the welcome email to the currently signed-in user. Called by the signup
 * page right after Supabase auto-logs the new account in.
 *
 * The recipient is taken from the SESSION, never from the request body, so this
 * can't be used as an open email relay. Best-effort: a failure here never blocks
 * the user — the client ignores the outcome.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email.split('@')[0];

  const { subject, html } = welcomeEmail(name);
  const { ok } = await sendEmail({ to: user.email, subject, html });

  return NextResponse.json({ ok });
}
