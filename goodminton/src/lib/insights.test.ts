import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clutch, form, funFacts, partners, ratingChange, ratingHistory, rivals, summary, type InsightGame } from './insights.ts'
import { ratings } from './stats.ts'

let n = 0
const G = (a: string, b: string, winner: 'a' | 'b', day: string, score?: [number, number], match?: string): InsightGame => ({
  id: 'g' + n++, played_on: day, match_title: null, created_by: 'x', a: a.split(''), b: b.split(''), winner,
  score_a: score?.[0] ?? null, score_b: score?.[1] ?? null, match_id: match ?? null,
})
// Newest first. "m" is me.
const games = [
  G('ma', 'bc', 'a', '2026-10-20', [21, 19], 'x1'),
  G('mb', 'ac', 'b', '2026-10-20', [15, 21], 'x1'),
  G('ma', 'bc', 'a', '2026-10-20', [22, 20], 'x1'),
  G('ma', 'de', 'a', '2026-10-13', [21, 9]),
  G('mb', 'de', 'b', '2026-10-13'),
  G('mb', 'de', 'b', '2026-10-06'),
  G('mb', 'de', 'b', '2026-09-29'),
  G('ma', 'bc', 'b', '2026-09-22'),
  G('bc', 'de', 'a', '2026-09-20'),
]

test('summary and form', () => {
  assert.deepEqual(summary('m', games), { games: 8, w: 3, l: 5, pct: 3 / 8 })
  const f = form('m', games)
  assert.deepEqual(f.last10, ['W', 'L', 'W', 'W', 'L', 'L', 'L', 'L'])
  assert.deepEqual(f.streak, { kind: 'W', n: 1 })
  assert.equal(f.longestWin, 2)
})

test('partners: best needs 3 games; most played with', () => {
  const p = partners('m', games)
  assert.equal(p.best?.key, 'a')   // a: 3–1
  assert.equal(p.most?.key, 'a')   // a and b both 4 games; the better record wins the tie
  assert.equal(p.most?.n, 4)
  assert.equal(p.people, 2)
})

test('rivals: nemesis and favourite, 3+ games against them', () => {
  const r = rivals('m', games)
  assert.deepEqual(r.nemesis?.ids, ['d', 'e'])  // d&e: 1–3
  assert.deepEqual(r.favourite?.ids, ['b', 'c']) // b&c: 2–1
})

test('clutch counts close and deuce games only with scores', () => {
  assert.deepEqual(clutch('m', games), { scored: 4, close: { w: 2, l: 0 }, deuce: { w: 1, l: 0 } })
})

test('rating history ends where ratings() does', () => {
  const pts = ratingHistory('m', games)
  assert.equal(pts.length, 8)
  assert.equal(pts.at(-1)!.rating, ratings(games).m)
  // Every game is inside the last 30 days, so the change counts from the start.
  assert.equal(ratingChange(pts, '2026-10-22'), pts.at(-1)!.rating - 1000)
  assert.equal(ratingChange(pts, '2026-11-01'), pts.at(-1)!.rating - pts.find(p => p.date === '2026-09-29')!.rating)
})

test('fun facts only with enough behind them', () => {
  const f = funFacts('m', games, id => id.toUpperCase())
  assert.ok(f.some(x => x === 'Biggest win: 21–9 with A.'))
  assert.ok(f.some(x => x === 'Most games in one session: 3.'))
  assert.ok(f.some(x => x.startsWith("You've played with or against 5")))
})
