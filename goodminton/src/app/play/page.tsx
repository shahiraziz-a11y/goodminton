import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Frame } from '@/components/Chrome'
import { fmtDate, fmtTime } from '@/lib/format'
import { person } from '@/lib/people'
import { photoFor } from '@/lib/photos'
import { getUser } from '@/lib/supabase/server'
import type { HomeMatch } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** Play tab: pick today's match to run the peg board (straight in when there's one). */
export default async function Page() {
  const { supabase, user } = await getUser()
  if (!user) redirect('/')
  const { data } = await supabase.rpc('my_matches')
  const now = Date.now()
  const mine = ((data ?? []) as HomeMatch[]).filter(m => m.my_role === 'organiser' || m.my_role === 'confirmed')
  const open = (m: HomeMatch) => {
    const start = new Date(m.starts_at).getTime()
    return now >= start - 12 * 3600e3 && now <= start + (m.duration_min + 180) * 60e3
  }
  const today = mine.filter(open).sort((x, y) => x.starts_at.localeCompare(y.starts_at))
  if (today.length === 1) redirect(`/play/${today[0].slug}`)
  const later = mine.filter(m => !open(m) && new Date(m.starts_at).getTime() > now).sort((x, y) => x.starts_at.localeCompare(y.starts_at)).slice(0, 3)

  return (
    <Frame me={person(user.id, user.name)} tab="play">
      <div className="screen" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span style={{ fontSize: 14, color: '#6B6B66', fontWeight: 600 }}>Match day</span>
          <span className="h1">Play</span>
        </div>
        {today.length > 0 ? (
          <div className="stack" style={{ gap: 10 }}>
            {today.map(m => (
              <Link key={m.slug} href={`/play/${m.slug}`} className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
                <span aria-hidden style={{ width: 56, height: 56, borderRadius: 16, flex: 'none', background: `#0E4A30 url(${photoFor(m.slug)}) center/cover` }} />
                <span className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <span className="display" style={{ fontSize: 16 }}>{m.title}</span>
                  <span style={{ fontSize: 13, color: '#55554F', fontWeight: 600 }}>{fmtTime(m.starts_at, m.timezone)} · {m.court_count} court{m.court_count > 1 ? 's' : ''} · {m.confirmed_count} players</span>
                </span>
                <span className="badge" style={{ background: '#0E5A3A', color: '#fff' }}>Open board</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="card stack" style={{ padding: 28, gap: 6, textAlign: 'center', alignItems: 'center' }}>
            <span className="display" style={{ fontSize: 17, fontWeight: 700 }}>No match today</span>
            <span className="note">The board opens on match day for matches you&apos;re in.</span>
            <Link href="/" className="chip-btn" style={{ marginTop: 8, height: 38, display: 'flex', alignItems: 'center' }}>See matches</Link>
          </div>
        )}
        {later.length > 0 && (
          <div className="stack" style={{ gap: 10 }}>
            <span className="eyebrow">Coming up</span>
            <div className="card" style={{ padding: '2px 16px' }}>
              {later.map(m => (
                <Link key={m.slug} href={`/m/${m.slug}`} className="row-line" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '12px 0' }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{m.title}</span>
                  <span style={{ fontSize: 13, color: '#6B6B66' }}>{fmtDate(m.starts_at, m.timezone)} · {fmtTime(m.starts_at, m.timezone)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </Frame>
  )
}
