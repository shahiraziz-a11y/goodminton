import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gameLine, matchSummary } from './match.ts'
import type { MatchGame } from './types.ts'

const p = (id: string, full_name: string) => ({ id, full_name })
const [priya, karan, omar, lena] = [p('p', 'Priya Nair'), p('k', 'Karan Shah'), p('o', 'Omar Ali'), p('l', 'Lena Fox')]
const g = (a: typeof priya[], b: typeof priya[], winner: 'a' | 'b', sa: number | null = null, sb: number | null = null): MatchGame =>
  ({ id: Math.random().toString(), created_by: 'p', winner, score_a: sa, score_b: sb, a, b })

test('game line: winners first, score high–low', () => {
  assert.equal(gameLine(g([priya, karan], [omar, lena], 'a', 21, 17)), 'Priya & Karan beat Omar & Lena 21–17')
  assert.equal(gameLine(g([priya, karan], [omar, lena], 'b', 15, 21)), 'Omar & Lena beat Priya & Karan 21–15')
  assert.equal(gameLine(g([priya], [omar], 'a')), 'Priya beat Omar')
})

test('summary: oldest game first, top players by wins', () => {
  // Newest first, as get_match returns them.
  const games = [
    g([priya, omar], [karan, lena], 'a', 21, 19),
    g([priya, karan], [omar, lena], 'b'),
    g([priya, karan], [omar, lena], 'a', 21, 17),
  ]
  const s = matchSummary('Thursday Smash', 'Thu 22 Oct', games, 'https://x/m/t').split('\n')
  assert.deepEqual(s, [
    '🏸 Thursday Smash · Thu 22 Oct',
    '3 games',
    '• Priya & Karan beat Omar & Lena 21–17',
    '• Omar & Lena beat Priya & Karan',
    '• Priya & Omar beat Karan & Lena 21–19',
    'Top: Priya 2–1, Omar 2–1, Karan 1–2',
    'https://x/m/t',
  ])
})

test('summary keeps the last 8 games', () => {
  const games = Array.from({ length: 10 }, () => g([priya], [omar], 'a'))
  const s = matchSummary('S', 'Mon 1 Jan', games, 'l').split('\n')
  assert.equal(s[1], '10 games (last 8)')
  assert.equal(s.filter(l => l.startsWith('•')).length, 8)
})
