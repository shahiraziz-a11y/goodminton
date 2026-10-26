import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshRound, nextRound, planStats, sittingOut, type PlanGame } from './schedule.ts'

// Small seeded random so the tests are repeatable.
const seeded = (s: number) => () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
const everyone = (gs: PlanGame[]) => gs.flatMap(g => [...g.a, ...g.b])

test('mix it up (fresh): 8 on two courts, no repeat partners in 3 rounds', () => {
  const players = 'abcdefgh'.split('')
  const rounds: PlanGame[][] = []
  for (let i = 0; i < 3; i++) rounds.push(freshRound({ players, courts: 2, perSide: 2, rounds, random: seeded(7 + i), tries: 2000 }))
  const { partners } = planStats(rounds)
  assert.ok(Object.values(partners).every(n => n === 1), JSON.stringify(partners))
})

const spots = (gs: PlanGame[]) => gs.flatMap(g => [...g.a.map((p, i) => `${g.court}a${i}:${p}`), ...g.b.map((p, i) => `${g.court}b${i}:${p}`)])
const changed = (x: PlanGame[], y: PlanGame[]) => spots(y).filter(s => !spots(x).includes(s)).length
const sides = (gs: PlanGame[]) => gs.flatMap(g => [g.a, g.b].map(s => [...s].sort().join('')))

test('5 on one court: one person rotates, into the exact spot; everyone sits out once', () => {
  const players = ['a', 'b', 'c', 'd', 'e']
  const rounds: PlanGame[][] = [nextRound({ players, courts: 1, perSide: 2, rounds: [], random: seeded(1) })]
  for (let i = 0; i < 4; i++) {
    const r = nextRound({ players, courts: 1, perSide: 2, rounds, random: seeded(i + 2) })
    assert.equal(changed(rounds.at(-1)!, r), 1, 'exactly one spot changes')
    rounds.push(r)
  }
  assert.deepEqual(rounds.flatMap(r => sittingOut(players, r)).sort(), players)
})

test('6 on one court: a whole pair comes off, the other side stays, newcomers partner up', () => {
  const players = 'abcdef'.split('')
  const rounds: PlanGame[][] = [nextRound({ players, courts: 1, perSide: 2, rounds: [], random: seeded(4) })]
  for (let i = 0; i < 2; i++) {
    const prev = rounds.at(-1)!
    const waiting = sittingOut(players, prev).sort().join('')
    const r = nextRound({ players, courts: 1, perSide: 2, rounds, random: seeded(10 + i) })
    const before = sides(prev), after = sides(r)
    assert.equal(after.filter(s => before.includes(s)).length, 1, 'one side unchanged')
    assert.ok(after.includes(waiting), 'the two who waited play together')
    rounds.push(r)
  }
  // Over 3 rounds each of the 3 pairs sits out once.
  const out = rounds.map(r => sittingOut(players, r).sort().join(''))
  assert.equal(new Set(out).size, 3)
})

test('nobody waiting: the same games again', () => {
  const p4 = ['a', 'b', 'c', 'd']
  const r1 = nextRound({ players: p4, courts: 1, perSide: 2, rounds: [], random: seeded(2) })
  assert.deepEqual(nextRound({ players: p4, courts: 1, perSide: 2, rounds: [r1], random: seeded(3) }), r1)
  const p8 = 'abcdefgh'.split('')
  const r2 = nextRound({ players: p8, courts: 2, perSide: 2, rounds: [], random: seeded(5) })
  assert.deepEqual(nextRound({ players: p8, courts: 2, perSide: 2, rounds: [r2], random: seeded(6) }), r2)
})

test('9 on two courts: one person rotates, everything else stays', () => {
  const players = 'abcdefghi'.split('')
  const r1 = nextRound({ players, courts: 2, perSide: 2, rounds: [], random: seeded(8) })
  const r2 = nextRound({ players, courts: 2, perSide: 2, rounds: [r1], random: seeded(9) })
  assert.equal(changed(r1, r2), 1)
  assert.equal(sittingOut(players, r2).length, 1)
})

test('someone drops out: the one waiting takes their spot, partner stays', () => {
  const players = 'abcde'.split('')
  const r1: PlanGame[] = [{ court: 1, a: ['a', 'b'], b: ['c', 'd'] }]
  const r2 = nextRound({ players: ['a', 'c', 'd', 'e'], courts: 1, perSide: 2, rounds: [r1], random: seeded(1) })
  assert.deepEqual(r2, [{ court: 1, a: ['a', 'e'], b: ['c', 'd'] }])
  assert.equal(players.length, 5)
})

test('play again on court 1 game: pinned, the other court keeps its game, the waiting one rotates in', () => {
  const players = 'abcdefghi'.split('')
  const r1: PlanGame[] = [{ court: 1, a: ['a', 'b'], b: ['c', 'd'] }, { court: 2, a: ['e', 'f'], b: ['g', 'h'] }]
  const keep = { a: ['a', 'b'], b: ['c', 'd'] }
  const r2 = nextRound({ players, courts: 2, perSide: 2, rounds: [r1], keep, random: seeded(4) })
  assert.deepEqual(r2[0], { court: 1, ...keep })
  const rest = [...r2[1].a, ...r2[1].b]
  assert.equal(new Set(everyone(r2)).size, 8, JSON.stringify(r2))
  assert.ok(rest.includes('i') && rest.filter(p => 'efgh'.includes(p)).length === 3, JSON.stringify(r2))
})

test('play again after round 1: that game pinned on court 1, the rest rotate minimally', () => {
  const players = 'abcdefghi'.split('')
  const r1: PlanGame[] = [{ court: 1, a: ['a', 'b'], b: ['c', 'd'] }, { court: 2, a: ['e', 'f'], b: ['g', 'h'] }]
  const keep = { a: ['e', 'f'], b: ['g', 'h'] }
  const r2 = nextRound({ players, courts: 2, perSide: 2, rounds: [r1], keep, random: seeded(3) })
  assert.deepEqual(r2[0], { court: 1, ...keep })
  assert.equal(r2.length, 2)
  // Court 2: a,b,c,d with one of them swapped for i.
  const rest = [...r2[1].a, ...r2[1].b]
  assert.ok(rest.includes('i') && rest.filter(p => 'abcd'.includes(p)).length === 3, JSON.stringify(r2))
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
