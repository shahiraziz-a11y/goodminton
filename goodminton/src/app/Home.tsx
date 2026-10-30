'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Frame, GoogleButton } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { EmailToggle } from '@/components/EmailToggle'
import { AlertsCard, InstallCard } from '@/components/Pwa'
import { LogResultSheet } from '@/components/LogResultSheet'
import { NoGroup } from '@/components/NoGroup'
import { Sheet } from '@/components/Sheet'
import { BLOCKED_REASON } from '@/lib/blocked'
import { fmtDate, fmtTime, money } from '@/lib/format'
import { person } from '@/lib/people'
import { photoFor } from '@/lib/photos'
import { balancesFor, transfersOf } from '@/lib/split'
import { signInWithGoogle } from '@/lib/supabase/client'
import { CURRENCY } from '@/lib/supabase/env'
import { perCourt, type HomeMatch, type HomeStats, type LedgerMatch, type MyGroup } from '@/lib/types'

export function SignIn({ failed, reason }: { failed?: boolean; reason?: string }) {
  const { flash } = useFeedback()
  const [busy, setBusy] = useState(false)
  return (
    <Frame>
      <div style={{ padding: '4px 12px 16px' }}>
        <div style={{ position: 'relative', minHeight: 'calc(100dvh - 80px)', borderRadius: 36, overflow: 'hidden', background: `#0E4A30 url(${PHOTOS_SIGNIN}) center/cover`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '28px 16px 16px' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.45) 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0) 60%, rgba(0,0,0,.35) 100%)' }} />
          <div className="stack" style={{ position: 'relative', gap: 12, padding: '0 8px', color: '#fff' }}>
            <span className="display" style={{ fontSize: 48, letterSpacing: '-.05em', lineHeight: 0.95 }}>Game on.</span>
            <span style={{ fontSize: 15, lineHeight: 1.45, color: 'rgba(255,255,255,.86)', maxWidth: 290 }}>Games of 4 or 8, never in between.</span>
          </div>
          <div className="stack" style={{ position: 'relative', background: 'rgba(246,245,241,.84)', backdropFilter: 'blur(22px) saturate(140%)', WebkitBackdropFilter: 'blur(22px) saturate(140%)', borderRadius: 30, padding: '24px 20px 20px', gap: 16 }}>
            <span className="display" style={{ fontSize: 28, letterSpacing: '-.035em', lineHeight: 1.1 }}>Share one link. First in play.</span>
            {failed && (
              <span className="note" style={{ color: '#E0245E' }}>
                {reason === BLOCKED_REASON ? reason : <>Sign-in didn&apos;t complete. Try again.{reason ? <><br /><span style={{ color: '#9A9992' }}>Reason: {reason.slice(0, 160)}</span></> : null}</>}
              </span>
            )}
            <GoogleButton busy={busy} onClick={async () => {
              setBusy(true)
              const { error } = await signInWithGoogle('/')
              if (error) { setBusy(false); flash(error.message) }
            }} />
            <span style={{ fontSize: 12, color: '#6B6B66', textAlign: 'center' }}>
              <a href="/privacy" style={{ textDecoration: 'underline' }}>Privacy</a> · <a href="/terms" style={{ textDecoration: 'underline' }}>Terms</a>
            </span>
          </div>
        </div>
      </div>
    </Frame>
  )
}

