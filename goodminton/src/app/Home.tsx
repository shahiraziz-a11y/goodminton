'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Bars, Frame, GoogleButton } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { fmtDate, fmtTime, money } from '@/lib/format'
import { person } from '@/lib/people'
import { balancesFor } from '@/lib/split'
import { signInWithGoogle } from '@/lib/supabase/client'
import { CURRENCY } from '@/lib/supabase/env'
import type { HomeMatch, LedgerMatch } from '@/lib/types'

export function SignIn({ failed }: { failed?: boolean }) {
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
        {failed && <span className="note" style={{ color: '#E0245E' }}>Sign-in didn&apos;t complete. Try again.</span>}
        <GoogleButton busy={busy} onClick={async () => {
          setBusy(true)
          const { error } = await signInWithGoogle('/')
          if (error) { setBusy(false); flash(error.message) }
        }} />
        <span className="note" style={{ textAlign: 'center' }}>Your Google name is used, so there&apos;s nothing to type.</span>
      </div>
    </Frame>
  )
}

export function Home({ meId, meName, matches, ledger }: { meId: string; meName: string; matches: HomeMatch[]; ledger: LedgerMatch[] }) {
  const me = person(meId, meName)
  const bal = balancesFor(meId, ledger)
  return (
    <Frame me={me} tab="home">
      <div className="screen">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div className="stack" style={{ gap: 6 }}>
            <span style={{ fontSize: 14, color: '#5B6573', fontWeight: 600 }}>Hey {me.first}</span>
            <span className="h1">Game on.</span>
          </div>
          <Link href="/new" aria-label="New match" style={{ width: 52, height: 52, borderRadius: 18, background: '#0E9F7E', color: '#fff', fontSize: 28, fontWeight: 600, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</Link>
        </div>
        <BalanceCard total={bal.total} currency={ledger[0]?.currency ?? CURRENCY} />
        <div className="stack" style={{ gap: 16 }}>
          <span className="eyebrow">Matches</span>
          {matches.map(m => <MatchRow key={m.slug} m={m} />)}
          {!matches.length && (
            <div className="card" style={{ padding: 28, textAlign: 'center', color: '#5B6573', fontSize: 14 }}>
              No matches yet. Tap + to organise one, or open a link from a friend to join theirs.
            </div>
          )}
        </div>
      </div>
    </Frame>
  )
}

export function BalanceCard({ total, currency }: { total: number; currency: string }) {
  return (
    <Link href="/balances" className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">{total >= 0 ? 'You are owed' : 'You owe'}</span>
        <span className="display" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em' }}>{money(Math.abs(total), currency)}</span>
      </span>
      <span className="panel" style={{ width: 42, height: 42, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0E7F66', fontSize: 20 }}>›</span>
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
          <span style={{ fontSize: 13, color: '#5B6573' }}>{fmtDate(m.starts_at, m.timezone)}, {fmtTime(m.starts_at, m.timezone)} · {m.venue}</span>
          {m.locked && !m.past && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: '#D9622B' }}>LOCKED</span>}
        </div>
        <span className="badge" style={badge}>{status}</span>
      </div>
      <Bars n={m.confirmed_count} size={m.size} />
    </Link>
  )
}
