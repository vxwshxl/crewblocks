import 'server-only';
import { Resend } from 'resend';

/**
 * Transactional email via Resend.
 *
 * `RESEND_API_KEY` is server-only — never expose it to the client. When it is
 * missing (local dev without a key) `sendEmail` is a no-op that logs and
 * returns, so nothing that calls it ever throws or blocks the user flow.
 *
 * `EMAIL_FROM` must be an address on a domain verified in your Resend account.
 * `onboarding@resend.dev` is Resend's shared test sender: it works immediately
 * but can only deliver to the email you signed up to Resend with.
 */
const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? 'CrewBlocks <onboarding@resend.dev>';

const resend = apiKey ? new Resend(apiKey) : null;

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailArgs): Promise<{ ok: boolean }> {
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping send to', to);
    return { ok: false };
  }

  const { error } = await resend.emails.send({ from, to, subject, html });

  if (error) {
    console.error('[email] send failed:', error);
    return { ok: false };
  }

  return { ok: true };
}

/** The CrewBlocks welcome email, brand-styled to match the app. */
export function welcomeEmail(name: string): { subject: string; html: string } {
  const first = name?.trim().split(/\s+/)[0] || 'Captain';
  const dashboardUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://crewblocks.com'}/dashboard`;
  return {
    subject: 'Welcome to CrewBlocks 🧱',
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#F8F6F0;padding:40px 0;">
        <div style="max-width:520px;margin:0 auto;background:#141414;border-radius:24px;padding:40px;color:#F8F6F0;">
          <h1 style="margin:0 0 8px;font-size:28px;font-weight:900;letter-spacing:-0.02em;">
            Welcome aboard, ${first}!
          </h1>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#D6D3CC;">
            Your crew is ready. Stack blocks into an agent, then let it work the
            web for you from the CrewBlocks side panel.
          </p>
          <a href="${dashboardUrl}"
             style="display:inline-block;background:#FF6B35;color:#141414;font-weight:800;
                    text-decoration:none;padding:14px 28px;border-radius:9999px;font-size:16px;">
            Build your first agent
          </a>
          <p style="margin:28px 0 0;font-size:13px;color:#8B8880;">
            You're receiving this because you created a CrewBlocks account.
          </p>
        </div>
      </div>
    `,
  };
}
