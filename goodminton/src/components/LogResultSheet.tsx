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

type Court = { label: string; players: Person[] }

/**
 * "Log result" from the design: two pairs, tap the winners, save.
 * With `courts` (from a match) the players are fixed per court; without, pick any 4 from your players.
 */
export function LogResultSheet({ open, onClose, matchId, matchTitle, courts, initialCourt = 0 }: {
  open: boolean; onClose: () => void; matchId?: string; matchTitle?: string; courts?: Court[]; initialCourt?: number
}) {
  const router = useRouter()
  const { flash } = useFeedback()
  const [court, setCourt] = useState(initialCourt)
  const [slots, setSlots] = useState<(Person | null)[]>(() => courts?.[initialCourt]?.players ?? [null, null, null, null])
  const [win, setWin] = useState<'a' | 'b' | null>(null)
  const [picking, setPicking] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const free = !courts

  // Reset when reopened on another court.
  const [lastKey, setLastKey] = useState('')
  const key = `${open}:${initialCourt}`
  if (key !== lastKey) {
    setLastKey(key)
    setCourt(initialCourt)
    setSlots(courts?.[initialCourt]?.players ?? [null, null, null, null])
    setWin(null)
    setPicking(null)
  }

  const full = slots.every(Boolean)
  const a = slots.slice(0, 2), b = slots.slice(2, 4)
  const names = (ps: (Person | null)[]) => ps.map(p => p?.first ?? '…').join(' & ')

  async function save() {
    if (!full) return flash('Pick all 4 players')
    if (!win) return flash('Tap the pair that won')
    setBusy(true)
    const ids = slots.map(p => p!.id)
    const { error } = await createClient().rpc('log_game', {
      p_match: matchId ?? null, p_a1: ids[0], p_a2: ids[1], p_b1: ids[2], p_b2: ids[3], p_winner: win,
    })
    setBusy(false)
    if (error) return flash(error.message)
    flash(`${names(win === 'a' ? a : b)} win · leaderboard updated`)
    onClose()
    router.refresh()
  }

  async function newGuest(name: string) {
    const { data, error } = await createClient().rpc('create_guest', { p_name: name })
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
      <Sheet open={open} onClose={() => setPicking(null)} title={`Pick player ${picking + 1} of 4`} subtitle={picking < 2 ? 'Left pair' : 'Right pair'}>
        <PlayerPicker exclude={slots.filter((p, i) => p && i !== picking).map(p => p!.id)} onPick={p => place(person(p.id, p.full_name))} onNew={newGuest} newLabel="Add guest" />
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
            const idx = (side === 'a' ? 0 : 2) + i
            return (
              <span key={i} style={{ margin: '0 -4px', display: 'flex' }}>
                {p ? (
                  free
                    ? <button type="button" aria-label={`Change ${p.name}`} onClick={e => { e.stopPropagation(); setPicking(idx) }} style={{ border: 'none', background: 'none', padding: 0 }}><Avatar p={p} ring /></button>
                    : <Avatar p={p} ring />
                ) : (
                  <button type="button" aria-label="Pick player" onClick={e => { e.stopPropagation(); setPicking(idx) }}
                    style={{ width: 36, height: 36, borderRadius: '50%', border: '1.5px dashed #8A94A3', background: '#fff', color: '#5B6573', fontSize: 18, boxShadow: '0 0 0 2px #fff' }}>+</button>
                )}
              </span>
            )
          })}
        </div>
        <span style={{ fontSize: 14, fontWeight: 800, textAlign: 'center', lineHeight: 1.2 }}>{full || ps.some(Boolean) ? names(ps) : 'Pick 2'}</span>
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
              if (c.players.length < 4) return flash("That court isn't full")
              setCourt(i); setSlots(c.players); setWin(null)
            }}>{c.label}</button>
          ))}
        </div>
      )}
      <span style={{ fontSize: 13, color: '#5B6573', marginTop: -8 }}>{full ? 'Tap the pair that won.' : 'Tap + to pick the players for each pair.'}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 10, alignItems: 'center' }}>
        <Pair side="a" ps={a} />
        <span className="display" style={{ fontSize: 13, fontWeight: 800, color: '#8A94A3' }}>VS</span>
        <Pair side="b" ps={b} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
        <button className="btn-2" style={{ height: 56 }} disabled={!full} onClick={() => { setSlots(shuffled(slots)); setWin(null) }}>Shuffle</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save result'}</button>
      </div>
    </Sheet>
  )
}
