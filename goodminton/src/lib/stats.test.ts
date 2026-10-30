import { test } from 'node:test'
import assert from 'node:assert/strict'
import { balancedByRating, balancedOrder, bestPairs, biggestRivalry, myPartners, pairRecords, pairTable, ratings, recentMatchups, recentPairs, recentPlayers, standings, START_RATING } from './stats.ts'
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

test('ratings: winners up, losers down, by the same amount', () => {
  const r = ratings([{ id: '1', played_on: '', match_title: null, created_by: 'a', a: ['a', 'b'], b: ['c', 'd'], winner: 'a' }])
  assert.equal(r.a, 1016); assert.equal(r.b, 1016); assert.equal(r.c, 984); assert.equal(r.d, 984)
})

test('ratings: beating a stronger side earns more; a big margin counts more', () => {
  const g = (a: string[], b: string[], winner: 'a' | 'b', sa: number | null = null, sb: number | null = null) =>
    ({ id: Math.random().toString(), played_on: '', match_title: null, created_by: 'x', a, b, winner, score_a: sa, score_b: sb })
  // Newest first: x+y (strong after two wins) then lose to the underdogs.
  const r = ratings([g(['x', 'y'], ['p', 'q'], 'b'), g(['x', 'y'], ['m', 'n'], 'a'), g(['x', 'y'], ['k', 'l'], 'a')])
  assert.ok(r.p - START_RATING > 16, 'upset win earns more than 16')
  const close = ratings([g(['a'], ['b'], 'a', 21, 19)]), rout = ratings([g(['a'], ['b'], 'a', 21, 5)])
  assert.ok(rout.a > close.a, '21–5 counts more than 21–19')
  assert.equal(rout.a - START_RATING, 24) // 16 x 1.5
})

test('balance by rating: best with worst', () => {
  assert.deepEqual(balancedByRating(['a', 'b', 'c', 'd'], { a: 1100, b: 900, c: 1050, d: 1000 }), ['a', 'b', 'c', 'd'])
  assert.deepEqual(balancedByRating(['n1', 'n2', 'n3', 'n4'], {}), ['n1', 'n4', 'n2', 'n3'])
})

test('pair table needs 3 games together and ranks by win rate', () => {
  const gs = [
    G(['a', 'b'], ['c', 'd'], 'a'),
    G(['b', 'a'], ['d', 'c'], 'a'),
    G(['a', 'b'], ['c', 'd'], 'b'),
    G(['a', 'b'], ['e', 'f'], 'a'),
    G(['e', 'f'], ['c', 'd'], 'a'),
    G(['x', 'y'], ['e', 'f'], 'a'),
  ]
  const t = pairTable(gs)
  assert.deepEqual(t.map(p => p.ids.join('')), ['ab', 'ef', 'cd'])
  assert.deepEqual([t[0].w, t[0].l, t[0].streak], [3, 1, 2])
  assert.equal(pairRecords(gs).find(p => p.ids.join('') === 'xy')?.w, 1)
  assert.ok(!t.some(p => p.ids.join('') === 'xy'), 'one game is not enough to rank')
})

test('my partners and the biggest rivalry', () => {
  const gs = [
    G(['a', 'b'], ['c', 'd'], 'b'),
    G(['a', 'b'], ['c', 'd'], 'a'),
    G(['d', 'c'], ['b', 'a'], 'b'),
    G(['a', 'c'], ['b', 'd'], 'a'),
  ]
  assert.deepEqual(myPartners(gs, 'a').map(p => [p.partner, p.w, p.l]), [['c', 1, 0], ['b', 2, 1]])
  const r = biggestRivalry(gs)
  assert.deepEqual(r && [r.l, r.r, r.lw, r.rw, r.lastWinner], [['a', 'b'], ['c', 'd'], 2, 1, 'r'])
  assert.equal(biggestRivalry(gs.slice(3)), null)
})

test('recent matchups: newest first, side order and pair order ignored', () => {
  const gs = [
    G(['a', 'b'], ['c', 'd'], 'a'),
    G(['d', 'c'], ['b', 'a'], 'b'),
    G(['a', 'c'], ['b', 'd'], 'a'),
    G(['x'], ['y'], 'a'),
    G(['a', 'd'], ['b', 'c'], 'a'),
    G(['e', 'f'], ['g', 'h'], 'a'),
  ]
  assert.deepEqual(recentMatchups(gs), [{ a: ['a', 'b'], b: ['c', 'd'] }, { a: ['a', 'c'], b: ['b', 'd'] }, { a: ['a', 'd'], b: ['b', 'c'] }])
})

test('recent pairs and players: distinct, newest first', () => {
  const gs = [G(['a', 'b'], ['c', 'd'], 'a'), G(['b', 'a'], ['c', 'e'], 'b'), G(['x'], ['y'], 'a')]
  assert.deepEqual(recentPairs(gs), [['a', 'b'], ['c', 'd'], ['c', 'e']])
  assert.deepEqual(recentPairs(gs, 2), [['a', 'b'], ['c', 'd']])
  assert.deepEqual(recentPlayers(gs), ['a', 'b', 'c', 'd', 'e', 'x', 'y'])
})
