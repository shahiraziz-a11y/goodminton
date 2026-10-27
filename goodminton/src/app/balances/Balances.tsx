'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { Frame } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { fmtDate, money } from '@/lib/format'
import { whatsappUrl } from '@/lib/match'
import { person } from '@/lib/people'
import { balancesFor } from '@/lib/split'
import { createClient } from '@/lib/supabase/client'
import { CURRENCY } from '@/lib/supabase/env'
import type { LedgerMatch } from '@/lib/types'

export function Balances({ meId, meName, ledger, origin }: { meId: string; meName: string; ledger: LedgerMatch[]; origin: string }) {
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

  // Mark every open transfer with this friend, where I'm the one paying, as settled.
  async function settleWith(id: string) {
    setBusy(true)
    const supabase = createClient()
    const open = lines.filter(l => l.other === id && !l.owedToMe && !l.transfer.settled)
    const results = await Promise.all(open.map(l => supabase.rpc('set_settled', {
      p_match: l.match.id, p_from: l.transfer.from, p_to: l.transfer.to, p_amount: l.transfer.amount,
    })))
    setBusy(false)
    const err = results.find(r => r.error)?.error
    if (err) return flash(err.message)
    flash(`Settled up with ${friend(id).first}`)
    router.refresh()
  }

  return (
    <Frame me={person(meId, meName)} tab="balances">
      <div className="screen">
        <span className="h1">Balances</span>
        {groupsHere.length > 1 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -18px', padding: '0 18px 2px', scrollbarWidth: 'none' }}>
            {[['all', 'All groups'] as const, ...groupsHere].map(([id, name]) => (
              <button key={id} className="chip-btn" onClick={() => setGf(id)}
                style={{ flex: 'none', height: 34, background: gf === id ? '#111111' : '#fff', color: gf === id ? '#fff' : '#111111', boxShadow: gf === id ? 'none' : '0 0 0 1px #E2E0DA' }}>{name}</button>
            ))}
          </div>
        )}
        <div className="stack" style={{ borderRadius: 28, padding: '26px 22px', background: '#F1F0EC', boxShadow: '0 0 0 1px #E2E0DA', gap: 8 }}>
          <span className="eyebrow">{total >= 0 ? 'You are owed' : 'You owe'}</span>
          <span className="display" style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1, color: '#0E5A3A' }}>{fmt(Math.abs(total))}</span>
          <span className="note">{gf === 'all' ? 'Across all groups, unsettled' : `In ${groupsHere.find(([id]) => id === gf)?.[1]}, unsettled`}</span>
        </div>
        {!list.length && <div className="card" style={{ padding: 24, textAlign: 'center', color: '#6B6B66', fontSize: 14 }}>All square with everyone.</div>}
        <div className="stack" style={{ gap: 14 }}>
          {list.map(([id, v]) => {
            const p = friend(id)
            const amt = fmt(Math.abs(v))
            return (
              <div key={id} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar p={p} size={38} />
                <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span>
                  <span style={{ fontSize: 12, color: '#6B6B66' }}>{v > 0 ? 'owes you' : 'you owe'}</span>
                </span>
                <span className="display" style={{ fontSize: 15, fontWeight: 700, color: v > 0 ? '#0E5A3A' : '#E0245E' }}>{amt}</span>
                {v > 0 ? (
                  <a className="chip-btn" style={{ height: 34, marginLeft: 4, display: 'flex', alignItems: 'center' }} target="_blank" rel="noreferrer"
                    href={whatsappUrl(`Hey ${p.first}, you owe me ${amt} from badminton 🏸 ${origin}/balances`)}>Nudge</a>
                ) : (
                  <button className="chip-btn" style={{ height: 34, marginLeft: 4 }} disabled={busy}
                    onClick={() => confirm(`Mark ${amt} to ${p.first} as paid?`) && settleWith(id)}>Settle</button>
                )}
              </div>
            )
          })}
        </div>
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
                  <span style={{ fontSize: 14, fontWeight: 800 }}>{fmt(l.transfer.settled ? l.transfer.amount : l.transfer.open)}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: l.transfer.settled ? '#0E5A3A' : '#D6336C', width: 36, textAlign: 'right' }}>
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
