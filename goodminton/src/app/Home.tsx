'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Bars, Frame, GoogleButton } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { EmailToggle } from '@/components/EmailToggle'
import { AlertsCard, InstallCard } from '@/components/Pwa'
import { LogResultSheet } from '@/components/LogResultSheet'
import { Sheet } from '@/components/Sheet'
import { fmtDate, fmtTime, money } from '@/lib/format'
import { person } from '@/lib/people'
import { balancesFor, transfersOf } from '@/lib/split'
import { signInWithGoogle } from '@/lib/supabase/client'
import { CURRENCY } from '@/lib/supabase/env'
import { perCourt, type HomeMatch, type HomeStats, type LedgerMatch, type MyGroup } from '@/lib/types'

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

export function Home({ meId, meName, matches, ledger, stats, myGroups = [] }: { meId: string; meName: string; matches: HomeMatch[]; ledger: LedgerMatch[]; stats: HomeStats | null; myGroups?: MyGroup[] }) {
  const me = person(meId, meName)
  const bal = balancesFor(meId, ledger)
  const [choosing, setChoosing] = useState(false)
  const [logging, setLogging] = useState(false)
  // Which group's matches to show (remembered on this phone); 'all' when you're in several.
  const [gf, setGf] = useState('all')
  useEffect(() => { try { const v = localStorage.getItem('home-group'); if (v && (v === 'all' || myGroups.some(g => g.id === v))) setGf(v) } catch {} }, [myGroups])
  const pickGroup = (v: string) => { setGf(v); try { localStorage.setItem('home-group', v) } catch {} }
  const many = myGroups.length > 1
  const shownMatches = gf === 'all' ? matches : matches.filter(m => m.group_id === gf)
  const groups = groupMatches(shownMatches)
  const bySlug = new Map(ledger.map(l => [l.slug, l]))
  return (
    <Frame me={me} tab="home">
      <div className="screen" style={{ gap: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div className="stack" style={{ gap: 6 }}>
            <span style={{ fontSize: 14, color: '#5B6573', fontWeight: 600 }}>Hey {me.first}</span>
            <span className="h1">Game on.</span>
          </div>
          <button className="btn" aria-label="New match or log a game" onClick={() => setChoosing(true)} style={{ width: 52, height: 52, borderRadius: 18, fontSize: 28, fontWeight: 600, lineHeight: 1, padding: 0 }}>+</button>
        </div>
        {stats && <StatsCard s={stats} />}
        {many && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -18px', padding: '0 18px 2px', scrollbarWidth: 'none' }}>
            {[{ id: 'all', name: 'All groups' }, ...myGroups].map(g => (
              <button key={g.id} className="chip-btn" onClick={() => pickGroup(g.id)}
                style={{ flex: 'none', height: 34, background: gf === g.id ? '#12161C' : '#fff', color: gf === g.id ? '#fff' : '#12161C', boxShadow: gf === g.id ? 'none' : '0 0 0 1px #E6E9EE' }}>{g.name}</button>
            ))}
          </div>
        )}
        {groups.map(g => <Group key={g.kind} g={g} ledger={bySlug} showGroup={many && gf === 'all'} />)}
        {!shownMatches.length && (
          <div className="card" style={{ padding: 28, textAlign: 'center', color: '#5B6573', fontSize: 14 }}>
            {myGroups.length
              ? 'No matches yet. Tap + to organise one.'
              : <>No matches yet. Tap + to organise one, or open a group invite link from a friend. <Link href="/groups" style={{ color: '#0E7F66', fontWeight: 700 }}>Groups</Link></>}
          </div>
        )}
        <BalanceRow total={bal.total} currency={ledger[0]?.currency ?? CURRENCY} />
        <InstallCard />
        <AlertsCard />
        <EmailToggle />
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
      <LogResultSheet open={logging} onClose={() => setLogging(false)} groups={myGroups} defaultGroup={gf !== 'all' ? gf : myGroups[0]?.id} />
    </Frame>
  )
}

type Kind = 'live' | 'upcoming' | 'completed' | 'abandoned'
const GROUPS: { kind: Kind; label: string; color: string; glow?: string; show: number }[] = [
  { kind: 'live', label: 'In progress', color: '#E5484D', glow: '0 0 0 3px rgba(229,72,77,.2)', show: 99 },
  { kind: 'upcoming', label: 'Upcoming', color: '#0E9F7E', show: 99 },
  { kind: 'completed', label: 'Completed', color: '#5B6573', show: 3 },
  { kind: 'abandoned', label: 'Abandoned', color: '#C5CDD8', show: 2 },
]
type GroupData = (typeof GROUPS)[number] & { items: HomeMatch[] }

/** Started without any court ever being marked booked counts as called off. */
function kindOf(m: HomeMatch): Kind {
  if (!m.started) return 'upcoming'
  if (m.status !== 'booked') return 'abandoned'
  return m.past ? 'completed' : 'live'
}

function groupMatches(matches: HomeMatch[]): GroupData[] {
  const t = (m: HomeMatch) => new Date(m.starts_at).getTime()
  return GROUPS.map(g => {
    const items = matches.filter(m => kindOf(m) === g.kind)
    items.sort((a, b) => (g.kind === 'upcoming' || g.kind === 'live' ? t(a) - t(b) : t(b) - t(a)))
    return { ...g, items }
  }).filter(g => g.items.length)
}

function Group({ g, ledger, showGroup }: { g: GroupData; ledger: Map<string, LedgerMatch>; showGroup?: boolean }) {
  const [all, setAll] = useState(false)
  const shown = all ? g.items : g.items.slice(0, g.show)
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, boxShadow: g.glow, flex: 'none' }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' }}>{g.label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#8A94A3' }}>{g.items.length}</span>
      </div>
      {shown.map(m => <MatchRow key={m.slug} m={m} kind={g.kind} money={ledger.get(m.slug)} showGroup={showGroup} />)}
      {g.items.length > shown.length && (
        <button className="link-btn" style={{ alignSelf: 'flex-start', color: '#0E7F66', padding: '0 4px' }} onClick={() => setAll(true)}>
          Show {g.items.length - shown.length} more
        </button>
      )}
    </div>
  )
}

