'use client'

import { useEffect, useState } from 'react'

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
declare global { interface Window { __installPrompt?: InstallEvent | null } }

/** Registers the service worker and keeps Chrome's install prompt for later. */
export function PwaSetup() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    const keep = (e: Event) => { e.preventDefault(); window.__installPrompt = e as InstallEvent; window.dispatchEvent(new Event('installable')) }
    const done = () => { window.__installPrompt = null; window.dispatchEvent(new Event('installable')) }
    window.addEventListener('beforeinstallprompt', keep)
    window.addEventListener('appinstalled', done)
    return () => { window.removeEventListener('beforeinstallprompt', keep); window.removeEventListener('appinstalled', done) }
  }, [])
  return null
}

const DISMISS_KEY = 'goodminton:install-dismissed'

function store(fn: () => void) { try { fn() } catch { /* private mode */ } }

/** "Add to Home Screen" card: one tap on Android/Chrome, Share-sheet steps on iPhone. */
export function InstallCard() {
  const [mode, setMode] = useState<'prompt' | 'ios' | null>(null)

  useEffect(() => {
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone
    let dismissed = false
    store(() => { dismissed = localStorage.getItem(DISMISS_KEY) === '1' })
    if (standalone || dismissed) return
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const update = () => setMode(window.__installPrompt ? 'prompt' : ios ? 'ios' : null)
    update()
    window.addEventListener('installable', update)
    return () => window.removeEventListener('installable', update)
  }, [])

  if (!mode) return null
  const dismiss = () => { store(() => localStorage.setItem(DISMISS_KEY, '1')); setMode(null) }

  return (
    <div className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={44} height={44} style={{ borderRadius: 12, flex: 'none' }} />
      <span className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Add to Home Screen</span>
        {mode === 'ios' ? (
          <span style={{ fontSize: 12, color: '#5B6573', lineHeight: 1.4 }}>
            Tap <ShareIcon /> Share, then <b style={{ color: '#12161C' }}>Add to Home Screen</b>.
          </span>
        ) : (
          <span style={{ fontSize: 12, color: '#5B6573', lineHeight: 1.4 }}>Open Goodminton in one tap, full screen.</span>
        )}
      </span>
      {mode === 'prompt' && (
        <button className="chip-btn go" onClick={async () => {
          const e = window.__installPrompt
          if (!e) return
          await e.prompt()
          const { outcome } = await e.userChoice
          window.__installPrompt = null
          if (outcome === 'accepted') setMode(null)
        }}>Install</button>
      )}
      <button onClick={dismiss} aria-label="Dismiss" style={{ border: 'none', background: 'none', color: '#8A94A3', fontSize: 20, lineHeight: 1, padding: 4, flex: 'none' }}>×</button>
    </div>
  )
}

const ShareIcon = () => (
  <svg width="12" height="15" viewBox="0 0 12 15" fill="none" stroke="#0E7F66" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }} aria-label="Share">
    <path d="M6 9.5V1M3 3.8 6 1l3 2.8M3.5 6H2.2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H8.5" />
  </svg>
)
