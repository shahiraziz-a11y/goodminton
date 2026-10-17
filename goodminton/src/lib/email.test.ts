import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderEmail, unsubscribeToken, validUnsubscribe } from './email.ts'

const id = '3f2a8c1e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'

test('unsubscribe links: valid, tampered, other user, other secret', () => {
  const t = unsubscribeToken(id, 's3cret')
  assert.equal(validUnsubscribe(id, t, 's3cret'), true)
  assert.equal(validUnsubscribe(id, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'), 's3cret'), false)
  assert.equal(validUnsubscribe('3f2a8c1e-5b6d-4e7f-8a9b-0c1d2e3f4a5c', t, 's3cret'), false)
  assert.equal(validUnsubscribe(id, t, 'other'), false)
  assert.equal(validUnsubscribe(id, t, ''), false)
  assert.equal(validUnsubscribe('not-a-uuid', t, 's3cret'), false)
})

test('email has the match link, unsubscribe link, and escapes names', () => {
  const { text, html } = renderEmail({ subject: 'E1: <Ann> joined', body: 'Joined: <Ann>\nNow 3/4 in', url: '/m/e1-abc' },
    'https://goodminton.app', 'https://goodminton.app/api/unsubscribe?u=x&t=y')
  assert.match(text, /View the match: https:\/\/goodminton\.app\/m\/e1-abc/)
  assert.match(text, /Stop these emails: https:\/\/goodminton\.app\/api\/unsubscribe/)
  assert.ok(html.includes('&lt;Ann&gt; joined') && !html.includes('<Ann>'), 'names escaped')
  assert.ok(html.includes('Joined: &lt;Ann&gt;<br>Now 3/4 in'), 'line breaks kept')
  assert.ok(html.includes('href="https://goodminton.app/m/e1-abc"'))
})
