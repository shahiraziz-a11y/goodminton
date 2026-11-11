import { fmtDate } from '@/lib/format'

const GREEN = '#0E5A3A'
const MUTED = '#9A9992'
const GRID = 'rgba(17,17,17,.08)'
const day = (d: string) => fmtDate(d + 'T12:00:00Z', 'UTC')

/** Matches each week, last 12 weeks, oldest left. One series; this week darker; hover a bar for detail. */
export function WeekBars({ weeks }: { weeks: { week: string; matches: number; games: number }[] }) {
  const W = 320, H = 116, top = 18, base = H - 20
  const max = Math.max(1, ...weeks.map(w => w.matches))
  const slot = W / weeks.length, bw = Math.min(18, slot - 6)
  const peak = weeks.reduce((p, w, i) => (w.matches > weeks[p].matches ? i : p), 0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Matches per week, last ${weeks.length} weeks`} style={{ display: 'block', overflow: 'visible' }}>
      <line x1={0} x2={W} y1={base} y2={base} stroke={GRID} strokeWidth={1} />
      {weeks.map((w, i) => {
        const h = (w.matches / max) * (base - top)
        const x = i * slot + (slot - bw) / 2
        const now = i === weeks.length - 1
        return (
          <g key={w.week}>
            <title>{`Week of ${day(w.week)}: ${w.matches} match${w.matches === 1 ? '' : 'es'}, ${w.games} game${w.games === 1 ? '' : 's'}`}</title>
            {/* Hit area bigger than the bar. */}
            <rect x={i * slot} y={top - 6} width={slot} height={base - top + 6} fill="transparent" />
            {w.matches > 0
              ? <path d={`M${x},${base} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z`} fill={GREEN} opacity={now ? 1 : 0.55} />
              : <rect x={x} y={base - 2} width={bw} height={2} rx={1} fill={GRID} />}
            {i === peak && w.matches > 0 && <text x={x + bw / 2} y={base - h - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="#111111">{w.matches}</text>}
          </g>
        )
      })}
      {[0, Math.floor(weeks.length / 2), weeks.length - 1].map(i => (
        <text key={i} x={i * slot + slot / 2} y={H - 4} textAnchor="middle" fontSize={10} fill={MUTED}>{i === weeks.length - 1 ? 'This week' : day(weeks[i].week)}</text>
      ))}
    </svg>
  )
}

/** Rating after each game, oldest left. A 2px line with the latest point marked. */
export function RatingLine({ points }: { points: { date: string; rating: number }[] }) {
  const W = 320, H = 110, pad = 10, top = 14, base = H - 18
  const vals = points.map(p => p.rating)
  const lo = Math.min(...vals) - 10, hi = Math.max(...vals) + 10
  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (W - pad * 2)
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (base - top)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Rating over ${points.length} games, now ${last.rating}`} style={{ display: 'block', overflow: 'visible' }}>
      <line x1={0} x2={W} y1={y(1000)} y2={y(1000)} stroke={GRID} strokeWidth={1} strokeDasharray="3 4" />
      <path d={d} fill="none" stroke={GREEN} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <title>{`${day(p.date)}: ${p.rating}`}</title>
          <circle cx={x(i)} cy={y(p.rating)} r={9} fill="transparent" />
        </g>
      ))}
      <circle cx={x(points.length - 1)} cy={y(last.rating)} r={4.5} fill={GREEN} stroke="#fff" strokeWidth={2} />
      <text x={pad} y={H - 4} fontSize={10} fill={MUTED}>{day(points[0].date)}</text>
      <text x={W - pad} y={H - 4} fontSize={10} fill={MUTED} textAnchor="end">Now</text>
    </svg>
  )
}

/** Last results, newest first: W filled green, L outlined grey, each with its letter. */
export function FormDots({ results }: { results: ('W' | 'L')[] }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} aria-label={`Last ${results.length}: ${results.join(' ')}`}>
      {results.map((r, i) => (
        <span key={i} style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800,
          background: r === 'W' ? GREEN : 'transparent', color: r === 'W' ? '#fff' : MUTED, boxShadow: r === 'W' ? 'none' : `inset 0 0 0 1.5px ${MUTED}` }}>{r}</span>
      ))}
    </div>
  )
}
