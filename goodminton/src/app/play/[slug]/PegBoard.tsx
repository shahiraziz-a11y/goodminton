'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { Frame } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { Sheet } from '@/components/Sheet'
import { pairUp, queue, type BoardGame } from '@/lib/board'
import { fmtTime } from '@/lib/format'
import { person } from '@/lib/people'
import { ratings as ratingsOf } from '@/lib/stats'
import { createClient } from '@/lib/supabase/client'
import type { BoardView, Game } from '@/lib/types'

type Draft = { a: string[]; b: string[] }

/**
 * Match-day peg board: every court runs on its own. A free court shows who's up next
 * (fewest games, longest wait, fair pairs); tap Start. Game over logs who won and frees it.
 */
export function PegBoard({ meId, meName, initial }: { meId: string; meName: string; initial: BoardView }) {
  const { flash } = useFeedback()
  const [b, setB] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [edits, setEdits] = useState<Record<number, Draft>>({})
  const [swap, setSwap] = useState<{ court: number; id: string } | null>(null)
  const [ending, setEnding] = useState<BoardGame | null>(null)
  const [win, setWin] = useState<'a' | 'b' | null>(null)
  const [score, setScore] = useState({ a: '', b: '' })

  const db = createClient()
  async function reload() {
    const { data } = await db.rpc('get_board', { p_slug: b.slug })
    if (data) setB(data as BoardView)
  }
  // Stay in step with other phones running the same board.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') reload() }, 5000)
    return () => clearInterval(t)
  })
  // Ratings even out the sides; the group's games feed them.
  useEffect(() => {
    db.rpc('get_leaderboard', b.group_id ? { p_group: b.group_id } : {}).then(({ data }) => {
      if (data) setRatings(ratingsOf((data as { games?: Game[] }).games ?? []))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.group_id])

  const names: Record<string, string> = { ...b.people, ...Object.fromEntries(b.players.map(p => [p.id, p.full_name])) }
  const who = (id: string) => person(id, names[id] ?? 'Player')
  const pairName = (ids: string[]) => ids.map(id => who(id).first).join(' & ')
  const per = b.format === 'doubles' ? 4 : 2
  const live = b.games.filter(g => !g.ended_at)
  const done = b.games.filter(g => g.ended_at).sort((x, y) => (y.ended_at ?? '').localeCompare(x.ended_at ?? ''))
  const waiting = queue(b.players, b.games)

  // Who goes on each free court: a hand-picked line-up if someone changed it, else the next in the queue.
  const drafts: Record<number, Draft> = {}
  const taken = new Set<string>()
  for (let c = 1; c <= b.court_count; c++) {
    if (live.some(g => g.court === c)) continue
    const mine = edits[c]
    const valid = mine && [...mine.a, ...mine.b].every(id => waiting.some(w => w.id === id) && !taken.has(id))
    const pick = valid ? mine : (() => {
      const ids = waiting.filter(w => !taken.has(w.id)).slice(0, per).map(w => w.id)
      return ids.length === per ? pairUp(ids, b.games, ratings) : null
    })()
    if (pick) { drafts[c] = pick; [...pick.a, ...pick.b].forEach(id => taken.add(id)) }
  }

  async function call(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true)
    const { error } = await db.rpc(fn, args)
    setBusy(false)
    if (error) return flash(error.message)
    flash(ok)
    await reload()
  }
  async function start(court: number) {
    const d = drafts[court]
    if (!d) return
    await call('board_start', { p_match: b.id, p_court: court, p_a1: d.a[0], p_a2: d.a[1] ?? null, p_b1: d.b[0], p_b2: d.b[1] ?? null }, `Court ${court} is on`)
    setEdits(e => { const n = { ...e }; delete n[court]; return n })
  }
  async function finish(winner: 'a' | 'b' | null) {
    if (!ending) return
    const [ra, rb] = [score.a.trim(), score.b.trim()]
    if (winner && !!ra !== !!rb) return flash('Enter both scores, or neither')
    const g = ending
    setEnding(null)
    await call('board_finish', { p_game: g.id, p_winner: winner, p_score_a: winner && ra ? Number(ra) : null, p_score_b: winner && rb ? Number(rb) : null },
      winner ? `${pairName(winner === 'a' ? g.a : g.b)} win · court ${g.court} free` : `Court ${g.court} free`)
  }
  function replace(court: number, out: string, inn: string) {
    const d = drafts[court]
    const sub = (ids: string[]) => ids.map(id => (id === out ? inn : id))
    setEdits(e => ({ ...e, [court]: { a: sub(d.a), b: sub(d.b) } }))
    setSwap(null)
  }

  const Pair = ({ ids, dark, onTap }: { ids: string[]; dark?: boolean; onTap?: (id: string) => void }) => (
    <div className="stack" style={{ gap: 6, alignItems: 'center', minWidth: 0 }}>
      <div style={{ display: 'flex' }}>
        {ids.map(id => {
          const ring = { margin: '0 -3px', display: 'flex', borderRadius: '50%', boxShadow: `0 0 0 2px ${dark ? '#0E4A30' : '#fff'}` } as const
          return onTap
            ? <button key={id} type="button" onClick={() => onTap(id)} aria-label={`Swap ${who(id).first}`} style={{ ...ring, border: 'none', background: 'none', padding: 0 }}><Avatar p={who(id)} size={38} font={13} /></button>
            : <span key={id} style={ring}><Avatar p={who(id)} size={38} font={13} /></span>
        })}
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'center', lineHeight: 1.2 }}>{pairName(ids)}</span>
    </div>
  )

  return (
    <Frame me={person(meId, meName)} tab="play" back="/play">
      <div className="screen" style={{ gap: 18 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span style={{ fontSize: 13, color: '#6B6B66', fontWeight: 600 }}>{fmtTime(b.starts_at, b.timezone)} · {b.players.length} players · {b.court_count} court{b.court_count > 1 ? 's' : ''}</span>
          <Link href={`/m/${b.slug}`} className="h1" style={{ fontSize: 30 }}>{b.title}</Link>
        </div>
        {!b.open && <div className="card" style={{ padding: 16, fontSize: 14, color: '#6B6B66', textAlign: 'center' }}>The board opens on match day.</div>}

        {Array.from({ length: b.court_count }, (_, i) => i + 1).map(c => {
          const g = live.find(x => x.court === c)
          const label = b.court_count > 1 ? `Court ${c}` : 'Court'
          if (g) {
            return (
              <div key={c} className="stack" style={{ gap: 14, borderRadius: 26, padding: 18, color: '#fff', background: 'linear-gradient(160deg, #135F3D, #0A3B26)', boxShadow: '0 20px 40px -24px rgba(14,40,26,.7)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', color: '#9FE0BC' }}>{label.toUpperCase()} · PLAYING</span>
                  <span style={{ fontSize: 12, color: '#CFE3D5', fontWeight: 600 }}>since {fmtTime(g.started_at, b.timezone)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: 8 }}>
                  <Pair ids={g.a} dark />
                  <span className="display" style={{ fontSize: 12, fontWeight: 700, color: '#9FE0BC' }}>VS</span>
                  <Pair ids={g.b} dark />
                </div>
                <button className="btn" disabled={busy || !b.open} onClick={() => { setWin(null); setScore({ a: '', b: '' }); setEnding(g) }}
                  style={{ height: 48, background: '#fff', color: '#111111' }}>Game over</button>
              </div>
            )
          }
          const d = drafts[c]
          return (
            <div key={c} className="card stack" style={{ gap: 14, padding: 18, borderRadius: 26 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', color: '#0E5A3A' }}>{label.toUpperCase()} · FREE</span>
                {d && <span style={{ fontSize: 12, color: '#6B6B66', fontWeight: 600 }}>Next up · tap a player to swap</span>}
              </div>
              {d ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: 8 }}>
                    <Pair ids={d.a} onTap={id => setSwap({ court: c, id })} />
                    <span className="display" style={{ fontSize: 12, fontWeight: 700, color: '#9A9992' }}>VS</span>
                    <Pair ids={d.b} onTap={id => setSwap({ court: c, id })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                    <button className="btn-2" style={{ height: 48 }} disabled={busy}
                      onClick={() => setEdits(e => ({ ...e, [c]: pairUp([...d.a, ...d.b].sort(() => Math.random() - 0.5), [], {}) }))}>Shuffle</button>
                    <button className="btn" style={{ height: 48 }} disabled={busy || !b.open} onClick={() => start(c)}>Start {label.toLowerCase()}</button>
                  </div>
                </>
              ) : (
                <span className="note">Waiting for {per} free players.</span>
              )}
            </div>
          )
        })}

        <div className="stack" style={{ gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="eyebrow">Waiting · {waiting.length}</span>
            <span style={{ fontSize: 11, color: '#9A9992', fontWeight: 600 }}>games played</span>
          </div>
          {!waiting.length ? <span className="note">Everyone&apos;s on court.</span> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {waiting.map(w => {
                const up = taken.has(w.id)
                return (
                  <span key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 5px', borderRadius: 99, fontSize: 13, fontWeight: 700,
                    background: up ? 'rgba(14,90,58,.1)' : 'rgba(255,255,255,.7)', boxShadow: up ? 'inset 0 0 0 1.5px rgba(14,90,58,.35)' : '0 0 0 1px #E2E0DA' }}>
                    <Avatar p={who(w.id)} size={24} font={9} />
                    {who(w.id).first}
                    <span style={{ fontSize: 11, color: '#9A9992' }}>{w.games}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        {done.length > 0 && (
          <div className="stack" style={{ gap: 10 }}>
            <span className="eyebrow">Today · {done.length} game{done.length === 1 ? '' : 's'}</span>
            <div className="card" style={{ padding: '2px 16px' }}>
              {done.map((g, i) => (
                <div key={g.id} className="row-line" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0' }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>
                    {g.winner
                      ? <>{pairName(g.winner === 'a' ? g.a : g.b)} beat {pairName(g.winner === 'a' ? g.b : g.a)}{g.score_a != null && g.score_b != null ? ` · ${Math.max(g.score_a, g.score_b)}–${Math.min(g.score_a, g.score_b)}` : ''}</>
                      : <>{pairName(g.a)} v {pairName(g.b)} <span style={{ color: '#9A9992' }}>· no result</span></>}
                  </span>
                  {i === 0 && b.open && <button className="link-btn" style={{ fontSize: 12, color: '#9A9992' }} disabled={busy}
                    onClick={() => confirm('Undo this game? It goes back on court and its result is removed.') && call('board_undo', { p_game: g.id }, 'Undone')}>Undo</button>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Sheet open={!!swap} onClose={() => setSwap(null)} title={swap ? `Swap ${who(swap.id).first}` : ''} subtitle="Pick who plays instead">
        <div className="stack" style={{ gap: 4 }}>
          {waiting.filter(w => !taken.has(w.id)).map(w => (
            <button key={w.id} type="button" className="picker-row" onClick={() => swap && replace(swap.court, swap.id, w.id)}>
              <Avatar p={who(w.id)} size={32} font={12} />
              <span style={{ flex: 1, textAlign: 'left', fontSize: 15, fontWeight: 600 }}>{who(w.id).name}</span>
              <span style={{ fontSize: 12, color: '#9A9992' }}>{w.games} played</span>
            </button>
          ))}
          {!waiting.some(w => !taken.has(w.id)) && <span className="note">Nobody else is free right now.</span>}
        </div>
      </Sheet>

      <Sheet open={!!ending} onClose={() => setEnding(null)} title="Game over" subtitle="Tap the pair that won">
        {ending && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 10, alignItems: 'center' }}>
              {(['a', 'b'] as const).map((k, i) => (
                <div key={k} className={`pair-card${win === k ? ' sel' : ''}`} role="button" aria-pressed={win === k} onClick={() => setWin(k)} style={{ gridColumn: i === 0 ? 1 : 3 }}>
                  <Pair ids={ending[k]} />
                  <span className={`win-tag${win === k ? ' sel' : ''}`}>{win === k ? 'WINNER' : 'TAP IF WON'}</span>
                </div>
              ))}
              <span className="display" style={{ gridColumn: 2, gridRow: 1, fontSize: 13, fontWeight: 700, color: '#9A9992' }}>VS</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {(['a', 'b'] as const).map(k => (
                <input key={k} className="field" inputMode="numeric" maxLength={2} placeholder="Score" aria-label={`Score for ${k === 'a' ? 'left' : 'right'} pair`} value={score[k]}
                  onChange={e => {
                    const next = { ...score, [k]: e.target.value.replace(/\D/g, '').slice(0, 2) }
                    setScore(next)
                    if (next.a && next.b && Number(next.a) !== Number(next.b)) setWin(Number(next.a) > Number(next.b) ? 'a' : 'b')
                  }} style={{ height: 44, textAlign: 'center', fontSize: 16 }} />
              ))}
            </div>
            <button className="btn" disabled={busy || !win} onClick={() => finish(win)}>Save · court {ending.court} free</button>
            <button className="link-btn" style={{ alignSelf: 'center', color: '#6B6B66' }} disabled={busy} onClick={() => finish(null)}>No result, just free the court</button>
          </>
        )}
      </Sheet>
    </Frame>
  )
}
