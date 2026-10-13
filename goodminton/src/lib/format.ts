// Dates are shown in the match's own timezone, so everyone sees the venue's local time.

type Parts = { weekday: string; day: number; month: string; hour: number; minute: number }

export function partsInTz(iso: string | Date, timeZone: string): Parts {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return { weekday: get('weekday'), day: Number(get('day')), month: get('month'), hour: Number(get('hour')), minute: Number(get('minute')) }
}

/** "Thu 15 Oct" */
export function fmtDate(iso: string | Date, tz: string) {
  const p = partsInTz(iso, tz)
  return `${p.weekday} ${p.day} ${p.month}`
}

/** "8:00 PM" */
export function fmtTime(iso: string | Date, tz: string) {
  const { hour, minute } = partsInTz(iso, tz)
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

export const addMinutes = (iso: string, mins: number) => new Date(new Date(iso).getTime() + mins * 60_000)

export function money(n: number, currency: string) {
  const r = Math.round(n * 100) / 100
  return `${currency} ${r % 1 ? r.toFixed(2) : r}`
}

/** "2m after" / "3h after" / "2d after" relative to when the match was created. */
export function joinedAfter(joinedAt: string, createdAt: string) {
  const mins = Math.max(0, Math.round((new Date(joinedAt).getTime() - new Date(createdAt).getTime()) / 60_000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m after`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h after`
  return `${Math.round(mins / (60 * 24))}d after`
}

/** "3" from "Court 3 & Court 4" for court index 0, padded to "03". */
export function courtNumber(courts: string, index: number) {
  const nums = courts.match(/\d+/g) ?? []
  return String(nums[index] ?? index + 1).padStart(2, '0')
}

/** Next Saturday as yyyy-mm-dd, the create form's default date. */
export function nextSaturday(from = new Date()) {
  const d = new Date(from)
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The match's date and time as form values ("2026-10-16", "20:00") in its own timezone. */
export function localDateTime(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}
