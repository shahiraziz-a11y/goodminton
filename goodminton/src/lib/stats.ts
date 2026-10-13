import type { Game } from './types.ts'

export type PlayerStats = { id: string; w: number; l: number; pct: number; form: ('W' | 'L')[]; streak: string; hot: boolean }

/** Wins, losses and recent form per player. Games must be newest first. */
export function standings(games: Game[]): PlayerStats[] {
  const st: Record<string, { id: string; w: number; l: number; form: ('W' | 'L')[] }> = {}
  const add = (id: string) => (st[id] ??= { id, w: 0, l: 0, form: [] })
  for (const g of games) {
    for (const id of g.a) { const x = add(id); g.winner === 'a' ? x.w++ : x.l++; x.form.push(g.winner === 'a' ? 'W' : 'L') }
    for (const id of g.b) { const x = add(id); g.winner === 'b' ? x.w++ : x.l++; x.form.push(g.winner === 'b' ? 'W' : 'L') }
  }
  return Object.values(st)
    .map(x => {
      let n = 0
      for (const f of x.form) { if (f === x.form[0]) n++; else break }
      return { ...x, pct: x.w / (x.w + x.l), streak: `${x.form[0]}${n}`, hot: x.form[0] === 'W' && n >= 2 }
    })
    .sort((a, b) => b.w - a.w || b.pct - a.pct || a.l - b.l)
}

export type PairStats = { ids: [string, string]; w: number; l: number }

/** Best partnerships: most wins together, then fewest losses. */
export function bestPairs(games: Game[], limit = 3): PairStats[] {
  const pm: Record<string, PairStats> = {}
  for (const g of games) {
    for (const [pair, won] of [[g.a, g.winner === 'a'], [g.b, g.winner === 'b']] as const) {
      const ids = [...pair].sort() as [string, string]
      const k = ids.join('|')
      pm[k] ??= { ids, w: 0, l: 0 }
      won ? pm[k].w++ : pm[k].l++
    }
  }
  return Object.values(pm).sort((a, b) => b.w - a.w || a.l - b.l).slice(0, limit)
}

/** Win rate for balancing pairs; 50% for anyone without games. */
export function winRate(stats: PlayerStats[], id: string) {
  return stats.find(s => s.id === id)?.pct ?? 0.5
}

/** Strongest with weakest, middle two together: [best, worst] vs [2nd, 3rd]. */
export function balancedOrder(ids: string[], stats: PlayerStats[]) {
  const o = [...ids].sort((a, b) => winRate(stats, b) - winRate(stats, a))
  return [o[0], o[3], o[1], o[2]]
}

export function shuffled<T>(xs: T[]) {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
