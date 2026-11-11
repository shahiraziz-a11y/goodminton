import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pairUp, queue, suggestNext, type BoardGame, type BoardPlayer } from './board.ts'

const P = (ids: string): BoardPlayer[] => ids.split('').map((id, i) => ({ id, full_name: id.toUpperCase(), joined_at: `2026-11-10T10:0${i}:00Z` }))
const G = (a: string, b: string, start: string, end: string | null): BoardGame =>
  ({ id: a + b + start, court: 1, a: a.split(''), b: b.split(''), started_at: `2026-11-10T${start}:00Z`, ended_at: end && `2026-11-10T${end}:00Z` })

test('queue: people on court are out; fewest games first, then longest wait', () => {
  const games = [G('ab', 'cd', '18:00', '18:15'), G('ef', 'gh', '18:00', '18:20'), G('ac', 'ij', '18:16', null)]
  // On court now: a, c, i, j. Off: b, d (1 game, ended 18:15), e f g h (1 game, 18:20), k (0 games).
  assert.deepEqual(queue(P('abcdefghijk'), games).map(w => w.id + w.games), ['k0', 'b1', 'd1', 'e1', 'f1', 'g1', 'h1'])
})

test('pairing avoids repeat partners, then evens out ratings', () => {
  const games = [G('ab', 'cd', '18:00', '18:15')]
  const r = pairUp(['a', 'b', 'c', 'd'], games, { a: 1200, b: 1100, c: 900, d: 800 })
  const sides = [r.a, r.b].map(s => [...s].sort().join('')).sort()
  // ab and cd already partnered: of ac|bd and ad|bc, ad|bc is more even (2000 v 2000).
  assert.deepEqual(sides, ['ad', 'bc'])
})

test('suggestNext: needs enough waiting players; singles pairs 1 v 1', () => {
  assert.equal(suggestNext(P('abc'), [], 2), null)
  assert.deepEqual(suggestNext(P('abc'), [], 1), { a: ['a'], b: ['b'] })
  const s = suggestNext(P('abcdef'), [G('ab', 'cd', '18:00', null)], 2)
  assert.equal(s, null, 'only e and f are free')
})
