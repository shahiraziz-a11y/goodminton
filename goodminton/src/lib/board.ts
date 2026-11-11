/** One game on the peg board. Live while ended_at is null. */
export type BoardGame = {
  id: string; court: number; a: string[]; b: string[]
  started_at: string; ended_at: string | null
  winner?: 'a' | 'b' | null; score_a?: number | null; score_b?: number | null
}
export type BoardPlayer = { id: string; full_name: string; joined_at: string }
export type Waiting = { id: string; games: number; since: string }

const key = (x: string, y: string) => [x, y].sort().join('|')

/** Who's free, fairest first: fewest games today, then waiting longest, then who joined first. */
export function queue(players: BoardPlayer[], games: BoardGame[]): Waiting[] {
  const on = new Set(games.filter(g => !g.ended_at).flatMap(g => [...g.a, ...g.b]))
  return players
    .filter(p => !on.has(p.id))
    .map((p, i) => {
      const mine = games.filter(g => [...g.a, ...g.b].includes(p.id))
      const ends = mine.map(g => g.ended_at).filter((t): t is string => !!t).sort()
      return { id: p.id, games: mine.length, since: ends.at(-1) ?? p.joined_at, i }
    })
    .sort((x, y) => x.games - y.games || x.since.localeCompare(y.since) || x.i - y.i)
    .map(({ id, games, since }) => ({ id, games, since }))
}

/** How often each pair has played together today. */
export function partnerCounts(games: BoardGame[]) {
  const n: Record<string, number> = {}
  for (const g of games) for (const s of [g.a, g.b]) if (s.length === 2) n[key(s[0], s[1])] = (n[key(s[0], s[1])] ?? 0) + 1
  return n
}

/** Split four players into the fairest two pairs: fewest repeat partners, then closest ratings. */
export function pairUp(ids: string[], games: BoardGame[], ratings: Record<string, number> = {}): { a: string[]; b: string[] } {
  if (ids.length !== 4) return { a: ids.slice(0, ids.length / 2), b: ids.slice(ids.length / 2) }
  const [p, q, r, s] = ids
  const together = partnerCounts(games)
  const rate = (x: string) => ratings[x] ?? 1000
  const options = [[[p, q], [r, s]], [[p, r], [q, s]], [[p, s], [q, r]]].map(([a, b]) => ({
    a, b,
    repeats: (together[key(a[0], a[1])] ?? 0) + (together[key(b[0], b[1])] ?? 0),
    gap: Math.abs(rate(a[0]) + rate(a[1]) - rate(b[0]) - rate(b[1])),
  }))
  options.sort((x, y) => x.repeats - y.repeats || x.gap - y.gap)
  return { a: options[0].a, b: options[0].b }
}

/** The next game for a free court: the first players in the queue, fairly paired. */
export function suggestNext(players: BoardPlayer[], games: BoardGame[], perSide: number, ratings: Record<string, number> = {}) {
  const q = queue(players, games)
  if (q.length < perSide * 2) return null
  return pairUp(q.slice(0, perSide * 2).map(w => w.id), games, ratings)
}
