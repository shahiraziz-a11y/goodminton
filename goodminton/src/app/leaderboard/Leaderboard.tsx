'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { Frame } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { LogResultSheet } from '@/components/LogResultSheet'
import { fmtDate } from '@/lib/format'
import { person } from '@/lib/people'
import { bestPairs, ratings, standings, START_RATING } from '@/lib/stats'
import { createClient } from '@/lib/supabase/client'
import type { Leaderboard as Data } from '@/lib/types'

const fmtDay = (d: string) => fmtDate(d + 'T12:00:00Z', 'UTC')

export function Leaderboard({ meId, meName, data }: { meId: string; meName: string; data: Data }) {
  const router = useRouter()
  const { flash } = useFeedback()
  const [logging, setLogging] = useState(false)
  const who = (id: string) => person(id, data.people[id] ?? 'Player')
  // Ranked by rating (beating strong pairs counts more); wins and losses shown alongside.
  const rating = ratings(data.games)
  const table = standings(data.games)
    .map(s => ({ ...s, rating: rating[s.id] ?? START_RATING }))
    .sort((a, b) => b.rating - a.rating || b.w - a.w)
    .map((s, i) => ({ ...s, rank: i + 1, p: who(s.id) }))
  const podium = [table[1], table[0], table[2]].filter(Boolean)
  const pairs = bestPairs(data.games)
  const recent = data.games.slice(0, 8)
  const nm = (ids: string[]) => ids.map(id => who(id).first).join(' & ')

  async function remove(id: string) {
    if (!confirm('Remove this result? The leaderboard will update.')) return
    const { error } = await createClient().rpc('delete_game', { p_game: id })
    if (error) return flash(error.message)
    flash('Result removed')
    router.refresh()
  }

  return (
    <Frame me={person(meId, meName)} tab="board">
      <div className="screen" style={{ gap: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
          <span className="h1">Leaderboard</span>
          <button className="chip-btn go" style={{ height: 40 }} onClick={() => setLogging(true)}>+ Log result</button>
        </div>

        {!table.length ? (
          <div className="card stack" style={{ padding: 28, gap: 8, textAlign: 'center', alignItems: 'center' }}>
            <span className="display" style={{ fontSize: 17, fontWeight: 700 }}>No games yet</span>
            <span className="note">Log who won after each game and the standings build up here.</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'end', paddingTop: 6 }}>
              {podium.map(t => {
                const first = t.rank === 1
                const h = first ? 128 : t.rank === 2 ? 98 : 76
                return (
                  <div key={t.id} className="stack" style={{ alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Avatar p={t.p} size={48} font={15} />
                    <span style={{ fontSize: 13, fontWeight: 800, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.p.first}</span>
                    <div className={first ? '' : 'card'} style={{ width: '100%', height: h, borderRadius: '18px 18px 8px 8px', background: first ? '#0E9F7E' : '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                      <span className="display" style={{ fontSize: first ? 36 : 28, fontWeight: 800, lineHeight: 1, color: first ? '#fff' : t.rank === 2 ? '#0B8A6B' : '#B07A3E' }}>{t.rank}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: first ? '#fff' : '#5B6573' }}>{t.w}–{t.l}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="stack" style={{ gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="eyebrow">Standings</span><span className="eyebrow">Rating</span></div>
              <div className="card" style={{ padding: '4px 18px' }}>
                {table.map(r => (
                  <div key={r.id} className="row-line" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                    <span className="display" style={{ width: 20, fontSize: 13, fontWeight: 700, color: '#8A94A3' }}>{r.rank}</span>
                    <Avatar p={r.p} size={34} />
                    <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{r.p.name}</span>
                      <span style={{ fontSize: 12, color: '#5B6573' }}>{r.w}W · {r.l}L · {Math.round(r.pct * 100)}%{r.id === meId ? ' · You' : ''}</span>
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '4px 7px', borderRadius: 99, background: r.hot ? '#E5484D' : '#F1F3F6', color: r.hot ? '#fff' : '#5B6573' }}>{r.streak}</span>
                    <span className="display" style={{ width: 48, textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{r.rating}</span>
                  </div>
                ))}
              </div>
            </div>

            {pairs.length > 0 && (
              <div className="stack" style={{ gap: 12 }}>
                <span className="eyebrow">Best pairs</span>
                {pairs.map(pr => {
                  const [p1, p2] = pr.ids.map(who)
                  const n = pr.w + pr.l
                  return (
                    <div key={pr.ids.join()} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ display: 'flex', flex: 'none' }}><Avatar p={p1} size={34} /><span style={{ marginLeft: -10, display: 'flex' }}><Avatar p={p2} size={34} ring /></span></span>
                      <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{p1.first} &amp; {p2.first}</span>
                        <span style={{ fontSize: 12, color: '#5B6573' }}>{n} game{n > 1 ? 's' : ''} together</span>
                      </span>
                      <span className="display" style={{ fontSize: 16, fontWeight: 800, color: '#0B8A6B' }}>{pr.w}–{pr.l}</span>
                    </div>
                  )
                })}
              </div>
            )}

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
