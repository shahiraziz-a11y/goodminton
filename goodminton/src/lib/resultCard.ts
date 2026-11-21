import { gameSides, nightRecords } from './match.ts'
import { colorFor, initials } from './people.ts'
import type { MatchGame } from './types.ts'

type P = { id: string; full_name: string }

/** Draws tonight's results as a PNG to share on WhatsApp. Browser only. Games are newest first. */
export async function drawResultCard({ title, dateLabel, games, photos = {} }: { title: string; dateLabel: string; games: MatchGame[]; photos?: Record<string, string> }): Promise<Blob> {
  const played = [...games].reverse()
  const MAX = 10
  const shown = played.slice(-MAX)
  const earlier = played.length - shown.length
  const recs = nightRecords(played)

  const W = 1080, PAD = 64, HEAD = 300, ROW = 96, GAP = 14, REC = 88
  const recRows = Math.ceil(recs.length / 2)
  const H = Math.max(1080, HEAD + 70 + (earlier ? 50 : 0) + shown.length * (ROW + GAP) + 60 + 60 + recRows * REC + 110)

  if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready.catch(() => {})
  const base = (typeof document !== 'undefined' && getComputedStyle(document.body).fontFamily) || 'system-ui, sans-serif'
  const family = `${base}, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`
  const font = (size: number, weight = 500) => `${weight} ${size}px ${family}`

  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const x = c.getContext('2d')!

  // Background + header band
  x.fillStyle = '#F4F2EC'; x.fillRect(0, 0, W, H)
  const hg = x.createLinearGradient(0, 0, W * 0.6, HEAD)
  hg.addColorStop(0, '#17734A'); hg.addColorStop(0.5, '#0E4A30'); hg.addColorStop(1, '#062A1A')
  x.fillStyle = hg; x.fillRect(0, 0, W, HEAD)

  // Photos load in parallel; any that fail (or block CORS) fall back to initials.
  const ids = [...new Set(played.flatMap(g => [...g.a, ...g.b].map(p => p.id)))]
  const [logo, ...imgs] = await Promise.all([loadImage('/icons/icon-192.png'), ...ids.map(id => photos[id] ? loadImage(photos[id], true) : Promise.resolve(null))])
  const pics = Object.fromEntries(ids.map((id, i) => [id, imgs[i]]))
  const face = (p: P, cx: number, cy: number, d: number) => {
    x.save()
    x.beginPath(); x.arc(cx, cy, d / 2 + 3, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill()
    x.beginPath(); x.arc(cx, cy, d / 2, 0, Math.PI * 2); x.clip()
    const im = pics[p.id]
    if (im) x.drawImage(im, cx - d / 2, cy - d / 2, d, d)
    else {
      x.fillStyle = colorFor(p.id); x.fillRect(cx - d / 2, cy - d / 2, d, d)
      x.fillStyle = '#fff'; x.font = font(d * 0.38, 700); x.textAlign = 'center'; x.textBaseline = 'middle'
      x.fillText(initials(p.full_name), cx, cy + 1)
    }
    x.restore()
  }
  /** Two overlapping faces; returns the width used. Left-to-right from px, or right-to-left when rtl. */
  const faces = (ps: P[], px: number, cy: number, rtl = false) => {
    const d = 52, step = 44
    const list = rtl ? [...ps].reverse() : ps
    list.forEach((p, i) => face(p, rtl ? px - d / 2 - (list.length - 1 - i) * step : px + d / 2 + i * step, cy, d))
    return d + (ps.length - 1) * step
  }
  if (logo) { roundClip(x, PAD, 56, 64, 64, 16, () => x.drawImage(logo, PAD, 56, 64, 64)) }
  x.fillStyle = '#fff'; x.font = font(34, 600); x.textBaseline = 'middle'
  x.fillText('Goodminton', PAD + (logo ? 84 : 0), 89)
  x.font = font(60, 700)
  x.fillText(fit(x, title, W - PAD * 2), PAD, 196)
  x.fillStyle = '#BFE0CC'; x.font = font(32, 500)
  x.fillText(`${dateLabel} · ${played.length} game${played.length === 1 ? '' : 's'}`, PAD, 254)

  // Games
  let y = HEAD + 50
  label(x, font, 'RESULTS', PAD, y)
  y += 36
  if (earlier) {
    x.fillStyle = '#8A8A84'; x.font = font(26, 500)
    x.fillText(`+ ${earlier} earlier game${earlier === 1 ? '' : 's'}`, PAD, y + 12)
    y += 50
  }
  const colW = 390
  for (const g of shown) {
    const s = gameSides(g)
    card(x, PAD, y, W - PAD * 2, ROW, 22)
    const mid = y + ROW / 2
    const fw = faces(s.winP, PAD + 22, mid)
    x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillStyle = '#141413'; x.font = font(28, 700)
    x.fillText(`${fit(x, s.win.join(' + '), colW - fw - 70)} 💚`, PAD + 36 + fw, mid)
    const lw0 = faces(s.loseP, W - PAD - 22, mid, true)
    x.textAlign = 'right'; x.textBaseline = 'middle'; x.fillStyle = '#7A7A74'; x.font = font(28, 500)
    x.fillText(`💔 ${fit(x, s.lose.join(' + '), colW - lw0 - 70)}`, W - PAD - 36 - lw0, mid)
    // score pill
    x.textAlign = 'center'
    const txt = s.score || 'vs'
    x.font = font(s.score ? 26 : 24, s.score ? 700 : 500)
    const pw = Math.max(70, x.measureText(txt).width + 30)
    x.fillStyle = s.score ? '#E3F0E7' : '#EFEEE9'
    rr(x, W / 2 - pw / 2, mid - 22, pw, 44, 22); x.fill()
    x.fillStyle = s.score ? '#0E5A3A' : '#8A8A84'
    x.fillText(txt, W / 2, mid + 1)
    y += ROW + GAP
  }

  // Tonight's record
  y += 46
  x.textAlign = 'left'
  label(x, font, "TONIGHT'S RECORD", PAD, y)
  y += 36
  const cw = (W - PAD * 2 - 20) / 2
  recs.forEach((r, i) => {
    const cx = PAD + (i % 2) * (cw + 20), cy = y + Math.floor(i / 2) * REC
    card(x, cx, cy, cw, REC - 12, 18)
    const crown = i === 0 && r.w > 0 && (recs.length < 2 || r.w > recs[1].w || r.l < recs[1].l)
    face(r, cx + 44, cy + 38, 52)
    x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillStyle = '#141413'; x.font = font(30, 600)
    x.fillText(fit(x, `${r.name}${crown ? ' 👑' : ''}`, cw - 250), cx + 84, cy + 32)
    x.textAlign = 'right'; x.font = font(30, 700)
    x.fillStyle = '#C0392B'; x.fillText(`${r.l}`, cx + cw - 24, cy + 32)
    const lw = x.measureText(`${r.l}`).width
    x.fillStyle = '#8A8A84'; x.font = font(30, 500); x.fillText('–', cx + cw - 30 - lw, cy + 32)
    const dw = x.measureText('–').width
    x.fillStyle = '#128A5C'; x.font = font(30, 700); x.fillText(`${r.w}`, cx + cw - 36 - lw - dw, cy + 32)
    // W–L bar
    const bx = cx + 84, bw = cw - 108, by = cy + 58, t = r.w + r.l || 1
    x.fillStyle = '#F2D4CF'; rr(x, bx, by, bw, 6, 3); x.fill()
    if (r.w) { x.fillStyle = '#128A5C'; rr(x, bx, by, Math.max(6, bw * r.w / t), 6, 3); x.fill() }
  })

  // Footer
  x.textAlign = 'center'; x.fillStyle = '#9A9992'; x.font = font(26, 600)
  x.fillText('🏸 goodminton.app', W / 2, H - 56)

  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not make the image'))), 'image/png'))
}

function label(x: CanvasRenderingContext2D, font: (s: number, w?: number) => string, t: string, px: number, py: number) {
  x.textAlign = 'left'; x.fillStyle = '#6B6B66'; x.font = font(24, 700)
  if ('letterSpacing' in x) (x as unknown as { letterSpacing: string }).letterSpacing = '3px'
  x.fillText(t, px, py)
  if ('letterSpacing' in x) (x as unknown as { letterSpacing: string }).letterSpacing = '0px'
}

function card(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number) {
  x.save()
  x.shadowColor = 'rgba(20,20,19,.06)'; x.shadowBlur = 16; x.shadowOffsetY = 4
  x.fillStyle = '#fff'; rr(x, px, py, w, h, r); x.fill()
  x.restore()
}

function rr(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number) {
  x.beginPath(); x.moveTo(px + r, py)
  x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r)
  x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath()
}

function roundClip(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number, draw: () => void) {
  x.save(); rr(x, px, py, w, h, r); x.clip(); draw(); x.restore()
}

/** Shortens text with … to fit a width. */
function fit(x: CanvasRenderingContext2D, t: string, max: number) {
  if (x.measureText(t).width <= max) return t
  let s = t
  while (s.length > 1 && x.measureText(s + '…').width > max) s = s.slice(0, -1)
  return s.trimEnd() + '…'
}

function loadImage(src: string, cors = false): Promise<HTMLImageElement | null> {
  return new Promise(res => {
    const i = new Image()
    if (cors) { i.crossOrigin = 'anonymous'; i.referrerPolicy = 'no-referrer' }
    setTimeout(() => res(null), 4000) // a slow photo shouldn't hold up the share
    i.onload = () => res(i); i.onerror = () => res(null)
    i.src = src
  })
}
