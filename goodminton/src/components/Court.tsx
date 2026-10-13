import { Avatar } from './Avatar'
import { LockIcon } from './Chrome'
import type { Person } from '@/lib/people'

export type Slot =
  | { kind: 'named'; p: Person }
  | { kind: 'anon' }
  | { kind: 'wait'; name: string }
  | { kind: 'empty' }

type Props = {
  label: string
  /** "03", or null when the viewer isn't allowed to see it. */
  num: string | null
  dateLabel: string
  start: string
  end: string
  slots: Slot[]
  /** Confirmed viewer, but the court isn't booked yet. */
  tbc?: boolean
  ghost?: boolean
  footer?: string
}

/** A court card: number, time, and a top-down court with players either side of the net. */
export function CourtCard({ label, num, dateLabel, start, end, slots, tbc, ghost, footer }: Props) {
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, opacity: ghost ? 0.85 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="eyebrow">{label}</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="display muted" style={{ fontSize: 12, fontWeight: 600 }}>COURT</span>
            {tbc ? (
              <span className="display" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: '#8A94A3' }}>TBC</span>
            ) : num ? (
              <span className="display" style={{ fontSize: 32, fontWeight: 700, lineHeight: 1, letterSpacing: '-.02em', color: ghost ? '#5B6573' : '#12161C' }}>{num}</span>
            ) : (
              <span className="display" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#8A94A3', fontSize: 26, fontWeight: 700, lineHeight: 1 }} aria-label="Hidden until you're confirmed">
                <LockIcon />?
              </span>
            )}
          </div>
        </div>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, padding: '8px 12px', borderRadius: 14 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#5B6573' }}>{dateLabel}</span>
          <span className="display" style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{start}</span>
          <span className="display muted" style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>→ {end}</span>
        </div>
      </div>
      <div className={`court${ghost ? ' ghost' : ''}`}>
        <Half slots={[slots[0], slots[1]]} side="left" />
        <div className="court-net" />
        <Half slots={[slots[2], slots[3]]} side="right" />
      </div>
      {footer && <span style={{ fontSize: 13, color: '#D9622B', fontWeight: 600 }}>{footer}</span>}
    </div>
  )
}

function Half({ slots, side }: { slots: Slot[]; side: 'left' | 'right' }) {
  return (
    <div className="court-half">
      <span className="court-service" style={side === 'left' ? { right: '22%' } : { left: '22%' }} />
      {slots.map((s, i) => <div key={i} className="court-slot"><SlotView s={s ?? { kind: 'empty' }} /></div>)}
    </div>
  )
}

function SlotView({ s }: { s: Slot }) {
  const center = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' } as const
  switch (s.kind) {
    case 'named':
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', minWidth: 0 }}>
          <Avatar p={s.p} size={26} font={10} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.15, overflow: 'hidden' }}>{s.p.name}</span>
        </div>
      )
    case 'anon':
      return <div style={center}><span style={{ width: 26, height: 26, borderRadius: '50%', background: '#0E9F7E', boxShadow: '0 0 14px rgba(255,255,255,.45)' }} /></div>
    case 'wait':
      return (
        <div style={{ ...center, padding: '0 8px' }}>
          <span style={{ fontSize: 11, fontWeight: 800, padding: '5px 9px', borderRadius: 99, background: '#E5484D', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{s.name}</span>
        </div>
      )
    default:
      return <div style={center}><span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', color: 'rgba(255,255,255,.45)' }}>OPEN</span></div>
  }
}
