import { ImageResponse } from 'next/og'
import { LOGO_DATA_URL } from '@/lib/logo'
import { matchLabels } from '@/lib/match'
import { getPublicMatch } from '@/lib/supabase/public'

export const alt = 'Goodminton match'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

async function geist() {
  try {
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=Geist:wght@600&text=' + encodeURIComponent('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ·–:&\'!?,.→-'))).text()
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1]
    return url ? await (await fetch(url)).arrayBuffer() : null
  } catch {
    return null
  }
}

// The WhatsApp card: deep green, logo, spot bars, title, time.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [m, font] = await Promise.all([getPublicMatch(slug), geist()])
  const L = m ? matchLabels(m, '') : null
  const family = font ? 'Geist' : 'sans-serif'
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', background: 'linear-gradient(160deg, #17734A 0%, #0E4A30 45%, #062A1A 100%)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, fontFamily: family }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URL} width={72} height={72} alt="" />
          <div style={{ display: 'flex', fontSize: 40, letterSpacing: -1.5, color: '#fff' }}>Goodminton</div>
        </div>
        {m && L ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <div style={{ display: 'flex', gap: 14 }}>
              {Array.from({ length: m.size }, (_, i) => (
                <div key={i} style={{ flex: 1, height: 22, borderRadius: 11, background: i < m.confirmed_count ? '#CFE3D5' : 'rgba(255,255,255,.18)' }} />
              ))}
            </div>
            <div style={{ display: 'flex', fontSize: 80, color: '#fff', lineHeight: 1.05, letterSpacing: -3 }}>{m.title}</div>
            <div style={{ display: 'flex', fontSize: 38, color: '#CFE3D5' }}>{`${L.dateLabel} · ${L.start}`}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', fontSize: 80, color: '#fff', letterSpacing: -3 }}>Game on.</div>
        )}
        <div style={{ display: 'flex', fontSize: 34, color: 'rgba(255,255,255,.75)' }}>{L ? L.spotsLine : 'Badminton, 4 or 8'}</div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: 'Geist', data: font, weight: 600 }] : undefined },
  )
}
