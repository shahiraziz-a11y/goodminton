'use client'

import { useState } from 'react'
import { Sheet } from './Sheet'

/** A small ⓘ that explains how ratings are worked out. */
export function RatingInfo() {
  const [open, setOpen] = useState(false)
  const line = { fontSize: 14, lineHeight: 1.5, color: '#33332F' } as const
  return (
    <>
      <button type="button" aria-label="How ratings work" onClick={() => setOpen(true)}
        style={{ width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(17,17,17,.08)', color: '#55554F', fontSize: 12, fontWeight: 800, lineHeight: 1, padding: 0, verticalAlign: 'middle', marginLeft: 6 }}>i</button>
      {/* Sits inside small-caps headings: reset their text style for the explainer. */}
      <span style={{ textTransform: 'none', letterSpacing: 'normal', fontWeight: 400, color: '#111111' }}>
      <Sheet open={open} onClose={() => setOpen(false)} title="How ratings work">
        <div className="stack" style={{ gap: 10 }}>
          <span style={line}><b>Everyone starts at 1000.</b> After each game the winners gain points and the losers lose the same amount.</span>
          <span style={line}><b>Beating a stronger pair earns more</b>; beating a weaker pair earns little. Losing to a weaker pair costs more.</span>
          <span style={line}>A pair&apos;s strength is the <b>average rating of its two players</b>.</span>
          <span style={line}>In an even game about <b>16 points</b> change hands (up to 32). If a score is entered, a bigger winning margin counts a little more, up to 1.5×.</span>
          <span style={{ ...line, color: '#6B6B66', fontSize: 13 }}>It&apos;s the Elo method used in chess, worked out game by game in the order they were played.</span>
        </div>
      </Sheet>
      </span>
    </>
  )
}