/** Slim money summary under the matches; hidden when everyone is square. */
/** Weeks in a row with a game, and lifetime totals. Hidden until you've played. */
function StatsCard({ s }: { s: HomeStats }) {
  if (!s.matches_played && !s.games_played) return null
  const w = s.week_streak
  const note = !w ? 'Play this week to start a streak'
    : s.played_this_week ? 'Played this week ✓'
    : 'Play this week to keep it going'
  const tile = (big: string | number, label: string) => (
    <div className="stack" style={{ flex: 1, minWidth: 0, gap: 2, padding: '12px 10px', borderRadius: 14, background: 'rgba(255,255,255,.07)' }}>
      <span className="display" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1 }}>{big}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#A9B2BF' }}>{label}</span>
    </div>
  )
  return (
    <div style={{ background: '#0F3D35', color: '#fff', borderRadius: 22, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 30, lineHeight: 1, filter: w ? undefined : 'grayscale(1)', opacity: w ? 1 : 0.5 }} aria-hidden>🔥</span>
        <span className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <span className="display" style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.02em' }}>{w} week{w === 1 ? '' : 's'} in a row</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: s.played_this_week ? '#5FE3BE' : '#BFE9DC' }}>{note}</span>
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {tile(s.matches_played, `match${s.matches_played === 1 ? '' : 'es'} played`)}
        {tile(s.games_played, `game${s.games_played === 1 ? '' : 's'} logged`)}
      </div>
    </div>
  )
}

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

const tagStyle = { fontSize: 10, fontWeight: 800, letterSpacing: '.08em' } as const

