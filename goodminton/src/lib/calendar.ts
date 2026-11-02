/** A match as a calendar event, from the email queue (see queue_calendar). */
export type CalEvent = {
  uid: string; method: 'REQUEST' | 'CANCEL'; sequence: number
  start: string; end: string; title: string; location: string; url: string
}

const stamp = (d: Date | string) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')

/** Lines longer than 75 bytes continue on the next line after a space (RFC 5545). */
function fold(line: string) {
  const out: string[] = []
  let cur = '', size = 0
  for (const ch of line) {
    const n = Buffer.byteLength(ch)
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0 }
    cur += ch; size += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

/**
 * An invite (or cancel) that Gmail and other calendars add, move or remove by UID.
 * The organiser is the app's mailbox; the player is the one attendee, already going.
 */
export function icsFor(e: CalEvent, site: string, from: string, to: { name: string; address: string }, now = new Date()) {
  const link = site + e.url
  const lines = [
    'BEGIN:VCALENDAR', 'PRODID:-//Goodminton//Matches//EN', 'VERSION:2.0', 'CALSCALE:GREGORIAN', `METHOD:${e.method}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}`, `SEQUENCE:${e.sequence}`, `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`,
    `SUMMARY:${text('🏸 ' + e.title)}`,
    ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
    `DESCRIPTION:${text(`Match details and who's playing: ${link}`)}`,
    `URL:${link}`,
    `ORGANIZER;CN=Goodminton:mailto:${from}`,
    `ATTENDEE;CN=${text(to.name).replace(/"/g, '')};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${to.address}`,
    `STATUS:${e.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    ...(e.method === 'REQUEST' ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(e.title)}`, 'TRIGGER:-PT2H', 'END:VALARM'] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}
