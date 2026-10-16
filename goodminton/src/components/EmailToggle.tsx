'use client'

import { useEffect, useState } from 'react'
import { useFeedback } from './Feedback'
import { createClient } from '@/lib/supabase/client'

/** "Email updates · On/Off": new matches, joins and drop-outs, and court bookings by email. */
export function EmailToggle() {
  const { flash } = useFeedback()
  const [st, setSt] = useState<{ on: boolean; email: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    createClient().rpc('get_email_updates').then(({ data }) => { if (data) setSt(data as { on: boolean; email: string | null }) })
  }, [])
  if (!st?.email) return null
  async function toggle() {
    const on = !st!.on
    setBusy(true)
    const { error } = await createClient().rpc('set_email_updates', { p_on: on })
    setBusy(false)
    if (error) return flash(error.message)
    setSt({ ...st!, on })
    flash(on ? `Emails on · ${st!.email}` : 'Emails off')
  }
  return (
    <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 14 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0E7F66" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
        <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
      </svg>
      <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <span style={{ fontSize: 13, color: '#12161C', fontWeight: 600 }}>Email updates</span>
        <span style={{ fontSize: 12, color: '#5B6573', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {st.on ? `New matches, joins, drop-outs, bookings · ${st.email}` : 'Off'}
        </span>
      </span>
      <button className={`chip-btn${st.on ? '' : ' go'}`} disabled={busy} onClick={toggle} aria-pressed={st.on}>{st.on ? 'Turn off' : 'Turn on'}</button>
    </div>
  )
}
