import { ImageResponse } from 'next/og'
import { matchLabels } from '@/lib/match'
import { getPublicMatch } from '@/lib/supabase/public'

export const alt = 'Courtside match'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

async function unbounded() {
  try {
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=Unbounded:wght@700&text=' + encodeURIComponent('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ·–:&\'!?,.→-'))).text()
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1]
    return url ? await (await fetch(url)).arrayBuffer() : null
  } catch {
    return null
  }
}

// Mirrors the dark green WhatsApp card in the design: spot bars, title, time.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [m, font] = await Promise.all([getPublicMatch(slug), unbounded()])
  const L = m ? matchLabels(m, '') : null
  const family = font ? 'Unbounded' : 'sans-serif'
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', background: '#0F3D35', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, fontFamily: family }}>
        <div style={{ display: 'flex', fontSize: 30, letterSpacing: 3, color: '#3FD3AE' }}>COURTSIDE</div>
        {m && L ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <div style={{ display: 'flex', gap: 14 }}>
              {Array.from({ length: m.size }, (_, i) => (
                <div key={i} style={{ flex: 1, height: 22, borderRadius: 11, background: i < m.confirmed_count ? '#0E9F7E' : 'rgba(255,255,255,.18)' }} />
              ))}
            </div>
            <div style={{ display: 'flex', fontSize: 76, color: '#fff', lineHeight: 1.1 }}>{m.title}</div>
            <div style={{ display: 'flex', fontSize: 38, color: '#3FD3AE' }}>{`${L.dateLabel} · ${L.timeRange}`}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', fontSize: 76, color: '#fff' }}>Game on.</div>
        )}
        <div style={{ display: 'flex', fontSize: 34, color: 'rgba(255,255,255,.75)' }}>{L ? L.spotsLine : 'Badminton, 4 or 8'}</div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: 'Unbounded', data: font, weight: 700 }] : undefined },
  )
}
