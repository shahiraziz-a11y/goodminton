import { addMinutes, fmtDate, fmtTime } from './format.ts'
import type { MatchGame, MatchView } from './types.ts'

/** Display strings shared by the match page, share page and link preview. */
export function matchLabels(m: Pick<MatchView, 'title' | 'size' | 'starts_at' | 'duration_min' | 'timezone' | 'confirmed_count' | 'waitlist_count'>, link: string) {
  const tz = m.timezone
  const end = addMinutes(m.starts_at, m.duration_min)
  const left = m.size - m.confirmed_count
  const wc = m.waitlist_count
  const start = fmtTime(m.starts_at, tz)
  const dateLabel = fmtDate(m.starts_at, tz)
  return {
    start,
    end: fmtTime(end, tz),
    dateLabel,
    when: `${dateLabel}, ${start}`,
    timeRange: `${start} – ${fmtTime(end, tz)}`,
    left,
    spotsLine: left > 0 ? `${left} of ${m.size} spots left` : `Full · ${wc} on waitlist`,
    statusMsg: `${m.title}: ${m.confirmed_count}/${m.size} in${left > 0 ? `, ${left} spot${left > 1 ? 's' : ''} left` : ', full'}${wc ? ` · ${wc} waiting` : ''}. ${link}`,
    inviteMsg: `Badminton, ${dateLabel}, ${start}. ${m.size} spots, first in get them. Tap to join: ${link}`,
  }
}

export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`

const first = (n: string) => n.trim().split(/\s+/)[0]
const side = (ps: { full_name: string }[]) => ps.map(p => first(p.full_name)).join(' & ')

/** "Priya & Karan beat Omar & Lena 21–17" */
export function gameLine(g: MatchGame) {
  const [w, l] = g.winner === 'a' ? [g.a, g.b] : [g.b, g.a]
  const score = g.score_a != null && g.score_b != null
    ? ` ${Math.max(g.score_a, g.score_b)}–${Math.min(g.score_a, g.score_b)}` : ''
  return `${side(w)} beat ${side(l)}${score}`
}

/** The end-of-night summary to post to the group. Games are newest first. */
export function matchSummary(title: string, dateLabel: string, games: MatchGame[], link: string) {
  const played = [...games].reverse()
  const rec: Record<string, { name: string; w: number; l: number }> = {}
  for (const g of played) {
    for (const [ps, won] of [[g.a, g.winner === 'a'], [g.b, g.winner === 'b']] as const) {
      for (const p of ps) {
        rec[p.id] ??= { name: first(p.full_name), w: 0, l: 0 }
        if (won) rec[p.id].w++; else rec[p.id].l++
      }
    }
  }
  const top = Object.values(rec).sort((a, b) => b.w - a.w || a.l - b.l).slice(0, 3)
  const lines = played.slice(-8).map(g => `• ${gameLine(g)}`)
  return [
    `🏸 ${title} · ${dateLabel}`,
    `${played.length} game${played.length === 1 ? '' : 's'}${played.length > 8 ? ' (last 8)' : ''}`,
    ...lines,
    top.length ? `Top: ${top.map(t => `${t.name} ${t.w}–${t.l}`).join(', ')}` : '',
    link,
  ].filter(Boolean).join('\n')
}
