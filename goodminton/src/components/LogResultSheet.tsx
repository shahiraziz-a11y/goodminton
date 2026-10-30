'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { useFeedback } from './Feedback'
import { loadPlayers, PlayerPicker } from './PlayerPicker'
import { Sheet } from './Sheet'
import { person, type Person } from '@/lib/people'
import { recentMatchups, recentPairs, recentPlayers, shuffled } from '@/lib/stats'
import { createClient } from '@/lib/supabase/client'
import type { Game, MyGroup } from '@/lib/types'

type Court = { label: string; players: Person[] }
type Win = 'a' | 'b'
/** A finished game waiting to be saved with the others. */
type Queued = { slots: Person[]; win: Win; sa: number | null; sb: number | null }
/** A logged game to change (edit), or players to start from (duplicate). */
export type GameDraft = { id?: string; a: Person[]; b: Person[]; winner?: Win; score_a?: number | null; score_b?: number | null }

/**
 * "Log results": two pairs, tap the winners. Add several games, then save them all at once.
 * With `courts` (from a match) the players are fixed per court; without, pick any 4 from your players,
 * or tap a recent matchup or pair. `edit` changes one logged game; `prefill` starts with its players.
 */
export function LogResultSheet({ open, onClose, matchId, matchTitle, courts, initialCourt = 0, groups = [], defaultGroup, recent, people, edit, prefill }: {
  open: boolean; onClose: () => void; matchId?: string; matchTitle?: string; courts?: Court[]; initialCourt?: number
  /** Without a match: the game goes in one of these groups, and players come from it. */
  groups?: MyGroup[]; defaultGroup?: string | null
  /** Recent games in the group and their names (else they're loaded when the sheet opens). */
  recent?: Game[]; people?: Record<string, string>
  edit?: GameDraft | null; prefill?: GameDraft | null
}) {
  const router = useRouter()
  const { flash } = useFeedback()
  const [court, setCourt] = useState(initialCourt)
  const [slots, setSlots] = useState<(Person | null)[]>([null, null, null, null])
  const [singles, setSingles] = useState(false)
  const [win, setWin] = useState<Win | null>(null)
  const [score, setScore] = useState({ a: '', b: '' })
  const [queue, setQueue] = useState<Queued[]>([])
  const [picking, setPicking] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const free = !courts
  const canPick = free || !!edit
  const [group, setGroup] = useState<string | null>(defaultGroup ?? groups[0]?.id ?? null)
  const [loaded, setLoaded] = useState<{ group: string | null; games: Game[]; people: Record<string, string> } | null>(null)

  // Reset whenever it opens for something else.
  const [lastKey, setLastKey] = useState('')
  const key = `${open}:${initialCourt}:${edit?.id ?? ''}:${prefill ? [...prefill.a, ...prefill.b].map(p => p.id).join() : ''}`
  if (key !== lastKey) {
    setLastKey(key)
    setCourt(initialCourt)
    const start = edit ?? prefill
    const s1 = start ? start.a.length === 1 : singles
    setSingles(s1)
    setSlots(start ? [...start.a, ...start.b] : courts?.[initialCourt]?.players ?? (s1 ? [null, null] : [null, null, null, null]))
    setWin(edit?.winner ?? null)
    setScore({ a: edit?.score_a != null ? String(edit.score_a) : '', b: edit?.score_b != null ? String(edit.score_b) : '' })
    setQueue([])
    setPicking(null)
    if (open && defaultGroup && defaultGroup !== group) setGroup(defaultGroup)
  }

  // Recent games for the quick picks: given, or loaded once per group.
  useEffect(() => {
    if (!open || !free || recent || (loaded && loaded.group === group)) return
    Promise.resolve(createClient().rpc('get_leaderboard', group ? { p_group: group } : {})).then(({ data }) => {
      const d = data as { games?: Game[]; people?: Record<string, string> } | null
      setLoaded({ group, games: d?.games ?? [], people: d?.people ?? {} })
    }, () => {})
  }, [open, free, recent, group, loaded])
  const games = recent ?? (loaded?.group === group ? loaded.games : [])
  const names = people ?? loaded?.people ?? {}
  const who = (id: string) => person(id, names[id] ?? '?')

  const full = slots.every(Boolean)
  const half = slots.length / 2
  const a = slots.slice(0, half), b = slots.slice(half)
  const pairName = (ps: (Person | null)[]) => ps.map(p => p?.first ?? '…').join(' & ')

  /** The game on screen, checked; a string says what's missing. */
  function current(): Queued | string {
    if (!full) return `Pick all ${slots.length} players`
    if (!win) return half === 1 ? 'Tap who won' : 'Tap the pair that won'
    const [ra, rb] = [score.a.trim(), score.b.trim()]
    if (!!ra !== !!rb) return 'Enter both scores, or leave both empty'
    const [na, nb] = [Number(ra), Number(rb)]
    if (ra && (!Number.isInteger(na) || !Number.isInteger(nb) || na > 99 || nb > 99)) return 'Scores are 0 to 99'
    if (ra && (na === nb || (na > nb) !== (win === 'a'))) return 'The winners need the higher score'
    return { slots: slots as Person[], win, sa: ra ? na : null, sb: rb ? nb : null }
  }
  const now = current()
  const ready = typeof now !== 'string'

  function addToQueue() {
    if (typeof now === 'string') return flash(now)
    setQueue(q => [...q, now])
    // Same players, ready for the next game.
    setWin(null)
    setScore({ a: '', b: '' })
  }

  const describe = (g: Queued) => {
    const h = g.slots.length / 2
    const [wa, wb] = g.win === 'a' ? [g.slots.slice(0, h), g.slots.slice(h)] : [g.slots.slice(h), g.slots.slice(0, h)]
    return `${pairName(wa)} beat ${pairName(wb)}${g.sa != null && g.sb != null ? ` · ${Math.max(g.sa, g.sb)}–${Math.min(g.sa, g.sb)}` : ''}`
  }

  async function save() {
    // A half-entered game on screen isn't dropped silently.
    if (typeof now === 'string' && (!queue.length || win || score.a || score.b)) return flash(now)
    const all = typeof now === 'string' ? queue : [...queue, now]
    const ids = (x: Queued) => {
      const h = x.slots.length / 2, i = x.slots.map(p => p.id)
      return { a1: i[0], a2: h === 2 ? i[1] : null, b1: i[h], b2: h === 2 ? i[3] : null }
    }
    setBusy(true)
    const db = createClient()
    const { error } = edit?.id
      ? await db.rpc('edit_game', { p_game: edit.id, ...Object.fromEntries(Object.entries(ids(all[0])).map(([k, v]) => [`p_${k}`, v])), p_winner: all[0].win, p_score_a: all[0].sa, p_score_b: all[0].sb })
      : await db.rpc('log_games', {
        p_match: matchId ?? null, p_group: matchId ? null : group,
        p_games: all.map(x => ({ ...ids(x), winner: x.win, score_a: x.sa, score_b: x.sb })),
      })
    setBusy(false)
    if (error) return flash(error.message)
    flash(edit?.id ? 'Result updated · leaderboard updated' : all.length > 1 ? `${all.length} games saved · leaderboard updated` : `${describe(all[0])} · leaderboard updated`)
    setQueue([])
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
  function fill(next: (Person | null)[]) {
    setSlots(next)
    setWin(null)
    setScore({ a: '', b: '' })
  }
  /** A recent pair goes on the empty side (left first); anyone in it leaves the other side. */
  function placePair(ids: string[]) {
    const pair = ids.map(who)
    const left = !slots[0] && !slots[1]
    const other = (left ? slots.slice(2) : slots.slice(0, 2)).map(p => (p && ids.includes(p.id) ? null : p))
    fill(left ? [...pair, ...other] : [...other, ...pair])
  }

  if (picking !== null) {
    return (
      <Sheet open={open} onClose={() => setPicking(null)} title={`Pick player ${picking + 1} of ${slots.length}`} subtitle={half === 1 ? (picking === 0 ? 'Left side' : 'Right side') : picking < 2 ? 'Left pair' : 'Right pair'}>
        <PlayerPicker exclude={slots.filter((p, i) => p && i !== picking).map(p => p!.id)} onPick={p => place(person(p.id, p.full_name))} onNew={newGuest} newLabel="Add guest"
          group={canPick ? group : undefined} recent={recentPlayers(games)} />
        <button className="btn-2" onClick={() => setPicking(null)}>Back</button>
      </Sheet>
    )
  }

  const Pair = ({ side, ps }: { side: Win; ps: (Person | null)[] }) => {
    const sel = win === side
    return (
      <div className={`pair-card${sel ? ' sel' : ''}`} onClick={() => full && setWin(side)} role="button" aria-pressed={sel}>
        <div style={{ display: 'flex' }}>
          {ps.map((p, i) => {
            const idx = (side === 'a' ? 0 : half) + i
            return (
              <span key={i} style={{ margin: '0 -4px', display: 'flex' }}>
                {p ? (
                  canPick
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
        <span style={{ fontSize: 14, fontWeight: 700, textAlign: 'center', lineHeight: 1.2 }}>{full || ps.some(Boolean) ? pairName(ps) : half === 1 ? 'Pick 1' : 'Pick 2'}</span>
        <span className={`win-tag${sel ? ' sel' : ''}`}>{sel ? 'WINNER' : full ? 'TAP IF WON' : 'PICK PLAYERS'}</span>
      </div>
    )
  }

  const quick = free && !edit?.id && !singles
  const matchups = quick ? recentMatchups(games) : []
  const pairs = quick ? recentPairs(games) : []
  const chip = { flex: 'none', height: 34, padding: '0 12px', borderRadius: 99, border: 'none', background: 'rgba(255,255,255,.75)', boxShadow: '0 0 0 1px #E2E0DA', fontSize: 13, fontWeight: 700, color: '#111111', whiteSpace: 'nowrap' } as const
  const row = { display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -20px', padding: '2px 20px 4px', scrollbarWidth: 'none' } as const
  const total = queue.length + (ready ? 1 : 0)

  return (
    <Sheet open={open} onClose={onClose} title={edit?.id ? 'Edit result' : 'Log results'} subtitle={matchTitle ?? 'Friendly game'}>
      {courts && courts.length > 1 && !edit?.id && (
        <div className="seg">
          {courts.map((c, i) => (
            <button key={i} className={court === i ? 'sel' : ''} style={{ height: 40 }} onClick={() => {
              if (c.players.length < slots.length) return flash("That court isn't full")
              setCourt(i); fill(c.players)
            }}>{c.label}</button>
          ))}
        </div>
      )}
      {free && !edit?.id && groups.length > 1 && (
        <select className="field" aria-label="Group" value={group ?? ''} style={{ height: 44 }}
          onChange={e => { setGroup(e.target.value); setQueue([]); fill(singles ? [null, null] : [null, null, null, null]) }}>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}
      {free && !edit?.id && (
        <div className="seg">
          {(['Doubles', 'Singles'] as const).map(label => {
            const sel = (label === 'Singles') === singles
            return <button key={label} className={sel ? 'sel' : ''} style={{ height: 40 }} onClick={() => {
              const s1 = label === 'Singles'
              if (s1 !== singles) { setSingles(s1); setQueue([]); fill(s1 ? [null, null] : [null, null, null, null]) }
            }}>{label}</button>
          })}
        </div>
      )}
      {matchups.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Recent matchups</span>
          <div style={row}>
            {matchups.map(m => (
              <button key={[...m.a, ...m.b].join()} type="button" style={chip} onClick={() => fill([...m.a, ...m.b].map(who))}>
                {pairName(m.a.map(who))} <span style={{ color: '#9A9992', fontWeight: 600 }}>vs</span> {pairName(m.b.map(who))}
              </button>
            ))}
          </div>
        </div>
      )}
      {pairs.length > 0 && (
        <div className="stack" style={{ gap: 6, marginTop: matchups.length ? -4 : 0 }}>
          <span className="eyebrow">Recent pairs</span>
          <div style={row}>
            {pairs.map(p => (
              <button key={p.join()} type="button" onClick={() => placePair(p)}
                style={{ ...chip, background: 'rgba(14,90,58,.08)', boxShadow: '0 0 0 1px rgba(14,90,58,.18)', color: '#0E5A3A' }}>{pairName(p.map(who))}</button>
            ))}
          </div>
        </div>
      )}
      <span style={{ fontSize: 13, color: '#6B6B66' }}>
        {full ? (half === 1 ? 'Tap who won.' : 'Tap the pair that won.') : half === 1 ? 'Tap + to pick each player.' : pairs.length ? 'Tap a recent pair, or + to pick players.' : 'Tap + to pick the players for each pair.'}
      </span>
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
      {!edit?.id && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button className="btn-2" style={{ height: 48 }} disabled={!full} onClick={() => fill(shuffled(slots))}>Shuffle pairs</button>
          <button className="btn-2" style={{ height: 48, color: '#0E5A3A' }} disabled={!ready} onClick={addToQueue}>+ Add game</button>
        </div>
      )}
      {queue.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Ready to save · {queue.length}</span>
          <div className="card" style={{ padding: '2px 14px' }}>
            {queue.map((g, i) => (
              <div key={i} className="row-line" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
                <span className="display" style={{ width: 18, fontSize: 12, fontWeight: 700, color: '#9A9992', flex: 'none' }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{describe(g)}</span>
                <button type="button" aria-label={`Remove game ${i + 1}`} onClick={() => setQueue(q => q.filter((_, j) => j !== i))}
                  style={{ border: 'none', background: 'none', color: '#9A9992', fontSize: 20, padding: '0 4px' }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <button className="btn" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : edit?.id ? 'Save changes' : total > 1 ? `Save ${total} games` : 'Save result'}
      </button>
    </Sheet>
  )
}
