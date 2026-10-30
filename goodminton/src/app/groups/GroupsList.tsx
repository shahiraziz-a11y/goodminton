'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Frame } from '@/components/Chrome'
import { NoGroup } from '@/components/NoGroup'
import { useFeedback } from '@/components/Feedback'
import { Sheet } from '@/components/Sheet'
import { fmtDate } from '@/lib/format'
import { person } from '@/lib/people'
import { photoFor } from '@/lib/photos'
import { createClient } from '@/lib/supabase/client'
import type { MyGroup } from '@/lib/types'

export function GroupsList({ meId, meName, groups, startNew = false }: { meId: string; meName: string; groups: MyGroup[]; startNew?: boolean }) {
  const router = useRouter()
  const { flash } = useFeedback()
  const [creating, setCreating] = useState(startNew)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!name.trim()) return flash('Give the group a name')
    setBusy(true)
    const { data, error } = await createClient().rpc('create_group', { p_name: name.trim() })
    setBusy(false)
    if (error) return flash(error.message)
    router.push(`/groups/${data}`)
  }

  return (
    <Frame me={person(meId, meName)} tab="groups">
      <div className="screen" style={{ gap: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
          <div className="stack" style={{ gap: 6 }}>
            <span style={{ fontSize: 14, color: '#6B6B66', fontWeight: 600 }}>Your crews</span>
            <span className="h1">Groups</span>
          </div>
          {groups.length > 0 && <button className="chip-btn go" style={{ height: 40 }} onClick={() => { setName(''); setCreating(true) }}>+ New group</button>}
        </div>
        {!groups.length && <NoGroup title="Find your crew" line="Start a group for the people you play with and share its link." photo={2} onStart={() => { setName(''); setCreating(true) }} />}
        <div className="stack" style={{ gap: 10 }}>
          {groups.map(g => (
            <Link key={g.id} href={`/groups/${g.id}`} className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
              <span aria-hidden style={{ width: 56, height: 56, borderRadius: 16, flex: 'none', background: `#0E4A30 url(${photoFor(g.id)}) center/cover`, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.4)' }} />
              <span className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <span className="display" style={{ fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
                <span style={{ fontSize: 12, color: '#6B6B66' }}>
                  {g.members} member{g.members === 1 ? '' : 's'}{g.my_role === 'owner' ? ' · you run it' : ''}{g.last_match ? ` · last match ${fmtDate(g.last_match, 'Asia/Dubai')}` : ''}
                </span>
              </span>
              <span style={{ color: '#9A9992', fontSize: 18 }}>›</span>
            </Link>
          ))}
        </div>
      </div>
      <Sheet open={creating} onClose={() => setCreating(false)} title="New group" subtitle="e.g. Tuesday crew, Office badminton">
        <input className="field" style={{ height: 50 }} placeholder="Group name" value={name} maxLength={60} autoFocus
          onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
        <button className="btn" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create group'}</button>
      </Sheet>
    </Frame>
  )
}
