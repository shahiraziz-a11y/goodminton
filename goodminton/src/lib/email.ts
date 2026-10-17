import { createHmac, timingSafeEqual } from 'node:crypto'

/** A ready-to-send email from claim_due_emails(). */
export type DueEmail = { ids: string[]; user_id: string; to: string; name: string; subject: string; body: string; url: string }

/** Signature for one-tap unsubscribe links, so nobody can unsubscribe someone else. */
export function unsubscribeToken(userId: string, secret: string) {
  return createHmac('sha256', secret).update(`unsubscribe:${userId}`).digest('base64url').slice(0, 32)
}

export function validUnsubscribe(userId: string, token: string, secret: string) {
  if (!secret || !/^[0-9a-f-]{36}$/i.test(userId) || typeof token !== 'string') return false
  const want = Buffer.from(unsubscribeToken(userId, secret))
  const got = Buffer.from(token)
  return got.length === want.length && timingSafeEqual(got, want)
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Plain text and a simple HTML version, both with the match link and an unsubscribe link. */
export function renderEmail(e: Pick<DueEmail, 'subject' | 'body' | 'url'>, site: string, unsubscribeUrl: string) {
  const link = site + e.url
  const text = `${e.body}\n\nView the match: ${link}\n\n—\nGoodminton · Stop these emails: ${unsubscribeUrl}`
  const html = `<!doctype html><html><body style="margin:0;background:#F7F8FA;font-family:Manrope,Helvetica,Arial,sans-serif;color:#12161C">
<div style="max-width:480px;margin:0 auto;padding:24px 20px">
<div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#0B8A6B;margin-bottom:16px">GOODMINTON</div>
<div style="background:#fff;border-radius:16px;padding:20px;border:1px solid #E6E9EE">
<div style="font-size:18px;font-weight:800;margin-bottom:12px">${esc(e.subject)}</div>
<div style="font-size:15px;line-height:1.55;color:#4A5462">${e.body.split('\n').map(esc).join('<br>')}</div>
<a href="${esc(link)}" style="display:inline-block;margin-top:18px;background:#0E9F7E;color:#fff;text-decoration:none;font-weight:800;padding:12px 20px;border-radius:12px">View match</a>
</div>
<div style="font-size:12px;color:#8A94A3;margin-top:16px">You get these because you play in Goodminton matches. <a href="${esc(unsubscribeUrl)}" style="color:#8A94A3">Stop these emails</a></div>
</div></body></html>`
  return { text, html }
}
