import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextRound, planStats, sittingOut, type PlanGame } from './schedule.ts'

// Small seeded random so the tests are repeatable.
const seeded = (s: number) => () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
const everyone = (gs: PlanGame[]) => gs.flatMap(g => [...g.a, ...g.b])

test('5 on one court: everyone sits out once in 5 rounds', () => {
  const players = ['a', 'b', 'c', 'd', 'e']
  const rounds: PlanGame[][] = []
  for (let i = 0; i < 5; i++) rounds.push(nextRound({ players, courts: 1, perSide: 2, rounds, random: seeded(i + 1) }))
  const out = rounds.flatMap(r => sittingOut(players, r))
  assert.deepEqual([...out].sort(), players)
  assert.ok(rounds.every(r => r.length === 1 && new Set(everyone(r)).size === 4))
})

test('8 on two courts: no repeat partners in the first 3 rounds', () => {
  const players = 'abcdefgh'.split('')
  const rounds: PlanGame[][] = []
  for (let i = 0; i < 3; i++) rounds.push(nextRound({ players, courts: 2, perSide: 2, rounds, random: seeded(7 + i), tries: 2000 }))
  const { partners } = planStats(rounds)
  assert.ok(Object.values(partners).every(n => n === 1), JSON.stringify(partners))
  assert.ok(rounds.every(r => r.length === 2 && new Set(everyone(r)).size === 8))
  assert.deepEqual(rounds[0].map(g => g.court), [1, 2])
})

test('9 on two courts: one sits out, nobody twice', () => {
  const players = 'abcdefghi'.split('')
  const r = nextRound({ players, courts: 2, perSide: 2, rounds: [], random: seeded(3) })
  assert.equal(everyone(r).length, 8)
  assert.equal(new Set(everyone(r)).size, 8)
  assert.equal(sittingOut(players, r).length, 1)
})

test('play again keeps the same four on court 1, others fill court 2', () => {
  const players = 'abcdefghij'.split('')
  const keep = { a: ['a', 'b'], b: ['c', 'd'] }
  const r = nextRound({ players, courts: 2, perSide: 2, rounds: [], keep, random: seeded(5) })
  assert.deepEqual(r[0], { court: 1, ...keep })
  assert.equal(r.length, 2)
  assert.ok(r[1].a.concat(r[1].b).every(p => !'abcd'.includes(p)))
})

test('singles: one per side', () => {
  const r = nextRound({ players: ['a', 'b', 'c'], courts: 1, perSide: 1, rounds: [], random: seeded(9) })
  assert.equal(r.length, 1)
  assert.equal(r[0].a.length, 1)
  assert.equal(r[0].b.length, 1)
})

test('even sides by rating when partners are all new', () => {
  const ratings = { a: 1200, b: 1180, c: 820, d: 800 }
  const r = nextRound({ players: ['a', 'b', 'c', 'd'], courts: 1, perSide: 2, rounds: [], ratings, random: seeded(11) })
  const side = (s: string[]) => s.slice().sort().join('')
  assert.ok([side(r[0].a), side(r[0].b)].sort().join(' ') === 'ac bd' || [side(r[0].a), side(r[0].b)].sort().join(' ') === 'ad bc')
})

test('not enough players: no games', () => {
  assert.deepEqual(nextRound({ players: ['a', 'b', 'c'], courts: 1, perSide: 2, rounds: [] }), [])
})
