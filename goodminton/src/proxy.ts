import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { SUPABASE_KEY, SUPABASE_URL } from './lib/supabase/env'

// Keeps the Supabase session cookie fresh on every page request.
export async function proxy(request: NextRequest) {
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
