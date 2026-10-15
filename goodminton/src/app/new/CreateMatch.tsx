'use client'

import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { Frame, Seg } from '@/components/Chrome'
import { FormatPicker } from '@/components/FormatPicker'
import { useFeedback } from '@/components/Feedback'
import { nextSaturday } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'
import { CURRENCY } from '@/lib/supabase/env'
import type { Format } from '@/lib/types'

export function CreateMatch() {
  const router = useRouter()
  const { flash } = useFeedback()
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({
    format: 'doubles' as Format, courts: 1, title: 'Saturday Doubles', venue: '',
    date: nextSaturday(), time: '19:00', duration: 90, closes: 6, weekly: false, regulars: true,
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }))

  async function create() {
    if (!f.title.trim()) return flash('Add a match name')
    setBusy(true)
    const { data, error } = await createClient().rpc('create_match', {
      p_title: f.title.trim(), p_format: f.format, p_court_count: f.courts, p_venue: f.venue.trim(),
      p_date: f.date, p_time: f.time, p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      p_duration_min: f.duration, p_rsvp_close_hours: f.closes, p_currency: CURRENCY,
    })
    if (error) { setBusy(false); return flash(error.message) }
    if (f.weekly) {
      const db = createClient()
      const { data: m } = await db.rpc('get_match', { p_slug: data })
      const { error: e2 } = await db.rpc('set_repeat', { p_match: (m as { id: string }).id, p_weekly: true, p_regulars_first: f.regulars })
      if (e2) flash(`Match created, but repeating wasn't saved: ${e2.message}`)
    }
    router.push(`/m/${data}/share`)
  }

  return (
    <Frame back="/" tab="home">
      <div className="screen" style={{ gap: 24 }}>
        <span className="h1">New match</span>
        <FormatPicker format={f.format} courts={f.courts} onChange={(format, courts) => setF(x => ({ ...x, format, courts }))} />
        <Field label="Match name"><input className="field" value={f.title} onChange={e => set('title', e.target.value)} maxLength={80} /></Field>
        <Field label="Venue · optional" hint="Not booked yet? Leave it. You'll add the venue, court and cost when you book.">
          <input className="field" value={f.venue} onChange={e => set('venue', e.target.value)} placeholder="e.g. Al Quoz Sports Hall" maxLength={120} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Date"><input className="field" type="date" value={f.date} onChange={e => set('date', e.target.value)} style={{ padding: '0 12px', fontSize: 15 }} /></Field>
          <Field label="Start"><input className="field" type="time" value={f.time} onChange={e => set('time', e.target.value)} style={{ padding: '0 12px', fontSize: 15 }} /></Field>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">Duration</span>
          <Seg options={[60, 90, 120].map(d => ({ value: d, label: `${d} min` }))} value={f.duration} onChange={v => set('duration', v)} />
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">RSVPs close</span>
          <Seg options={[2, 6, 24].map(h => ({ value: h, label: `${h}h before` }))} value={f.closes} onChange={v => set('closes', v)} />
          <span className="note">Sign-ups lock automatically, so you have the final count in time to book.</span>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">Repeats</span>
          <Seg options={[{ value: false, label: 'Just once' }, { value: true, label: 'Every week' }]} value={f.weekly} onChange={v => set('weekly', v)} />
          {f.weekly && (
            <>
              <span className="note">Next week&apos;s match appears automatically once this one starts. Nothing is booked until you book it.</span>
              <Seg options={[{ value: true, label: 'Regulars first' }, { value: false, label: 'Open to all' }]} value={f.regulars} onChange={v => set('regulars', v)} />
              <span className="note">{f.regulars ? 'This week\'s players get the first 12 hours to claim a spot; others join the waitlist until then.' : 'Anyone can take a spot as soon as it appears.'}</span>
            </>
          )}
        </div>
        <button className="btn" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create plan & get link'}</button>
      </div>
    </Frame>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="label">
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span className="note">{hint}</span>}
    </label>
  )
}
