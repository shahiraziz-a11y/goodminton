import type { ReactNode } from 'react'
import { Avatar } from './Avatar'
import { LockIcon } from './Chrome'
import type { Person } from '@/lib/people'

export type Slot =
  | { kind: 'named'; p: Person; onRemove?: () => void }
  /** The viewer's own spot, highlighted; the − button opens their drop-out options. */
  | { kind: 'mine'; p: Person; onTap?: () => void }
  | { kind: 'anon' }
  | { kind: 'wait'; name: string; onRemove?: () => void }
  | { kind: 'empty' }
  /** An open spot the viewer can fill by adding someone. */
  | { kind: 'add'; onTap: () => void }
  /** An open spot someone not yet in the match can tap to join on this court. */
  | { kind: 'claim'; onTap: () => void; disabled?: boolean }

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
  /** "✓ Booked by Ann" / "Not booked yet", under the court. */
  booking?: { text: string; booked: boolean }
  /** e.g. the Book button. */
  action?: ReactNode
  /** Extra players beyond the court's size, who rotate in. */
  extras?: { p: Person; mine?: boolean; onRemove?: () => void }[]
}

/** A court card: number, time, and a top-down court with players either side of the net. */
export function CourtCard({ label, num, dateLabel, start, end, slots, tbc, ghost, footer, booking, action, extras = [] }: Props) {
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
        <Half slots={slots.slice(0, slots.length / 2)} side="left" />
        <div className="court-net" />
        <Half slots={slots.slice(slots.length / 2)} side="right" />
      </div>
      {extras.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 14, background: '#E8F7F2' }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.12em', color: '#0E7F66' }}>+{extras.length} ROTATING</span>
          {extras.map(x => (
            <span key={x.p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px 3px 3px', borderRadius: 99, background: x.mine ? '#0E9F7E' : '#fff', color: x.mine ? '#fff' : '#12161C' }}>
              <Avatar p={x.p} size={22} font={9} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{x.p.first}{x.mine ? ' · You' : ''}</span>
              {x.onRemove && (
                <button type="button" aria-label={`Remove ${x.p.first}`} onClick={x.onRemove}
                  style={{ border: 'none', background: 'none', color: x.mine ? '#fff' : '#8A94A3', fontSize: 14, lineHeight: 1, padding: 0, cursor: 'pointer' }}>×</button>
              )}
            </span>
          ))}
        </div>
      )}
      {footer && <span style={{ fontSize: 13, color: '#D9622B', fontWeight: 600 }}>{footer}</span>}
      {(booking || action) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 32 }}>
          {booking && <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.04em', color: booking.booked ? '#0E7F66' : '#8A94A3' }}>{booking.text}</span>}
          {action}
        </div>
      )}
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
          <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.15, overflow: 'hidden' }}>{s.p.name}</span>
          {s.onRemove && <RemoveX name={s.p.first} onClick={s.onRemove} />}
        </div>
      )
    case 'mine':
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', minWidth: 0, background: 'rgba(14,159,126,.55)', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.75)', color: '#fff' }}>
          <Avatar p={s.p} size={26} font={10} ring />
          <span className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.15, overflow: 'hidden' }}>{s.p.name}</span>
            <span style={{ alignSelf: 'flex-start', fontSize: 9, fontWeight: 900, letterSpacing: '.12em', padding: '2px 6px', borderRadius: 99, background: '#fff', color: '#0E7F66' }}>YOU</span>
          </span>
          {s.onTap && (
            <button type="button" onClick={s.onTap} aria-label="Drop out"
              style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.22)', color: '#fff', fontSize: 16, fontWeight: 800, lineHeight: 1, padding: 0, flex: 'none', cursor: 'pointer' }}>−</button>
          )}
        </div>
      )
    case 'add':
      return (
        <button type="button" onClick={s.onTap} aria-label="Add a player"
          style={{ ...center, gap: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,.75)', cursor: 'pointer' }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', border: '1.5px dashed rgba(255,255,255,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.14em' }}>ADD</span>
        </button>
      )
    case 'claim':
      return (
        <button type="button" onClick={s.onTap} disabled={s.disabled} aria-label="Claim this spot"
          style={{ ...center, border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 6px' }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', padding: '7px 11px', borderRadius: 99, background: '#5FE3BE', color: '#0A2622', whiteSpace: 'nowrap' }}>Tap to join</span>
        </button>
      )
    case 'anon':
      return <div style={center}><span style={{ width: 26, height: 26, borderRadius: '50%', background: '#0E9F7E', boxShadow: '0 0 14px rgba(255,255,255,.45)' }} /></div>
    case 'wait':
      return (
        <div style={{ ...center, padding: '0 8px' }}>
          <span style={{ fontSize: 11, fontWeight: 800, padding: '5px 9px', borderRadius: 99, background: '#E5484D', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{s.name}</span>
          {s.onRemove && <span style={{ marginLeft: 6 }}><RemoveX name={s.name.split(' ')[0]} onClick={s.onRemove} /></span>}
        </div>
      )
    default:
      return <div style={center}><span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', color: 'rgba(255,255,255,.45)' }}>OPEN</span></div>
  }
}

function RemoveX({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={`Remove ${name}`} onClick={onClick}
      style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.18)', color: '#fff', fontSize: 14, lineHeight: 1, padding: 0, flex: 'none', cursor: 'pointer' }}>×</button>
  )
}
