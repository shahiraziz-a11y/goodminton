'use client'

import { useEffect, useState } from 'react'
import { useFeedback } from './Feedback'
import { enablePush, pushState, type PushState } from '@/lib/push'

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
            Tap <ShareIcon /> Share, then <b style={{ color: '#12161C' }}>Add to Home Screen</b>. Needed for alerts on iPhone.
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

const ALERTS_DISMISS_KEY = 'goodminton:alerts-dismissed'

/**
 * "Turn on alerts". `compact` is the inline version on a match page, worded for the viewer
 * (e.g. waitlisted: "Get an alert when you move up"). Hidden once alerts are on.
 */
export function AlertsCard({ compact, reason }: { compact?: boolean; reason?: string }) {
  const { flash } = useFeedback()
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let dismissed = false
    if (!compact) store(() => { dismissed = localStorage.getItem(ALERTS_DISMISS_KEY) === '1' })
    if (dismissed) return
    pushState().then(setState, () => setState('unsupported'))
  }, [compact])

  if (!state || state === 'unsupported' || state === 'on') return null
  if (!compact && state !== 'off') return null // Home: the install card covers iPhone; blocked needs settings

  const turnOn = async () => {
    setBusy(true)
    try {
      const s = await enablePush()
      setState(s)
      flash(s === 'on' ? 'Alerts on for this device' : s === 'blocked' ? 'Alerts are blocked in your settings' : 'Alerts not turned on')
    } catch (e) {
      flash((e as Error).message || 'Could not turn on alerts')
    } finally {
      setBusy(false)
    }
  }

  if (compact) {
    return (
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
        <BellIcon />
        <span style={{ flex: 1, fontSize: 13, lineHeight: 1.4, color: '#12161C' }}>
          {state === 'needs-install' ? <>To get alerts on iPhone, add Goodminton to your Home Screen: tap <b>Share</b>, then <b>Add to Home Screen</b>, and open it from there.</>
            : state === 'blocked' ? 'Alerts are blocked for this site. Turn them on in your browser settings.'
            : reason ?? 'Get alerts about this match'}
        </span>
        {state === 'off' && <button className="chip-btn go" disabled={busy} onClick={turnOn}>Turn on</button>}
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ width: 44, height: 44, borderRadius: 12, background: '#E7F6F1', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><BellIcon size={22} /></span>
      <span className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Turn on alerts</span>
        <span style={{ fontSize: 12, color: '#5B6573', lineHeight: 1.4 }}>Know when people join, the court is booked, or you move up the waitlist.</span>
      </span>
      <button className="chip-btn go" disabled={busy} onClick={turnOn}>Turn on</button>
      <button onClick={() => { store(() => localStorage.setItem(ALERTS_DISMISS_KEY, '1')); setState(null) }} aria-label="Dismiss"
        style={{ border: 'none', background: 'none', color: '#8A94A3', fontSize: 20, lineHeight: 1, padding: 4, flex: 'none' }}>×</button>
    </div>
  )
}

const BellIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#0E7F66" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
)
