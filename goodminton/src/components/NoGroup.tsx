import Link from 'next/link'
import { AppIcon } from './AppIcon'

/**
 * First visit, not in any group yet: one friendly card instead of an empty screen.
 * `onStart` opens the new-group sheet in place; otherwise "Start a group" goes to Groups.
 */
export function NoGroup({ title, line, photo = 3, onStart, match = true }: {
  title: string; line: string; photo?: number; onStart?: () => void
  /** Lead with "Organise a match" (on by default). */
  match?: boolean
}) {
  const primary = { height: 52, fontSize: 15, background: '#fff', color: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center' } as const
  const secondary = { height: 48, fontSize: 14, color: '#fff', background: 'rgba(255,255,255,.14)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' } as const
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ position: 'relative', borderRadius: 32, overflow: 'hidden', color: '#fff', padding: '120px 22px 22px', display: 'flex', flexDirection: 'column', gap: 16,
        background: `linear-gradient(180deg, rgba(6,42,26,.15) 0%, rgba(6,42,26,.55) 40%, rgba(6,42,26,.95) 100%), #0E4A30 url(/photos/court-${photo}.webp) center/cover`,
        boxShadow: '0 30px 50px -30px rgba(14,40,26,.65)' }}>
        <span style={{ position: 'absolute', top: 20, left: 20, display: 'flex', borderRadius: 14, boxShadow: '0 8px 20px -6px rgba(0,0,0,.5)' }}><AppIcon size={48} /></span>
        <div className="stack" style={{ gap: 6 }}>
          <span className="display" style={{ fontSize: 30, letterSpacing: '-.04em', lineHeight: 1.02 }}>{title}</span>
          <span style={{ fontSize: 14, color: '#CFE3D5', lineHeight: 1.45 }}>{line}</span>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {/* Organising a match comes first; it sets up a group on the way. */}
          {match && <Link className="btn" style={primary} href="/new">Organise a match</Link>}
          {onStart
            ? <button className="btn" style={match ? secondary : primary} onClick={onStart}>Start a group</button>
            : <Link className="btn" style={match ? secondary : primary} href="/groups?new=1">Start a group</Link>}
        </div>
      </div>
      <span className="note" style={{ textAlign: 'center' }}>Got an invite? Open the link from WhatsApp.</span>
    </div>
  )
}
