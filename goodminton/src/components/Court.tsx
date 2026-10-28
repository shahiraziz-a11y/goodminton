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
              <span className="display" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: '#9A9992' }}>TBC</span>
            ) : num ? (
              <span className="display" style={{ fontSize: 32, fontWeight: 700, lineHeight: 1, letterSpacing: '-.02em', color: ghost ? '#6B6B66' : '#111111' }}>{num}</span>
            ) : (
              <span className="display" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9A9992', fontSize: 26, fontWeight: 700, lineHeight: 1 }} aria-label="Hidden until you're confirmed">
                <LockIcon />?
              </span>
            )}
          </div>
        </div>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, padding: '8px 12px', borderRadius: 14 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#6B6B66' }}>{dateLabel}</span>
          <span className="display" style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{start}</span>
          <span className="display muted" style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>→ {end}</span>
        </div>
      </div>
      <div className="court-stage">
        <div className={`court${ghost ? ' ghost' : ''}`}>
          <span className="court-line" style={{ left: 0, right: 0, top: '7.5%', height: 1.5 }} />
          <span className="court-line" style={{ left: 0, right: 0, bottom: '7.5%', height: 1.5 }} />
          <span className="court-line" style={{ top: 0, bottom: 0, left: '5.5%', width: 1.5 }} />
          <span className="court-line" style={{ top: 0, bottom: 0, right: '5.5%', width: 1.5 }} />
          <Half slots={slots.slice(0, slots.length / 2)} side="left" />
          <div className="court-net" />
          <Half slots={slots.slice(slots.length / 2)} side="right" />
        </div>
      </div>
      {extras.length > 0 && (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 14 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#0E5A3A' }}>+{extras.length} ROTATING</span>
          {extras.map(x => (
            <span key={x.p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px 3px 3px', borderRadius: 99, background: x.mine ? '#0E5A3A' : '#fff', color: x.mine ? '#fff' : '#111111' }}>
              <Avatar p={x.p} size={22} font={9} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{x.p.first}{x.mine ? ' · You' : ''}</span>
              {x.onRemove && (
                <button type="button" aria-label={`Remove ${x.p.first}`} onClick={x.onRemove}
                  style={{ border: 'none', background: 'none', color: x.mine ? '#fff' : '#9A9992', fontSize: 14, lineHeight: 1, padding: 0, cursor: 'pointer' }}>×</button>
              )}
            </span>
          ))}
        </div>
      )}
      {footer && <span style={{ fontSize: 13, color: '#6B6B66', fontWeight: 600 }}>{footer}</span>}
      {(booking || action) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 32 }}>
          {booking && <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', color: booking.booked ? '#0E5A3A' : '#9A9992' }}>{booking.text}</span>}
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
    case 'mine': {
      // Your own spot: tap it for your options (drop out etc.).
      const inner = (
        <>
          <span style={{ display: 'flex', borderRadius: '50%', boxShadow: '0 0 0 2px #111111, 0 0 0 3.5px #FFFFFF', flex: 'none' }}><Avatar p={s.p} size={26} font={10} /></span>
          <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{s.p.first}</span>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.1em', padding: '3px 6px', borderRadius: 99, background: '#fff', color: '#111111', flex: 'none' }}>YOU</span>
        </>
      )
      const style = { flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', minWidth: 0, color: '#fff' } as const
      return s.onTap
        ? <button type="button" onClick={s.onTap} aria-label="Your spot: options" style={{ ...style, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}>{inner}</button>
        : <div style={style}>{inner}</div>
    }
    case 'add':
      return (
        <button type="button" onClick={s.onTap} aria-label="Add a player"
          style={{ ...center, gap: 6, border: 'none', background: 'transparent', color: 'rgba(255,255,255,.75)', cursor: 'pointer' }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', border: '1.5px dashed rgba(255,255,255,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em' }}>ADD</span>
        </button>
      )
    case 'claim':
      return (
        <button type="button" onClick={s.onTap} disabled={s.disabled} aria-label="Claim this spot"
          style={{ ...center, border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 6px', opacity: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}><span className="spot-pulse" />Your spot?</span>
        </button>
      )
    case 'anon':
      return <div style={center}><span style={{ width: 26, height: 26, borderRadius: '50%', background: '#0E5A3A', boxShadow: '0 0 14px rgba(255,255,255,.45)' }} /></div>
    case 'wait':
      return (
        <div style={{ ...center, padding: '0 8px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '5px 9px', borderRadius: 99, background: '#111111', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{s.name}</span>
          {s.onRemove && <span style={{ marginLeft: 6 }}><RemoveX name={s.name.split(' ')[0]} onClick={s.onRemove} /></span>}
        </div>
      )
    default:
      return <div style={center}><span style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px dashed rgba(255,255,255,.45)' }} aria-label="Open spot" /></div>
  }
}

function RemoveX({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={`Remove ${name}`} onClick={onClick}
      style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.18)', color: '#fff', fontSize: 14, lineHeight: 1, padding: 0, flex: 'none', cursor: 'pointer' }}>×</button>
  )
}
