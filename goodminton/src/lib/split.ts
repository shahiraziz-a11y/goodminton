import type { Expense, LedgerMatch, Settlement } from './types.ts'

export type Transfer = { from: string; to: string; amount: number; paid: number; open: number; settled: boolean }

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Split all expenses equally between confirmed players, then pair debtors with
 * creditors greedily. Settlements record how much of each transfer is paid.
 */
export function transfersOf(players: string[], expenses: Expense[], settlements: Settlement[] = []) {
  const n = players.length || 1
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const share = total / n
  const net: Record<string, number> = {}
  players.forEach(p => (net[p] = (net[p] ?? 0) - share)) // a sponsor appears once per share they carry
  expenses.forEach(e => (net[e.paid_by] = (net[e.paid_by] ?? 0) + Number(e.amount)))

  const deb = Object.entries(net).filter(([, v]) => v < -0.005).map(([k, v]) => ({ k, v: -v }))
  const cre = Object.entries(net).filter(([, v]) => v > 0.005).map(([k, v]) => ({ k, v }))
  const out: Transfer[] = []
  let i = 0, j = 0
  while (i < deb.length && j < cre.length) {
    const a = Math.min(deb[i].v, cre[j].v)
    const amount = round(a)
    const paid = Number(settlements.find(s => s.from === deb[i].k && s.to === cre[j].k)?.amount ?? 0)
    const open = round(Math.max(0, amount - paid))
    out.push({ from: deb[i].k, to: cre[j].k, amount, paid, open, settled: open < 0.01 })
    deb[i].v -= a; cre[j].v -= a
    if (deb[i].v < 0.005) i++
    if (cre[j].v < 0.005) j++
  }
  return { out, total, share }
}

export type LedgerLine = { match: LedgerMatch; transfer: Transfer; owedToMe: boolean; other: string }

/** Net balance with each friend across matches (positive: they owe me), plus every line involving me. */
export function balancesFor(me: string, matches: LedgerMatch[]) {
  const net: Record<string, number> = {}
  const lines: LedgerLine[] = []
  for (const m of matches) {
    for (const t of transfersOf(m.players, m.expenses, m.settlements).out) {
      if (t.from !== me && t.to !== me) continue
      const owedToMe = t.to === me
      const other = owedToMe ? t.from : t.to
      lines.push({ match: m, transfer: t, owedToMe, other })
      if (!t.settled) net[other] = round((net[other] ?? 0) + (owedToMe ? t.open : -t.open))
    }
  }
  const total = round(Object.values(net).reduce((a, b) => a + b, 0))
  return { net, lines, total }
}

export type GuestDue = { match: LedgerMatch; guest: string; amount: number; collected: boolean }

/** Guests whose share I carry, to collect from them offline. Collected = a settlement from the guest to me. */
export function guestDues(me: string, matches: LedgerMatch[]) {
  const dues: GuestDue[] = []
  for (const m of matches) {
    const { share } = transfersOf(m.players, m.expenses, m.settlements)
    for (const [guest, payer] of Object.entries(m.guests ?? {})) {
      if (payer !== me || share < 0.01) continue
      const collected = m.settlements.some(s => s.from === guest && s.to === me && Number(s.amount) > 0)
      dues.push({ match: m, guest, amount: round(share), collected })
    }
  }
  const open = round(dues.filter(d => !d.collected).reduce((a, d) => a + d.amount, 0))
  return { dues, open }
}

export type BreakdownRow = {
  match: LedgerMatch; total: number; share: number; people: number
  /** What I paid for this match, and my share of it (two shares if I carry a guest). */
  iPaid: number; myShare: number
  /** Between me and them in this match: positive = they owe me. */
  amount: number; paid: number; open: number
}

/** Every match that adds to what's between me and one person, and every payment between us. */
export function breakdownWith(me: string, other: string, matches: LedgerMatch[]) {
  const rows: BreakdownRow[] = []
  const payments: { match: LedgerMatch; from: string; to: string; amount: number; at?: string }[] = []
  for (const m of matches) {
    const { out, total, share } = transfersOf(m.players, m.expenses, m.settlements)
    const t = out.find(x => (x.from === other && x.to === me) || (x.from === me && x.to === other))
    if (t) {
      const sign = t.to === me ? 1 : -1
      rows.push({
        match: m, total, share, people: m.players.length,
        iPaid: round(m.expenses.filter(e => e.paid_by === me).reduce((s, e) => s + Number(e.amount), 0)),
        myShare: round(share * m.players.filter(p => p === me).length),
        amount: sign * t.amount + 0, paid: sign * t.paid + 0, open: sign * t.open + 0,
      })
    }
    for (const s of m.settlements) {
      if ((s.from === me && s.to === other) || (s.from === other && s.to === me)) payments.push({ match: m, from: s.from, to: s.to, amount: Number(s.amount), at: s.settled_at })
    }
  }
  const net = round(rows.reduce((a, r) => a + r.open, 0))
  payments.sort((x, y) => (y.at ?? y.match.starts_at).localeCompare(x.at ?? x.match.starts_at))
  return { rows, payments, net }
}

/** Every payment I made or received, newest first. */
export function paymentsOf(me: string, matches: LedgerMatch[]) {
  return matches.flatMap(m => m.settlements.filter(s => s.from === me || s.to === me).map(s => ({ match: m, ...s, amount: Number(s.amount) })))
    .sort((x, y) => (y.settled_at ?? y.match.starts_at).localeCompare(x.settled_at ?? x.match.starts_at))
}
