import type { ReactNode } from 'react'

/**
 * Example content for people not in a group yet: a striped SAMPLE tag, a dashed faded
 * panel with a watermark, and nothing inside can be tapped, so it never reads as real.
 */
export function SamplePreview({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="stack" style={{ gap: 10 }} aria-label={`${title} (sample)`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.14em', color: '#7A5A00', padding: '4px 8px', borderRadius: 6,
          background: 'repeating-linear-gradient(135deg, #FFE7A3 0 6px, #FFF3CF 6px 12px)', boxShadow: 'inset 0 0 0 1px #E9C35A' }}>SAMPLE</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: 12, color: '#9A9992', marginLeft: 'auto' }}>How it looks once you play</span>
      </div>
      <div inert aria-hidden style={{ position: 'relative', borderRadius: 26, padding: 10, border: '1.5px dashed #C9C6BD', overflow: 'hidden', userSelect: 'none' }}>
        <div style={{ opacity: 0.62, filter: 'grayscale(.45)', pointerEvents: 'none' }}>{children}</div>
        <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-14deg)', pointerEvents: 'none',
          fontSize: 44, fontWeight: 900, letterSpacing: '.2em', color: 'rgba(17,17,17,.07)', whiteSpace: 'nowrap' }}>SAMPLE</span>
      </div>
    </section>
  )
}
