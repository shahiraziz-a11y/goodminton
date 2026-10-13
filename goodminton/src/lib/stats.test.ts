import { test } from 'node:test'
import assert from 'node:assert/strict'
import { balancedOrder, bestPairs, standings } from './stats.ts'
import type { Game } from './types.ts'

const G = (a: string[], b: string[], winner: 'a' | 'b'): Game =>
  ({ id: Math.random().toString(), played_on: '2026-10-11', match_title: null, created_by: 'r', a, b, winner })

// Newest first.
const games = [
  G(['r', 'a'], ['m', 'd'], 'a'),
  G(['r', 'd'], ['m', 'a'], 'b'),
  G(['r', 'm'], ['d', 'a'], 'a'),
  G(['p', 'r'], ['s', 'j'], 'a'),
]

test('standings rank by wins then win rate, with streaks', () => {
  const t = standings(games)
  assert.equal(t[0].id, 'r')
  assert.deepEqual([t[0].w, t[0].l], [3, 1])
  assert.equal(t[0].streak, 'W1')
  const a = t.find(x => x.id === 'a')!
  assert.deepEqual([a.w, a.l, a.streak, a.hot], [2, 1, 'W2', true])
  const j = t.find(x => x.id === 'j')!
  assert.equal(j.pct, 0)
})

test('best pairs count wins together regardless of order', () => {
  const p = bestPairs([G(['x', 'y'], ['p', 'q'], 'a'), G(['y', 'x'], ['p', 'q'], 'a'), G(['p', 'q'], ['x', 'z'], 'a')])
  assert.deepEqual(p[0], { ids: ['x', 'y'], w: 2, l: 0 })
  assert.deepEqual(p[1].ids, ['p', 'q'])
})

test('singles count in standings but not in pairs', () => {
  const s = [G(['x'], ['y'], 'a')]
  assert.deepEqual(standings(s).map(t => [t.id, t.w]), [['x', 1], ['y', 0]])
  assert.equal(bestPairs(s).length, 0)
})

test('balance pairs strongest with weakest', () => {
  const t = standings(games)
  // r 3-1, a 2-1, m 2-1, d 0-3: best (r) with worst (d), the middle two together.
  const [x1, x2, y1, y2] = balancedOrder(['m', 'r', 'd', 'a'], t)
  assert.deepEqual([x1, x2], ['r', 'd'])
  assert.deepEqual([y1, y2].sort(), ['a', 'm'])
})
