import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { SUPABASE_URL } from '@/lib/supabase/env'
import { authorised } from '@/lib/webhook'

/**
 * Called by a Supabase Database Webhook for each new row in public.notifications, and every
 * 5 minutes by the database schedule (type FLUSH) to send anything the webhook missed.
 * Sends each alert to every device that person has turned alerts on for.
 */
type Row = { id: string; user_id: string; kind: string; title: string; body: string; url: string; match_id: string | null; sent_at: string | null }


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public', any>

/** Send one alert to every device of its person. Claims it first, so it's never sent twice. */
async function deliver(db: Db, id: string) {
  const { data: claimed } = await db.from('notifications').update({ sent_at: new Date().toISOString() })
    .eq('id', id).is('sent_at', null).select('id, user_id, kind, title, body, url, match_id').maybeSingle()
  const n = claimed as Omit<Row, 'sent_at'> | null
  if (!n) return { skipped: 'already sent' as const }

  const { data: subs, error } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', n.user_id)
  if (error) {
    await db.from('notifications').update({ sent_at: null }).eq('id', n.id) // try again on the next sweep
    throw new Error(error.message)
  }
  const message = JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: `${n.kind}:${n.match_id ?? n.id}` })
  let delivered = 0
  const gone: string[] = []
  await Promise.all((subs ?? []).map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message, { TTL: 60 * 60 * 12, urgency: 'high' })
      delivered++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      // The device unsubscribed or the app was removed: forget it.
      if (status === 404 || status === 410) gone.push(s.id)
      else console.error('push failed', status, (e as Error).message)
    }
  }))
  if (gone.length) await db.from('push_subscriptions').delete().in('id', gone)
  await db.from('notifications').update({ devices: delivered }).eq('id', n.id)
  return { delivered, removed: gone.length }
}

export async function POST(req: Request) {
  if (!authorised(req)) return new Response('Unauthorised', { status: 401 })
  const { VAPID_PRIVATE_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_SUBJECT, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!VAPID_PRIVATE_KEY || !NEXT_PUBLIC_VAPID_PUBLIC_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: 'Push is not configured' }, { status: 500 })
  }
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:hello@goodminton.app', NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const payload = await req.json().catch(() => null) as { type?: string; table?: string; record?: Row } | null
  try {
    // The 5-minute sweep: anything from the last day the webhook didn't send.
    if (payload?.type === 'FLUSH') {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString()
      const { data: rows } = await db.from('notifications').select('id').is('sent_at', null).gt('created_at', since)
        .order('created_at').limit(200)
      const results = []
      for (const r of rows ?? []) results.push(await deliver(db, r.id))
      return Response.json({ swept: results.filter(r => !('skipped' in r)).length })
    }
    // The database webhook: one new alert.
    const n = payload?.record
    if (payload?.type !== 'INSERT' || payload.table !== 'notifications' || !n?.id) return Response.json({ skipped: true })
    return Response.json(await deliver(db, n.id))
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
