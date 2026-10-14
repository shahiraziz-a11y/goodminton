import { test } from 'node:test'
import assert from 'node:assert/strict'
import { balancesFor, transfersOf } from './split.ts'
import { courtNumber, fmtDate, fmtTime, joinedAfter, money } from './format.ts'
import { initials } from './people.ts'
import type { LedgerMatch } from './types.ts'

test('organiser paid the court: everyone else owes a quarter', () => {
  const { out, share } = transfersOf(['r', 'p', 's', 'm'], [{ amount: 180, paid_by: 'r' }])
  assert.equal(share, 45)
  assert.deepEqual(out.map(t => [t.from, t.to, t.amount]), [['p', 'r', 45], ['s', 'r', 45], ['m', 'r', 45]])
})

test('two payers net out', () => {
  // Court 160 by r, shuttles 48 by d. Share 52 each.
  const { out } = transfersOf(['r', 'm', 'd', 'a'], [{ amount: 160, paid_by: 'r' }, { amount: 48, paid_by: 'd' }])
  const owed = (to: string) => out.filter(t => t.to === to).reduce((s, t) => s + t.amount, 0)
  assert.equal(owed('r'), 108)
  assert.equal(owed('d'), 0)
  assert.equal(out.find(t => t.from === 'd')?.amount, 4) // paid 48 of a 52 share
})

test('a payer who dropped out is still paid back', () => {
  const { out } = transfersOf(['a', 'b'], [{ amount: 20, paid_by: 'gone' }])
  assert.deepEqual(out.map(t => [t.from, t.to, t.amount]), [['a', 'gone', 10], ['b', 'gone', 10]])
})

test('settlement covers the transfer until expenses grow', () => {
  const players = ['r', 'p']
  const paid = [{ from: 'p', to: 'r', amount: 50 }]
  assert.equal(transfersOf(players, [{ amount: 100, paid_by: 'r' }], paid).out[0].settled, true)
  const grown = transfersOf(players, [{ amount: 100, paid_by: 'r' }, { amount: 30, paid_by: 'r' }], paid).out[0]
  assert.equal(grown.settled, false)
  assert.equal(grown.open, 15)
})

test('balances across matches', () => {
  const m = (id: string, players: string[], payer: string, amount: number, settlements = []): LedgerMatch => ({
    id, slug: id, title: id, starts_at: '2026-10-15T16:00:00Z', timezone: 'Asia/Dubai', currency: 'AED',
    players, expenses: [{ amount, paid_by: payer }], settlements, people: {},
  })
  const { net, total, lines } = balancesFor('r', [m('a', ['r', 'p'], 'r', 100), m('b', ['r', 'p', 's', 'x'], 'p', 80)])
  assert.equal(net.p, 30) // p owes 50, r owes p 20
  assert.equal(total, 30)
  assert.equal(lines.length, 2)
})

test('a sponsor pays their own share and their guest\'s', () => {
  // Ann added guest Raj, so the split lists Ann twice.
  const { out } = transfersOf(['olly', 'ann', 'ann', 'bob'], [{ amount: 120, paid_by: 'olly' }])
  assert.equal(out.find(t => t.from === 'ann')?.amount, 60)
  assert.equal(out.find(t => t.from === 'bob')?.amount, 30)
})

test('formatting', () => {
  const iso = '2026-10-15T16:00:00Z' // 8 PM in Dubai
  assert.equal(fmtDate(iso, 'Asia/Dubai'), 'Thu 15 Oct')
  assert.equal(fmtTime(iso, 'Asia/Dubai'), '8:00 PM')
  assert.equal(fmtTime('2026-10-15T08:30:00Z', 'UTC'), '8:30 AM')
  assert.equal(fmtTime('2026-10-15T00:05:00Z', 'UTC'), '12:05 AM')
  assert.equal(money(45, 'AED'), 'AED 45')
  assert.equal(money(52.5, 'AED'), 'AED 52.50')
  assert.equal(courtNumber('Court 3 & Court 4', 1), '04')
  assert.equal(courtNumber('Main hall', 0), '01')
  assert.equal(joinedAfter('2026-10-12T10:14:00Z', '2026-10-12T10:00:00Z'), '14m after')
  assert.equal(initials('Rohan Kapoor'), 'RK')
  assert.equal(initials('cher'), 'CH')
})
