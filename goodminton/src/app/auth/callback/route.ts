import { NextResponse, type NextRequest } from 'next/server'
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
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`)
    reason = error.message
  }
  const back = new URL('/', origin)
  back.searchParams.set('error', 'signin')
  back.searchParams.set('reason', reason)
  return NextResponse.redirect(back)
}
