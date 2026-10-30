'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Avatar } from './Avatar'
import { useFeedback } from './Feedback'
import { Sheet } from './Sheet'
import { person, type Person } from '@/lib/people'
import { freshRound, nextRound, planStats, sittingOut, type PlanGame } from '@/lib/schedule'
import { ratings } from '@/lib/stats'
import { createClient } from '@/lib/supabase/client'
import { isVisible, type Game, type MatchView, type PlanEntry } from '@/lib/types'

const toGame = (e: PlanEntry): PlanGame => ({ court: e.court, a: e.a.map(p => p.id), b: e.b.map(p => p.id) })

/**
 * The game plan: rounds of games across the courts, made one round at a time.
 * Tap a player to swap them; tap "Won" under a side to log the result.
 */
export function GamePlan({ m }: { m: MatchView }) {
  const router = useRouter()
  const { flash } = useFeedback()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ game: PlanEntry; who: Person } | null>(null)
  const [winning, setWinning] = useState<{ game: PlanEntry; side: 'a' | 'b' } | null>(null)
  const [score, setScore] = useState({ a: '', b: '' })

  const plan = m.plan ?? []
  const players = m.players.filter(isVisible).map(p => p.id)
  const names: Record<string, string> = Object.fromEntries(m.players.filter(isVisible).map(p => [p.id, p.full_name]))
  plan.forEach(e => [...e.a, ...e.b].forEach(p => (names[p.id] ??= p.full_name)))
  const who = (id: string) => person(id, names[id] ?? 'Player')
  const perSide = m.format === 'doubles' ? 2 : 1
  const per = perSide * 2
  const roundNos = [...new Set(plan.map(e => e.round))].sort((x, y) => x - y)
  const last = roundNos.at(-1) ?? 0
  const byRound = (r: number) => plan.filter(e => e.round === r)
  const history = roundNos.map(r => byRound(r).map(toGame))
  const stats = planStats(history)

  async function call(fn: string, args: Record<string, unknown>, ok?: string) {
    setBusy(true)
    const { error } = await createClient().rpc(fn, args)
    setBusy(false)
    if (error) flash(error.message)
    else if (ok) flash(ok)
    router.refresh()
    return !error
  }

  /** Next round: keeps last round's pairs and swaps in who's waiting; `mix` re-pairs everyone. */
  async function makeRound(keep?: PlanEntry, mix = false) {
    if (players.length < per) return flash(`Needs at least ${per} players`)
    setBusy(true)
    // Ratings even out the sides; the group's games feed them.
    let r: Record<string, number> = {}
    const { data } = await createClient().rpc('get_leaderboard', m.group ? { p_group: m.group.id } : {})
    if (data) r = ratings(((data as { games?: Game[] }).games ?? []))
    setBusy(false)
    const games = (mix ? freshRound : nextRound)({ players, courts: m.court_count, perSide, rounds: history, ratings: r, keep: keep && { a: keep.a.map(p => p.id), b: keep.b.map(p => p.id) } })
    if (!games.length) return flash(`Needs at least ${per} players`)
    await call('save_round', { p_match: m.id, p_round: last + 1, p_games: games }, mix ? `Round ${last + 1}: new partners` : `Round ${last + 1} is set`)
  }

  async function saveWinner() {
    if (!winning) return
    const [ra, rb] = [score.a.trim(), score.b.trim()]
    if (!!ra !== !!rb) return flash('Enter both scores, or leave both empty')
    const ok = await call('log_planned', { p_game: winning.game.id, p_winner: winning.side, p_score_a: ra ? Number(ra) : null, p_score_b: rb ? Number(rb) : null }, 'Result saved · leaderboard updated')
    if (ok) { setWinning(null); setScore({ a: '', b: '' }) }
  }

  async function swap(pIn: string) {
    if (!editing) return
    const ok = await call('swap_planned', { p_game: editing.game.id, p_out: editing.who.id, p_in: pIn }, `${who(pIn).first} in for ${editing.who.first}`)
    if (ok) setEditing(null)
  }

  // Whoever has played least (then sat out longest) comes in when someone is taken out.
  const restedFirst = (ids: string[]) => [...ids].sort((x, y) => (stats.played[x] ?? 0) - (stats.played[y] ?? 0) || (stats.last[x] ?? -1) - (stats.last[y] ?? -1))

  const side = (e: PlanEntry, s: 'a' | 'b') => {
    const ps = e[s]
    const won = e.winner === s, lost = !!e.winner && !won, open = !e.game_id
    const sc = e.score_a != null && e.score_b != null ? (s === 'a' ? `${e.score_a}–${e.score_b}` : `${e.score_b}–${e.score_a}`) : ''
    return (
      <div className="stack" style={{ gap: 8, padding: 10, borderRadius: 14, minWidth: 0, background: won ? '#E3EEE6' : '#F1F0EC', boxShadow: won ? '0 0 0 2px #0E5A3A' : 'none', opacity: lost ? 0.6 : 1 }}>
        {ps.map(p => {
          const pp = who(p.id)
          const mine = p.id === m.viewer.id
          return (
            <button key={p.id} type="button" disabled={!open || busy} onClick={() => setEditing({ game: e, who: pp })} aria-label={open ? `Change ${pp.first}` : pp.name}
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', padding: 0, minWidth: 0, cursor: open ? 'pointer' : 'default', color: '#111111', textAlign: 'left', opacity: 1 }}>
              <Avatar p={pp} size={26} font={10} ring={mine} />
              <span style={{ fontSize: 13, fontWeight: mine ? 800 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pp.first}{mine ? ' · You' : ''}</span>
            </button>
          )
        })}
        {open ? (
          <button className="win-tag" style={{ alignSelf: 'flex-start', border: 'none', cursor: 'pointer' }} disabled={busy} onClick={() => setWinning({ game: e, side: s })}>WON?</button>
        ) : won ? (
          <span className="win-tag sel" style={{ alignSelf: 'flex-start' }}>WON{sc ? ` ${sc}` : ''}</span>
        ) : null}
      </div>
    )
  }

  if (players.length < per && !plan.length) return null

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="eyebrow">Game plan</span>
        <span style={{ fontSize: 11, color: '#9A9992', fontWeight: 600 }}>{players.length} playing · {m.court_count} court{m.court_count > 1 ? 's' : ''}</span>
      </div>
      {!plan.length ? (
        <div className="card stack" style={{ padding: 20, gap: 12 }}>
          <button className="btn" disabled={busy} onClick={() => makeRound()}>{busy ? 'Making…' : 'Make round 1'}</button>
        </div>
      ) : (
        <>
          {roundNos.map(r => {
            const games = byRound(r)
            const out = sittingOut(players, games.map(toGame))
            return (
              <div key={r} className="card stack" style={{ padding: 16, gap: 12, boxShadow: r === last ? '0 0 0 2px #0E5A3A' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span className="display" style={{ fontSize: 15, fontWeight: 700 }}>Round {r}</span>
                  {out.length > 0 && <span style={{ fontSize: 12, color: '#6B6B66', textAlign: 'right' }}>Sitting out: {out.map(id => who(id).first).join(', ')}{r === last ? ' · up next' : ''}</span>}
                </div>
                {games.map(e => (
                  <div key={e.id} className="stack" style={{ gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#9A9992' }}>COURT {e.court}</span>
                      <span style={{ display: 'flex', gap: 12 }}>
                        {e.game_id && <button className="link-btn" style={{ fontSize: 11, color: '#9A9992' }} disabled={busy}
                          onClick={() => confirm('Undo this result?') && call('delete_game', { p_game: e.game_id }, 'Result removed')}>Undo result</button>}
                        <button className="link-btn" style={{ fontSize: 11, color: '#0E5A3A', fontWeight: 700 }} disabled={busy} onClick={() => makeRound(e)}>Play again</button>
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 8, alignItems: 'center' }}>
                      {side(e, 'a')}
                      <span className="display" style={{ fontSize: 11, fontWeight: 700, color: '#9A9992' }}>VS</span>
                      {side(e, 'b')}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
          <button className="btn" style={{ height: 50 }} disabled={busy} onClick={() => makeRound()}>{busy ? 'Making…' : `Make round ${last + 1}`}</button>
          <div style={{ display: 'grid', gridTemplateColumns: byRound(last).every(e => !e.game_id) ? '1fr 1fr' : '1fr', gap: 8, marginTop: -4 }}>
            <button className="btn-2" style={{ height: 44, fontSize: 14 }} disabled={busy} onClick={() => makeRound(undefined, true)}>Mix it up</button>
            {byRound(last).every(e => !e.game_id) && (
              <button className="btn-2" style={{ height: 44, fontSize: 14 }} disabled={busy}
                onClick={() => confirm(`Remove round ${last}?`) && call('delete_round', { p_match: m.id, p_round: last }, `Round ${last} removed`)}>Undo round</button>
            )}
          </div>
        </>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing ? `Change ${editing.who.first}` : ''}
        subtitle="Swap places with someone in this round, or bring in someone sitting out.">
        {editing && (() => {
          const games = byRound(editing.game.round)
          const outs = restedFirst(sittingOut(players, games.map(toGame)))
          const inRound = games.filter(e => !e.game_id).flatMap(e => [...e.a, ...e.b].map(p => p.id)).filter(id => id !== editing.who.id)
          const row = (id: string, tag: string) => {
            const pp = who(id)
            return (
              <button key={id} type="button" className="picker-row" disabled={busy} onClick={() => swap(id)}>
                <Avatar p={pp} size={32} font={12} />
                <span style={{ flex: 1, textAlign: 'left', fontSize: 15, fontWeight: 600 }}>{pp.name}</span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#9A9992' }}>{tag}</span>
              </button>
            )
          }
          return (
            <>
              {outs.length > 0 && (
                <button className="btn-2" disabled={busy} onClick={() => swap(outs[0])}>Take {editing.who.first} out · {who(outs[0]).first} comes in</button>
              )}
              <div className="stack picker-list">
                {outs.map(id => row(id, 'SITTING OUT'))}
                {inRound.map(id => row(id, 'SWAP'))}
              </div>
            </>
          )
        })()}
      </Sheet>

      <Sheet open={!!winning} onClose={() => setWinning(null)} title={winning ? `${winning.game[winning.side].map(p => who(p.id).first).join(' & ')} won?` : ''} subtitle="Score is optional">
        {winning && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center' }}>
              {(['a', 'b'] as const).map((k, i) => (
                <input key={k} className="field" inputMode="numeric" pattern="[0-9]*" maxLength={2} placeholder={winning.game[k].map(p => who(p.id).first).join(' & ')}
                  aria-label={`Score for ${k === 'a' ? 'left' : 'right'} side`} value={score[k]} style={{ height: 46, textAlign: 'center', gridColumn: i === 0 ? 1 : 3, fontSize: 15 }}
                  onChange={e => setScore(s => ({ ...s, [k]: e.target.value.replace(/\D/g, '').slice(0, 2) }))} />
              ))}
              <span className="display" style={{ gridColumn: 2, gridRow: 1, fontSize: 12, fontWeight: 700, color: '#9A9992' }}>–</span>
            </div>
            <button className="btn" disabled={busy} onClick={saveWinner}>{busy ? 'Saving…' : 'Save result'}</button>
          </>
        )}
      </Sheet>
    </div>
  )
}
