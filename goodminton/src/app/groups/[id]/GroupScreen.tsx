'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { Frame } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { Sheet } from '@/components/Sheet'
import { whatsappUrl } from '@/lib/match'
import { person } from '@/lib/people'
import { createClient } from '@/lib/supabase/client'
import type { GroupDetail, GroupMember } from '@/lib/types'

export function GroupScreen({ meId, meName, g, origin }: { meId: string; meName: string; g: GroupDetail; origin: string }) {
  const router = useRouter()
  const { flash } = useFeedback()
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(g.name)
  const [acting, setActing] = useState<GroupMember | null>(null)
  const owner = g.my_role === 'owner'
  const link = `${origin}/g/${g.invite_code}`
  const people = g.members.filter(m => !m.is_guest)
  const guests = g.members.filter(m => m.is_guest)

  async function rpc(fn: string, args: Record<string, unknown>, done?: (data: unknown) => void) {
    setBusy(true)
    const { data, error } = await createClient().rpc(fn, args)
    setBusy(false)
    if (error) return flash(error.message)
    done?.(data)
    router.refresh()
  }

  async function copy() {
    try { await navigator.clipboard.writeText(link); flash('Link copied') } catch { flash(link) }
  }

  const row = (m: GroupMember) => {
    const p = person(m.id, m.full_name)
    const canAct = owner && m.id !== meId
    return (
      <div key={m.id} className="row-line" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
        <Avatar p={p} size={32} font={11} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: m.id === meId ? 800 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.full_name}{m.id === meId ? ' · You' : ''}
        </span>
        {m.role === 'owner' && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: '#0E5A3A' }}>OWNER</span>}
        {m.is_guest && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: '#9A9992' }}>GUEST</span>}
        {canAct && <button className="link-btn" aria-label={`Options for ${p.first}`} style={{ fontSize: 18, color: '#9A9992', padding: '0 4px' }} onClick={() => setActing(m)}>⋯</button>}
      </div>
    )
  }

  return (
    <Frame me={person(meId, meName)} tab="groups" back="/groups">
      <div className="screen" style={{ gap: 22 }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">{people.length} member{people.length === 1 ? '' : 's'}{owner ? ' · you run it' : ''}</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            <span className="h1" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{g.name}</span>
            {owner && <button className="chip-btn" onClick={() => { setName(g.name); setRenaming(true) }}>Rename</button>}
          </div>
        </div>

        <div style={{ background: '#0E4A30', color: '#fff', borderRadius: 22, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: '#9FE0BC' }}>Invite people</span>
          <span style={{ fontSize: 13, color: '#CFE3D5', lineHeight: 1.45 }}>Anyone with this link can join and see the group&apos;s matches, results and balances.</span>
          <span style={{ fontSize: 13, fontWeight: 700, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.08)', overflowWrap: 'anywhere' }}>{link}</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <a className="btn" style={{ height: 46, fontSize: 14, background: '#9FE0BC', color: '#062A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }} target="_blank" rel="noreferrer"
              href={whatsappUrl(`Join ${g.name} on Goodminton to see our badminton matches 🏸 ${link}`)}>Share on WhatsApp</a>
            <button className="btn-2" style={{ height: 46, fontSize: 14 }} onClick={copy}>Copy link</button>
          </div>
          {owner && (
            <button className="link-btn" style={{ alignSelf: 'flex-start', fontSize: 12, color: '#CFE3D5' }} disabled={busy}
              onClick={() => confirm('Make a new link? The old one stops working.') && rpc('reset_invite', { p_group: g.id }, () => flash('New link made'))}>Reset link</button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Link className="row-btn go" href={`/new?group=${g.id}`}>+ New match</Link>
          <Link className="row-btn" href={`/leaderboard?group=${g.id}`}>Leaderboard</Link>
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <span className="eyebrow">Members</span>
          <div className="card" style={{ padding: '4px 16px' }}>{people.map(row)}</div>
        </div>
        {guests.length > 0 && (
          <div className="stack" style={{ gap: 12 }}>
            <span className="eyebrow">Guests (no app)</span>
            <div className="card" style={{ padding: '4px 16px' }}>{guests.map(row)}</div>
          </div>
        )}

        {!owner && (
          <button className="link-btn" style={{ alignSelf: 'center', color: '#E0245E' }} disabled={busy}
            onClick={() => confirm(`Leave ${g.name}? You'll stop seeing its matches (except ones you're in).`) && rpc('leave_group', { p_group: g.id }, () => { flash(`Left ${g.name}`); router.push('/groups') })}>Leave group</button>
        )}
      </div>

      <Sheet open={renaming} onClose={() => setRenaming(false)} title="Rename group">
        <input className="field" style={{ height: 50 }} value={name} maxLength={60} autoFocus onChange={e => setName(e.target.value)} />
        <button className="btn" disabled={busy} onClick={() => rpc('rename_group', { p_group: g.id, p_name: name }, () => { setRenaming(false); flash('Renamed') })}>Save</button>
      </Sheet>
      <Sheet open={!!acting} onClose={() => setActing(null)} title={acting?.full_name ?? ''}>
        {acting && !acting.is_guest && (
          <button className="btn-2" disabled={busy}
            onClick={() => confirm(`Make ${acting.full_name} the owner? You'll become a member.`) && rpc('make_owner', { p_group: g.id, p_user: acting.id }, () => { setActing(null); flash(`${acting.full_name} owns the group now`) })}>Make owner</button>
        )}
        {acting && (
          <button className="btn-2" style={{ color: '#E0245E' }} disabled={busy}
            onClick={() => confirm(`Remove ${acting.full_name} from ${g.name}? They'll stop seeing its matches (except ones they're in).`) && rpc('remove_member', { p_group: g.id, p_user: acting.id }, () => { setActing(null); flash('Removed') })}>Remove from group</button>
        )}
      </Sheet>
    </Frame>
  )
}
