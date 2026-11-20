'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { Frame } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { fmtDate, money } from '@/lib/format'
import { whatsappUrl } from '@/lib/match'
import { person } from '@/lib/people'
import { balancesFor, breakdownWith } from '@/lib/split'
import { createClient } from '@/lib/supabase/client'
import { CURRENCY } from '@/lib/supabase/env'
import type { LedgerMatch } from '@/lib/types'

/** Everything between me and one person: each match's split, and the payments between us. */
export function PersonBalance({ meId, meName, other, ledger, origin }: { meId: string; meName: string; other: string; ledger: LedgerMatch[]; origin: string }) {
  const router = useRouter()
  const { flash } = useFeedback()
  const [busy, setBusy] = useState(false)
  const names: Record<string, string> = Object.assign({}, ...ledger.map(m => m.people))
  const p = person(other, names[other] ?? 'Player')
  const cur = ledger[0]?.currency ?? CURRENCY
  const fmt = (n: number) => money(Math.abs(n), cur)
  const { rows, payments, net } = breakdownWith(meId, other, ledger)

  async function settleAll() {
    const lines = balancesFor(meId, ledger).lines.filter(l => l.other === other && !l.transfer.settled)
    setBusy(true)
    const db = createClient()
    const res = await Promise.all(lines.map(l => db.rpc('set_settled', { p_match: l.match.id, p_from: l.transfer.from, p_to: l.transfer.to, p_amount: l.transfer.amount })))
    setBusy(false)
    const err = res.find(x => x.error)?.error
    if (err) return flash(err.message)
    flash(`Settled up with ${p.first}`)
    router.refresh()
  }

  return (
    <Frame me={person(meId, meName)} tab="balances" back="/balances">
      <div className="screen" style={{ gap: 18 }}>
        <div className="card stack" style={{ borderRadius: 28, padding: 22, gap: 12, alignItems: 'center', textAlign: 'center' }}>
          <Avatar p={p} size={56} font={18} />
          <span className="display" style={{ fontSize: 18 }}>{p.name}</span>
          <span className="display" style={{ fontSize: 40, letterSpacing: '-.05em', lineHeight: 1, color: net > 0 ? '#0E5A3A' : net < 0 ? '#E0245E' : '#111111' }}>{fmt(net)}</span>
          <span className="note">{net > 0.005 ? `${p.first} owes you` : net < -0.005 ? `You owe ${p.first}` : 'All square'}</span>
          {Math.abs(net) > 0.005 && (
            <div style={{ display: 'flex', gap: 8 }}>
              {net > 0 && <a className="chip-btn" target="_blank" rel="noreferrer" style={{ height: 38, display: 'flex', alignItems: 'center' }}
                href={whatsappUrl(`Hey ${p.first}, you owe me ${fmt(net)} from badminton 🏸 ${origin}/balances/${meId}`)}>Nudge</a>}
              <button className="chip-btn go" style={{ height: 38 }} disabled={busy}
                onClick={() => confirm(net > 0 ? `Mark ${p.first}'s ${fmt(net)} as paid to you?` : `Mark ${fmt(net)} to ${p.first} as paid?`) && settleAll()}>{net > 0 ? 'Paid' : 'Settle'}</button>
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">Match by match</span>
          {!rows.length ? <span className="note">Nothing between you yet.</span> : (
            <div className="stack" style={{ gap: 10 }}>
              {rows.map(r => (
                <Link key={r.match.id} href={`/m/${r.match.slug}`} className="card stack" style={{ padding: '14px 16px', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span className="stack" style={{ gap: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{r.match.title}</span>
                      <span style={{ fontSize: 12, color: '#6B6B66' }}>{fmtDate(r.match.starts_at, r.match.timezone)}</span>
                    </span>
                    <span className="stack" style={{ alignItems: 'flex-end', gap: 1, flex: 'none' }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: r.amount > 0 ? '#0E5A3A' : '#E0245E' }}>{r.amount > 0 ? '+' : '−'}{fmt(r.amount)}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: Math.abs(r.open) < 0.01 ? '#0E5A3A' : '#D6336C' }}>{Math.abs(r.open) < 0.01 ? 'PAID' : Math.abs(r.paid) > 0.005 ? `${fmt(r.open)} OPEN` : 'OPEN'}</span>
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: '#55554F', lineHeight: 1.45, background: 'rgba(17,17,17,.04)', borderRadius: 10, padding: '8px 10px' }}>
                    Cost {fmt(r.total)} ÷ {r.people} = {fmt(r.share)} each. You paid {fmt(r.iPaid)}, your share {fmt(r.myShare)}.
                    {' '}{r.amount > 0 ? `${p.first} owes you ${fmt(r.amount)}.` : `You owe ${p.first} ${fmt(r.amount)}.`}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">Payments</span>
          {!payments.length ? <span className="note">No payments between you yet.</span> : (
            <div className="card" style={{ padding: '4px 16px' }}>
              {payments.map(x => (
                <div key={`${x.match.id}:${x.from}`} className="row-line" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0' }}>
                  <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{x.from === meId ? `You paid ${p.first}` : `${p.first} paid you`}</span>
                    <span style={{ fontSize: 12, color: '#6B6B66' }}>{fmtDate(x.at ?? x.match.starts_at, x.match.timezone)} · for {x.match.title}</span>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{fmt(x.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Frame>
  )
}
