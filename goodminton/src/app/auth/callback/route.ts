import { NextResponse, type NextRequest } from 'next/server'
import { BLOCKED_REASON, isBlockedEmail } from '@/lib/blocked'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'
  // Only same-site paths, so the link can't bounce people elsewhere.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  let reason = searchParams.get('error_description') ?? 'No sign-in code came back from Google.'
  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && !isBlockedEmail(data.user?.email)) return NextResponse.redirect(`${origin}${safeNext}`)
    if (error) reason = error.message
    else { await supabase.auth.signOut(); reason = BLOCKED_REASON }
  }
  const back = new URL('/', origin)
  back.searchParams.set('error', 'signin')
  back.searchParams.set('reason', reason)
  return NextResponse.redirect(back)
}
