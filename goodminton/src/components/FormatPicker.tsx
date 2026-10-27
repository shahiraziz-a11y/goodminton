'use client'

import { Seg } from './Chrome'
import { perCourt, type Format } from '@/lib/types'

/** Singles or doubles, then 1–4 courts. The big number is the player count, as in the design. */
export function FormatPicker({ format, courts, onChange }: { format: Format; courts: number; onChange: (format: Format, courts: number) => void }) {
  const per = perCourt(format)
  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="eyebrow">Players</span>
      <Seg options={[{ value: 'doubles' as Format, label: 'Doubles' }, { value: 'singles' as Format, label: 'Singles' }]} value={format} onChange={f => onChange(f, courts)} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[1, 2, 3, 4].map(n => {
          const sel = courts === n
          return (
            <button key={n} type="button" onClick={() => onChange(format, n)} aria-pressed={sel} className={sel ? '' : 'card'}
              style={{ borderRadius: 18, border: 'none', background: sel ? '#0E5A3A' : '#fff', padding: '14px 10px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.04em', lineHeight: 1, color: sel ? '#fff' : '#111111' }}>{n * per}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: sel ? '#fff' : '#6B6B66' }}>{n} court{n > 1 ? 's' : ''}</span>
            </button>
          )
        })}
      </div>
      <span className="note">Fixed sizes, so nobody sits out on rotation.</span>
    </div>
  )
}
