import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { renderEmail, unsubscribeToken, type DueEmail } from '@/lib/email'
import { SITE_URL, SUPABASE_URL } from '@/lib/supabase/env'
import { authorised } from '@/lib/webhook'

/**
 * Called by the database when emails are due (straight away for new matches and
 * bookings; joins and drop-outs bundled after 5 minutes; a sweep every 5 minutes).
 * Claims what's due, sends it from the organiser's Gmail, and puts failures back.
 */
export async function POST(req: Request) {
  if (!authorised(req)) return new Response('Unauthorised', { status: 401 })
  const { GMAIL_USER, GMAIL_APP_PASSWORD, SUPABASE_SERVICE_ROLE_KEY, PUSH_WEBHOOK_SECRET, EMAIL_SMTP_HOST, EMAIL_SMTP_PORT } = process.env
  // Not set up yet: leave the emails queued (nothing is claimed).
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !SUPABASE_SERVICE_ROLE_KEY || !PUSH_WEBHOOK_SECRET) {
    return Response.json({ error: 'Email is not configured' }, { status: 503 })
  }
  const site = SITE_URL || new URL(req.url).origin
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data, error } = await db.rpc('claim_due_emails')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const due = (data ?? []) as DueEmail[]
  if (!due.length) return Response.json({ sent: 0 })

  // Gmail by default; EMAIL_SMTP_HOST/PORT only for local testing.
  const transport = EMAIL_SMTP_HOST
    ? nodemailer.createTransport({ host: EMAIL_SMTP_HOST, port: Number(EMAIL_SMTP_PORT || 2525), secure: false, ignoreTLS: true })
    : nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } })

  let sent = 0
  const failed: string[] = []
  for (const e of due) {
    const unsubscribe = `${site}/api/unsubscribe?u=${e.user_id}&t=${unsubscribeToken(e.user_id, PUSH_WEBHOOK_SECRET)}`
    const { text, html } = renderEmail(e, site, unsubscribe)
    try {
      await transport.sendMail({
        from: { name: 'Goodminton', address: GMAIL_USER },
        to: { name: e.name, address: e.to },
        subject: e.subject, text, html,
        list: { unsubscribe: { url: unsubscribe, comment: 'Stop Goodminton emails' } },
        headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      })
      sent++
    } catch (err) {
      failed.push(...e.ids)
      console.error('email failed', (err as Error).message)
      await db.rpc('unclaim_emails', { p_ids: e.ids, p_error: (err as Error).message })
    }
  }
  transport.close()
  return Response.json({ sent, failed: failed.length })
}
