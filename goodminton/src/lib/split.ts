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
