import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { SITE_URL, SUPABASE_KEY, SUPABASE_URL } from './lib/supabase/env'

// Keeps the Supabase session cookie fresh on every page request.
export async function proxy(request: NextRequest) {
  // Production is reachable on several *.vercel.app addresses; send everyone to the
  // official one so links, sign-in cookies and the installed app all match.
  // Preview deployments keep their own address.
  if (SITE_URL && process.env.VERCEL_ENV === 'production') {
    const official = new URL(SITE_URL)
    const host = request.headers.get('x-forwarded-host') ?? request.nextUrl.host
    if (host !== official.host && host.endsWith('.vercel.app')) {
      const to = new URL(request.nextUrl.pathname + request.nextUrl.search, official)
      return NextResponse.redirect(to, 308)
    }
  }
  let response = NextResponse.next({ request })
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: list => {
        list.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
  // Refreshes an expired session; verifies locally when it's still valid.
  await supabase.auth.getClaims()
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/push|sw.js|offline.html|manifest.webmanifest|icons/|.*opengraph-image|.*\\.(?:svg|png|jpg|ico)$).*)'],
}
