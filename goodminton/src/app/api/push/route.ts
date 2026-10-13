import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import webpush from 'web-push'
import { SUPABASE_URL } from '@/lib/supabase/env'

/**
 * Called by a Supabase Database Webhook for each new row in public.notifications.
 * Sends the alert to every device that person has turned alerts on for.
 */
type Row = { id: string; user_id: string; kind: string; title: string; body: string; url: string; match_id: string | null; sent_at: string | null }

function authorised(req: Request) {
  const want = process.env.PUSH_WEBHOOK_SECRET ?? ''
  const got = req.headers.get('x-push-secret') ?? ''
  if (!want || got.length !== want.length) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(want))
}

export async function POST(req: Request) {
  if (!authorised(req)) return new Response('Unauthorised', { status: 401 })
  const { VAPID_PRIVATE_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_SUBJECT, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!VAPID_PRIVATE_KEY || !NEXT_PUBLIC_VAPID_PUBLIC_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: 'Push is not configured' }, { status: 500 })
  }

  const payload = await req.json().catch(() => null) as { type?: string; table?: string; record?: Row } | null
  const n = payload?.record
  if (payload?.type !== 'INSERT' || payload.table !== 'notifications' || !n?.id) return Response.json({ skipped: true })
  if (n.sent_at) return Response.json({ skipped: 'already sent' })

  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:hello@goodminton.app', NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: subs, error } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', n.user_id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

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
  await db.from('notifications').update({ sent_at: new Date().toISOString(), devices: delivered }).eq('id', n.id)
  return Response.json({ delivered, removed: gone.length })
}
