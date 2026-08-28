import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'

/**
 * Link-preview scrapers have short timeouts and carry no session cookie,
 * so refreshing a Supabase session for them is pure latency and can cost
 * us the preview card entirely. Let them straight through.
 */
const PREVIEW_BOTS =
  /(bot|crawler|spider|facebookexternalhit|facebookcatalog|twitterbot|linkedinbot|slackbot|slack-imgproxy|discordbot|whatsapp|telegrambot|applebot|redditbot|pinterest|skypeuripreview|vkshare|iframely|embedly|quora link preview|nuzzel|outbrain|bitlybot|google-inspectiontool|chrome-lighthouse|developers\.google\.com\/\+\/web\/snippet)/i

/** Routes that must keep their auth check even for a bot. */
const PROTECTED = ['/dashboard', '/agent']

export async function middleware(request: NextRequest) {
  const ua = request.headers.get('user-agent') ?? ''
  const path = request.nextUrl.pathname
  const isProtected = PROTECTED.some((route) => path.startsWith(route))

  if (!isProtected && PREVIEW_BOTS.test(ua)) {
    return NextResponse.next()
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - SEO / social endpoints, which must stay fast and cookie-free
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*opengraph-image|.*twitter-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)',
  ],
}
