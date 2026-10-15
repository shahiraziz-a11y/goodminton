/** Send an error to /api/report (at most 5 per page load, never throws). */
let sent = 0
export function reportError(message: string, detail?: string) {
  if (typeof window === 'undefined' || sent >= 5 || !message) return
  sent++
  try {
    const body = JSON.stringify({ message, detail, page: location.pathname })
    if (!navigator.sendBeacon?.('/api/report', new Blob([body], { type: 'application/json' }))) {
      fetch('/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }
  } catch { /* reporting must never break the page */ }
}
