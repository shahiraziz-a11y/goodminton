'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { Frame } from '@/components/Chrome'
import { NoGroup } from '@/components/NoGroup'
import { useFeedback } from '@/components/Feedback'
import { fmtDate, money } from '@/lib/format'
import { whatsappUrl } from '@/lib/match'
import { person } from '@/lib/people'
import { balancesFor, guestDues } from '@/lib/split'
import { createClient } from '@/lib/supabase/client'
import { CURRENCY } from '@/lib/supabase/env'
import type { LedgerMatch } from '@/lib/types'

export function Balances({ meId, meName, ledger, origin, inGroup = true }: { meId: string; meName: string; ledger: LedgerMatch[]; origin: string; inGroup?: boolean }) {
  const router = useRouter()
  const { flash } = useFeedback()
  const [busy, setBusy] = useState(false)
  // Splitwise-style: everyone across all groups, or one group at a time.
  const groupsHere = [...new Map(ledger.filter(l => l.group_id).map(l => [l.group_id!, l.group_name ?? 'Group'])).entries()]
  const [gf, setGf] = useState('all')
  const shown = gf === 'all' ? ledger : ledger.filter(l => l.group_id === gf)
  const cur = ledger[0]?.currency ?? CURRENCY
  const fmt = (n: number) => money(n, cur)
  const { net, lines, total } = balancesFor(meId, shown)
  const names: Record<string, string> = Object.assign({}, ...ledger.map(m => m.people))
  const friend = (id: string) => person(id, names[id] ?? 'Player')
  const list = Object.entries(net).filter(([, v]) => Math.abs(v) > 0.005)
  const guests = guestDues(meId, shown)

  // Mark every open transfer with this friend as settled: what I owe them, or (when I'm
  // the one receiving) what they owe me.
  async function settleWith(id: string, owedToMe: boolean) {
    setBusy(true)
    const supabase = createClient()
    const open = lines.filter(l => l.other === id && l.owedToMe === owedToMe && !l.transfer.settled)
    const results = await Promise.all(open.map(l => supabase.rpc('set_settled', {
      p_match: l.match.id, p_from: l.transfer.from, p_to: l.transfer.to, p_amount: l.transfer.amount,
    })))
    setBusy(false)
    const err = results.find(r => r.error)?.error
    if (err) return flash(err.message)
    flash(`Settled up with ${friend(id).first}`)
    router.refresh()
  }

  // A guest's share I carry: mark it collected (or not) once they've paid me back.
  async function collect(matchId: string, guest: string, amount: number | null) {
    setBusy(true)
    const { error } = await createClient().rpc('set_settled', { p_match: matchId, p_from: guest, p_to: meId, p_amount: amount })
    setBusy(false)
    if (error) return flash(error.message)
    flash(amount ? `Collected from ${friend(guest).first}` : 'Marked as not collected')
    router.refresh()
  }

  if (!inGroup && !ledger.length) {
    return (
      <Frame me={person(meId, meName)} tab="balances">
        <div className="screen">
          <span className="h1">Balances</span>
          <NoGroup title="Split the court, not hairs" line="Join or start a group. Court costs split themselves and you'll see who owes what." photo={4} />
        </div>
      </Frame>
    )
  }

  return (
    <Frame me={person(meId, meName)} tab="balances">
      <div className="screen">
        <span className="h1">Balances</span>
        {groupsHere.length > 1 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -18px', padding: '0 18px 2px', scrollbarWidth: 'none' }}>
            {[['all', 'All groups'] as const, ...groupsHere].map(([id, name]) => (
              <button key={id} className="chip-btn" onClick={() => setGf(id)}
                style={{ flex: 'none', height: 36, padding: '0 16px', fontWeight: 600, fontSize: 13, background: gf === id ? '#111111' : 'rgba(255,255,255,.55)', color: gf === id ? '#fff' : '#111111' }}>{name}</button>
            ))}
          </div>
        )}
        <div className="card stack" style={{ borderRadius: 28, padding: '26px 22px', gap: 8 }}>
          <span className="eyebrow">{total >= 0 ? 'You are owed' : 'You owe'}</span>
          <span className="display" style={{ fontSize: 48, letterSpacing: '-.05em', lineHeight: 1, color: '#0E5A3A' }}>{fmt(Math.abs(total))}</span>
          <span className="note">{gf === 'all' ? 'Unsettled' : `Unsettled in ${groupsHere.find(([id]) => id === gf)?.[1]}`}</span>
        </div>
        {!list.length && <div className="card" style={{ padding: 24, textAlign: 'center', color: '#6B6B66', fontSize: 14 }}>All square with everyone.</div>}
        <div className="stack" style={{ gap: 14 }}>
          {list.map(([id, v]) => {
            const p = friend(id)
            const amt = fmt(Math.abs(v))
            return (
              <div key={id} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Avatar p={p} size={38} />
                <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span>
                  <span style={{ fontSize: 12, color: '#6B6B66' }}>{v > 0 ? 'owes you' : 'you owe'}</span>
                </span>
                <span className="display" style={{ fontSize: 15, fontWeight: 700, color: v > 0 ? '#0E5A3A' : '#E0245E' }}>{amt}</span>
                {v > 0 ? (
                  // Their own line, so the name keeps its room.
                  <span style={{ display: 'flex', gap: 8, flex: '1 0 100%', justifyContent: 'flex-end' }}>
                    <a className="chip-btn" style={{ height: 34, display: 'flex', alignItems: 'center' }} target="_blank" rel="noreferrer"
                      href={whatsappUrl(`Hey ${p.first}, you owe me ${amt} from badminton 🏸 ${origin}/balances`)}>Nudge</a>
                    <button className="chip-btn" style={{ height: 34, background: '#0E5A3A', color: '#fff' }} disabled={busy}
                      onClick={() => confirm(`Mark ${p.first}'s ${amt} as paid to you?`) && settleWith(id, true)}>Paid</button>
                  </span>
                ) : (
                  <button className="chip-btn" style={{ height: 34, marginLeft: 4 }} disabled={busy}
                    onClick={() => confirm(`Mark ${amt} to ${p.first} as paid?`) && settleWith(id, false)}>Settle</button>
                )}
              </div>
            )
          })}
        </div>
        {guests.dues.length > 0 && (
          <div className="stack" style={{ gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="eyebrow">Collect from your guests</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: guests.open ? '#C2410C' : '#0E5A3A' }}>{guests.open ? `${fmt(guests.open)} to collect` : 'All collected'}</span>
            </div>
            <div className="card" style={{ padding: '4px 18px' }}>
              {guests.dues.map(d => (
                <div key={`${d.match.id}:${d.guest}`} className="row-line" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                  <Avatar p={friend(d.guest)} size={32} font={12} />
                  <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{friend(d.guest).name}</span>
                    <span style={{ fontSize: 12, color: '#6B6B66', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtDate(d.match.starts_at, d.match.timezone)} · {d.match.title}</span>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: d.collected ? '#9A9992' : '#111111', textDecoration: d.collected ? 'line-through' : 'none' }}>{fmt(d.amount)}</span>
                  <button className="chip-btn" disabled={busy} style={{ height: 32, fontSize: 12, flex: 'none', ...(d.collected ? { color: '#0E5A3A' } : {}) }}
                    onClick={() => collect(d.match.id, d.guest, d.collected ? null : d.amount)}>{d.collected ? 'Collected ✓' : 'Collected'}</button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="stack" style={{ gap: 12 }}>
          <span className="eyebrow">History</span>
          {!lines.length ? <span className="note">No payments yet.</span> : (
            <div className="card" style={{ padding: '4px 18px' }}>
              {lines.map(l => (
                <div key={`${l.match.id}:${l.transfer.from}>${l.transfer.to}`} className="row-line" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                  <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{l.owedToMe ? `${friend(l.other).first} owes you` : `You owe ${friend(l.other).first}`}</span>
                    <span style={{ fontSize: 12, color: '#6B6B66' }}>{fmtDate(l.match.starts_at, l.match.timezone)} · {l.match.title}{gf === 'all' && groupsHere.length > 1 && l.match.group_name ? ` · ${l.match.group_name}` : ''}</span>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{fmt(l.transfer.settled ? l.transfer.amount : l.transfer.open)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: l.transfer.settled ? '#0E5A3A' : '#D6336C', width: 36, textAlign: 'right' }}>
                    {l.transfer.settled ? 'PAID' : 'OPEN'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Frame>
  )
}
