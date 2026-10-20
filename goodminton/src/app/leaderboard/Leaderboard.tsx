'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { Frame } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { LogResultSheet } from '@/components/LogResultSheet'
import { fmtDate } from '@/lib/format'
import { person, type Person } from '@/lib/people'
import { biggestRivalry, myPartners, pairRecords, pairTable, ratings, standings, START_RATING, winsToPass, type PairRecord } from '@/lib/stats'
import { createClient } from '@/lib/supabase/client'
import type { Leaderboard as Data } from '@/lib/types'

const fmtDay = (d: string) => fmtDate(d + 'T12:00:00Z', 'UTC')
const pctOf = (x: number) => `${Math.round(x * 100)}%`
const MIN_GAMES = 3

function Duo({ a, b, size, edge }: { a: Person; b: Person; size: number; edge: string }) {
  const s = (p: Person) => ({ width: size, height: size, borderRadius: '50%', background: p.color, color: '#fff', fontWeight: 800, fontSize: Math.round(size * 0.34), display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', boxShadow: `0 0 0 2.5px ${edge}` })
  return (
    <span style={{ display: 'flex', flex: 'none' }}>
      <span style={s(a)}>{a.initials}</span>
      <span style={{ ...s(b), marginLeft: -Math.round(size * 0.28) }}>{b.initials}</span>
    </span>
  )
}

export function Leaderboard({ meId, meName, data }: { meId: string; meName: string; data: Data }) {
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
  const podium = [table[1], table[0], table[2]].map((q, i) => q && { q, rank: [2, 1, 3][i] }).filter(Boolean) as { q: PairRecord; rank: number }[]
  const chase = table.slice(3).map((q, k) => {
    const above = table[k + 2]
    const need = winsToPass(q, above.pct)
    return { q, rank: k + 4, tag: need == null ? `Chasing an unbeaten #${k + 3}` : `${q.streak ? 'Won last game · ' : ''}${need} win${need > 1 ? 's' : ''} to pass #${k + 3}`, hot: q.streak > 0 }
  })
  const partners = myPartners(data.games, meId)
  const rival = biggestRivalry(data.games)

  const hot = [...all].sort((a, b) => b.streak - a.streak || b.w - a.w)[0]
  const most = [...all].sort((a, b) => (b.w + b.l) - (a.w + a.l) || b.pct - a.pct)[0]
  const last3 = (q: PairRecord) => q.form.slice(0, 3).filter(f => f === 'W').length
  const surge = all.filter(q => q !== hot && q.form.length >= 3 && last3(q) >= 2).sort((a, b) => last3(b) - last3(a) || b.pct - a.pct)[0]
  const cold = table.length >= 4 ? table[table.length - 1] : undefined
  const awards = [
    hot && hot.streak >= 2 && { q: hot, title: 'On fire', big: `${hot.streak} in a row`, sub: 'Longest win streak', bg: '#E5484D', fg: '#fff', accent: '#FFE1E2', ring: 'none' },
    most && most.w + most.l >= 2 && { q: most, title: 'Ride or die', big: `${most.w + most.l} games`, sub: 'Most games together', bg: '#12161C', fg: '#fff', accent: '#5FE3BE', ring: 'none' },
    surge && { q: surge, title: 'Heating up', big: `${last3(surge)} of 3`, sub: 'Wins in last 3', bg: '#E8F7F2', fg: '#12161C', accent: '#0E7F66', ring: 'none' },
    cold && { q: cold, title: 'Due a win', big: `${cold.w} of ${cold.w + cold.l}`, sub: 'Comeback loading…', bg: '#FFFFFF', fg: '#12161C', accent: '#D9622B', ring: '0 0 0 1px #E6E9EE' },
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
      style={{ height: 40, flex: 'none', border: 'none', background: dark ? '#5FE3BE' : '#0E9F7E', color: dark ? '#0A2622' : '#fff', fontWeight: 800 }}>+ Log result</button>
  )

  return (
    <Frame me={person(meId, meName)} tab="board">
      <div className="screen" style={{ gap: 22 }}>
        {!data.games.length ? (
          <>
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
            {/* The arena: dark court-green header with the podium. */}
            <div style={{ margin: '-8px -18px 0', background: '#0F3D35', color: '#fff', padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 18, borderRadius: '0 0 32px 32px', overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', left: 18, right: 18, top: 0, bottom: 0, borderLeft: '1.5px solid rgba(255,255,255,.08)', borderRight: '1.5px solid rgba(255,255,255,.08)', pointerEvents: 'none' }} />
              <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div className="stack" style={{ gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: '#5FE3BE' }}>
                    {doubles ? `Doubles · ${doubles} game${doubles > 1 ? 's' : ''}` : `${data.games.length} game${data.games.length > 1 ? 's' : ''}`}
                  </span>
                  <span className="display" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.02, textWrap: 'balance' }}>Who rules the court?</span>
                </div>
                {logBtn(true)}
              </div>
              {podium.length ? (
                <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, alignItems: 'end' }}>
                  {[0, 1, 2].map(col => {
                    const pd = podium.find(x => x.rank === [2, 1, 3][col])
                    if (!pd) return <div key={col} />
                    const d = duo(pd.q.ids)
                    const first = pd.rank === 1
                    return (
                      <div key={col} className="stack" style={{ alignItems: 'center', gap: 8, minWidth: 0 }}>
                        {first && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.16em', padding: '4px 8px', borderRadius: 99, background: '#E5484D', color: '#fff' }}>CHAMPS</span>}
                        <Duo a={d.a} b={d.b} size={first ? 46 : 36} edge="#0F3D35" />
                        <span style={{ fontSize: 12, fontWeight: 800, textAlign: 'center', lineHeight: 1.2, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.names}</span>
                        <div className="stack" style={{ width: '100%', height: first ? 118 : pd.rank === 2 ? 88 : 68, borderRadius: 16, background: first ? '#5FE3BE' : 'rgba(255,255,255,.10)', color: first ? '#0A2622' : '#fff', alignItems: 'center', paddingTop: 12, gap: 2 }}>
                          <span className="display" style={{ fontSize: first ? 34 : 24, fontWeight: 800, lineHeight: 1, letterSpacing: '-.04em' }}>{pd.rank}</span>
                          <span style={{ fontSize: 12, fontWeight: 800 }}>{pctOf(pd.q.pct)}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.75 }}>{pd.q.w}–{pd.q.l}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <span style={{ position: 'relative', fontSize: 13, color: '#BFE9DC', fontWeight: 600, lineHeight: 1.4 }}>
                  Pairs make the podium after {MIN_GAMES} doubles games together. Keep logging results.
                </span>
              )}
            </div>

            {partners.length > 0 && (
              <div style={{ background: '#12161C', color: '#fff', borderRadius: 24, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: '#5FE3BE' }}>Your chemistry</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#A9B2BF' }}>win % by partner</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  {partners.slice(0, 3).map((y, i) => {
                    const p = who(y.partner)
                    return (
                      <div key={y.partner} className="stack" style={{ alignItems: 'center', gap: 6, padding: '12px 6px', borderRadius: 16, background: i === 0 ? 'rgba(95,227,190,.14)' : 'rgba(255,255,255,.06)', minWidth: 0 }}>
                        <Avatar p={p} size={36} font={12} />
                        <span className="display" style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.03em', color: i === 0 ? '#5FE3BE' : '#fff' }}>{pctOf(y.pct)}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#A9B2BF', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>w/ {p.first} · {y.w}–{y.l}</span>
                      </div>
                    )
                  })}
                </div>
                <span style={{ fontSize: 12, color: '#BFE9DC', fontWeight: 600, lineHeight: 1.4 }}>
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
                        <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.2 }}>{l.names}</span>
                      </div>
                      <div className="stack" style={{ alignItems: 'center', gap: 2 }}>
                        <span className="display" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1 }}>{rival.lw}–{rival.rw}</span>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.14em', color: '#8A94A3' }}>HEAD TO HEAD</span>
                      </div>
                      <div className="stack" style={{ alignItems: 'flex-end', gap: 8, minWidth: 0, textAlign: 'right' }}>
                        <Duo a={r.a} b={r.b} size={36} edge="#fff" />
                        <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.2 }}>{r.names}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 3 }}>
                      <span style={{ width: `${lw}%`, background: '#0E9F7E', borderRadius: 4 }} />
                      <span style={{ flex: 1, background: '#E5484D', borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 12, color: '#5B6573', fontWeight: 600 }}>{(rival.lastWinner === 'l' ? l : r).names} won the last one.</span>
                  </div>
                </div>
              )
            })()}

            {chase.length > 0 && (
              <div className="stack" style={{ gap: 12 }}>
                <span className="eyebrow">The chase</span>
                <div className="stack" style={{ gap: 8 }}>
                  {chase.map(ch => {
                    const d = duo(ch.q.ids)
                    return (
                      <div key={ch.q.ids.join()} style={{ background: '#fff', boxShadow: d.mine ? '0 0 0 1.5px #0E9F7E' : '0 0 0 1px #E6E9EE', borderRadius: 18, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="display" style={{ fontSize: 18, fontWeight: 800, color: '#C5CDD8', width: 22, flex: 'none' }}>{ch.rank}</span>
                        <Duo a={d.a} b={d.b} size={30} edge="#fff" />
                        <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: d.mine ? 800 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.names}{d.mine ? ' · You' : ''}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: ch.hot ? '#0E7F66' : '#5B6573' }}>{ch.tag}</span>
                        </span>
                        <span className="display" style={{ fontSize: 14, fontWeight: 700, flex: 'none' }}>{pctOf(ch.q.pct)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {awards.length > 0 && (
              <div className="stack" style={{ gap: 12 }}>
                <span className="eyebrow">Awards</span>
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', margin: '0 -18px', padding: '0 18px 4px', scrollbarWidth: 'none' }}>
                  {awards.map(aw => {
                    const d = duo(aw.q.ids)
                    return (
                      <div key={aw.title} className="stack" style={{ flex: 'none', width: 150, borderRadius: 20, padding: 14, background: aw.bg, color: aw.fg, boxShadow: aw.ring, gap: 12 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: aw.accent }}>{aw.title}</span>
                        <Duo a={d.a} b={d.b} size={30} edge={aw.bg} />
                        <span className="stack" style={{ gap: 2 }}>
                          <span className="display" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1 }}>{aw.big}</span>
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
                      <span className="display" style={{ width: 16, fontSize: 12, fontWeight: 700, color: '#8A94A3', flex: 'none' }}>{r.rank}</span>
                      <span style={{ display: 'flex', borderRadius: '50%', boxShadow: me ? '0 0 0 2px #fff, 0 0 0 3.5px #0E9F7E' : undefined }}><Avatar p={r.p} size={28} font={10} /></span>
                      <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: me ? 800 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.p.name}{me ? ' · You' : ''}</span>
                        <span style={{ fontSize: 11, color: '#5B6573', fontWeight: 600 }}>{pctOf(r.pct)} · {r.w}W · {r.l}L · rating {r.rating}</span>
                      </span>
                      {bp && r.best && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                          <Avatar p={bp} size={22} font={9} />
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#0E7F66' }}>{pctOf(r.best.pct)}</span>
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
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#8A94A3' }}>{fmtDay(g.played_on)} · {g.match_title ?? 'Friendly'}</span>
                        {g.created_by === meId && <button className="link-btn" style={{ fontSize: 11, color: '#8A94A3' }} onClick={() => remove(g.id)}>Remove</button>}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: 14, fontWeight: aWin ? 800 : 500, color: aWin ? '#12161C' : '#5B6573' }}>{nm(g.a)}</span>
                        <span className="display panel" style={{ fontWeight: 800, padding: '6px 10px', borderRadius: 10, whiteSpace: 'nowrap', fontSize: 11, textAlign: 'center' }}>
                          {aWin ? 'BEAT' : 'LOST TO'}
                          {g.score_a != null && g.score_b != null && <span style={{ display: 'block', fontSize: 12, marginTop: 2 }}>{g.score_a}–{g.score_b}</span>}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: aWin ? 500 : 800, color: aWin ? '#5B6573' : '#12161C', textAlign: 'right' }}>{nm(g.b)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
      <LogResultSheet open={logging} onClose={() => setLogging(false)} />
    </Frame>
  )
}