function MatchRow({ m, kind, money: led, showGroup }: { m: HomeMatch; kind: Kind; money?: LedgerMatch; showGroup?: boolean }) {
  const full = m.confirmed_count >= m.size
  const venue = m.venue || 'Venue TBC'
  const when = `${fmtDate(m.starts_at, m.timezone)}, ${fmtTime(m.starts_at, m.timezone)}`
  let sub = `${when} · ${venue}`, tag = '', tagColor = '#8A94A3', note: string | null = null
  let status: string, badge: { background: string; color: string }

  const inIt = m.my_role != null
  if (kind === 'live') {
    sub = `Started ${fmtTime(m.starts_at, m.timezone)} · ${venue}`
    tag = m.courts ? m.courts.toUpperCase() : '✓ COURT BOOKED'
    tagColor = '#0E7F66'
    status = 'Live'
    badge = { background: '#E5484D', color: '#fff' }
    note = !inIt ? null : m.games_count ? `${m.games_count} game${m.games_count > 1 ? 's' : ''} logged · tap to log more.` : 'Tap to log results as you play.'
  } else if (kind === 'upcoming') {
    const b = m.booked_courts ?? (m.status === 'booked' ? m.court_count : 0)
    tag = b === 0 ? 'PLANNING' : b >= m.court_count ? (m.court_count > 1 ? '✓ COURTS BOOKED' : '✓ COURT BOOKED') : `✓ ${b} OF ${m.court_count} COURTS BOOKED`
    tagColor = b === 0 ? '#8A94A3' : '#0E7F66'
    status = full ? `Full${m.waitlist_count ? ` · +${m.waitlist_count}` : ''}` : `${m.confirmed_count}/${m.size} in`
    badge = full ? { background: '#E5484D', color: '#fff' } : { background: '#0E9F7E', color: '#fff' }
  } else if (kind === 'completed') {
    if (led) {
      const tr = transfersOf(led.players, led.expenses, led.settlements)
      const settled = tr.out.every(t => t.settled)
      tag = `${money(tr.share, led.currency).toUpperCase()} EACH · ${settled ? 'SETTLED' : 'SETTLING UP'}`
      tagColor = settled ? '#0E7F66' : '#D6336C'
    } else tag = inIt ? 'NO COST' : ''
    status = 'Played'
    badge = { background: '#F1F3F6', color: '#5B6573' }
    if (m.last_winners) note = m.games_count > 1 ? `${m.last_winners} won the last game · ${m.games_count} games logged` : `${m.last_winners} won`
  } else {
    tag = 'NO COST'
    status = 'Called off'
    badge = { background: '#F1F3F6', color: '#8A94A3' }
    const per = perCourt(m.format)
    note = m.confirmed_count < per ? `Only ${m.confirmed_count} of ${m.size} signed up by the deadline` : 'The court was never booked'
  }

  return (
    <Link href={`/m/${m.slug}`} className="card" style={{
      padding: 20, display: 'flex', flexDirection: 'column', gap: 16,
      boxShadow: kind === 'live' ? '0 0 0 2px #0E9F7E' : undefined, opacity: kind === 'abandoned' ? 0.7 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, width: '100%' }}>
        <div className="stack" style={{ gap: 5, minWidth: 0 }}>
          <span className="display" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.2, textDecoration: kind === 'abandoned' ? 'line-through' : 'none' }}>{m.title}</span>
          <span style={{ fontSize: 13, color: '#5B6573' }}>{sub}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {showGroup && m.group_name && <span style={{ ...tagStyle, color: '#12161C' }}>{m.group_name.toUpperCase()}</span>}
            {tag && <span style={{ ...tagStyle, color: tagColor }}>{tag}</span>}
            {kind === 'upcoming' && m.locked && <span style={{ ...tagStyle, color: '#D9622B' }}>LOCKED</span>}
            {kind === 'upcoming' && m.weekly && <span style={{ ...tagStyle, color: '#5B6573' }}>↻ WEEKLY</span>}
            {kind === 'upcoming' && m.my_role === 'waitlist' && <span style={{ ...tagStyle, color: '#D6336C' }}>YOU&apos;RE ON THE WAITLIST</span>}
            {kind === 'upcoming' && !inIt && !m.locked && <span style={{ ...tagStyle, color: full ? '#D6336C' : '#0E7F66' }}>{full ? 'FULL · WAITLIST' : 'OPEN TO JOIN'}</span>}
          </div>
        </div>
        <span className="badge" style={badge}>{status}</span>
      </div>
      {kind === 'upcoming' && <Bars n={m.confirmed_count} size={m.size} />}
      {note && <span style={{ fontSize: 13, color: '#4A5462', lineHeight: 1.4, borderTop: '1px solid rgba(0,0,0,.06)', paddingTop: 12 }}>{note}</span>}
    </Link>
  )
}
