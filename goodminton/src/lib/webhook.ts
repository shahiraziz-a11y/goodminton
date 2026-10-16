import { timingSafeEqual } from 'node:crypto'

/** True when the request carries the shared x-push-secret (database → app calls). */
export function authorised(req: Request) {
  const want = process.env.PUSH_WEBHOOK_SECRET ?? ''
  const got = req.headers.get('x-push-secret') ?? ''
  if (!want || got.length !== want.length) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(want))
}
