'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Frame } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { Sheet } from '@/components/Sheet'
import { fmtDate } from '@/lib/format'
import { person } from '@/lib/people'
import { createClient } from '@/lib/supabase/client'
import type { MyGroup } from '@/lib/types'

export function GroupsList({ meId, meName, groups }: { meId: string; meName: string; groups: MyGroup[] }) {
  const router = useRouter()
  const { flash } = useFeedback()
  const [creating, setCreating] = useState(false)
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
            <span style={{ fontSize: 14, color: '#5B6573', fontWeight: 600 }}>Your crews</span>
            <span className="h1">Groups</span>
          </div>
          <button className="chip-btn go" style={{ height: 40 }} onClick={() => { setName(''); setCreating(true) }}>+ New group</button>
        </div>
        <span className="note" style={{ marginTop: -10 }}>You only see matches, results and balances from your groups. Invite people with a group&apos;s link.</span>
        {!groups.length && (
          <div className="card stack" style={{ padding: 28, gap: 8, textAlign: 'center', alignItems: 'center' }}>
            <span className="display" style={{ fontSize: 17, fontWeight: 700 }}>No groups yet</span>
            <span className="note">Make one for the people you play with, then share its link.</span>
          </div>
        )}
        <div className="stack" style={{ gap: 10 }}>
          {groups.map(g => (
            <Link key={g.id} href={`/groups/${g.id}`} className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <span className="avatar" style={{ width: 44, height: 44, borderRadius: 14, background: '#0F3D35', color: '#5FE3BE', fontSize: 16 }}>{g.name.slice(0, 2).toUpperCase()}</span>
              <span className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <span style={{ fontSize: 16, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
                <span style={{ fontSize: 12, color: '#5B6573' }}>
                  {g.members} member{g.members === 1 ? '' : 's'}{g.my_role === 'owner' ? ' · you run it' : ''}{g.last_match ? ` · last match ${fmtDate(g.last_match, 'Asia/Dubai')}` : ''}
                </span>
              </span>
              <span style={{ color: '#8A94A3', fontSize: 18 }}>›</span>
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
