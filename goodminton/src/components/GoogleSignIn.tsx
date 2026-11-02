'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { GoogleButton } from './Chrome'
import { useFeedback } from './Feedback'
import { BLOCKED_REASON, isBlockedEmail } from '@/lib/blocked'
import { createClient, signInWithGoogle } from '@/lib/supabase/client'
import { GOOGLE_CLIENT_ID } from '@/lib/supabase/env'

type Gsi = {
  initialize: (o: Record<string, unknown>) => void
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void
}
declare global { interface Window { google?: { accounts: { id: Gsi } } } }

let script: Promise<void> | null = null
const loadGsi = () => (script ??= new Promise<void>((ok, fail) => {
  const s = document.createElement('script')
  s.src = 'https://accounts.google.com/gsi/client'
  s.async = true
  s.onload = () => ok()
  s.onerror = () => { script = null; fail(new Error('Google sign-in did not load')) }
  document.head.appendChild(s)
}))

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Sign in with Google. With NEXT_PUBLIC_GOOGLE_CLIENT_ID set, Google's own button signs in
 * right here, so Google shows "Goodminton" and this site, not the Supabase address. Without
 * it (or if Google's script fails), the usual redirect sign-in.
 */
export function GoogleSignIn({ next, label }: { next: string; label?: string }) {
  const router = useRouter()
  const { flash } = useFeedback()
  const box = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [fallback, setFallback] = useState(!GOOGLE_CLIENT_ID)

  useEffect(() => {
    if (fallback) return
    let cancelled = false
    ;(async () => {
      try {
        await loadGsi()
        const raw = crypto.randomUUID()
        const nonce = await sha256(raw)
        if (cancelled || !box.current || !window.google) return
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID, nonce, use_fedcm_for_button: true, itp_support: true,
          callback: async ({ credential }: { credential: string }) => {
            setBusy(true)
            const db = createClient()
            const { data, error } = await db.auth.signInWithIdToken({ provider: 'google', token: credential, nonce: raw })
            if (error) { setBusy(false); return flash(error.message) }
            if (isBlockedEmail(data.user?.email)) { await db.auth.signOut(); setBusy(false); return flash(BLOCKED_REASON) }
            router.replace(next)
            router.refresh()
          },
        })
        window.google.accounts.id.renderButton(box.current, {
          type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with',
          logo_alignment: 'left', width: Math.min(400, box.current.clientWidth || 320),
        })
      } catch {
        if (!cancelled) setFallback(true)
      }
    })()
    return () => { cancelled = true }
  }, [fallback, next, flash, router])

  if (fallback) {
    return (
      <GoogleButton busy={busy} label={label} onClick={async () => {
        setBusy(true)
        const { error } = await signInWithGoogle(next)
        if (error) { setBusy(false); flash(error.message) }
      }} />
    )
  }
  return (
    <div style={{ minHeight: 44, display: 'flex', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
      <div ref={box} style={{ width: '100%', display: 'flex', justifyContent: 'center' }} aria-label={label ?? 'Continue with Google'} />
    </div>
  )
}
