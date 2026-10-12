'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { Frame, GoogleButton, LockIcon } from '@/components/Chrome'
import { CourtCard, type Slot } from '@/components/Court'
import { useFeedback } from '@/components/Feedback'
import { courtNumber, joinedAfter, money } from '@/lib/format'
import { icsFor, matchLabels, whatsappUrl } from '@/lib/match'
import { person, type Person } from '@/lib/people'
import { transfersOf } from '@/lib/split'
import { createClient, signInWithGoogle } from '@/lib/supabase/client'
import { isVisible, type MatchView } from '@/lib/types'

export function MatchScreen({ m, link }: { m: MatchView; link: string }) {
  const router = useRouter()
  const { flash, celebrate } = useFeedback()
  const [busy, setBusy] = useState(false)

  // Keep the count live while the page is open.
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && router.refresh()
    const id = setInterval(tick, 20_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [router])

  async function rpc<T>(fn: string, args: Record<string, unknown>, done?: (data: T) => void) {
    setBusy(true)
    const { data, error } = await createClient().rpc(fn, args)
    setBusy(false)
    if (error) return flash(error.message)
    done?.(data as T)
    router.refresh()
  }

  const role = m.viewer.role
  const signedIn = role !== 'anon'
  const isOrg = role === 'organiser'
  const conf = isOrg || role === 'confirmed'
  const canSee = conf
  const full = m.confirmed_count >= m.size
  const wc = m.waitlist_count
  const L = matchLabels(m, link)
  const org = person(m.organiser.id, m.organiser.full_name)
  const me = m.viewer.id && m.viewer.full_name ? person(m.viewer.id, m.viewer.full_name) : null
  const outsider = role === 'outsider'
  const open = !m.locked && !m.past
  const names: Record<string, string> = { ...m.people }
  m.players.filter(isVisible).forEach(p => (names[p.id] = p.full_name))
  const personOf = (id: string): Person => person(id, names[id] ?? 'Player')

  const courts = Array.from({ length: m.size / 4 }, (_, c) => {
    const group = m.players.slice(c * 4, c * 4 + 4)
    const slots: Slot[] = [0, 1, 2, 3].map(i => {
      const p = group[i]
      if (!p) return { kind: 'empty' }
      return isVisible(p) ? { kind: 'named', p: person(p.id, p.full_name) } : { kind: 'anon' }
    })
    return { label: `Court ${c + 1} of ${m.size / 4}`, num: canSee && m.courts !== null ? courtNumber(m.courts, c) : null, slots }
  })
  const showGhost = m.size === 4 && full && wc > 0 && !m.past
  const ghostSlots: Slot[] = [0, 1, 2, 3].map(i =>
    i < Math.min(wc, 4) ? { kind: 'wait', name: isOrg && m.waitlist ? m.waitlist[i].full_name : 'Waiting' } : { kind: 'empty' })
  const cn = m.confirmed_count >= 8 ? 2 : m.confirmed_count >= 4 ? 1 : 0
  const finalLine = `Final: ${m.confirmed_count} players · ${cn} court${cn === 1 ? '' : 's'}`

  const courtCards = courts.map((c, i) => <CourtCard key={i} {...c} dateLabel={L.dateLabel} start={L.start} end={L.end} />)

  // Signed out: the invite landing.
  if (!signedIn) {
    return (
      <Frame>
        <div className="screen" style={{ gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar p={org} size={40} font={14} />
            <span style={{ fontSize: 14, color: '#5B6573' }}><b style={{ color: '#12161C' }}>{org.first}</b> invited you to play</span>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <span className="display" style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.02 }}>{m.title}</span>
            <span style={{ fontSize: 15, color: '#5B6573' }}>{m.venue} · {m.duration_min} min</span>
          </div>
          {courtCards}
          <span className="display" style={{ fontSize: 15, fontWeight: 700, textAlign: 'center', color: '#0B8A6B' }}>
            {m.past ? 'This match has been played' : m.locked ? 'Sign-ups are closed' : L.spotsLine}
          </span>
          <GoogleButton busy={busy} onClick={async () => {
            setBusy(true)
            const { error } = await signInWithGoogle(`/m/${m.slug}`)
            if (error) { setBusy(false); flash(error.message) }
          }} />
          <span className="note" style={{ textAlign: 'center', textWrap: 'pretty' }}>
            Your Google name is used, so there&apos;s nothing to type. You can see who&apos;s playing while spots are open. The court number unlocks once you&apos;re confirmed.
          </span>
        </div>
      </Frame>
    )
  }

  const tr = canSee ? transfersOf(m.players.filter(isVisible).map(p => p.id), m.expenses ?? [], m.settlements ?? []) : null
  const cur = m.currency
  const fmt = (n: number) => money(n, cur)

  return (
    <Frame back="/" me={me}>
      <div className="screen" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', color: '#0B8A6B' }}>
              {m.size === 4 ? 'Doubles · 1 court · 4 players' : 'Doubles · 2 courts · 8 players'}
            </span>
            <span style={{ fontSize: 12, color: '#5B6573', fontWeight: 600 }}>
              {m.past ? 'Played' : m.locked ? 'Sign-ups closed' : `RSVPs close ${m.rsvp_close_hours}h before`}
            </span>
          </div>
          <span className="display" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.02 }}>{m.title}</span>
          <span style={{ fontSize: 14, color: '#5B6573' }}>{m.venue} · {m.duration_min} min</span>
          {m.locked && !m.past && (
            <div><span className="badge" style={{ background: '#E5484D', color: '#fff', display: 'inline-block' }}>Sign-ups closed</span></div>
          )}
        </div>

        {courtCards}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
          <span className="display" style={{ fontSize: 14, fontWeight: 700 }}>{m.confirmed_count}/{m.size} confirmed</span>
          <span style={{ fontSize: 13, color: '#5B6573', fontWeight: 600 }}>{wc ? `${wc} waiting` : 'No waitlist'}</span>
        </div>

        {outsider && m.locked && !m.past && (
          <div className="card stack" style={{ padding: 20, gap: 6 }}>
            <span className="display" style={{ fontSize: 17, fontWeight: 700 }}>Sign-ups are closed</span>
            <span style={{ fontSize: 14, color: '#5B6573', lineHeight: 1.45 }}>{org.first} has locked the final count. Keep an eye on the group in case a spot opens.</span>
          </div>
        )}
        {outsider && open && !full && (
          <div className="stack" style={{ gap: 10 }}>
            <span style={{ fontSize: 14, color: '#5B6573', textAlign: 'center' }}>Signed in as <b style={{ color: '#12161C' }}>{me?.name}</b></span>
            <button className="btn" disabled={busy} onClick={() => rpc<{ status: string; filled: boolean; position?: number }>('join_match', { p_match: m.id }, r => {
              flash(r.status === 'confirmed' ? "You're confirmed" : `You're #${r.position} on the waitlist`)
              if (r.filled) celebrate()
            })}>Confirm I&apos;m playing</button>
          </div>
        )}
        {outsider && open && full && (
          <div className="card stack" style={{ padding: 20, gap: 16 }}>
            <div className="stack" style={{ gap: 6 }}>
              <span className="display" style={{ fontSize: 17, fontWeight: 700 }}>Match is full</span>
              <span style={{ fontSize: 14, color: '#5B6573', lineHeight: 1.45 }}>Join the waitlist. You&apos;ll move up if someone drops out, or play on a second court once 4 are waiting.</span>
            </div>
            <button className="btn red" disabled={busy} onClick={() => rpc<{ position: number }>('join_match', { p_match: m.id }, r => flash(`You're #${r.position} on the waitlist`))}>Join waitlist</button>
          </div>
        )}
        {conf && (
          <div style={{ borderRadius: 22, padding: 2, background: '#0E9F7E' }}>
            <div style={{ borderRadius: 20, background: '#E6EAF0', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 40, height: 40, borderRadius: '50%', background: '#0E9F7E', color: '#fff', fontSize: 18, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>✓</span>
              <div className="stack" style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <span className="display" style={{ fontSize: 16, fontWeight: 700 }}>{m.past ? 'You played' : "You're in"}</span>
                <span style={{ fontSize: 13, color: '#5B6573' }}>{L.timeRange}</span>
              </div>
              {!isOrg && !m.past && (
                <button className="link-btn" disabled={busy} onClick={() => {
                  if (!confirm(m.locked ? 'Sign-ups are closed. Drop out anyway? Your spot goes to the waitlist.' : 'Drop out? Your spot goes to the next person waiting.')) return
                  rpc<{ promoted: string | null }>('leave_match', { p_match: m.id }, r => flash(r.promoted ? `Spot passed to ${r.promoted.split(' ')[0]}` : 'You dropped out'))
                }}>Drop out</button>
              )}
            </div>
          </div>
        )}
        {role === 'waitlist' && (
          <div className="card stack" style={{ padding: 20, gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span className="display" style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1, color: '#E5484D' }}>#{m.viewer.wait_pos}</span>
              <div className="stack" style={{ gap: 3 }}>
                <span className="display" style={{ fontSize: 16, fontWeight: 700 }}>On the waitlist</span>
                <span style={{ fontSize: 13, color: '#5B6573' }}>You move up automatically if a spot opens. Check back here.</span>
              </div>
            </div>
            {!m.past && <button className="link-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => rpc('leave_match', { p_match: m.id }, () => flash('Left the waitlist'))}>Leave waitlist</button>}
          </div>
        )}

        {showGhost && (
          <CourtCard ghost label="Second court" num={null} dateLabel={L.dateLabel} start={L.start} end={L.end} slots={ghostSlots} footer={`${Math.min(wc, 4)}/4 waiting · opens at 4`} />
        )}

        {!canSee && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '0 4px', color: '#8A94A3' }}>
            <LockIcon />
            <span className="note" style={{ lineHeight: 1.4, textWrap: 'pretty' }}>Court number and costs are visible to confirmed players only. Player names are hidden once the match is full.</span>
          </div>
        )}

        {isOrg && !m.past && (
          <>
            <div className="card stack" style={{ padding: 20, gap: 14 }}>
              <span className="eyebrow">Organiser tools</span>
              {m.locked ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 800 }}>{finalLine}</span>
                  <button className="chip-btn" disabled={busy} onClick={() => rpc('set_lock', { p_match: m.id, p_locked: false }, () => flash('Sign-ups reopened'))}>Reopen</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 14, color: '#5B6573', lineHeight: 1.35 }}>Sign-ups auto-lock {m.rsvp_close_hours}h before start</span>
                  <button className="chip-btn" disabled={busy} onClick={() => rpc('set_lock', { p_match: m.id, p_locked: true }, () => flash(`Sign-ups closed · ${finalLine}`))}>Lock now</button>
                </div>
              )}
              <div className="stack" style={{ borderTop: '1px solid rgba(0,0,0,.06)', paddingTop: 14, gap: 10 }}>
                <span style={{ fontSize: 12, color: '#5B6573', fontWeight: 700 }}>Status update for the group</span>
                <div className="panel" style={{ padding: '12px 14px', fontSize: 13, lineHeight: 1.45, wordBreak: 'break-word' }}>{L.statusMsg}</div>
                <a className="btn-2" href={whatsappUrl(L.statusMsg)} target="_blank" rel="noreferrer" style={{ height: 46, color: '#128A5C' }}>Post to WhatsApp</a>
              </div>
            </div>
            {m.size === 4 && wc >= 4 && (
              <div className="stack" style={{ borderRadius: 20, padding: 22, background: '#F7F8FA', boxShadow: '0 0 0 1px #E6E9EE', gap: 16 }}>
                <div className="stack" style={{ gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: '#D9622B' }}>4 WAITING · EVEN NUMBERS</span>
                  <span className="display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2 }}>Make it 8 on two courts</span>
                  <span style={{ fontSize: 14, color: '#4A5462', lineHeight: 1.45 }}>Book a second court and all 4 waiting players are confirmed. Its cost joins the split.</span>
                </div>
                <button className="btn red" disabled={busy} onClick={() => rpc('upgrade_match', { p_match: m.id }, () => { flash('Now 8 players on 2 courts'); celebrate() })}>I&apos;ve booked court 2</button>
              </div>
            )}
            {m.size === 4 && full && wc > 0 && wc < 4 && (
              <span className="note" style={{ padding: '0 4px' }}>Hold off booking court 2. With fewer than 4 waiting, someone would sit out.</span>
            )}
          </>
        )}

        {canSee && tr && (
          <>
            {m.locked && !m.past && (
              <div className="stack" style={{ borderRadius: 22, padding: '16px 20px', background: '#0E9F7E', color: '#fff', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em' }}>SIGN-UPS CLOSED</span>
                <span className="display" style={{ fontSize: 18, fontWeight: 700 }}>{finalLine}</span>
              </div>
            )}
            <div className="card stack" style={{ padding: '18px 20px', gap: 14 }}>
              <div className="stack" style={{ gap: 4 }}>
                <span className="eyebrow">Venue</span>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{m.venue}</span>
                <span style={{ fontSize: 13, color: '#5B6573' }}>{m.parking || 'No parking notes'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <a className="chip-btn" style={{ height: 44, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.venue)}`} target="_blank" rel="noreferrer">Directions</a>
                <button className="chip-btn" style={{ height: 44, fontSize: 13 }} onClick={() => {
                  const url = URL.createObjectURL(new Blob([icsFor(m, link)], { type: 'text/calendar' }))
                  const a = Object.assign(document.createElement('a'), { href: url, download: `${m.slug}.ics` })
                  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
                }}>Add to calendar</button>
              </div>
            </div>

            <div className="card stack" style={{ padding: '8px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 4px' }}>
                <span className="eyebrow">Squad</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0E7F66' }}>{m.courts}</span>
              </div>
              {m.players.filter(isVisible).map(p => {
                const pp = person(p.id, p.full_name)
                const tag = [p.id === m.organiser.id ? 'Organiser' : '', p.id === m.viewer.id ? 'You' : ''].filter(Boolean).join(' · ') || 'Confirmed'
                const joined = p.id === m.organiser.id ? 'Created' : p.promoted ? 'Promoted' : joinedAfter(p.joined_at, m.created_at)
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                    <Avatar p={pp} />
                    <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{pp.name}</span>
                      <span style={{ fontSize: 12, color: '#5B6573' }}>{tag}</span>
                    </span>
                    <span style={{ fontSize: 12, color: '#8A94A3', fontWeight: 600 }}>{joined}</span>
                  </div>
                )
              })}
              {wc > 0 && (
                <div className="stack" style={{ borderTop: '1px solid rgba(0,0,0,.07)', padding: '14px 0 8px', gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: '#D6336C' }}>WAITLIST · {wc}</span>
                  {m.waitlist?.map((p, i) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className="display" style={{ width: 26, fontSize: 13, fontWeight: 700, color: '#D6336C' }}>{i + 1}</span>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{p.full_name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <CostSplit m={m} tr={tr} fmt={fmt} personOf={personOf} busy={busy} rpc={rpc} link={link} />

            <Link href={`/m/${m.slug}/share`} className="btn-2">Share match link</Link>
          </>
        )}
      </div>
    </Frame>
  )
}

type Rpc = <T>(fn: string, args: Record<string, unknown>, done?: (data: T) => void) => Promise<void>

function CostSplit({ m, tr, fmt, personOf, busy, rpc, link }: {
  m: MatchView; tr: ReturnType<typeof transfersOf>; fmt: (n: number) => string; personOf: (id: string) => Person; busy: boolean; rpc: Rpc; link: string
}) {
  const { flash } = useFeedback()
  const [adding, setAdding] = useState(false)
  const [exp, setExp] = useState({ label: '', amount: '' })
  const meId = m.viewer.id
  const isOrg = m.viewer.role === 'organiser'

  return (
    <div className="card stack" style={{ padding: 20, gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Cost split</span>
          <span className="display" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', color: '#0B8A6B' }}>{fmt(tr.share)}</span>
        </div>
        <span style={{ fontSize: 12, color: '#5B6573', fontWeight: 600, paddingBottom: 4 }}>each · {fmt(tr.total)} total</span>
      </div>
      <div className="stack" style={{ gap: 12 }}>
        {(m.expenses ?? []).map((e, i) => (
          <div key={e.id ?? i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span className="stack" style={{ minWidth: 0, gap: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{e.label}</span>
              <span style={{ fontSize: 12, color: '#5B6573' }}>Paid by {e.paid_by === meId ? 'you' : personOf(e.paid_by).first}</span>
            </span>
            <span style={{ fontSize: 14, fontWeight: 800, flex: 'none' }}>{fmt(Number(e.amount))}</span>
          </div>
        ))}
      </div>
      {adding ? (
        <form className="stack" style={{ gap: 10 }} onSubmit={e => {
          e.preventDefault()
          const amt = Number(exp.amount)
          if (!amt || amt <= 0 || !exp.label.trim()) return flash('Add a label and amount')
          rpc('add_expense', { p_match: m.id, p_label: exp.label.trim(), p_amount: amt }, () => { setAdding(false); flash('Expense added and split') })
        }}>
          <input className="field" style={{ height: 46 }} value={exp.label} onChange={e => setExp(x => ({ ...x, label: e.target.value }))} placeholder="What for? e.g. Shuttles" maxLength={80} autoFocus />
          <div style={{ display: 'flex', gap: 10 }}>
            <input className="field" style={{ height: 46, flex: 1, minWidth: 0, width: 'auto' }} type="number" inputMode="decimal" min={0} step="0.01" value={exp.amount} onChange={e => setExp(x => ({ ...x, amount: e.target.value }))} placeholder="Amount" />
            <button type="submit" disabled={busy} style={{ height: 46, padding: '0 20px', borderRadius: 16, border: 'none', background: '#0E9F7E', color: '#fff', fontWeight: 800, fontSize: 14 }}>Add</button>
          </div>
        </form>
      ) : (
        <button onClick={() => { setExp({ label: '', amount: '' }); setAdding(true) }} style={{ height: 46, borderRadius: 16, border: 'none', background: '#F1F3F6', color: '#0E7F66', fontWeight: 700, fontSize: 14 }}>+ Add expense</button>
      )}
      <div className="stack" style={{ gap: 10 }}>
        <span className="eyebrow">Settle up</span>
        {tr.out.map(t => {
          const iOwe = t.from === meId
          const canMark = !t.settled && !iOwe && (t.to === meId || isOrg)
          const mayToggle = iOwe || t.to === meId || isOrg
          const shown = t.settled ? t.amount : t.open
          const from = personOf(t.from), to = personOf(t.to)
          const mark = (amount: number | null, msg: string) => rpc('set_settled', { p_match: m.id, p_from: t.from, p_to: t.to, p_amount: amount }, () => flash(msg))
          return (
            <div key={`${t.from}>${t.to}`} className="panel stack" style={{ gap: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1, fontSize: 14, minWidth: 0, fontWeight: 600 }}>
                  {iOwe ? 'You' : from.first} <span style={{ color: '#8A94A3' }}>→</span> {t.to === meId ? 'you' : to.first}
                </span>
                <span style={{ fontSize: 14, fontWeight: 800 }}>{fmt(shown)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
                {t.settled && (
                  <button className="pill-btn go" disabled={busy || !mayToggle} onClick={() => mayToggle && mark(null, 'Marked as unpaid')}>Paid ✓</button>
                )}
                {canMark && (
                  <>
                    <a className="pill-btn" style={{ display: 'flex', alignItems: 'center' }} target="_blank" rel="noreferrer"
                      href={whatsappUrl(`Hey ${from.first}, ${fmt(t.open)} for ${m.title} 🏸 ${link}`)}>Nudge</a>
                    <button className="pill-btn outline" disabled={busy} onClick={() => mark(t.amount, `${from.first} marked as paid`)}>Mark paid</button>
                  </>
                )}
                {!t.settled && iOwe && (
                  <button className="pill-btn go" disabled={busy} onClick={() => mark(t.amount, `Marked as paid to ${to.first}`)}>I&apos;ve paid {fmt(t.open)}</button>
                )}
                {!t.settled && !iOwe && !canMark && <span style={{ fontSize: 12, color: '#D6336C', fontWeight: 700 }}>Pending</span>}
              </div>
            </div>
          )
        })}
        {tr.out.length === 0 && <span className="note">All square.</span>}
      </div>
    </div>
  )
}
