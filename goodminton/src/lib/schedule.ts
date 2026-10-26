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
  // Rounds in a row played, counting back from the latest round.
  const streak: Record<string, number> = {}
  for (const id of Object.keys(played)) {
    let n = 0
    for (let r = rounds.length - 1; r >= 0 && rounds[r].some(g => g.a.includes(id) || g.b.includes(id)); r--) n++
    streak[id] = n
  }
  return { played, last, partners, opponents, streak }
}

/** Who sits out a round: everyone not in one of its games. */
export function sittingOut(players: string[], games: PlanGame[]) {
  const inIt = new Set(games.flatMap(g => [...g.a, ...g.b]))
  return players.filter(p => !inIt.has(p))
}

/**
 * A fresh round ("Mix it up", and round 1). Whoever has played least plays first (ties: sat out
 * longest, then random), then many arrangements are tried and the one with the fewest repeat
 * partners, fewest repeat opponents and the most even sides (by rating) wins.
 */
export function freshRound({ players, courts, perSide, rounds, ratings = {}, keep, random = Math.random, tries = 400 }: Opts): PlanGame[] {
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

/**
 * The next round, changing as little as possible: last round's games stay as they were, and
 * only whoever is waiting swaps in. Those who have played most (then longest in a row) come off;
 * with two or more coming off, whole pairs come off together so the other side stays intact,
 * and the newcomers partner each other. Nobody waiting means the same games again.
 * Round 1, or too few people for last round's games, uses a fresh round.
 */
export function nextRound(opts: Opts): PlanGame[] {
  const { players, courts, perSide, rounds, keep, random = Math.random } = opts
  const prev = rounds.at(-1)
  if (!prev?.length) return freshRound(opts)
  const per = perSide * 2
  const kept = keep ? [...keep.a, ...keep.b] : []
  const avail = players.filter(p => !kept.includes(p))
  const free = courts - (keep ? 1 : 0)
  const possible = Math.min(free, Math.floor(avail.length / per))
  // Last round's games, minus the one being played again.
  const isKept = (g: PlanGame) => keep && [...g.a, ...g.b].every(p => kept.includes(p))
  const prevGames = [...prev].filter(g => !isKept(g)).sort((x, y) => x.court - y.court)
  const base = prevGames.slice(0, possible).map(g => ({ court: g.court, a: [...g.a], b: [...g.b] }))
  if (possible < Math.min(prevGames.length, free)) return freshRound(opts)

  const { played, last, streak } = planStats(rounds)
  const jitter = new Map(players.map(p => [p, random()]))
  const longestWait = (x: string, y: string) =>
    (played[x] ?? 0) - (played[y] ?? 0) || (last[x] ?? -1) - (last[y] ?? -1) || jitter.get(x)! - jitter.get(y)!
  const onCourt = () => new Set(base.flatMap(g => [...g.a, ...g.b]))
  let waiting = avail.filter(p => !onCourt().has(p)).sort(longestWait)

  // Anyone who left the match (or is in the kept game) gives up their spot first.
  const filledIn = new Set<string>()
  for (const g of base) for (const s of [g.a, g.b]) s.forEach((id, i) => {
    if (!avail.includes(id) && waiting.length) { s[i] = waiting.shift()!; filledIn.add(s[i]) }
  })

  if (base.some(g => [...g.a, ...g.b].some(id => !avail.includes(id)))) return freshRound(opts)

  // A free court and enough people waiting: a new game for them.
  const extra = possible - base.length
  const extraPlayers = waiting.slice(0, extra * per)
  waiting = waiting.slice(extra * per)

  // Everyone still waiting comes on; the same number come off.
  let k = Math.min(waiting.length, base.length * per - filledIn.size)
  const due = (id: string) => [played[id] ?? 0, streak[id] ?? 0, jitter.get(id)!] as const
  const cmpDue = (x: readonly number[], y: readonly number[]) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2]
  const out = new Set<string>()
  const vacated: { side: string[]; idx: number[] }[] = []
  if (perSide === 2) {
    const sides = base.flatMap(g => [g.a, g.b]).filter(s => s.every(id => !filledIn.has(id)))
      .sort((x, y) => cmpDue([due(x[0])[0] + due(x[1])[0], due(x[0])[1] + due(x[1])[1], due(x[0])[2] + due(x[1])[2]],
                             [due(y[0])[0] + due(y[1])[0], due(y[0])[1] + due(y[1])[1], due(y[0])[2] + due(y[1])[2]]))
    for (const s of sides) {
      if (k < 2) break
      vacated.push({ side: s, idx: [0, 1] }); s.forEach(id => out.add(id)); k -= 2
    }
  }
  if (k > 0) {
    const singles = base.flatMap(g => [g.a, g.b]).flatMap(s => s.map((id, i) => ({ s, i, id })))
      .filter(x => !filledIn.has(x.id) && !out.has(x.id))
      .sort((x, y) => cmpDue(due(x.id), due(y.id)))
    for (const x of singles.slice(0, k)) { vacated.push({ side: x.s, idx: [x.i] }); out.add(x.id) }
  }
  for (const v of vacated) for (const i of v.idx) v.side[i] = waiting.shift()!

  const games: PlanGame[] = []
  if (keep) games.push({ court: 1, a: [...keep.a], b: [...keep.b] })
  const used = new Set(games.map(g => g.court))
  const courtFor = (c: number) => { let n = used.has(c) ? 1 : c; while (used.has(n)) n++; used.add(n); return n }
  for (const g of base) games.push({ ...g, court: courtFor(g.court) })
  if (extraPlayers.length) {
    for (const g of freshRound({ ...opts, players: extraPlayers, courts: extra, keep: undefined })) games.push({ ...g, court: courtFor(1) })
  }
  return games.sort((x, y) => x.court - y.court)
}
