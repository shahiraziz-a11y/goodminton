'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { Frame, GoogleButton, LockIcon, Seg } from '@/components/Chrome'
import { CourtCard, type Slot } from '@/components/Court'
import { useFeedback } from '@/components/Feedback'
import { FormatPicker } from '@/components/FormatPicker'
import { LogResultSheet } from '@/components/LogResultSheet'
import { PlayerPicker, loadPlayers } from '@/components/PlayerPicker'
import { AlertsCard } from '@/components/Pwa'
import { Sheet } from '@/components/Sheet'
import { balancedOrder, shuffled, standings } from '@/lib/stats'
import { courtNumber, joinedAfter, localDateTime, money } from '@/lib/format'
import { matchLabels, whatsappUrl } from '@/lib/match'
import { person, type Person } from '@/lib/people'
import { transfersOf } from '@/lib/split'
import { createClient, signInWithGoogle } from '@/lib/supabase/client'
import { isVisible, perCourt, type Format, type Leaderboard, type MatchView } from '@/lib/types'

export function MatchScreen({ m, link }: { m: MatchView; link: string }) {
  const router = useRouter()
  const { flash, celebrate } = useFeedback()
  const [busy, setBusy] = useState(false)
  const [booking, setBooking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [logCourt, setLogCourt] = useState<number | null>(null)

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

  const per = perCourt(m.format)
  const nCourts = m.court_count
  const singles = m.format === 'singles'
  const courts = Array.from({ length: nCourts }, (_, c) => {
    const group = m.players.slice(c * per, c * per + per)
    const slots: Slot[] = Array.from({ length: per }, (_, i) => {
      const p = group[i]
      if (!p) return { kind: 'empty' }
      return isVisible(p) ? { kind: 'named', p: person(p.id, p.full_name) } : { kind: 'anon' }
    })
    return {
      label: `Court ${c + 1} of ${nCourts}`,
      num: canSee && m.courts ? courtNumber(m.courts, c) : null,
      tbc: canSee && m.status === 'planning',
      slots,
      players: group.filter(isVisible).map(p => person(p.id, p.full_name)),
    }
  })
  const booked = m.status === 'booked'
  const showGhost = nCourts < 4 && full && wc > 0 && !m.past
  const ghostSlots: Slot[] = Array.from({ length: per }, (_, i) =>
    i < Math.min(wc, per) ? { kind: 'wait', name: isOrg && m.waitlist ? m.waitlist[i].full_name : 'Waiting' } : { kind: 'empty' })
  const cn = Math.floor(m.confirmed_count / per)
  const finalLine = `Final: ${m.confirmed_count} players · ${cn} court${cn === 1 ? '' : 's'}`

  const courtCards = courts.map((c, i) => <CourtCard key={i} label={c.label} num={c.num} tbc={c.tbc} slots={c.slots} dateLabel={L.dateLabel} start={L.start} end={L.end} />)

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
            <span style={{ fontSize: 15, color: '#5B6573' }}>{m.venue || 'Venue TBC'} · {m.duration_min} min</span>
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

  function remove(id: string, first: string) {
    if (!confirm(`Remove ${first} from this match?${booked ? ` The court is booked: if nobody takes the spot, ${first} still owes their share.` : ''}`)) return
    rpc<{ promoted: string | null; still_owes: boolean }>('remove_player', { p_match: m.id, p_user: id }, r =>
      flash([`${first} removed`, r.still_owes ? 'still owes their share' : '', r.promoted ? `${r.promoted.split(' ')[0]} promoted` : ''].filter(Boolean).join(' · ')))
  }
  const members = [...m.players.filter(isVisible).map(p => p.id), ...(m.waitlist ?? []).map(p => p.id)]

  const tr = canSee ? transfersOf(m.split_ids ?? m.players.filter(isVisible).map(p => p.id), m.expenses ?? [], m.settlements ?? []) : null
  const cur = m.currency
  const fmt = (n: number) => money(n, cur)

  return (
    <Frame back="/" me={me}>
      <div className="screen" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', color: '#0B8A6B' }}>
              {`${singles ? 'Singles' : 'Doubles'} · ${nCourts} court${nCourts > 1 ? 's' : ''} · ${m.size} players`}
            </span>
            <span style={{ fontSize: 12, color: '#5B6573', fontWeight: 600 }}>
              {m.past ? 'Played' : m.locked ? 'Sign-ups closed' : `RSVPs close ${m.rsvp_close_hours}h before`}
            </span>
          </div>
          <span className="display" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.02 }}>{m.title}</span>
          <span style={{ fontSize: 14, color: '#5B6573' }}>{m.venue || 'Venue TBC'} · {m.duration_min} min</span>
          {!m.past && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {booked
                ? <span className="badge" style={{ background: '#E7F6F1', color: '#0E7F66' }}>✓ Court booked</span>
                : <span className="badge" style={{ background: '#F1F3F6', color: '#5B6573' }}>Planning · court not booked yet</span>}
              {m.locked && <span className="badge" style={{ background: '#E5484D', color: '#fff' }}>Sign-ups closed</span>}
            </div>
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
              {!isOrg && !m.past && booked && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#8A94A3', textAlign: 'right', maxWidth: 110, lineHeight: 1.3 }}>Court booked · ask {org.first} to drop out</span>
              )}
              {!isOrg && !m.past && !booked && (
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
                <span style={{ fontSize: 13, color: '#5B6573' }}>You move up automatically if a spot opens.</span>
              </div>
            </div>
            {!m.past && <button className="link-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => rpc('leave_match', { p_match: m.id }, () => flash('Left the waitlist'))}>Leave waitlist</button>}
          </div>
        )}

        {!m.past && (conf || role === 'waitlist') && (
          <AlertsCard compact reason={isOrg ? 'Get alerts when people join or drop out' : role === 'waitlist' ? 'Get an alert the moment you move up' : 'Get alerts if the court, time or players change'} />
        )}

        {showGhost && (
          <CourtCard ghost label="Next court" num={null} dateLabel={L.dateLabel} start={L.start} end={L.end} slots={ghostSlots} footer={`${Math.min(wc, per)}/${per} waiting · opens at ${per}`} />
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="eyebrow">Organiser tools</span>
                <button className="chip-btn" onClick={() => setEditing(true)}>Edit match</button>
              </div>
              {booked ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="stack" style={{ flex: 1, gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#0E7F66' }}>✓ Court booked</span>
                    <span style={{ fontSize: 12, color: '#5B6573' }}>Players are locked in. Only you can remove someone.</span>
                  </span>
                  <button className="chip-btn" onClick={() => setBooking(true)}>Edit details</button>
                </div>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  <span style={{ fontSize: 14, color: '#5B6573', lineHeight: 1.4 }}>
                    {full ? `${m.size} in. Book the court${nCourts > 1 ? 's' : ''}, then add the details here.`
                      : nCourts > 1 && cn >= 1 ? `${m.confirmed_count}/${m.size} in · enough for ${cn} of ${nCourts} courts. Book ${cn} now, or wait for ${per - (m.confirmed_count % per)} more for another.`
                      : `Book once you have ${per}. ${per - m.confirmed_count} to go.`}
                  </span>
                  <button className="btn" style={{ height: 48, fontSize: 15 }} onClick={() => setBooking(true)}>Court booked · add details</button>
                </div>
              )}
              <div style={{ borderTop: '1px solid rgba(0,0,0,.06)' }} />
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
            {nCourts < 4 && wc >= per && (
              <div className="stack" style={{ borderRadius: 20, padding: 22, background: '#F7F8FA', boxShadow: '0 0 0 1px #E6E9EE', gap: 16 }}>
                <div className="stack" style={{ gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: '#D9622B' }}>{per} WAITING · EVEN NUMBERS</span>
                  <span className="display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2 }}>Make it {m.size + per} on {nCourts + 1} courts</span>
                  <span style={{ fontSize: 14, color: '#4A5462', lineHeight: 1.45 }}>
                    {booked ? `Book another court and all ${per} waiting players are confirmed. Its cost joins the split.` : `All ${per} waiting players are confirmed. When you book, book ${nCourts + 1} courts.`}
                  </span>
                </div>
                <button className="btn red" disabled={busy} onClick={() => rpc('upgrade_match', { p_match: m.id }, () => { flash(`Now ${m.size + per} players on ${nCourts + 1} courts`); celebrate() })}>{booked ? `I've booked court ${nCourts + 1}` : 'Open another court'}</button>
              </div>
            )}
            {nCourts < 4 && full && wc > 0 && wc < per && (
              <span className="note" style={{ padding: '0 4px' }}>Hold off booking another court. With fewer than {per} waiting, someone would sit out.</span>
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
            {booked && (
              <div className="card stack" style={{ padding: '18px 20px', gap: 4 }}>
                <span className="eyebrow">Venue</span>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{m.venue}</span>
                <span style={{ fontSize: 13, color: '#5B6573' }}>{[m.courts, m.parking].filter(Boolean).join(' · ')}</span>
              </div>
            )}

            {courts.some(c => c.players.length === per) && (
              <div className="card stack" style={{ padding: '18px 20px', gap: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span className="eyebrow">{singles ? 'Results' : 'Doubles pairs'}</span>
                  <span style={{ fontSize: 12, color: '#5B6573' }}>{singles ? 'Left vs right' : 'Left pair vs right pair'}</span>
                </div>
                {courts.map((c, i) => c.players.length === per && (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 800, minWidth: 0 }}>{nCourts > 1 ? `Court ${i + 1}` : 'Court'}</span>
                    {!singles && <>
                    <button className="chip-btn" disabled={busy} onClick={() => rpc('set_court_order', { p_match: m.id, p_ids: shuffled(c.players.map(p => p.id)) }, () => flash('Pairs shuffled'))}>Shuffle</button>
                    <button className="chip-btn" disabled={busy} onClick={async () => {
                      const { data, error } = await createClient().rpc('get_leaderboard')
                      if (error) return flash(error.message)
                      const order = balancedOrder(c.players.map(p => p.id), standings((data as Leaderboard).games))
                      rpc('set_court_order', { p_match: m.id, p_ids: order }, () => flash('Balanced by win rate'))
                    }}>Balance</button>
                    </>}
                    <button className="chip-btn go" onClick={() => setLogCourt(i)}>Log result</button>
                  </div>
                ))}
              </div>
            )}

            <div className="card stack" style={{ padding: '8px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 4px' }}>
                <span className="eyebrow">Squad</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0E7F66' }}>{m.courts}</span>
              </div>
              {m.players.filter(isVisible).map(p => {
                const pp = person(p.id, p.full_name)
                const payer = m.billed_to?.[p.id]
                const tag = [p.id === m.organiser.id ? 'Organiser' : '', p.id === m.viewer.id ? 'You' : '',
                  p.is_guest ? `Guest · ${payer === m.viewer.id ? 'you pay' : `${personOf(payer ?? '').first} pays`} their share` : ''].filter(Boolean).join(' · ') || 'Confirmed'
                const joined = p.id === m.organiser.id ? 'Created' : p.promoted ? 'Promoted' : joinedAfter(p.joined_at, m.created_at)
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                    <Avatar p={pp} />
                    <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{pp.name}</span>
                      <span style={{ fontSize: 12, color: '#5B6573' }}>{tag}</span>
                    </span>
                    <span style={{ fontSize: 12, color: '#8A94A3', fontWeight: 600 }}>{joined}</span>
                    {!m.past && p.id !== m.organiser.id && (isOrg || m.added_by[p.id] === m.viewer.id) && <RemoveButton name={pp.first} onRemove={() => remove(p.id, pp.first)} busy={busy} />}
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
                      {!m.past && <RemoveButton name={p.full_name.split(' ')[0]} onRemove={() => remove(p.id, p.full_name.split(' ')[0])} busy={busy} />}
                    </div>
                  ))}
                </div>
              )}
              {(m.liable?.length ?? 0) > 0 && (
                <div className="stack" style={{ borderTop: '1px solid rgba(0,0,0,.07)', padding: '14px 0 8px', gap: 10 }}>
                  <div className="stack" style={{ gap: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: '#D9622B' }}>REMOVED AFTER BOOKING · STILL OWE A SHARE</span>
                    <span style={{ fontSize: 12, color: '#5B6573' }}>Cleared automatically when someone takes the spot.</span>
                  </div>
                  {m.liable!.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{p.full_name}</span>
                      {isOrg && <button className="chip-btn" style={{ height: 30 }} disabled={busy} onClick={() => {
                        if (!confirm(`Waive ${p.full_name.split(' ')[0]}'s share? The others split it instead.`)) return
                        rpc('waive_share', { p_match: m.id, p_user: p.id }, () => flash('Share waived'))
                      }}>Waive</button>}
                    </div>
                  ))}
                </div>
              )}
              {conf && !m.past && (
                <button onClick={() => setAdding(true)} style={{ height: 44, margin: '6px 0 12px', borderRadius: 14, border: 'none', background: '#F1F3F6', color: '#0E7F66', fontWeight: 700, fontSize: 14 }}>+ Add player</button>
              )}
            </div>

            <CostSplit m={m} tr={tr} fmt={fmt} personOf={personOf} busy={busy} rpc={rpc} link={link} />

            <Link href={`/m/${m.slug}/share`} className="btn-2">Share match link</Link>
          </>
        )}
      </div>

      {isOrg && <BookSheet open={booking} onClose={() => setBooking(false)} m={m} rpc={rpc} />}
      {isOrg && <EditSheet open={editing} onClose={() => setEditing(false)} m={m} rpc={rpc} />}
      {conf && (
        <Sheet open={adding} onClose={() => setAdding(false)} title="Add player" subtitle={full ? 'The match is full, so they go on the waitlist.' : `${m.size - m.confirmed_count} spot${m.size - m.confirmed_count === 1 ? '' : 's'} left`}>
          <PlayerPicker exclude={members} newLabel="Add guest (no login, you pay their share)"
            onPick={p => { setAdding(false); rpc<{ status: string }>('add_player', { p_match: m.id, p_user: p.id, p_name: null }, r => flash(`${p.full_name.split(' ')[0]} added${r.status === 'waitlist' ? ' to the waitlist' : ''}`)) }}
            onNew={name => { setAdding(false); rpc<{ status: string }>('add_player', { p_match: m.id, p_user: null, p_name: name }, r => { loadPlayers(true); flash(`${name} added as a guest${r.status === 'waitlist' ? ' · waitlist' : ''}`) }) }} />
        </Sheet>
      )}
      {canSee && (
        <LogResultSheet open={logCourt !== null} onClose={() => setLogCourt(null)} matchId={m.id} matchTitle={m.title} initialCourt={logCourt ?? 0}
          courts={courts.map((c, i) => ({ label: `Court ${i + 1}`, players: c.players }))} />
      )}
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

  if (!m.split_ready) {
    return (
      <div className="card stack" style={{ padding: 20, gap: 6 }}>
        <span className="eyebrow">Cost split</span>
        <span style={{ fontSize: 14, color: '#5B6573', lineHeight: 1.45 }}>
          {m.status === 'booked'
            ? `Starts once the court cost is entered.${isOrg ? ' Add it under Edit details.' : ''}`
            : `Starts once the court is booked and its cost is entered.${isOrg ? '' : ` ${personOf(m.organiser.id).first} will add it.`}`}
        </span>
      </div>
    )
  }

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

function RemoveButton({ name, onRemove, busy }: { name: string; onRemove: () => void; busy: boolean }) {
  return (
    <button aria-label={`Remove ${name}`} disabled={busy} onClick={onRemove}
      style={{ border: 'none', background: '#F1F3F6', color: '#8A94A3', width: 28, height: 28, borderRadius: 10, fontSize: 16, lineHeight: 1, flex: 'none' }}>×</button>
  )
}

/** Organiser marks the court booked and adds the details. Running it again edits them. */
function BookSheet({ open, onClose, m, rpc }: { open: boolean; onClose: () => void; m: MatchView; rpc: Rpc }) {
  const { flash } = useFeedback()
  const [f, setF] = useState({ venue: m.venue, courts: m.courts ?? '', parking: m.parking ?? '', cost: m.court_cost ? String(m.court_cost) : '' })
  // Pick up changes made elsewhere (e.g. a court added) each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setF({ venue: m.venue, courts: m.courts ?? '', parking: m.parking ?? '', cost: m.court_cost ? String(m.court_cost) : '' })
  }
  const set = (k: 'venue' | 'courts' | 'parking' | 'cost') => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }))
  const cost = Number(f.cost || 0)
  const booked = m.status === 'booked'
  const per = perCourt(m.format)
  // How many courts to book: on first booking, default to the courts we can fill.
  const fillable = Math.max(1, Math.min(m.court_count, Math.floor(m.confirmed_count / per)))
  const [book, setBook] = useState(booked ? m.court_count : fillable)
  if (open !== wasOpen && open) setBook(booked ? m.court_count : fillable)
  const nCourts = booked ? m.court_count : book
  const size = nCourts * per
  const moving = Math.max(0, m.confirmed_count - size)
  const dropping = m.court_count - nCourts
  return (
    <Sheet open={open} onClose={onClose} title={booked ? 'Court details' : 'Court booked'}
      subtitle={booked ? 'Update what the players see.' : 'Players get locked in once you save. Only you can remove someone after this.'}>
      {!booked && m.court_count > 1 && (
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">Courts booked</span>
          <Seg options={Array.from({ length: m.court_count }, (_, i) => ({ value: i + 1, label: `${i + 1} of ${m.court_count}` }))} value={book} onChange={setBook} />
          <span className="note" style={{ color: moving ? '#D9622B' : undefined }}>
            {m.confirmed_count} signed up.{' '}
            {dropping > 0 ? `Court${dropping > 1 ? 's' : ''} ${Array.from({ length: dropping }, (_, i) => nCourts + i + 1).join(' & ')} will be dropped. ` : ''}
            {moving > 0 ? `${moving === 1 ? 'The last person to join moves' : `The last ${moving} to join move`} to the front of the waitlist; another court opens once ${per} are waiting.` : ''}
          </span>
        </div>
      )}
      <label className="label"><span className="eyebrow">Venue</span>
        <input className="field" value={f.venue} onChange={set('venue')} placeholder="e.g. Al Quoz Sports Hall" maxLength={120} /></label>
      <label className="label"><span className="eyebrow">{nCourts > 1 ? 'Court numbers' : 'Court number'}</span>
        <input className="field" value={f.courts} onChange={set('courts')} placeholder={nCourts > 1 ? `e.g. ${Array.from({ length: nCourts }, (_, i) => `Court ${i + 3}`).join(' & ')}` : 'e.g. Court 3'} maxLength={60} />
        {nCourts > 1 && <span className="note">Just the first one is fine: the next numbers are filled in.</span>}</label>
      <label className="label"><span className="eyebrow">Parking notes · optional</span>
        <input className="field" value={f.parking} onChange={set('parking')} placeholder="e.g. Free parking behind the hall" maxLength={200} /></label>
      <label className="label"><span className="eyebrow">Court cost · per court</span>
        <div className="field-wrap">
          <span style={{ fontWeight: 800, color: '#0E7F66', fontSize: 14 }}>{m.currency}</span>
          <input type="number" inputMode="decimal" min={0} value={f.cost} onChange={set('cost')} placeholder="0" style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: '#12161C', fontSize: 16, outline: 'none' }} />
        </div>
        <span className="note">{money(cost * nCourts, m.currency)} for {nCourts} court{nCourts > 1 ? 's' : ''} · {money((cost * nCourts) / size, m.currency)} per player · in the cost split as paid by you</span>
      </label>
      <button className="btn" onClick={() => {
        if (!f.venue.trim() || !f.courts.trim()) return flash('Add the venue and court number')
        if (Number.isNaN(cost) || cost < 0) return flash('Court cost must be a number')
        if (moving > 0 && !confirm(`Book ${nCourts} of ${m.court_count} courts? ${moving === 1 ? 'The last person to join moves' : `The last ${moving} to join move`} to the waitlist.`)) return
        onClose()
        rpc<{ demoted: number }>('book_match', {
          p_match: m.id, p_venue: f.venue.trim(), p_courts: f.courts.trim(), p_parking: f.parking.trim(), p_court_cost: cost,
          p_court_count: booked ? null : nCourts,
        }, r => flash(booked ? 'Details updated' : ['Court booked · players locked in', r?.demoted ? `${r.demoted} moved to the waitlist` : ''].filter(Boolean).join(' · ')))
      }}>{booked ? 'Save details' : `Save · lock in ${Math.min(m.confirmed_count, size)} players`}</button>
    </Sheet>
  )
}

