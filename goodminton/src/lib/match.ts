import { addMinutes, fmtDate, fmtTime } from './format.ts'
import type { MatchView } from './types.ts'

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
