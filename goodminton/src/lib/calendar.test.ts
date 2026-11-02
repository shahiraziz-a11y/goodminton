import { test } from 'node:test'
import assert from 'node:assert/strict'
import { icsFor, type CalEvent } from './calendar.ts'

const ev: CalEvent = {
  uid: 'm1@goodminton.app', method: 'REQUEST', sequence: 42, start: '2026-10-31T15:00:00Z', end: '2026-10-31T16:30:00Z',
  title: 'Thursday Night Doubles', location: 'Al Quoz Sports Hall, Dubai · Court 5', url: '/m/thursday-ab12',
}
const to = { name: 'Ann Lee', address: 'ann@example.com' }

test('invite: times in UTC, details escaped, player already going', () => {
  const ics = icsFor(ev, 'https://goodminton.app', 'app@example.com', to, new Date('2026-10-28T10:00:00Z'))
  const unfolded = ics.replace(/\r\n /g, '')
  assert.ok(ics.endsWith('\r\n') && !/[^\r]\n/.test(ics), 'CRLF line endings')
  for (const l of ['METHOD:REQUEST', 'UID:m1@goodminton.app', 'SEQUENCE:42', 'DTSTAMP:20261028T100000Z', 'DTSTART:20261031T150000Z',
    'DTEND:20261031T163000Z', 'LOCATION:Al Quoz Sports Hall\\, Dubai · Court 5', 'URL:https://goodminton.app/m/thursday-ab12',
    'ORGANIZER;CN=Goodminton:mailto:app@example.com', 'STATUS:CONFIRMED', 'TRIGGER:-PT2H']) {
    assert.ok(unfolded.includes(l), l)
  }
  assert.ok(unfolded.includes('PARTSTAT=ACCEPTED') && unfolded.includes('mailto:ann@example.com'))
})

test('cancel: same event, marked cancelled, no reminder', () => {
  const ics = icsFor({ ...ev, method: 'CANCEL', sequence: 43 }, 'https://goodminton.app', 'app@example.com', to)
  assert.ok(ics.includes('METHOD:CANCEL') && ics.includes('STATUS:CANCELLED') && ics.includes('UID:m1@goodminton.app') && ics.includes('SEQUENCE:43'))
  assert.ok(!ics.includes('VALARM'))
})

test('long lines fold at 75 bytes', () => {
  const ics = icsFor({ ...ev, title: 'A very long match name '.repeat(6) }, 'https://goodminton.app', 'app@example.com', to)
  assert.ok(ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75))
})
