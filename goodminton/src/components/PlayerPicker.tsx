'use client'

import { useEffect, useMemo, useState } from 'react'
import { Avatar } from './Avatar'
import { useFeedback } from './Feedback'
import { person } from '@/lib/people'
import { createClient } from '@/lib/supabase/client'
import type { PlayerOption } from '@/lib/types'

/** Loads the people in a group (or all my groups) once per page. */
const cache = new Map<string, Promise<PlayerOption[]>>()
export function loadPlayers(refresh = false, group?: string | null) {
  const k = group ?? ''
  if (refresh) cache.clear()
  if (!cache.has(k)) {
    cache.set(k, Promise.resolve(createClient().rpc('my_players', group ? { p_group: group } : {})).then(({ data, error }) => {
      if (error) { cache.delete(k); throw error }
      return (data ?? []) as PlayerOption[]
    }))
  }
  return cache.get(k)!
}

/**
 * Search your players and pick one, or type a new name to add them as a guest.
 * `onPick` gets an existing player; `onNew` gets a typed name (the caller decides how to create it).
 */
export function PlayerPicker({ exclude = [], onPick, onNew, newLabel = 'Add as new player', group }: {
  exclude?: string[]; onPick: (p: PlayerOption) => void; onNew?: (name: string) => void; newLabel?: string; group?: string | null
}) {
  const { flash } = useFeedback()
  const [all, setAll] = useState<PlayerOption[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => { setAll(null); loadPlayers(false, group).then(setAll, e => flash(e.message)) }, [flash, group])

  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (all ?? []).filter(p => !exclude.includes(p.id) && (!term || p.full_name.toLowerCase().includes(term)))
  }, [all, q, exclude])
  const exact = (all ?? []).some(p => p.full_name.toLowerCase() === q.trim().toLowerCase())

  return (
    <div className="stack" style={{ gap: 10, minHeight: 0 }}>
      <input className="field" style={{ height: 46 }} placeholder="Search or type a new name" value={q} onChange={e => setQ(e.target.value)} maxLength={60} autoFocus />
      <div className="stack picker-list">
        {all === null && <span className="note" style={{ padding: '10px 4px' }}>Loading players…</span>}
        {list.map(p => {
          const pp = person(p.id, p.full_name)
          return (
            <button key={p.id} type="button" onClick={() => onPick(p)} className="picker-row">
              <Avatar p={pp} size={32} font={12} />
              <span style={{ flex: 1, textAlign: 'left', fontSize: 15, fontWeight: 600 }}>{p.full_name}</span>
              {p.is_guest && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: '#8A94A3' }}>GUEST</span>}
            </button>
          )
        })}
        {all !== null && !list.length && !q.trim() && <span className="note" style={{ padding: '10px 4px' }}>No players yet. Type a name to add one.</span>}
        {onNew && q.trim() && !exact && (
          <button type="button" className="picker-row" onClick={() => onNew(q.trim())}>
            <span className="avatar" style={{ width: 32, height: 32, fontSize: 18, background: '#F1F3F6', color: '#0E7F66' }}>+</span>
            <span style={{ flex: 1, textAlign: 'left', fontSize: 15 }}>{newLabel}: <b>{q.trim()}</b></span>
          </button>
        )}
      </div>
    </div>
  )
}
