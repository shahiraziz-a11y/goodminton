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
import { photoFor } from '@/lib/photos'
import { fmtDate, fmtTime } from '@/lib/format'
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
  const member = !!g.my_role
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
        {m.role === 'owner' && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#0E5A3A' }}>OWNER</span>}
        {m.is_guest && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#9A9992' }}>GUEST</span>}
        {canAct && <button className="link-btn" aria-label={`Options for ${p.first}`} style={{ fontSize: 18, color: '#9A9992', padding: '0 4px' }} onClick={() => setActing(m)}>⋯</button>}
      </div>
    )
  }

  return (
    <Frame me={person(meId, meName)} tab="groups" back="/">
      <div className="screen" style={{ gap: 22 }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">{people.length} member{people.length === 1 ? '' : 's'}{owner ? ' · you run it' : ''}</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            <span className="h1" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{g.name}</span>
            {owner && <button className="chip-btn" onClick={() => { setName(g.name); setRenaming(true) }}>Rename</button>}
          </div>
        </div>

        {/* Someone finding the group: ask to join; the owner approves. */}
        {!member && (
          <div style={{ background: `linear-gradient(180deg, rgba(14,74,48,.55) 0%, rgba(6,42,26,.94) 75%), #0E4A30 url(${photoFor(g.id)}) center/cover`, color: '#fff', borderRadius: 28, padding: 18, paddingTop: 90, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 14, color: '#CFE3D5', lineHeight: 1.4 }}>Ask to join and the organiser will let you in. Then you can sign up for matches.</span>
            {g.my_status === 'requested'
              ? <span className="btn" style={{ height: 48, background: 'rgba(255,255,255,.16)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Request sent</span>
              : <button className="btn" style={{ height: 48, background: '#fff', color: '#111111' }} disabled={busy}
                  onClick={() => rpc('request_join', { p_group: g.id }, () => flash(`Asked to join ${g.name}`))}>Ask to join</button>}
          </div>
        )}

        {owner && !!g.requests?.length && (
          <div className="card stack" style={{ padding: '16px 18px', gap: 10, boxShadow: 'inset 0 0 0 1.5px rgba(229,72,77,.35)' }}>
            <span className="eyebrow" style={{ color: '#C2410C' }}>Join requests · {g.requests.length}</span>
            {g.requests.map(q => (
              <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar p={person(q.user_id, q.full_name)} size={32} font={11} />
                <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{q.full_name}</span>
                  <span style={{ fontSize: 12, color: '#9A9992' }}>asked {fmtDate(q.created_at, 'Asia/Dubai').replace(/^\w+ /, '')}</span>
                </span>
                <button className="chip-btn" style={{ height: 32, fontSize: 12, padding: '0 10px' }} disabled={busy} onClick={() => rpc('decide_request', { p_request: q.id, p_approve: false }, () => flash('Declined'))}>Decline</button>
                <button className="chip-btn go" style={{ height: 32, fontSize: 12, padding: '0 10px' }} disabled={busy} onClick={() => rpc('decide_request', { p_request: q.id, p_approve: true }, () => flash(`${q.full_name.split(' ')[0]} is in`))}>Approve</button>
              </div>
            ))}
          </div>
        )}

        {member && <div style={{ background: `linear-gradient(180deg, rgba(14,74,48,.6) 0%, rgba(6,42,26,.94) 70%), #0E4A30 url(${photoFor(g.id)}) center/cover`, color: '#fff', borderRadius: 28, padding: 18, paddingTop: 90, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 30px 50px -30px rgba(14,40,26,.65)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#CFE3D5' }}>Invite people</span>
          <span style={{ fontSize: 13, fontWeight: 700, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.08)', overflowWrap: 'anywhere' }}>{link}</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <a className="btn" style={{ height: 46, fontSize: 14, background: '#fff', color: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center' }} target="_blank" rel="noreferrer"
              href={whatsappUrl(`Join ${g.name} on Goodminton to see our badminton matches 🏸 ${link}`)}>Share on WhatsApp</a>
            <button className="btn-2" style={{ height: 46, fontSize: 14, color: '#fff', background: 'rgba(255,255,255,.16)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.3)' }} onClick={copy}>Copy link</button>
          </div>
          {owner && (
            <button className="link-btn" style={{ alignSelf: 'flex-start', fontSize: 12, color: '#CFE3D5' }} disabled={busy}
              onClick={() => confirm('Make a new link? The old one stops working.') && rpc('reset_invite', { p_group: g.id }, () => flash('New link made'))}>Reset link</button>
          )}
        </div>}

        <div style={{ display: 'grid', gridTemplateColumns: member ? '1fr 1fr' : '1fr', gap: 8 }}>
          {member && <Link className="row-btn go" href={`/new?group=${g.id}`}>+ New match</Link>}
          <Link className="row-btn" href={`/leaderboard?group=${g.id}#group`}>Rankings</Link>
        </div>

        {!!g.upcoming?.length && (
          <div className="stack" style={{ gap: 12 }}>
            <span className="eyebrow">Upcoming matches</span>
            <div className="card" style={{ padding: '2px 16px' }}>
              {g.upcoming.map(m => (
                <Link key={m.slug} href={`/m/${m.slug}`} className="row-line" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0' }}>
                  <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{m.title}</span>
                    <span style={{ fontSize: 12, color: '#6B6B66' }}>{fmtDate(m.starts_at, m.timezone)} · {fmtTime(m.starts_at, m.timezone)}{m.venue ? ` · ${m.venue}` : ''}</span>
                  </span>
                  <span className="badge" style={{ background: m.confirmed >= m.size ? '#111111' : '#0E5A3A', color: '#fff' }}>{m.confirmed}/{m.size}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

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

        {owner && (
          <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="stack" style={{ flex: 1, gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{g.is_public === false ? 'Private group' : 'Public group'}</span>
              <span style={{ fontSize: 12, color: '#6B6B66' }}>{g.is_public === false ? 'Hidden from Find groups. Invite link only.' : 'Anyone can find it and ask to join.'}</span>
            </span>
            <button className="chip-btn" disabled={busy} onClick={() => rpc('set_group_public', { p_group: g.id, p_public: g.is_public === false }, () => flash(g.is_public === false ? 'Now public' : 'Now private'))}>
              {g.is_public === false ? 'Make public' : 'Make private'}
            </button>
          </div>
        )}
        {member && !owner && (
          <button className="link-btn" style={{ alignSelf: 'center', color: '#E0245E' }} disabled={busy}
            onClick={() => confirm(`Leave ${g.name}? You'll stop seeing its matches (except ones you're in).`) && rpc('leave_group', { p_group: g.id }, () => { flash(`Left ${g.name}`); router.push('/') })}>Leave group</button>
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
        {acting?.is_guest && (() => {
          // Someone typed this name before the real person joined: merge the two.
          const first = acting.full_name.trim().split(/\s+/)[0].toLowerCase()
          const same = (m: GroupMember) => m.full_name.trim().split(/\s+/)[0].toLowerCase() === first
          const options = [...people.filter(same), ...people.filter(m => !same(m))]
          return (
            <div className="stack" style={{ gap: 6 }}>
              <span className="eyebrow">Same person as…</span>
              <span className="note" style={{ marginTop: -2 }}>Moves {acting.full_name}&apos;s games, matches and balances to their real account.</span>
              <div className="card" style={{ padding: '2px 14px', maxHeight: 260, overflowY: 'auto' }}>
                {options.map(m => (
                  <button key={m.id} type="button" className="row-line" disabled={busy}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', width: '100%', border: 'none', background: 'none', textAlign: 'left', color: '#111111' }}
                    onClick={() => confirm(`Merge ${acting.full_name} (guest) into ${m.full_name}? Their games, matches and balances move over. This can't be undone.`)
                      && rpc('merge_player', { p_from: acting.id, p_into: m.id }, () => { setActing(null); flash(`Merged into ${m.full_name}`) })}>
                    <Avatar p={person(m.id, m.full_name)} size={30} font={11} />
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{m.full_name}</span>
                    {same(m) && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#0E5A3A' }}>SAME NAME</span>}
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0E5A3A' }}>Merge</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })()}
        {acting && (
          <button className="btn-2" style={{ color: '#E0245E' }} disabled={busy}
            onClick={() => confirm(`Remove ${acting.full_name} from ${g.name}? They'll stop seeing its matches (except ones they're in).`) && rpc('remove_member', { p_group: g.id, p_user: acting.id }, () => { setActing(null); flash('Removed') })}>Remove from group</button>
        )}
      </Sheet>
    </Frame>
  )
}
