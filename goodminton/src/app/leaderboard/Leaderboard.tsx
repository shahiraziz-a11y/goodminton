'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { Frame } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { LogResultSheet } from '@/components/LogResultSheet'
import { fmtDate } from '@/lib/format'
import { person, type Person } from '@/lib/people'
import { biggestRivalry, myPartners, pairRecords, pairTable, ratings, standings, START_RATING, type PairRecord } from '@/lib/stats'
import { createClient } from '@/lib/supabase/client'
import type { Leaderboard as Data, MyGroup } from '@/lib/types'

const fmtDay = (d: string) => fmtDate(d + 'T12:00:00Z', 'UTC')
const pctOf = (x: number) => `${Math.round(x * 100)}%`
const MIN_GAMES = 3

function Duo({ a, b, size, edge }: { a: Person; b: Person; size: number; edge: string }) {
  const s = (p: Person) => ({ width: size, height: size, borderRadius: '50%', background: p.color, color: '#fff', fontWeight: 700, fontSize: Math.round(size * 0.34), display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', boxShadow: `0 0 0 2.5px ${edge}` })
  return (
    <span style={{ display: 'flex', flex: 'none' }}>
      <span style={s(a)}>{a.initials}</span>
      <span style={{ ...s(b), marginLeft: -Math.round(size * 0.28) }}>{b.initials}</span>
    </span>
  )
}

export function Leaderboard({ meId, meName, data, groups = [] }: { meId: string; meName: string; data: Data; groups?: MyGroup[] }) {
  const router = useRouter()
  const { flash } = useFeedback()
  const [logging, setLogging] = useState(false)
  const who = (id: string) => person(id, data.people[id] ?? 'Player')
  const duo = (ids: [string, string]) => { const [a, b] = ids.map(who); return { a, b, names: `${a.first} & ${b.first}`, mine: ids.includes(meId) } }
  const nm = (ids: string[]) => ids.map(id => who(id).first).join(' & ')

  // Pairs rank by win rate once they've played 3 games together.
  const table = pairTable(data.games, MIN_GAMES)
  const all = pairRecords(data.games)
  const doubles = data.games.filter(g => g.a.length === 2).length
  const partners = myPartners(data.games, meId)
  const rival = biggestRivalry(data.games)

  const hot = [...all].sort((a, b) => b.streak - a.streak || b.w - a.w)[0]
  const most = [...all].sort((a, b) => (b.w + b.l) - (a.w + a.l) || b.pct - a.pct)[0]
  const last3 = (q: PairRecord) => q.form.slice(0, 3).filter(f => f === 'W').length
  const surge = all.filter(q => q !== hot && q.form.length >= 3 && last3(q) >= 2).sort((a, b) => last3(b) - last3(a) || b.pct - a.pct)[0]
  const cold = table.length >= 4 ? table[table.length - 1] : undefined
  const awards = [
    hot && hot.streak >= 2 && { q: hot, title: 'On fire', big: `${hot.streak} in a row`, sub: 'Longest win streak', bg: '#111111', fg: '#fff', accent: '#FF8A7A', ring: 'none' },
    most && most.w + most.l >= 2 && { q: most, title: 'Ride or die', big: `${most.w + most.l} games`, sub: 'Most games together', bg: '#0E4A30', fg: '#fff', accent: '#9FE0BC', ring: 'none' },
    surge && { q: surge, title: 'Heating up', big: `${last3(surge)} of 3`, sub: 'Wins in last 3', bg: 'rgba(255,255,255,.6)', fg: '#111111', accent: '#0E5A3A', ring: 'inset 0 0 0 1px rgba(255,255,255,.8)' },
    cold && { q: cold, title: 'Due a win', big: `${cold.w} of ${cold.w + cold.l}`, sub: 'Comeback loading…', bg: 'rgba(255,255,255,.6)', fg: '#111111', accent: '#D9622B', ring: 'inset 0 0 0 1px rgba(255,255,255,.8)' },
  ].filter(Boolean) as { q: PairRecord; title: string; big: string; sub: string; bg: string; fg: string; accent: string; ring: string }[]

  // Players: ranked by rating (beating strong pairs counts more), with their best partner.
  const rating = ratings(data.games)
  const players = standings(data.games)
    .map(s => ({ ...s, rating: rating[s.id] ?? START_RATING, best: myPartners(data.games, s.id)[0] }))
    .sort((a, b) => b.rating - a.rating || b.w - a.w)
    .map((s, i) => ({ ...s, rank: i + 1, p: who(s.id) }))
  const recent = data.games.slice(0, 8)

  async function remove(id: string) {
    if (!confirm('Remove this result? The leaderboard will update.')) return
    const { error } = await createClient().rpc('delete_game', { p_game: id })
    if (error) return flash(error.message)
    flash('Result removed')
    router.refresh()
  }

  const logBtn = (dark: boolean) => (
    <button className="chip-btn" onClick={() => setLogging(true)}
      style={{ height: 40, flex: 'none', border: 'none', background: dark ? '#fff' : '#111111', color: dark ? '#111111' : '#fff', fontWeight: 700 }}>+ Log result</button>
  )

  return (
    <Frame me={person(meId, meName)} tab="board">
      <div className="screen" style={{ gap: 22 }}>
        {!data.games.length ? (
          <>
            <GroupChips groups={groups} current={data.group?.id} dark={false} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
              <span className="h1">Leaderboard</span>
              {logBtn(false)}
            </div>
            <div className="card stack" style={{ padding: 28, gap: 8, textAlign: 'center', alignItems: 'center' }}>
              <span className="display" style={{ fontSize: 17, fontWeight: 700 }}>No games yet</span>
              <span className="note">Log who won after each game and the standings build up here.</span>
            </div>
          </>
        ) : (
          <>
            {/* Dark court-green header. */}
            <div style={{ background: 'linear-gradient(180deg, rgba(14,74,48,.55) 0%, rgba(6,42,26,.92) 100%), #0E4A30 url(/photos/court-1.webp) center/cover', color: '#fff', padding: '18px 18px 22px', display: 'flex', flexDirection: 'column', gap: 18, borderRadius: 32, overflow: 'hidden', position: 'relative', boxShadow: '0 30px 50px -30px rgba(14,40,26,.65)' }}>
              <div style={{ position: 'absolute', left: 18, right: 18, top: 0, bottom: 0, borderLeft: '1.5px solid rgba(255,255,255,.08)', borderRight: '1.5px solid rgba(255,255,255,.08)', pointerEvents: 'none' }} />
              <GroupChips groups={groups} current={data.group?.id} dark />
              <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div className="stack" style={{ gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: '#9FE0BC' }}>
                    {doubles ? `Doubles · ${doubles} game${doubles > 1 ? 's' : ''}` : `${data.games.length} game${data.games.length > 1 ? 's' : ''}`}
                  </span>
                  <span className="display" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1.02, textWrap: 'balance' }}>Who rules the court?</span>
                </div>
                {logBtn(true)}
              </div>
              {!table.length && (
                <span style={{ position: 'relative', fontSize: 13, color: '#CFE3D5', fontWeight: 600, lineHeight: 1.4 }}>
                  Pairs rank after {MIN_GAMES} doubles games together. Keep logging results.
                </span>
              )}
            </div>

            {table.length > 0 && (
              <div className="stack" style={{ gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span className="eyebrow">Pair standings</span>
                  <span style={{ fontSize: 11, color: '#9A9992', fontWeight: 600 }}>{MIN_GAMES}+ games together</span>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  {table.map((q, i) => {
                    const d = duo(q.ids)
                    const rank = i + 1
                    const first = rank === 1
                    const top = rank <= 3
                    const edge = first ? '#0E4A30' : top ? 'rgba(227,238,230,.85)' : 'rgba(255,255,255,.6)'
                    return (
                      <div key={q.ids.join()} style={{ background: edge, color: first ? '#fff' : '#111111', boxShadow: d.mine ? `0 0 0 2px ${first ? '#9FE0BC' : '#0E5A3A'}` : 'inset 0 0 0 1px rgba(255,255,255,.7)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', borderRadius: 20, padding: top ? '14px' : '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="display" style={{ fontSize: top ? 22 : 18, fontWeight: 700, width: 24, flex: 'none', color: first ? '#9FE0BC' : top ? '#0E5A3A' : '#C9C7BF' }}>{rank}</span>
                        <Duo a={d.a} b={d.b} size={top ? 34 : 30} edge={edge} />
                        <span className="stack" style={{ gap: 3, flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <span style={{ fontSize: 14, fontWeight: d.mine || top ? 800 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.names}{d.mine ? ' · You' : ''}</span>
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: first ? '#CFE3D5' : '#6B6B66' }}>
                            {first && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', padding: '3px 7px', borderRadius: 99, background: '#E5484D', color: '#fff', flex: 'none' }}>CHAMPS</span>}
                            {q.w} won · {q.l} lost
                          </span>
                        </span>
                        <span className="display" style={{ fontSize: top ? 16 : 14, fontWeight: 700, flex: 'none', color: first ? '#9FE0BC' : '#111111' }}>{pctOf(q.pct)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {partners.length > 0 && (
              <div style={{ background: '#111111', color: '#fff', borderRadius: 24, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#9FE0BC' }}>Your chemistry</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#A8A79F' }}>win % by partner</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  {partners.slice(0, 3).map((y, i) => {
                    const p = who(y.partner)
                    return (
                      <div key={y.partner} className="stack" style={{ alignItems: 'center', gap: 6, padding: '12px 6px', borderRadius: 16, background: i === 0 ? 'rgba(159,224,188,.14)' : 'rgba(255,255,255,.06)', minWidth: 0 }}>
                        <Avatar p={p} size={36} font={12} />
                        <span className="display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.03em', color: i === 0 ? '#9FE0BC' : '#fff' }}>{pctOf(y.pct)}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#A8A79F', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>w/ {p.first} · {y.w}–{y.l}</span>
                      </div>
                    )
                  })}
                </div>
                <span style={{ fontSize: 12, color: '#CFE3D5', fontWeight: 600, lineHeight: 1.4 }}>
                  {partners.length > 1
                    ? `You win ${pctOf(partners[0].pct)} with ${who(partners[0].partner).first} vs ${pctOf(partners[partners.length - 1].pct)} with ${who(partners[partners.length - 1].partner).first}. Team up with ${who(partners[0].partner).first} again.`
                    : `You've only paired with ${who(partners[0].partner).first} so far.`}
                </span>
              </div>
            )}

            {rival && (() => {
              const l = duo(rival.l), r = duo(rival.r)
              const lw = Math.round(rival.lw / (rival.lw + rival.rw) * 100)
              return (
                <div className="stack" style={{ gap: 12 }}>
                  <span className="eyebrow">Biggest rivalry</span>
                  <div className="card stack" style={{ padding: 18, gap: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: 10 }}>
                      <div className="stack" style={{ alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
                        <Duo a={l.a} b={l.b} size={36} edge="#fff" />
                        <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{l.names}</span>
                      </div>
                      <div className="stack" style={{ alignItems: 'center', gap: 2 }}>
                        <span className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.04em', lineHeight: 1 }}>{rival.lw}–{rival.rw}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', color: '#9A9992' }}>HEAD TO HEAD</span>
                      </div>
                      <div className="stack" style={{ alignItems: 'flex-end', gap: 8, minWidth: 0, textAlign: 'right' }}>
                        <Duo a={r.a} b={r.b} size={36} edge="#fff" />
                        <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{r.names}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 3 }}>
                      <span style={{ width: `${lw}%`, background: '#0E5A3A', borderRadius: 4 }} />
                      <span style={{ flex: 1, background: '#E5484D', borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 12, color: '#6B6B66', fontWeight: 600 }}>{(rival.lastWinner === 'l' ? l : r).names} won the last one.</span>
                  </div>
                </div>
              )
            })()}

            {awards.length > 0 && (
              <div className="stack" style={{ gap: 12 }}>
                <span className="eyebrow">Awards</span>
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', margin: '0 -18px', padding: '0 18px 4px', scrollbarWidth: 'none' }}>
                  {awards.map(aw => {
                    const d = duo(aw.q.ids)
                    return (
                      <div key={aw.title} className="stack" style={{ flex: 'none', width: 150, borderRadius: 20, padding: 14, background: aw.bg, color: aw.fg, boxShadow: aw.ring, gap: 12 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: aw.accent }}>{aw.title}</span>
                        <Duo a={d.a} b={d.b} size={30} edge={aw.bg} />
                        <span className="stack" style={{ gap: 2 }}>
                          <span className="display" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1 }}>{aw.big}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>{d.names}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.75 }}>{aw.sub}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="stack" style={{ gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="eyebrow">Players</span><span className="eyebrow">Best partner</span></div>
              <div className="card" style={{ padding: '4px 16px' }}>
                {players.map(r => {
                  const me = r.id === meId
                  const bp = r.best && who(r.best.partner)
                  return (
                    <div key={r.id} className="row-line" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
                      <span className="display" style={{ width: 16, fontSize: 12, fontWeight: 700, color: '#9A9992', flex: 'none' }}>{r.rank}</span>
                      <span style={{ display: 'flex', borderRadius: '50%', boxShadow: me ? '0 0 0 2px #fff, 0 0 0 3.5px #0E5A3A' : undefined }}><Avatar p={r.p} size={28} font={10} /></span>
                      <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: me ? 800 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.p.name}{me ? ' · You' : ''}</span>
                        <span style={{ fontSize: 11, color: '#6B6B66', fontWeight: 600 }}>{pctOf(r.pct)} · {r.w}W · {r.l}L · rating {r.rating}</span>
                      </span>
                      {bp && r.best && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                          <Avatar p={bp} size={22} font={9} />
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#0E5A3A' }}>{pctOf(r.best.pct)}</span>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="stack" style={{ gap: 12 }}>
              <span className="eyebrow">Recent games</span>
              <div className="card" style={{ padding: '4px 18px' }}>
                {recent.map(g => {
                  const aWin = g.winner === 'a'
                  return (
                    <div key={g.id} className="row-line stack" style={{ gap: 8, padding: '14px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#9A9992' }}>{fmtDay(g.played_on)} · {g.match_title ?? 'Friendly'}</span>
                        {g.created_by === meId && <button className="link-btn" style={{ fontSize: 11, color: '#9A9992' }} onClick={() => remove(g.id)}>Remove</button>}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: 14, fontWeight: aWin ? 800 : 500, color: aWin ? '#111111' : '#6B6B66' }}>{nm(g.a)}</span>
                        <span className="display panel" style={{ fontWeight: 700, padding: '6px 10px', borderRadius: 10, whiteSpace: 'nowrap', fontSize: 11, textAlign: 'center' }}>
                          {aWin ? 'BEAT' : 'LOST TO'}
                          {g.score_a != null && g.score_b != null && <span style={{ display: 'block', fontSize: 12, marginTop: 2 }}>{g.score_a}–{g.score_b}</span>}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: aWin ? 500 : 800, color: aWin ? '#6B6B66' : '#111111', textAlign: 'right' }}>{nm(g.b)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
      <LogResultSheet open={logging} onClose={() => setLogging(false)} groups={groups} defaultGroup={data.group?.id} />
    </Frame>
  )
}

/** Switch between my groups' leaderboards (only when I'm in more than one). */
function GroupChips({ groups, current, dark }: { groups: MyGroup[]; current?: string; dark: boolean }) {
  if (groups.length < 2) return null
  return (
    <div style={{ position: 'relative', display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -18px', padding: '0 18px 2px', scrollbarWidth: 'none' }}>
      {groups.map(g => {
        const sel = g.id === current
        return (
          <Link key={g.id} href={`/leaderboard?group=${g.id}`} replace className="chip-btn"
            style={{ flex: 'none', height: 32, display: 'flex', alignItems: 'center', fontSize: 12,
              background: sel ? (dark ? '#fff' : '#111111') : (dark ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.55)'),
              color: sel ? (dark ? '#111111' : '#fff') : (dark ? '#fff' : '#111111'),
              boxShadow: sel || dark ? 'none' : '0 0 0 1px #E2E0DA' }}>{g.name}</Link>
        )
      })}
    </div>
  )
}
