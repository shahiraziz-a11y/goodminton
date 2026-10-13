'use client'

import { useEffect, type ReactNode } from 'react'

/** Bottom sheet from the design: dimmed backdrop, rounded top, drag handle. */
export function Sheet({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()} className="sheet">
        <span style={{ width: 36, height: 5, borderRadius: 3, background: '#C5CDD8', alignSelf: 'center', flex: 'none' }} />
        <div className="stack" style={{ gap: 4 }}>
          <span className="display" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em' }}>{title}</span>
          {subtitle && <span style={{ fontSize: 13, color: '#5B6573' }}>{subtitle}</span>}
        </div>
        {children}
      </div>
    </div>
  )
}
