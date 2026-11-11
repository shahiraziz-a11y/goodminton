import { START_RATING } from './stats.ts'
import type { Game } from './types.ts'

/** A logged game as my_insights returns it (newest first). */
export type InsightGame = Game & { created_at?: string; match_id?: string | null }
type Rec = { w: number; l: number }
const pct = (r: Rec) => (r.w + r.l ? r.w / (r.w + r.l) : 0)

const mine = (me: string, games: InsightGame[]) => games.filter(g => g.a.includes(me) || g.b.includes(me))
const won = (me: string, g: InsightGame) => (g.a.includes(me) ? 'a' : 'b') === g.winner
const myside = (me: string, g: InsightGame) => (g.a.includes(me) ? g.a : g.b)
const theirs = (me: string, g: InsightGame) => (g.a.includes(me) ? g.b : g.a)

export function summary(me: string, games: InsightGame[]) {
  const gs = mine(me, games)
  const w = gs.filter(g => won(me, g)).length
  return { games: gs.length, w, l: gs.length - w, pct: pct({ w, l: gs.length - w }) }
}

/** Last 10 results (newest first), streaks, and recent vs overall win rate. */
export function form(me: string, games: InsightGame[]) {
  const results = mine(me, games).map(g => (won(me, g) ? 'W' : 'L') as 'W' | 'L')
  let current = 0
  while (current < results.length && results[current] === results[0]) current++
  let longest = 0, run = 0
  for (const r of [...results].reverse()) { run = r === 'W' ? run + 1 : 0; longest = Math.max(longest, run) }
  const rate = (rs: string[]) => (rs.length ? rs.filter(r => r === 'W').length / rs.length : 0)
  return {
    last10: results.slice(0, 10), streak: results.length ? { kind: results[0], n: current } : null,
    longestWin: longest, recent: rate(results.slice(0, 10)), overall: rate(results),
  }
}

/**
 * My rating after each of my games, oldest first, replaying everyone's games so
 * opponents' strength is fair (same formula as ratings() in stats.ts).
 */
export function ratingHistory(me: string, games: InsightGame[], k = 32) {
  const r: Record<string, number> = {}
  const get = (id: string) => (r[id] ??= START_RATING)
  const points: { date: string; rating: number }[] = []
  for (const g of [...games].reverse()) {
    const ra = g.a.reduce((s, id) => s + get(id), 0) / g.a.length
    const rb = g.b.reduce((s, id) => s + get(id), 0) / g.b.length
    const expectA = 1 / (1 + 10 ** ((rb - ra) / 400))
    const margin = g.score_a != null && g.score_b != null ? 1 + Math.min(Math.abs(g.score_a - g.score_b), 10) / 20 : 1
    const delta = k * margin * ((g.winner === 'a' ? 1 : 0) - expectA)
    for (const id of g.a) r[id] = get(id) + delta
    for (const id of g.b) r[id] = get(id) - delta
    if (g.a.includes(me) || g.b.includes(me)) points.push({ date: g.played_on, rating: Math.round(r[me]) })
  }
  return points
}

/** Change over the last 30 days (from the rating before the window, or the start). */
export function ratingChange(points: { date: string; rating: number }[], today: string) {
  if (!points.length) return 0
  const cutoff = new Date(new Date(today + 'T00:00:00Z').getTime() - 30 * 864e5).toISOString().slice(0, 10)
  const before = [...points].reverse().find(p => p.date < cutoff)
  return points[points.length - 1].rating - (before?.rating ?? START_RATING)
}

const tally = <K extends string>(rows: { key: K; win: boolean }[]) => {
  const m = new Map<K, Rec>()
  for (const { key, win } of rows) { const t = m.get(key) ?? { w: 0, l: 0 }; win ? t.w++ : t.l++; m.set(key, t) }
  return [...m.entries()].map(([key, t]) => ({ key, ...t, n: t.w + t.l, pct: pct(t) }))
}

/** Doubles partners: best (3+ games together), most played with, top 5. */
export function partners(me: string, games: InsightGame[]) {
  const rows = tally(mine(me, games).filter(g => myside(me, g).length === 2)
    .map(g => ({ key: myside(me, g).find(id => id !== me)!, win: won(me, g) })))
  const best = rows.filter(r => r.n >= 3).sort((x, y) => y.pct - x.pct || y.n - x.n)[0] ?? null
  const most = [...rows].sort((x, y) => y.n - x.n || y.pct - x.pct)[0] ?? null
  return { best, most, top: [...rows].sort((x, y) => y.n - x.n || y.pct - x.pct).slice(0, 5), people: rows.length }
}

/** The side you lose to most and the one you beat most (3+ games against them). */
export function rivals(me: string, games: InsightGame[]) {
  const rows = tally(mine(me, games).map(g => ({ key: [...theirs(me, g)].sort().join('+'), win: won(me, g) })))
    .filter(r => r.n >= 3).map(r => ({ ...r, ids: r.key.split('+') }))
  const nemesis = rows.filter(r => r.l > r.w).sort((x, y) => y.l - x.l || x.pct - y.pct)[0] ?? null
  const favourite = rows.filter(r => r.w > r.l).sort((x, y) => y.w - x.w || y.pct - x.pct)[0] ?? null
  return { nemesis, favourite }
}

/** Games decided by 2 points or less, and deuce games (both sides on 20+). Needs scores. */
export function clutch(me: string, games: InsightGame[]) {
  const scored = mine(me, games).filter(g => g.score_a != null && g.score_b != null)
  const close = scored.filter(g => Math.abs(g.score_a! - g.score_b!) <= 2)
  const deuce = scored.filter(g => Math.min(g.score_a!, g.score_b!) >= 20)
  const w = (gs: InsightGame[]) => gs.filter(g => won(me, g)).length
  return { scored: scored.length, close: { w: w(close), l: close.length - w(close) }, deuce: { w: w(deuce), l: deuce.length - w(deuce) } }
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** A few one-liners, only those with enough data behind them. */
export function funFacts(me: string, games: InsightGame[], name: (id: string) => string) {
  const gs = mine(me, games)
  const facts: string[] = []
  const days = tally(gs.map(g => ({ key: String(new Date(g.played_on + 'T12:00:00Z').getUTCDay()), win: won(me, g) }))).filter(d => d.n >= 3)
  const bestDay = days.sort((x, y) => y.pct - x.pct || y.n - x.n)[0]
  if (bestDay && days.length > 1) facts.push(`${DAYS[+bestDay.key]}s are your day: ${Math.round(bestDay.pct * 100)}% wins.`)
  const big = gs.filter(g => won(me, g) && g.score_a != null && g.score_b != null)
    .sort((x, y) => Math.abs(y.score_a! - y.score_b!) - Math.abs(x.score_a! - x.score_b!))[0]
  if (big) {
    const partner = myside(me, big).find(id => id !== me)
    facts.push(`Biggest win: ${Math.max(big.score_a!, big.score_b!)}–${Math.min(big.score_a!, big.score_b!)}${partner ? ` with ${name(partner)}` : ''}.`)
  }
  const sessions = tally(gs.filter(g => g.match_id).map(g => ({ key: g.match_id!, win: won(me, g) })))
  const busiest = sessions.sort((x, y) => y.n - x.n)[0]
  if (busiest && busiest.n >= 3) facts.push(`Most games in one session: ${busiest.n}.`)
  const people = new Set(gs.flatMap(g => [...g.a, ...g.b]).filter(id => id !== me))
  if (people.size >= 3) facts.push(`You've played with or against ${people.size} different people.`)
  return facts.slice(0, 4)
}
