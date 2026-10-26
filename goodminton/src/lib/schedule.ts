/** One planned game: court number and the two sides (1 or 2 players each). */
export type PlanGame = { court: number; a: string[]; b: string[] }

type Opts = {
  /** Everyone who can play (confirmed players), in a stable order. */
  players: string[]
  courts: number
  /** 1 for singles, 2 for doubles. */
  perSide: 1 | 2
  /** Earlier rounds, oldest first. */
  rounds: PlanGame[][]
  ratings?: Record<string, number>
  /** A game to play again as-is (for "Play again"); it takes court 1. */
  keep?: { a: string[]; b: string[] }
  random?: () => number
  tries?: number
}

const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`)

/** How much each person has played, when they last played, and who's been with/against whom. */
export function planStats(rounds: PlanGame[][]) {
  const played: Record<string, number> = {}
  const last: Record<string, number> = {}
  const partners: Record<string, number> = {}
  const opponents: Record<string, number> = {}
  rounds.forEach((games, r) => {
    for (const g of games) {
      for (const id of [...g.a, ...g.b]) { played[id] = (played[id] ?? 0) + 1; last[id] = r }
      for (const side of [g.a, g.b]) if (side.length === 2) partners[key(side[0], side[1])] = (partners[key(side[0], side[1])] ?? 0) + 1
      for (const x of g.a) for (const y of g.b) opponents[key(x, y)] = (opponents[key(x, y)] ?? 0) + 1
    }
  })
  return { played, last, partners, opponents }
}

/** Who sits out a round: everyone not in one of its games. */
export function sittingOut(players: string[], games: PlanGame[]) {
  const inIt = new Set(games.flatMap(g => [...g.a, ...g.b]))
  return players.filter(p => !inIt.has(p))
}

/**
 * The next round. Whoever has played least plays first (ties: sat out longest, then random),
 * then many arrangements are tried and the one with the fewest repeat partners, fewest repeat
 * opponents and the most even sides (by rating) wins.
 */
export function nextRound({ players, courts, perSide, rounds, ratings = {}, keep, random = Math.random, tries = 400 }: Opts): PlanGame[] {
  const per = perSide * 2
  const kept = keep ? [...keep.a, ...keep.b] : []
  const pool = players.filter(p => !kept.includes(p))
  const games = Math.min(courts - (keep ? 1 : 0), Math.floor(pool.length / per))
  const { played, last, partners, opponents } = planStats(rounds)

  // Fewest games first; then whoever sat out longest; then random.
  const jitter = new Map(pool.map(p => [p, random()]))
  const picked = [...pool]
    .sort((x, y) => (played[x] ?? 0) - (played[y] ?? 0) || (last[x] ?? -1) - (last[y] ?? -1) || jitter.get(x)! - jitter.get(y)!)
    .slice(0, games * per)

  const rating = (id: string) => ratings[id] ?? 1000
  const avg = (ids: string[]) => ids.reduce((s, id) => s + rating(id), 0) / ids.length
  const cost = (gs: { a: string[]; b: string[] }[]) => {
    let c = 0
    for (const g of gs) {
      for (const side of [g.a, g.b]) if (side.length === 2) c += 10 * (partners[key(side[0], side[1])] ?? 0)
      for (const x of g.a) for (const y of g.b) c += 2 * (opponents[key(x, y)] ?? 0)
      c += Math.abs(avg(g.a) - avg(g.b)) / 100
    }
    return c
  }

  let best: { a: string[]; b: string[] }[] = []
  let bestCost = Infinity
  for (let t = 0; t < Math.max(1, tries) && picked.length; t++) {
    const order = [...picked]
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    const gs = Array.from({ length: games }, (_, k) => {
      const four = order.slice(k * per, k * per + per)
      return { a: four.slice(0, perSide), b: four.slice(perSide) }
    })
    const c = cost(gs)
    if (c < bestCost) { best = gs; bestCost = c }
    if (c === 0) break
  }

  const out: PlanGame[] = []
  if (keep) out.push({ court: 1, a: [...keep.a], b: [...keep.b] })
  best.forEach(g => out.push({ court: out.length + 1, ...g }))
  return out
}
