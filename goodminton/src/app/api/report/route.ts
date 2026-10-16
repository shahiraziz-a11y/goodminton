import { createClient } from '@supabase/supabase-js'
import { getUser } from '@/lib/supabase/server'
import { SUPABASE_URL } from '@/lib/supabase/env'

/**
 * Errors from people's phones, so they show up without anyone having to report them.
 * Stored in public.app_errors (closed to the app; read it from the Supabase SQL editor).
 */
export async function POST(req: Request) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return new Response(null, { status: 204 })
  const body = await req.json().catch(() => null) as { message?: string; detail?: string; page?: string } | null
  if (!body?.message) return new Response(null, { status: 204 })
  const { user } = await getUser().catch(() => ({ user: null }))
  const cut = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : null)
  const db = createClient(SUPABASE_URL, key, { auth: { persistSession: false } })
  await db.from('app_errors').insert({
    user_id: user?.id ?? null, page: cut(body.page, 300), message: cut(body.message, 500)!,
    detail: cut(body.detail, 4000), user_agent: cut(req.headers.get('user-agent'), 300),
  })
  return new Response(null, { status: 204 })
}
