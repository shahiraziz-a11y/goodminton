'use client'

import { Avatar } from '@/components/Avatar'
import { FormDots, RatingLine, WeekBars } from '@/components/InsightsCharts'
import { fmtDate } from '@/lib/format'
import { clutch, form, funFacts, partners, ratingChange, ratingHistory, rivals, summary } from '@/lib/insights'
import { person } from '@/lib/people'
import type { Insights } from '@/lib/types'

const pctOf = (x: number) => `${Math.round(x * 100)}%`

/** The personal half of Insights: how much you play, with whom, and how it's going. */
export function YouInsights({ meId, ins }: { meId: string; ins: Insights }) {
  const who = (id: string) => person(id, ins.people[id] ?? 'Player')
  const s = summary(meId, ins.games)
  if (!s.games && !ins.matches_played) return null
  const f = form(meId, ins.games)
  const pts = ratingHistory(meId, ins.games)
  const change = ratingChange(pts, new Date().toISOString().slice(0, 10))
  const p = partners(meId, ins.games)
  const r = rivals(meId, ins.games)
  const c = clutch(meId, ins.games)
  const facts = funFacts(meId, ins.games, id => who(id).first)
  const busiest = ins.weeks.reduce((b, w) => (w.matches > b.matches ? w : b), ins.weeks[0])
  const trend = f.last10.length >= 5 ? f.recent - f.overall : 0
  const card = { padding: 18, borderRadius: 24, gap: 12 } as const
  const head = (title: string, aside?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span className="eyebrow">{title}</span>
      {aside && <span style={{ fontSize: 12, color: '#6B6B66', fontWeight: 600 }}>{aside}</span>}
    </div>
  )
  const nameOf = (ids: string[]) => ids.map(id => who(id).first).join(' & ')

  return (
    <div className="stack" style={{ gap: 14 }}>
      {/* Your season */}
      <div className="stack" style={{ borderRadius: 28, padding: 20, gap: 14, color: '#fff', background: 'linear-gradient(160deg, #135F3D, #0A3B26)', boxShadow: '0 24px 44px -26px rgba(14,40,26,.7)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.16em', color: '#9FE0BC' }}>YOUR SEASON</span>
          <span style={{ fontSize: 12, color: '#CFE3D5', fontWeight: 600 }}>{ins.first_played ? `since ${fmtDate(ins.first_played + 'T12:00:00Z', 'UTC').replace(/^\w+ /, '')}` : ''}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {([[ins.matches_played, 'matches'], [s.games, 'games'], [s.games ? pctOf(s.pct) : '–', 'wins']] as const).map(([v, l]) => (
            <div key={l} className="stack" style={{ gap: 2 }}>
              <span className="display" style={{ fontSize: 30, letterSpacing: '-.04em', lineHeight: 1 }}>{v}</span>
              <span style={{ fontSize: 12, color: '#CFE3D5', fontWeight: 600 }}>{l}</span>
            </div>
          ))}
        </div>
        {ins.week_streak > 0 && <span style={{ fontSize: 13, fontWeight: 600, color: '#CFE3D5' }}>🔥 {ins.week_streak} week{ins.week_streak === 1 ? '' : 's'} in a row{ins.played_this_week ? '' : ' · play this week to keep it'}</span>}
      </div>

      {/* Week by week */}
      <div className="card stack" style={card}>
        {head('Week by week', 'matches')}
        <WeekBars weeks={ins.weeks} />
        {busiest.matches > 0 && <span className="note" style={{ fontSize: 12 }}>Busiest: {busiest.matches} match{busiest.matches === 1 ? '' : 'es'}, week of {fmtDate(busiest.week + 'T12:00:00Z', 'UTC')}.</span>}
      </div>

      {/* Form */}
      {f.last10.length >= 3 && (
        <div className="card stack" style={card}>
          {head('Form', `last ${f.last10.length}, newest first`)}
          <FormDots results={f.last10} />
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, fontWeight: 600, color: '#55554F' }}>
            <span><b style={{ color: '#111111' }}>{pctOf(f.recent)}</b> recently vs {pctOf(f.overall)} overall {trend > 0.05 ? '↑' : trend < -0.05 ? '↓' : '→'}</span>
            {f.streak && <span>{f.streak.kind === 'W' ? 'Won' : 'Lost'} last <b style={{ color: '#111111' }}>{f.streak.n}</b></span>}
            {f.longestWin > 1 && <span>Best run <b style={{ color: '#111111' }}>{f.longestWin}</b> wins</span>}
          </div>
        </div>
      )}

      {/* Rating */}
      {pts.length >= 3 && (
        <div className="card stack" style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="eyebrow">Rating</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{pts[pts.length - 1].rating} <span style={{ color: change >= 0 ? '#0E5A3A' : '#C2410C' }}>{change >= 0 ? '+' : ''}{change} this month</span></span>
          </div>
          <RatingLine points={pts} />
          <span className="note" style={{ fontSize: 12 }}>Everyone starts at 1000. Beating stronger pairs counts more.</span>
        </div>
      )}

      {/* Partners */}
      {p.top.length > 0 && (
        <div className="card stack" style={card}>
          {head('Partners', `${p.people} different`)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {([['Best with', p.best, (x: NonNullable<typeof p.best>) => `${x.w}–${x.l} · ${pctOf(x.pct)}`], ['Most played with', p.most, (x: NonNullable<typeof p.most>) => `${x.n} games`]] as const).map(([label, x, line]) => x && (
              <div key={label} className="panel stack" style={{ padding: 12, gap: 6, borderRadius: 16 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6B6B66' }}>{label}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar p={who(x.key)} size={28} font={10} /><b style={{ fontSize: 14 }}>{who(x.key).first}</b></span>
                <span style={{ fontSize: 12, color: '#55554F', fontWeight: 600 }}>{line(x)}</span>
              </div>
            ))}
          </div>
          <div className="stack">
            {p.top.map(x => (
              <div key={x.key} className="row-line" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                <Avatar p={who(x.key)} size={24} font={9} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{who(x.key).first}</span>
                <span style={{ fontSize: 12, color: '#6B6B66', fontWeight: 600 }}>{x.w}–{x.l}</span>
                <span style={{ width: 40, textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{pctOf(x.pct)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rivals */}
      {(r.nemesis || r.favourite) && (
        <div className="card stack" style={card}>
          {head('Rivals', '3+ games against')}
          {r.nemesis && <span style={{ fontSize: 14, lineHeight: 1.4 }}>😤 <b>Nemesis:</b> {nameOf(r.nemesis.ids)}, you&apos;re {r.nemesis.w}–{r.nemesis.l} against them.</span>}
          {r.favourite && <span style={{ fontSize: 14, lineHeight: 1.4 }}>😎 <b>Favourite opponents:</b> {nameOf(r.favourite.ids)}, {r.favourite.w}–{r.favourite.l}.</span>}
        </div>
      )}

      {/* Clutch & fun facts */}
      {(c.close.w + c.close.l > 0 || facts.length > 0) && (
        <div className="card stack" style={card}>
          {head('Did you know')}
          {c.close.w + c.close.l > 0 && <span style={{ fontSize: 14, lineHeight: 1.4 }}>🎯 Close games (won or lost by 2): <b>{c.close.w}–{c.close.l}</b>{c.deuce.w + c.deuce.l > 0 ? ` · deuce games ${c.deuce.w}–${c.deuce.l}` : ''}.</span>}
          {facts.map(t => <span key={t} style={{ fontSize: 14, lineHeight: 1.4 }}>• {t}</span>)}
        </div>
      )}
    </div>
  )
}