const PHOTOS_SIGNIN = '/photos/court-1.webp'

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
  // The big "Next up" card: a live match I'm in, else my next one, else the next open one.
  const t = (m: HomeMatch) => new Date(m.starts_at).getTime()
  const soon = shownMatches.filter(m => kindOf(m) === 'live' || kindOf(m) === 'upcoming').sort((x, y) => t(x) - t(y))
  const next = soon.find(m => kindOf(m) === 'live' && m.my_role) ?? soon.find(m => m.my_role) ?? soon[0]
  const groups = groupMatches(shownMatches.filter(m => m !== next))
  const bySlug = new Map(ledger.map(l => [l.slug, l]))
  const fresh = !myGroups.length && !matches.length
  return (
    <Frame me={me} tab="home">
      <div className="screen" style={{ gap: 24, paddingLeft: 20, paddingRight: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
          <div className="stack" style={{ gap: 4 }}>
            <span style={{ fontSize: 15, color: '#55554F', fontWeight: 600 }}>Hey {me.first}</span>
            <span className="display" style={{ fontSize: 44, letterSpacing: '-.05em', lineHeight: 0.96 }}>Game on.</span>
          </div>
          {!fresh && <button className="btn" aria-label="New match or log a game" onClick={() => setChoosing(true)}
            style={{ width: 56, height: 56, borderRadius: '50%', fontSize: 28, fontWeight: 400, lineHeight: 1, padding: 0, flex: 'none', boxShadow: '0 12px 24px -10px rgba(0,0,0,.5)' }}>+</button>}
        </div>
        {fresh && <NoGroup title="Find your crew" line="Matches, results and who owes what, just for the people you play with." />}
        {next && <NextUp m={next} />}
        {stats && <StatsCard s={stats} />}
        {many && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -20px', padding: '0 20px 4px', scrollbarWidth: 'none' }}>
            {[{ id: 'all', name: 'All groups' }, ...myGroups].map(g => (
              <button key={g.id} className="chip-btn" onClick={() => pickGroup(g.id)}
                style={{ flex: 'none', height: 36, padding: '0 16px', fontWeight: 600, fontSize: 13, background: gf === g.id ? '#111111' : 'rgba(255,255,255,.55)', color: gf === g.id ? '#fff' : '#111111' }}>{g.name}</button>
            ))}
          </div>
        )}
        {groups.map(g => <Group key={g.kind} g={g} ledger={bySlug} showGroup={many && gf === 'all'} />)}
        {!fresh && !shownMatches.length && (
          <div className="card stack" style={{ padding: 28, gap: 6, textAlign: 'center', alignItems: 'center' }}>
            <span className="display" style={{ fontSize: 17, fontWeight: 700 }}>No matches yet</span>
            <span className="note">Tap + to organise one.</span>
          </div>
        )}
        {!fresh && <BalanceRow total={bal.total} currency={ledger[0]?.currency ?? CURRENCY} />}
        <InstallCard />
        <AlertsCard />
        <EmailToggle />
      </div>
      <Sheet open={choosing} onClose={() => setChoosing(false)} title="What's up?">
        <Link href="/new" className="card sheet-option" onClick={() => setChoosing(false)}>
          <span className="avatar" style={{ width: 44, height: 44, borderRadius: 14, background: '#0E5A3A', fontSize: 22 }}>+</span>
          <span className="stack" style={{ flex: 1, gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>New match</span>
            <span style={{ fontSize: 13, color: '#6B6B66' }}>Plan a game, share the link.</span>
          </span>
        </Link>
        <button className="card sheet-option" onClick={() => { setChoosing(false); setLogging(true) }}>
          <span className="avatar" style={{ width: 44, height: 44, borderRadius: 14, background: '#111111', fontSize: 20 }}>🏸</span>
          <span className="stack" style={{ flex: 1, gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>Log a game</span>
            <span style={{ fontSize: 13, color: '#6B6B66' }}>Tap who won.</span>
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
  { kind: 'upcoming', label: 'Upcoming', color: '#0E5A3A', show: 99 },
  { kind: 'completed', label: 'Completed', color: '#6B6B66', show: 3 },
  { kind: 'abandoned', label: 'Abandoned', color: '#C9C7BF', show: 2 },
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
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' }}>{g.label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#9A9992' }}>{g.items.length}</span>
      </div>
      <div className="card" style={{ padding: '2px 16px', borderRadius: 26 }}>
        {shown.map(m => <MatchRow key={m.slug} m={m} kind={g.kind} money={ledger.get(m.slug)} showGroup={showGroup} />)}
      </div>
      {g.items.length > shown.length && (
        <button className="link-btn" style={{ alignSelf: 'flex-start', color: '#0E5A3A', padding: '0 4px' }} onClick={() => setAll(true)}>
          Show {g.items.length - shown.length} more
        </button>
      )}
    </div>
  )
}

/** Weeks in a row with a game, the last 8 weeks, and lifetime totals. Hidden until you've played. */
function StatsCard({ s }: { s: HomeStats }) {
  if (!s.matches_played && !s.games_played) return null
  const w = s.week_streak
  const note = !w ? 'Play this week to start a streak'
    : s.played_this_week ? 'Played this week. Keep it going.'
    : 'Play this week to keep it going.'
  const weeks = s.last_weeks ?? []
  const tile = (big: string | number, label: string) => (
    <div className="panel stack" style={{ padding: 12, gap: 2 }}>
      <span className="display" style={{ fontSize: 20 }}>{big}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B66' }}>{label}</span>
    </div>
  )
  return (
    <div className="card stack" style={{ borderRadius: 28, padding: '18px 20px', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="display" style={{ fontSize: 20 }}>{w} week{w === 1 ? '' : 's'} in a row</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#0E5A3A' }}>{note}</span>
        </div>
        <span className="display" style={{ fontSize: 44, letterSpacing: '-.05em', lineHeight: 0.9, color: '#0E5A3A' }}>{w}</span>
      </div>
      {weeks.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }} aria-label="Last 8 weeks">
          {weeks.map((on, i) => {
            const now = i === weeks.length - 1
            return <span key={i} title={now ? 'This week' : `${weeks.length - 1 - i} week${weeks.length - 1 - i === 1 ? '' : 's'} ago`}
              style={{ flex: 1, height: 28, borderRadius: 8, background: on ? (now ? '#0E5A3A' : 'rgba(14,90,58,.55)') : 'rgba(255,255,255,.45)',
                boxShadow: now ? '0 0 0 2px rgba(255,255,255,.9), 0 0 0 4px #0E5A3A' : 'inset 0 0 0 1px rgba(255,255,255,.6)' }} />
          })}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {tile(s.matches_played, `match${s.matches_played === 1 ? '' : 'es'} played`)}
        {tile(s.games_played, `game${s.games_played === 1 ? '' : 's'} logged`)}
      </div>
    </div>
  )
}

/** The next match, big, on its photo. */
function NextUp({ m }: { m: HomeMatch }) {
  const live = kindOf(m) === 'live'
  const days = Math.round((new Date(m.starts_at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
  // What people look for first: when it starts.
  const when = live ? `Started ${fmtTime(m.starts_at, m.timezone)}`
    : `${days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : fmtDate(m.starts_at, m.timezone)} · ${fmtTime(m.starts_at, m.timezone)}`
  const full = m.confirmed_count >= m.size
  const need = m.confirmed_count > m.size ? `Full · +${m.confirmed_count - m.size} extra`
    : full ? `Full.${m.waitlist_count ? ` ${m.waitlist_count} waiting.` : ''}` : `${m.confirmed_count}/${m.size} in · ${m.size - m.confirmed_count} to go`
  const booked = m.booked_courts ?? (m.status === 'booked' ? m.court_count : 0)
  const meta = [
    m.venue || 'Venue TBC',
    m.group_name,
    booked === 0 ? 'Not booked yet' : booked >= m.court_count ? (m.court_count > 1 ? 'Courts booked' : 'Court booked') : `${booked} of ${m.court_count} courts booked`,
    m.locked ? 'Sign-ups closed' : '',
    m.weekly ? '↻ Weekly' : '',
    !live && days > 1 ? `In ${days} days` : '',
  ].filter(Boolean)
  const chip = { fontSize: 12, fontWeight: 700, letterSpacing: '.1em', padding: '8px 12px', borderRadius: 99, background: 'rgba(255,255,255,.18)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.25)' } as const
  return (
    <div className="stack" style={{ gap: 10 }}>
      <Link href={`/m/${m.slug}`} style={{ position: 'relative', height: 380, borderRadius: 36, overflow: 'hidden', background: `#1D2A22 url(${photoFor(m.slug)}) center/cover`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 16, color: '#fff', boxShadow: '0 34px 60px -30px rgba(14,40,26,.65)' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.35) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,.1) 55%, rgba(0,0,0,.55) 100%)' }} />
        <div style={{ position: 'relative', display: 'flex', padding: 4 }}>
          <span style={{ ...chip, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: live ? '#FF5A4E' : '#7BE0A8', boxShadow: '0 0 0 3px rgba(255,255,255,.18)' }} />{live ? 'LIVE NOW' : 'NEXT UP'}
          </span>
        </div>
        <div className="stack" style={{ position: 'relative', borderRadius: 28, padding: 20, gap: 16, background: 'linear-gradient(160deg, rgba(30,34,30,.42), rgba(10,12,10,.55))', backdropFilter: 'blur(22px) saturate(150%)', WebkitBackdropFilter: 'blur(22px) saturate(150%)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.16), inset 0 1px 0 rgba(255,255,255,.22)' }}>
          <div className="stack" style={{ gap: 6 }}>
            <span className="display" style={{ fontSize: 28, letterSpacing: '-.045em', lineHeight: 1 }}>{m.title}</span>
            <span className="display" style={{ fontSize: 22, letterSpacing: '-.03em', lineHeight: 1.1 }}>{when}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, color: 'rgba(255,255,255,.85)' }}>
              {m.my_role === 'waitlist' ? "You're on the waitlist · " : !m.my_role ? 'Open to join · ' : ''}{need}
            </span>
            <span style={{ flex: 'none', height: 42, padding: '0 16px', borderRadius: 99, background: '#fff', color: '#111111', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center' }}>{live && m.my_role ? 'Log results' : 'Open'}</span>
          </div>
        </div>
      </Link>
      <span style={{ fontSize: 12, color: '#6B6B66', lineHeight: 1.45, padding: '0 8px' }}>{meta.join(' · ')}</span>
    </div>
  )
}

function BalanceRow({ total, currency }: { total: number; currency: string }) {
  if (Math.abs(total) < 0.01) return null
  const owed = total > 0
  return (
    <Link href="/balances" className="panel" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 14 }}>
      <span style={{ flex: 1, fontSize: 13, color: '#6B6B66' }}>{owed ? 'You are owed' : 'You owe'}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: owed ? '#0E5A3A' : '#E0245E' }}>{money(Math.abs(total), currency)}</span>
      <span style={{ color: '#9A9992', fontSize: 16 }}>›</span>
    </Link>
  )
}

function MatchRow({ m, kind, money: led, showGroup }: { m: HomeMatch; kind: Kind; money?: LedgerMatch; showGroup?: boolean }) {
  const full = m.confirmed_count >= m.size
  const venue = m.venue || 'Venue TBC'
  // The start time sits right under the name; past matches just show the day.
  let when = kind === 'upcoming' ? `${fmtDate(m.starts_at, m.timezone)} · ${fmtTime(m.starts_at, m.timezone)}` : fmtDate(m.starts_at, m.timezone)
  let sub = venue, tag = '', note: string | null = null
  let status: string, badge: { background: string; color: string }

  const inIt = m.my_role != null
  if (kind === 'live') {
    when = `Started ${fmtTime(m.starts_at, m.timezone)}`
    tag = m.courts ? m.courts : 'Court booked'
    status = 'Live'
    badge = { background: '#111111', color: '#fff' }
    note = !inIt ? null : m.games_count ? `${m.games_count} game${m.games_count > 1 ? 's' : ''} logged · tap to log more.` : 'Tap to log results as you play.'
  } else if (kind === 'upcoming') {
    const b = m.booked_courts ?? (m.status === 'booked' ? m.court_count : 0)
    tag = b === 0 ? 'Not booked yet' : b >= m.court_count ? (m.court_count > 1 ? 'Courts booked' : 'Court booked') : `${b} of ${m.court_count} courts booked`
    status = m.confirmed_count > m.size ? `Full · +${m.confirmed_count - m.size} extra` : full ? `Full${m.waitlist_count ? ` · +${m.waitlist_count}` : ''}` : `${m.confirmed_count}/${m.size} in`
    badge = full ? { background: '#111111', color: '#fff' } : { background: '#0E5A3A', color: '#fff' }
  } else if (kind === 'completed') {
    if (led) {
      const tr = transfersOf(led.players, led.expenses, led.settlements)
      const settled = tr.out.every(t => t.settled)
      tag = `${money(tr.share, led.currency)} each · ${settled ? 'Settled' : 'Settling up'}`
    } else tag = inIt ? 'No cost' : ''
    status = 'Played'
    badge = { background: 'rgba(255,255,255,.6)', color: '#6B6B66' }
    if (m.last_winners) note = m.games_count > 1 ? `${m.last_winners} won the last game · ${m.games_count} games logged` : `${m.last_winners} won`
  } else {
    tag = 'No cost'
    status = 'Called off'
    badge = { background: 'rgba(255,255,255,.6)', color: '#9A9992' }
    const per = perCourt(m.format)
    note = m.confirmed_count < per ? `Only ${m.confirmed_count} of ${m.size} signed up by the deadline` : 'The court was never booked'
  }

  const tags = [
    showGroup && m.group_name ? m.group_name : '',
    tag,
    kind === 'upcoming' && m.locked ? 'Locked' : '',
    kind === 'upcoming' && m.weekly ? '↻ Weekly' : '',
    kind === 'upcoming' && m.my_role === 'waitlist' ? "You're on the waitlist" : '',
    kind === 'upcoming' && !inIt && !m.locked ? (full ? 'Full · waitlist' : 'Open to join') : '',
  ].filter(Boolean)
  return (
    <Link href={`/m/${m.slug}`} className="row-line" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 0', opacity: kind === 'abandoned' ? 0.6 : 1 }}>
      <div className="stack" style={{ gap: 3, flex: 1, minWidth: 0 }}>
        <span className="display" style={{ fontSize: 16, lineHeight: 1.15, textDecoration: kind === 'abandoned' ? 'line-through' : 'none' }}>{m.title}</span>
        <span className="display" style={{ fontSize: 15, color: kind === 'upcoming' || kind === 'live' ? '#111111' : '#6B6B66' }}>{when}</span>
        <span style={{ fontSize: 12, color: '#9A9992', lineHeight: 1.4, marginTop: 2 }}>
          {[sub, ...tags].join(' · ')}
        </span>
        {note && <span style={{ fontSize: 12, color: '#55554F', lineHeight: 1.4 }}>{note}</span>}
      </div>
      <span className="badge" style={{ ...badge, fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{status}</span>
      <span style={{ color: '#9A9992', fontSize: 20, flex: 'none' }}>›</span>
    </Link>
  )
}
