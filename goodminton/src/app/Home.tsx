'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Bars, Frame, GoogleButton } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { AlertsCard, InstallCard } from '@/components/Pwa'
import { LogResultSheet } from '@/components/LogResultSheet'
import { Sheet } from '@/components/Sheet'
import { fmtDate, fmtTime, money } from '@/lib/format'
import { person } from '@/lib/people'
import { balancesFor } from '@/lib/split'
import { signInWithGoogle } from '@/lib/supabase/client'
import { CURRENCY } from '@/lib/supabase/env'
import type { HomeMatch, LedgerMatch } from '@/lib/types'

export function SignIn({ failed, reason }: { failed?: boolean; reason?: string }) {
  const { flash } = useFeedback()
  const [busy, setBusy] = useState(false)
  return (
    <Frame>
      <div className="screen" style={{ minHeight: 'calc(100dvh - 56px)', justifyContent: 'center', gap: 28 }}>
        <div className="stack" style={{ gap: 10 }}>
          <span className="display" style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1, color: '#0B8A6B' }}>Goodminton</span>
          <span className="h1">Game on.</span>
          <span style={{ fontSize: 15, lineHeight: 1.5, color: '#5B6573' }}>
            Games of 4 or 8, never in between. Share one link, the first in are confirmed, and the rest wait for a second court.
          </span>
        </div>
        {failed && (
          <span className="note" style={{ color: '#E0245E' }}>
            Sign-in didn&apos;t complete. Try again.{reason ? <><br /><span style={{ color: '#8A94A3' }}>Reason: {reason.slice(0, 160)}</span></> : null}
          </span>
        )}
        <GoogleButton busy={busy} onClick={async () => {
          setBusy(true)
          const { error } = await signInWithGoogle('/')
          if (error) { setBusy(false); flash(error.message) }
        }} />
        <span className="note" style={{ textAlign: 'center' }}>
          Your Google name is used, so there&apos;s nothing to type.<br />
          <a href="/privacy" style={{ textDecoration: 'underline' }}>Privacy</a> · <a href="/terms" style={{ textDecoration: 'underline' }}>Terms</a>
        </span>
      </div>
    </Frame>
  )
}

export function Home({ meId, meName, matches, ledger }: { meId: string; meName: string; matches: HomeMatch[]; ledger: LedgerMatch[] }) {
  const me = person(meId, meName)
  const bal = balancesFor(meId, ledger)
  const [choosing, setChoosing] = useState(false)
  const [logging, setLogging] = useState(false)
  return (
    <Frame me={me} tab="home">
      <div className="screen">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div className="stack" style={{ gap: 6 }}>
            <span style={{ fontSize: 14, color: '#5B6573', fontWeight: 600 }}>Hey {me.first}</span>
            <span className="h1">Game on.</span>
          </div>
          <button className="btn" aria-label="New match or log a game" onClick={() => setChoosing(true)} style={{ width: 52, height: 52, borderRadius: 18, fontSize: 28, fontWeight: 600, lineHeight: 1, padding: 0 }}>+</button>
        </div>
        <div className="stack" style={{ gap: 16 }}>
          <span className="eyebrow">Matches</span>
          {matches.map(m => <MatchRow key={m.slug} m={m} />)}
          {!matches.length && (
            <div className="card" style={{ padding: 28, textAlign: 'center', color: '#5B6573', fontSize: 14 }}>
              No matches yet. Tap + to organise one, or open a link from a friend to join theirs.
            </div>
          )}
        </div>
        <BalanceRow total={bal.total} currency={ledger[0]?.currency ?? CURRENCY} />
        <InstallCard />
        <AlertsCard />
      </div>
      <Sheet open={choosing} onClose={() => setChoosing(false)} title="What's up?">
        <Link href="/new" className="card sheet-option" onClick={() => setChoosing(false)}>
          <span className="avatar" style={{ width: 44, height: 44, borderRadius: 14, background: '#0E9F7E', fontSize: 22 }}>+</span>
          <span className="stack" style={{ flex: 1, gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>New match</span>
            <span style={{ fontSize: 13, color: '#5B6573' }}>Plan a game and share the link. Book the court once enough people are in.</span>
          </span>
        </Link>
        <button className="card sheet-option" onClick={() => { setChoosing(false); setLogging(true) }}>
          <span className="avatar" style={{ width: 44, height: 44, borderRadius: 14, background: '#12161C', fontSize: 20 }}>🏸</span>
          <span className="stack" style={{ flex: 1, gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Log a game</span>
            <span style={{ fontSize: 13, color: '#5B6573' }}>Pick the two pairs, tap who won. Goes on the leaderboard.</span>
          </span>
        </button>
      </Sheet>
      <LogResultSheet open={logging} onClose={() => setLogging(false)} />
    </Frame>
  )
}

/** Slim money summary under the matches; hidden when everyone is square. */
function BalanceRow({ total, currency }: { total: number; currency: string }) {
  if (Math.abs(total) < 0.01) return null
  const owed = total > 0
  return (
    <Link href="/balances" className="panel" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 14 }}>
      <span style={{ flex: 1, fontSize: 13, color: '#5B6573' }}>{owed ? 'You are owed' : 'You owe'}</span>
      <span style={{ fontSize: 14, fontWeight: 800, color: owed ? '#0E7F66' : '#E0245E' }}>{money(Math.abs(total), currency)}</span>
      <span style={{ color: '#8A94A3', fontSize: 16 }}>›</span>
    </Link>
  )
}

function MatchRow({ m }: { m: HomeMatch }) {
  const full = m.confirmed_count >= m.size
  const status = m.past ? 'Played' : full ? `Full${m.waitlist_count ? ` · +${m.waitlist_count}` : ''}` : `${m.confirmed_count}/${m.size} in`
  const badge = m.past ? { background: '#F1F3F6', color: '#5B6573', fontWeight: 700 } : full ? { background: '#E5484D', color: '#fff' } : { background: '#0E9F7E', color: '#fff' }
  return (
    <Link href={`/m/${m.slug}`} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, width: '100%' }}>
        <div className="stack" style={{ gap: 5, minWidth: 0 }}>
          <span className="display" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.2 }}>{m.title}</span>
          <span style={{ fontSize: 13, color: '#5B6573' }}>{fmtDate(m.starts_at, m.timezone)}, {fmtTime(m.starts_at, m.timezone)} · {m.venue || 'Venue TBC'}</span>
          {!m.past && (
            <div style={{ display: 'flex', gap: 8 }}>
              {m.status === 'booked'
                ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: '#0E7F66' }}>✓ COURT BOOKED</span>
                : <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: '#8A94A3' }}>PLANNING</span>}
              {m.locked && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: '#D9622B' }}>LOCKED</span>}
            </div>
          )}
        </div>
        <span className="badge" style={badge}>{status}</span>
      </div>
      <Bars n={m.confirmed_count} size={m.size} />
    </Link>
  )
}
