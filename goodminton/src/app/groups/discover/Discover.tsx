'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Frame } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { fmtDate } from '@/lib/format'
import { person } from '@/lib/people'
import { groupArtFor } from '@/lib/photos'
import { createClient } from '@/lib/supabase/client'
import type { GroupListing } from '@/lib/types'

/** Find groups: every public group, searchable; ask to join or open one you're in. */
export function Discover({ meId, meName, initial }: { meId: string; meName: string; initial: GroupListing[] }) {
  const { flash } = useFeedback()
  const [groups, setGroups] = useState(initial)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  async function search(term: string) {
    setQ(term)
    const { data } = await createClient().rpc('list_groups', { p_search: term })
    if (data) setGroups(data as GroupListing[])
  }
  async function ask(g: GroupListing) {
    setBusy(g.id)
    const { error } = await createClient().rpc('request_join', { p_group: g.id })
    setBusy(null)
    if (error) return flash(error.message)
    flash(`Asked to join ${g.name}`)
    setGroups(gs => gs.map(x => (x.id === g.id ? { ...x, requested: true } : x)))
  }

  return (
    <Frame me={person(meId, meName)} back="/">
      <div className="screen" style={{ gap: 18 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span style={{ fontSize: 14, color: '#6B6B66', fontWeight: 600 }}>Players near you</span>
          <span className="h1">Find groups</span>
        </div>
        <input className="field" style={{ height: 48 }} placeholder="Search groups" value={q} onChange={e => search(e.target.value)} maxLength={60} />
        {!groups.length && <div className="card" style={{ padding: 24, textAlign: 'center', color: '#6B6B66', fontSize: 14 }}>No groups found.</div>}
        <div className="stack" style={{ gap: 10 }}>
          {groups.map(g => (
            <div key={g.id} className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Link href={`/groups/${g.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                <span aria-hidden style={{ width: 52, height: 52, borderRadius: '50%', flex: 'none', background: `#0E4A30 url(${groupArtFor(g.id)}) center/cover` }} />
                <span className="stack" style={{ minWidth: 0, gap: 2 }}>
                  <span className="display" style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
                  <span style={{ fontSize: 12, color: '#6B6B66' }}>
                    {g.members} member{g.members === 1 ? '' : 's'} · {g.next_match ? `next ${fmtDate(g.next_match, 'Asia/Dubai')}` : 'no match planned'}
                  </span>
                </span>
              </Link>
              {g.is_member
                ? <Link href={`/groups/${g.id}`} className="chip-btn" style={{ height: 34, display: 'flex', alignItems: 'center' }}>Open</Link>
                : g.requested
                ? <span style={{ fontSize: 12, fontWeight: 700, color: '#9A9992', padding: '0 6px' }}>Requested</span>
                : <button className="chip-btn go" style={{ height: 34 }} disabled={busy === g.id} onClick={() => ask(g)}>Ask to join</button>}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  )
}
