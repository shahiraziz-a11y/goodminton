'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { AppIcon } from './AppIcon'
import { Avatar } from './Avatar'
import type { Person } from '@/lib/people'

/**
 * Page frame: frosted top bar, content, and the bottom tabs whenever someone is signed in
 * (`me` or `tab` given). `tab` picks the highlighted tab; anything else counts as Matches.
 */
export function Frame({ children, back, me, tab, extra }: {
  children: ReactNode; back?: string; me?: Person | null; tab?: 'home' | 'play' | 'board' | 'balances' | 'groups'
  /** Small things next to the account photo (e.g. Home's streak). */
  extra?: ReactNode
}) {
  const tabs = !!tab || !!me
  return (
    <div className={`app${tabs ? ' has-tabs' : ''}`}>
      <TopBar back={back} me={me} extra={extra} />
      <main>{children}</main>
      {tabs && <TabBar active={tab ?? 'home'} />}
    </div>
  )
}

function TopBar({ back, me, extra }: { back?: string; me?: Person | null; extra?: ReactNode }) {
  const router = useRouter()
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {back && (
            <button className="icon-btn" aria-label="Back" onClick={() => (window.history.length > 1 ? router.back() : router.push(back))}>
              <svg width="9" height="15" viewBox="0 0 11 19" fill="none"><path d="M9.5 1.5 2 9.5l7.5 8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
          <Link href="/" className="wordmark"><AppIcon size={28} />Goodminton</Link>
        </div>
        {extra && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', marginRight: 12 }}>{extra}</div>}
        {me && (
          <form action="/auth/signout" method="post" onSubmit={e => { if (!confirm(`Signed in as ${me.name}. Sign out?`)) e.preventDefault() }}>
            <button type="submit" aria-label="Account" style={{ border: 'none', background: 'none', padding: 0 }}>
              <Avatar p={me} size={32} font={12} />
            </button>
          </form>
        )}
      </div>
    </header>
  )
}

function TabBar({ active }: { active: 'home' | 'play' | 'board' | 'balances' | 'groups' }) {
  // Groups live on Home (+ and the list at the bottom), not in the bar.
  return (
    <nav className="tabbar">
      <Link href="/" className={`tab${active === 'home' ? ' sel' : ''}`}>
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3.5" y="5" width="19" height="17" rx="3.5" /><path d="M3.5 10.5h19M8.5 3v4M17.5 3v4" /></svg>
        Matches
      </Link>
      <Link href="/play" className={`tab${active === 'play' ? ' sel' : ''}`}>
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 15.5 7 6.5a1.5 1.5 0 0 1 1-2.3l5-.7 5 .7a1.5 1.5 0 0 1 1 2.3l-6 9Z" /><path d="M10 5l1.4 9M16 5l-1.4 9" /><circle cx="13" cy="19" r="3.5" /></svg>
        Play
      </Link>
      <Link href="/leaderboard" className={`tab${active === 'board' ? ' sel' : ''}`}>
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4h10v6a5 5 0 0 1-10 0V4Z" /><path d="M8 6H4.5a3.5 3.5 0 0 0 4 4M18 6h3.5a3.5 3.5 0 0 1-4 4M13 15v4M9 22h8" /></svg>
        Leaderboard
      </Link>
      <Link href="/balances" className={`tab${active === 'balances' ? ' sel' : ''}`}>
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="6.5" width="20" height="14" rx="3" /><path d="M3 11h20M7.5 16h4" /></svg>
        Balances
      </Link>
    </nav>
  )
}

export function Bars({ n, size, dark }: { n: number; size: number; dark?: boolean }) {
  if (dark) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: size }, (_, i) => <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i < n ? '#0E5A3A' : 'rgba(255,255,255,.18)' }} />)}
      </div>
    )
  }
  return <div className="bars">{Array.from({ length: size }, (_, i) => <span key={i} className={i < n ? 'on' : ''} />)}</div>
}

export function Seg<T extends string | number | boolean>({ options, value, onChange, height }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; height?: number }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(o => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'sel' : ''} style={height ? { height } : undefined} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function GoogleButton({ onClick, label = 'Continue with Google', busy }: { onClick: () => void; label?: string; busy?: boolean }) {
  return (
    <button className="btn dark" onClick={onClick} disabled={busy} style={{ height: 58, padding: '0 6px', gap: 12, fontWeight: 600, fontSize: 15 }}>
      <span style={{ width: 46, height: 46, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: '#4285F4', fontSize: 20, flex: 'none' }}>G</span>
      <span style={{ flex: 1, textAlign: 'center', marginRight: 52 }}>{label}</span>
    </button>
  )
}

export const LockIcon = () => (
  <svg width="13" height="15" viewBox="0 0 14 16" fill="none"><rect x="1" y="7" width="12" height="8.5" rx="2" fill="currentColor" /><path d="M4 7V4.5a3 3 0 0 1 6 0V7" stroke="currentColor" strokeWidth="1.6" /></svg>
)
