'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Avatar } from './Avatar'
import { useFeedback } from './Feedback'
import { loadPlayers, PlayerPicker } from './PlayerPicker'
import { Sheet } from './Sheet'
import { person, type Person } from '@/lib/people'
import { shuffled } from '@/lib/stats'
import { createClient } from '@/lib/supabase/client'
import type { MyGroup } from '@/lib/types'

type Court = { label: string; players: Person[] }

/**
 * "Log result" from the design: two pairs, tap the winners, save.
 * With `courts` (from a match) the players are fixed per court; without, pick any 4 from your players.
 */
export function LogResultSheet({ open, onClose, matchId, matchTitle, courts, initialCourt = 0, groups = [], defaultGroup }: {
  open: boolean; onClose: () => void; matchId?: string; matchTitle?: string; courts?: Court[]; initialCourt?: number
  /** Without a match: the game goes in one of these groups, and players come from it. */
  groups?: MyGroup[]; defaultGroup?: string | null
}) {
  const router = useRouter()
  const { flash } = useFeedback()
  const [court, setCourt] = useState(initialCourt)
  const [slots, setSlots] = useState<(Person | null)[]>(() => courts?.[initialCourt]?.players ?? [null, null, null, null])
  const [singles, setSingles] = useState(false)
  const [win, setWin] = useState<'a' | 'b' | null>(null)
  const [score, setScore] = useState({ a: '', b: '' })
  const [picking, setPicking] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const free = !courts
  const [group, setGroup] = useState<string | null>(defaultGroup ?? groups[0]?.id ?? null)

  // Reset when reopened on another court.
  const [lastKey, setLastKey] = useState('')
  const key = `${open}:${initialCourt}`
  if (key !== lastKey) {
    setLastKey(key)
    setCourt(initialCourt)
    setSlots(courts?.[initialCourt]?.players ?? (singles ? [null, null] : [null, null, null, null]))
    setWin(null)
    setScore({ a: '', b: '' })
    setPicking(null)
  }

  const full = slots.every(Boolean)
  const half = slots.length / 2
  const a = slots.slice(0, half), b = slots.slice(half)
  const names = (ps: (Person | null)[]) => ps.map(p => p?.first ?? '…').join(' & ')

  async function save() {
    if (!full) return flash(`Pick all ${slots.length} players`)
    if (!win) return flash(half === 1 ? 'Tap who won' : 'Tap the pair that won')
    const [ra, rb] = [score.a.trim(), score.b.trim()]
    if (!!ra !== !!rb) return flash('Enter both scores, or leave both empty')
    const [na, nb] = [Number(ra), Number(rb)]
    if (ra && (!Number.isInteger(na) || !Number.isInteger(nb) || na < 0 || nb < 0 || na > 99 || nb > 99)) return flash('Scores are 0 to 99')
    if (ra && (na === nb || (na > nb) !== (win === 'a'))) return flash('The winners need the higher score')
    setBusy(true)
    const ids = slots.map(p => p!.id)
    const [sa, sb] = [ids.slice(0, half), ids.slice(half)]
    const { error } = await createClient().rpc('log_game', {
      p_match: matchId ?? null, p_a1: sa[0], p_a2: sa[1] ?? null, p_b1: sb[0], p_b2: sb[1] ?? null, p_winner: win,
      p_score_a: ra ? na : null, p_score_b: rb ? nb : null, ...(!matchId && group ? { p_group: group } : {}),
    })
    setBusy(false)
    if (error) return flash(error.message)
    flash(`${names(win === 'a' ? a : b)} win${ra ? ` ${Math.max(na, nb)}–${Math.min(na, nb)}` : ''} · leaderboard updated`)
    onClose()
    router.refresh()
  }

  async function newGuest(name: string) {
    const { data, error } = await createClient().rpc('create_guest', group ? { p_name: name, p_group: group } : { p_name: name })
    if (error) return flash(error.message)
    loadPlayers(true)
    place(person(data as string, name))
  }
  function place(p: Person) {
    setSlots(s => s.map((x, i) => (i === picking ? p : x)))
    setWin(null)
    setPicking(null)
  }

  if (picking !== null) {
    return (
      <Sheet open={open} onClose={() => setPicking(null)} title={`Pick player ${picking + 1} of ${slots.length}`} subtitle={half === 1 ? (picking === 0 ? 'Left side' : 'Right side') : picking < 2 ? 'Left pair' : 'Right pair'}>
        <PlayerPicker exclude={slots.filter((p, i) => p && i !== picking).map(p => p!.id)} onPick={p => place(person(p.id, p.full_name))} onNew={newGuest} newLabel="Add guest" group={free ? group : undefined} />
        <button className="btn-2" onClick={() => setPicking(null)}>Back</button>
      </Sheet>
    )
  }

  const Pair = ({ side, ps }: { side: 'a' | 'b'; ps: (Person | null)[] }) => {
    const sel = win === side
    return (
      <div className={`pair-card${sel ? ' sel' : ''}`} onClick={() => full && setWin(side)} role="button" aria-pressed={sel}>
        <div style={{ display: 'flex' }}>
          {ps.map((p, i) => {
            const idx = (side === 'a' ? 0 : half) + i
            return (
              <span key={i} style={{ margin: '0 -4px', display: 'flex' }}>
                {p ? (
                  free
                    ? <button type="button" aria-label={`Change ${p.name}`} onClick={e => { e.stopPropagation(); setPicking(idx) }} style={{ border: 'none', background: 'none', padding: 0 }}><Avatar p={p} ring /></button>
                    : <Avatar p={p} ring />
                ) : (
                  <button type="button" aria-label="Pick player" onClick={e => { e.stopPropagation(); setPicking(idx) }}
                    style={{ width: 36, height: 36, borderRadius: '50%', border: '1.5px dashed #9A9992', background: '#fff', color: '#6B6B66', fontSize: 18, boxShadow: '0 0 0 2px #fff' }}>+</button>
                )}
              </span>
            )
          })}
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, textAlign: 'center', lineHeight: 1.2 }}>{full || ps.some(Boolean) ? names(ps) : half === 1 ? 'Pick 1' : 'Pick 2'}</span>
        <span className={`win-tag${sel ? ' sel' : ''}`}>{sel ? 'WINNER' : full ? 'TAP IF WON' : 'PICK PLAYERS'}</span>
      </div>
    )
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log result" subtitle={matchTitle ?? 'Friendly game'}>
      {courts && courts.length > 1 && (
        <div className="seg">
          {courts.map((c, i) => (
            <button key={i} className={court === i ? 'sel' : ''} style={{ height: 40 }} onClick={() => {
              if (c.players.length < slots.length) return flash("That court isn't full")
              setCourt(i); setSlots(c.players); setWin(null)
            }}>{c.label}</button>
          ))}
        </div>
      )}
      {free && groups.length > 1 && (
        <select className="field" aria-label="Group" value={group ?? ''} style={{ height: 44 }}
          onChange={e => { setGroup(e.target.value); setSlots(singles ? [null, null] : [null, null, null, null]); setWin(null) }}>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}
      {free && (
        <div className="seg">
          {(['Doubles', 'Singles'] as const).map(label => {
            const sel = (label === 'Singles') === singles
            return <button key={label} className={sel ? 'sel' : ''} style={{ height: 40 }} onClick={() => {
              const s1 = label === 'Singles'
              setSingles(s1); setSlots(s1 ? [null, null] : [null, null, null, null]); setWin(null)
            }}>{label}</button>
          })}
        </div>
      )}
      <span style={{ fontSize: 13, color: '#6B6B66', marginTop: -8 }}>{full ? (half === 1 ? 'Tap who won.' : 'Tap the pair that won.') : half === 1 ? 'Tap + to pick each player.' : 'Tap + to pick the players for each pair.'}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 10, alignItems: 'center' }}>
        <Pair side="a" ps={a} />
        <span className="display" style={{ fontSize: 13, fontWeight: 700, color: '#9A9992' }}>VS</span>
        <Pair side="b" ps={b} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 10, alignItems: 'center', marginTop: -6 }}>
        {(['a', 'b'] as const).map((k, i) => (
          <input key={k} className="field" inputMode="numeric" pattern="[0-9]*" maxLength={2} placeholder="Score" aria-label={`Score for ${k === 'a' ? 'left' : 'right'} side`}
            value={score[k]} disabled={!full}
            onChange={e => {
              const next = { ...score, [k]: e.target.value.replace(/\D/g, '').slice(0, 2) }
              setScore(next)
              // Both scores in: the higher one won.
              if (next.a && next.b && Number(next.a) !== Number(next.b)) setWin(Number(next.a) > Number(next.b) ? 'a' : 'b')
            }}
            style={{ height: 44, textAlign: 'center', fontSize: 16, gridColumn: i === 0 ? 1 : 3 }} />
        ))}
      </div>
      <span className="note" style={{ textAlign: 'center', marginTop: -8 }}>Score is optional</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
        <button className="btn-2" style={{ height: 56 }} disabled={!full} onClick={() => { setSlots(shuffled(slots)); setWin(null); setScore({ a: '', b: '' }) }}>Shuffle</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save result'}</button>
      </div>
    </Sheet>
  )
}