/** Organiser edits the match: name, singles/doubles, courts, date, time, duration, RSVP close. */
function EditSheet({ open, onClose, m, rpc }: { open: boolean; onClose: () => void; m: MatchView; rpc: Rpc }) {
  const { flash } = useFeedback()
  const init = () => ({ title: m.title, format: m.format, courts: m.court_count, ...localDateTime(m.starts_at, m.timezone), duration: m.duration_min, closes: m.rsvp_close_hours })
  const [f, setF] = useState(init)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) { setWasOpen(open); if (open) setF(init()) }
  const size = f.courts * perCourt(f.format)
  const moving = Math.max(0, m.confirmed_count - size)
  return (
    <Sheet open={open} onClose={onClose} title="Edit match" subtitle={m.status === 'booked' ? 'Court booked · changing courts updates the cost split' : 'Planning'}>
      <label className="label"><span className="eyebrow">Match name</span>
        <input className="field" value={f.title} onChange={e => setF(x => ({ ...x, title: e.target.value }))} maxLength={80} /></label>
      <FormatPicker format={f.format} courts={f.courts} onChange={(format: Format, courts) => setF(x => ({ ...x, format, courts }))} />
      {moving > 0 && <span className="note" style={{ color: '#D9622B', marginTop: -8 }}>{moving} player{moving > 1 ? 's' : ''} who joined last will move to the front of the waitlist.</span>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="label"><span className="eyebrow">Date</span>
          <input className="field" type="date" value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} style={{ padding: '0 12px', fontSize: 15 }} /></label>
        <label className="label"><span className="eyebrow">Start</span>
          <input className="field" type="time" value={f.time} onChange={e => setF(x => ({ ...x, time: e.target.value }))} style={{ padding: '0 12px', fontSize: 15 }} /></label>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <span className="eyebrow">Duration</span>
        <Seg options={[60, 90, 120].map(d => ({ value: d, label: `${d} min` }))} value={f.duration} onChange={v => setF(x => ({ ...x, duration: v }))} />
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <span className="eyebrow">RSVPs close</span>
        <Seg options={[2, 6, 24].map(h => ({ value: h, label: `${h}h before` }))} value={f.closes} onChange={v => setF(x => ({ ...x, closes: v }))} />
      </div>
      <button className="btn" onClick={() => {
        if (!f.title.trim()) return flash('Add a match name')
        if (moving > 0 && !confirm(`${moving} player${moving > 1 ? 's' : ''} will move to the waitlist. Continue?`)) return
        onClose()
        rpc<{ demoted: number; promoted: number }>('update_match', {
          p_match: m.id, p_title: f.title.trim(), p_format: f.format, p_court_count: f.courts,
          p_date: f.date, p_time: f.time, p_duration_min: f.duration, p_rsvp_close_hours: f.closes,
        }, r => flash(['Match updated', r.demoted ? `${r.demoted} moved to waitlist` : '', r.promoted ? `${r.promoted} promoted` : ''].filter(Boolean).join(' · ')))
      }}>Save changes</button>
    </Sheet>
  )
}
