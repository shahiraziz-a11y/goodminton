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
    if (g.a.length < 2) continue // singles have no partnerships
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

export const START_RATING = 1000

/**
 * Elo-style ratings: everyone starts at 1000; a side's strength is its players' average.
 * Beating a stronger side earns more. With a score, a bigger margin counts a little more
 * (up to 1.5x at 10+ points). Games must be newest first.
 */
export function ratings(games: Game[], k = 32): Record<string, number> {
  const r: Record<string, number> = {}
  const get = (id: string) => (r[id] ??= START_RATING)
  for (const g of [...games].reverse()) {
    const ra = g.a.reduce((s, id) => s + get(id), 0) / g.a.length
    const rb = g.b.reduce((s, id) => s + get(id), 0) / g.b.length
    const expectA = 1 / (1 + 10 ** ((rb - ra) / 400))
    const margin = g.score_a != null && g.score_b != null ? 1 + Math.min(Math.abs(g.score_a - g.score_b), 10) / 20 : 1
    const delta = k * margin * ((g.winner === 'a' ? 1 : 0) - expectA)
    for (const id of g.a) r[id] = get(id) + delta
    for (const id of g.b) r[id] = get(id) - delta
  }
  for (const id in r) r[id] = Math.round(r[id])
  return r
}

/** Balance by rating: strongest with weakest, middle two together. */
export function balancedByRating(ids: string[], rating: Record<string, number>) {
  const o = [...ids].sort((a, b) => (rating[b] ?? START_RATING) - (rating[a] ?? START_RATING))
  return [o[0], o[3], o[1], o[2]]
}

export type PairRecord = { ids: [string, string]; w: number; l: number; pct: number; form: ('W' | 'L')[]; streak: number }

const pairKey = (ids: string[]) => [...ids].sort().join('|')

/** Every doubles partnership: record, form (newest first) and current win streak. Games must be newest first. */
export function pairRecords(games: Game[]): PairRecord[] {
  const pm: Record<string, { ids: [string, string]; w: number; l: number; form: ('W' | 'L')[] }> = {}
  for (const g of games) {
    if (g.a.length < 2) continue
    for (const [pair, won] of [[g.a, g.winner === 'a'], [g.b, g.winner === 'b']] as const) {
      const k = pairKey(pair)
      pm[k] ??= { ids: [...pair].sort() as [string, string], w: 0, l: 0, form: [] }
      won ? pm[k].w++ : pm[k].l++
      pm[k].form.push(won ? 'W' : 'L')
    }
  }
  return Object.values(pm).map(p => {
    let streak = 0
    while (p.form[streak] === 'W') streak++
    return { ...p, pct: p.w / (p.w + p.l), streak }
  })
}

/** Pairs with at least `min` games together, best win rate first (more games breaks ties). */
export function pairTable(games: Game[], min = 3): PairRecord[] {
  return pairRecords(games)
    .filter(p => p.w + p.l >= min)
    .sort((a, b) => b.pct - a.pct || (b.w + b.l) - (a.w + a.l) || b.w - a.w)
}

/** Wins in a row a pair needs to move above a win rate; null when it can't (the pair above is unbeaten). */
export function winsToPass(p: { w: number; l: number }, above: number): number | null {
  if (above >= 1) return null
  // Smallest k with (w + k) / (w + l + k) > above.
  const k = Math.floor((above * (p.w + p.l) - p.w) / (1 - above)) + 1
  return Math.max(1, k)
}

/** How I do with each partner, best first. */
export function myPartners(games: Game[], me: string) {
  return pairRecords(games)
    .filter(p => p.ids.includes(me))
    .map(p => ({ partner: p.ids[0] === me ? p.ids[1] : p.ids[0], w: p.w, l: p.l, pct: p.pct }))
    .sort((a, b) => b.pct - a.pct || (b.w + b.l) - (a.w + a.l))
}

export type Rivalry = { l: [string, string]; r: [string, string]; lw: number; rw: number; lastWinner: 'l' | 'r' }

/** The two pairs who have played each other most (at least twice). Games must be newest first. */
export function biggestRivalry(games: Game[]): Rivalry | null {
  const rm: Record<string, Rivalry & { n: number }> = {}
  for (const g of games) {
    if (g.a.length < 2) continue
    const [x, y] = [pairKey(g.a), pairKey(g.b)]
    const flip = x > y
    const k = flip ? `${y}~${x}` : `${x}~${y}`
    const lWon = (g.winner === 'a') !== flip
    if (!rm[k]) {
      const [l, r] = flip ? [g.b, g.a] : [g.a, g.b]
      rm[k] = { l: [...l].sort() as [string, string], r: [...r].sort() as [string, string], lw: 0, rw: 0, lastWinner: lWon ? 'l' : 'r', n: 0 }
    }
    lWon ? rm[k].lw++ : rm[k].rw++
    rm[k].n++
  }
  const best = Object.values(rm).filter(x => x.n >= 2)
    .sort((a, b) => b.n - a.n || Math.abs(a.lw - a.rw) - Math.abs(b.lw - b.rw))[0]
  if (!best) return null
  const { n: _n, ...rv } = best
  // The leading pair on the left.
  return rv.rw > rv.lw ? { l: rv.r, r: rv.l, lw: rv.rw, rw: rv.lw, lastWinner: rv.lastWinner === 'l' ? 'r' : 'l' } : rv
}
