import { createClient } from '@supabase/supabase-js'
import { validUnsubscribe } from '@/lib/email'
import { SUPABASE_URL } from '@/lib/supabase/env'

/**
 * "Stop these emails" from any Goodminton email. Opening the link only shows a button
 * (mail scanners open links, and shouldn't unsubscribe anyone); the button, or a mail
 * app's one-click unsubscribe, POSTs here and switches emails off.
 */
function check(req: Request) {
  const url = new URL(req.url)
  const u = url.searchParams.get('u') ?? ''
  const ok = !!process.env.SUPABASE_SERVICE_ROLE_KEY && validUnsubscribe(u, url.searchParams.get('t') ?? '', process.env.PUSH_WEBHOOK_SECRET ?? '')
  return ok ? u : null
}

const invalid = () => page('This link isn\'t valid', 'Open Goodminton and use the Email updates switch on the home screen instead.', 400)

export async function GET(req: Request) {
  if (!check(req)) return invalid()
  return page('Stop Goodminton emails?', 'You\'ll still get app alerts. You can turn emails back on from the home screen.', 200,
    `<form method="post"><button style="margin-top:8px;background:#E0245E;color:#fff;border:0;border-radius:12px;padding:12px 22px;font-weight:800;font-size:15px">Stop emails</button></form>`)
}

export async function POST(req: Request) {
  const u = check(req)
  if (!u) return invalid()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const db = createClient(SUPABASE_URL, key, { auth: { persistSession: false } })
  const { error } = await db.from('profiles').update({ email_updates: false }).eq('id', u)
  if (error) return page('Something went wrong', 'Try again in a minute, or use the switch on the home screen.', 500)
  return page('You won\'t get Goodminton emails', 'App alerts are unaffected. To turn emails back on, use the Email updates switch on the home screen.')
}

function page(title: string, body: string, status = 200, extra = '') {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="margin:0;background:#F7F8FA;font-family:Manrope,Helvetica,Arial,sans-serif;color:#12161C">
<div style="max-width:420px;margin:15vh auto 0;padding:24px;text-align:center">
<div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#0B8A6B">GOODMINTON</div>
<h1 style="font-size:22px;margin:16px 0 8px">${title}</h1><p style="color:#5B6573;line-height:1.5">${body}</p>${extra}
<p><a href="/" style="color:#0E7F66;font-weight:700">Open Goodminton</a></p></div></body>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

