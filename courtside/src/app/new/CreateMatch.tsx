'use client'

import { useRouter } from 'next/navigation'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Frame, Seg } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { money, nextSaturday } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'
import { CURRENCY } from '@/lib/supabase/env'

const big: CSSProperties = { fontFamily: 'var(--display)', fontSize: 44, fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1 }

export function CreateMatch() {
  const router = useRouter()
  const { flash } = useFeedback()
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({
    size: 4 as 4 | 8, title: 'Saturday Doubles', venue: '', courts: '', parking: '',
    date: nextSaturday(), time: '19:00', duration: 90, cost: '', closes: 6,
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }))
  const cost = Number(f.cost || 0)

  async function create() {
    if (!f.title.trim() || !f.venue.trim()) return flash('Add a match name and venue')
    if (cost < 0 || Number.isNaN(cost)) return flash('Court cost must be a number')
    setBusy(true)
    const { data, error } = await createClient().rpc('create_match', {
      p_title: f.title.trim(), p_size: f.size, p_venue: f.venue.trim(), p_courts: f.courts.trim(), p_parking: f.parking.trim(),
      p_date: f.date, p_time: f.time, p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      p_duration_min: f.duration, p_rsvp_close_hours: f.closes, p_court_cost: cost, p_currency: CURRENCY,
    })
    if (error) { setBusy(false); return flash(error.message) }
    router.push(`/m/${data}/share`)
  }

  return (
    <Frame back="/">
      <div className="screen" style={{ gap: 24 }}>
        <span className="h1">New match</span>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">Players</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {([[4, '1 court · doubles'], [8, '2 courts · doubles']] as const).map(([n, sub]) => {
              const sel = f.size === n
              return (
                <button key={n} type="button" onClick={() => set('size', n)} aria-pressed={sel} className={sel ? '' : 'card'}
                  style={{ borderRadius: 22, border: 'none', background: sel ? '#0E9F7E' : '#fff', padding: 18, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ ...big, color: sel ? '#fff' : '#12161C' }}>{n}</span>
                  <span style={{ fontSize: 12, fontWeight: sel ? 800 : 700, color: sel ? '#fff' : '#5B6573' }}>{sub}</span>
                </button>
              )
            })}
          </div>
          <span className="note">Fixed sizes, so nobody sits out on rotation.</span>
        </div>
        <Field label="Match name"><input className="field" value={f.title} onChange={e => set('title', e.target.value)} maxLength={80} /></Field>
        <Field label="Venue"><input className="field" value={f.venue} onChange={e => set('venue', e.target.value)} placeholder="e.g. Al Quoz Sports Hall" maxLength={120} /></Field>
        <Field label="Court numbers" hint="Revealed to confirmed players only.">
          <input className="field" value={f.courts} onChange={e => set('courts', e.target.value)} placeholder="e.g. Court 3" maxLength={60} />
        </Field>
        <Field label="Parking notes" hint="Optional. Also for confirmed players only.">
          <input className="field" value={f.parking} onChange={e => set('parking', e.target.value)} placeholder="e.g. Free parking behind the hall" maxLength={200} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Date"><input className="field" type="date" value={f.date} onChange={e => set('date', e.target.value)} style={{ padding: '0 12px', fontSize: 15 }} /></Field>
          <Field label="Start"><input className="field" type="time" value={f.time} onChange={e => set('time', e.target.value)} style={{ padding: '0 12px', fontSize: 15 }} /></Field>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">Duration</span>
          <Seg options={[60, 90, 120].map(d => ({ value: d, label: `${d} min` }))} value={f.duration} onChange={v => set('duration', v)} />
        </div>
        <Field label="Court cost · per court" hint={`${money(cost / 4, CURRENCY)} per player`}>
          <div className="field-wrap">
            <span style={{ fontWeight: 800, color: '#0E7F66', fontSize: 14 }}>{CURRENCY}</span>
            <input type="number" inputMode="decimal" min={0} value={f.cost} onChange={e => set('cost', e.target.value)} placeholder="0"
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: '#12161C', fontSize: 16, outline: 'none' }} />
          </div>
        </Field>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">RSVPs close</span>
          <Seg options={[2, 6, 24].map(h => ({ value: h, label: `${h}h before` }))} value={f.closes} onChange={v => set('closes', v)} />
          <span className="note">Sign-ups lock automatically, so you have the final count in time to book.</span>
        </div>
        <button className="btn" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create match & get link'}</button>
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
