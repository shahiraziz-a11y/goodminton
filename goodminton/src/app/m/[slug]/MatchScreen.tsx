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
import { loadPlayers } from '@/components/PlayerPicker'
import { AlertsCard } from '@/components/Pwa'
import { Sheet } from '@/components/Sheet'
import { balancedOrder, shuffled, standings } from '@/lib/stats'
import { courtNumber, localDateTime, money } from '@/lib/format'
import { matchLabels, whatsappUrl } from '@/lib/match'
import { person, type Person } from '@/lib/people'
import { transfersOf } from '@/lib/split'
import { createClient, signInWithGoogle } from '@/lib/supabase/client'
import { isVisible, perCourt, type Format, type Leaderboard, type MatchView, type PlayerOption } from '@/lib/types'

export function MatchScreen({ m, link, started }: { m: MatchView; link: string; started: boolean }) {
  const router = useRouter()
  const { flash, celebrate } = useFeedback()
  const [busy, setBusy] = useState(false)
  const [booking, setBooking] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [mySpot, setMySpot] = useState(false)
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
  const info = (c: number | undefined) => m.court_info?.find(x => x.court === c)
  const nBooked = m.court_info?.filter(x => x.booked).length ?? 0
  const canAdd = conf && !m.past
  const canRemove = (id: string) => !m.past && id !== m.organiser.id && (isOrg || m.added_by[id] === m.viewer.id)
  const mine = m.players.find(p => isVisible(p) && p.id === m.viewer.id)
  const myCourtBooked = !!info(mine?.court)?.booked
  const courts = Array.from({ length: nCourts }, (_, ci) => {
    const c = ci + 1
    const ic = info(c)
    const group = m.players.filter(p => p.court === c)
    const slots: Slot[] = Array.from({ length: per }, (_, i) => {
      const p = group[i]
      if (!p) return canAdd ? { kind: 'add', onTap: () => setAdding(true) } : { kind: 'empty' }
      if (!isVisible(p)) return { kind: 'anon' }
      const pp = person(p.id, p.full_name)
      if (p.id === m.viewer.id) return { kind: 'mine', p: pp, onTap: !isOrg && !m.past ? () => setMySpot(true) : undefined }
      return { kind: 'named', p: pp, onRemove: canRemove(p.id) ? () => remove(p.id, pp.first, !!ic?.booked) : undefined }
    })
    const canEdit = !!ic?.booked && (isOrg || ic.booked_by === m.viewer.id)
    return {
      court: c,
      label: `Court ${c} of ${nCourts}`,
      num: canSee && ic?.booked && ic.label ? (/\d/.test(ic.label) ? courtNumber(ic.label, 0) : ic.label) : null,
      tbc: canSee && !ic?.booked,
      slots,
      count: group.length,
      players: group.filter(isVisible).map(p => person(p.id, p.full_name)),
      booking: ic?.booked
        ? { booked: true, text: `✓ BOOKED${ic.booked_by_name ? ` BY ${ic.booked_by === m.viewer.id ? 'YOU' : ic.booked_by_name.split(' ')[0].toUpperCase()}` : ''}` }
        : { booked: false, text: 'NOT BOOKED YET' },
      action: !conf || m.past ? null
        : !ic?.booked ? <button className="chip-btn go" onClick={() => setBooking(c)}>Book court {c}</button>
        : canEdit ? <button className="chip-btn" onClick={() => setBooking(c)}>Edit</button> : null,
    }
  })
  const firstOpen = courts.find(c => !c.booking.booked)
  const showGhost = nCourts < 4 && full && wc > 0 && !m.past
  const ghostSlots: Slot[] = Array.from({ length: per }, (_, i) => {
    const w = m.waitlist?.[i]
    if (i >= Math.min(wc, per)) return { kind: 'empty' }
    if (!w) return { kind: 'wait', name: 'Waiting' }
    return { kind: 'wait', name: w.full_name, onRemove: canRemove(w.id) ? () => remove(w.id, w.full_name.split(' ')[0]) : undefined }
  })
  const cn = Math.floor(m.confirmed_count / per)
  const finalLine = `Final: ${m.confirmed_count} players · ${cn} court${cn === 1 ? '' : 's'}`

  function remove(id: string, first: string, courtBooked = false) {
    if (!confirm(`Remove ${first} from this match?${courtBooked ? ` Their court is booked: if nobody takes the spot, ${first} still owes their share.` : ''}`)) return
    rpc<{ promoted: string | null; still_owes: boolean }>('remove_player', { p_match: m.id, p_user: id }, r =>
      flash([`${first} removed`, r.still_owes ? 'still owes their share' : '', r.promoted ? `${r.promoted.split(' ')[0]} promoted` : ''].filter(Boolean).join(' · ')))
  }

  const courtCards = courts.map((c, i) => (
    <CourtCard key={i} label={c.label} num={c.num} tbc={c.tbc} slots={c.slots} dateLabel={L.dateLabel} start={L.start} end={L.end}
      booking={signedIn && !m.past ? c.booking : undefined} action={c.action} />
  ))

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
            Your Google name is used, so there&apos;s nothing to type. You can see who&apos;s playing. The court number unlocks once you&apos;re confirmed.
          </span>
        </div>
      </Frame>
    )
  }

  const canLog = started && courts.some(c => c.players.length === per)
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
              {nBooked === 0
                ? <span className="badge" style={{ background: '#F1F3F6', color: '#5B6573' }}>Planning · {nCourts > 1 ? 'courts' : 'court'} not booked yet</span>
                : <span className="badge" style={{ background: '#E7F6F1', color: '#0E7F66' }}>
                    {nBooked === nCourts ? (nCourts > 1 ? '✓ All courts booked' : '✓ Court booked') : `✓ ${nBooked} of ${nCourts} courts booked`}
                  </span>}
              {m.locked && <span className="badge" style={{ background: '#E5484D', color: '#fff' }}>Sign-ups closed</span>}
            </div>
          )}
        </div>

        {courtCards}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
          <span className="display" style={{ fontSize: 14, fontWeight: 700 }}>{m.confirmed_count}/{m.size} confirmed</span>
          <span style={{ fontSize: 13, color: '#5B6573', fontWeight: 600 }}>{wc ? `${wc} waiting` : 'No waitlist'}</span>
        </div>
        {canSee && (canLog || !started || canAdd) && (
          <div style={{ display: 'flex', gap: 8, marginTop: -8 }}>
            {canLog && <button className="row-btn go" onClick={() => setLogCourt(Math.max(0, courts.findIndex(c => c.players.length === per)))}>+ Log result</button>}
            {!started && <Link className="row-btn go" href={`/m/${m.slug}/share`}>Share match link</Link>}
            {canAdd && <button className="row-btn" onClick={() => setAdding(true)}>+ Add player</button>}
          </div>
        )}

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
            <span className="note" style={{ lineHeight: 1.4, textWrap: 'pretty' }}>Court number and costs are visible to confirmed players only.</span>
          </div>
        )}

        {isOrg && !m.past && (
          <>
            <div className="card stack" style={{ padding: 20, gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="eyebrow">Organiser tools</span>
                <button className="chip-btn" onClick={() => setEditing(true)}>Edit match</button>
              </div>
              {!firstOpen ? (
                <div className="stack" style={{ gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#0E7F66' }}>✓ {nCourts > 1 ? 'All courts booked' : 'Court booked'}</span>
                  <span style={{ fontSize: 12, color: '#5B6573' }}>Players are locked in. Only you can remove someone. Edit a booking on its court card.</span>
                </div>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  <span style={{ fontSize: 14, color: '#5B6573', lineHeight: 1.4 }}>
                    {nCourts > 1
                      ? `${nBooked} of ${nCourts} courts booked. Book each court once you've booked it at the venue; it doesn't have to be full. Only players on a booked court are locked in.`
                      : firstOpen.count >= per ? `${m.size} in. Book the court, then add the details here.` : `${firstOpen.count}/${per} in. You can book now or wait for ${per - firstOpen.count} more.`}
                  </span>
                  <button className="btn" style={{ height: 48, fontSize: 15 }} onClick={() => setBooking(firstOpen.court)}>Book court {firstOpen.court}{nCourts > 1 ? ` · ${firstOpen.count}/${per} in` : ''}</button>
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
                    All {per} waiting players are confirmed on court {nCourts + 1}. Book it whenever you&apos;re ready; until then they can still drop out.
                  </span>
                </div>
                <button className="btn red" disabled={busy} onClick={() => rpc('upgrade_match', { p_match: m.id }, () => { flash(`Now ${m.size + per} players on ${nCourts + 1} courts`); celebrate() })}>Open court {nCourts + 1}</button>
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
            {nBooked > 0 && (
              <div className="card stack" style={{ padding: '18px 20px', gap: 4 }}>
                <span className="eyebrow">Venue</span>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{m.venue}</span>
                <span style={{ fontSize: 13, color: '#5B6573' }}>{[m.courts, m.parking].filter(Boolean).join(' · ')}</span>
              </div>
            )}

            {!singles && !m.past && courts.some(c => c.players.length === per) && (
              <div className="card stack" style={{ padding: '18px 20px', gap: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span className="eyebrow">Doubles pairs</span>
                  <span style={{ fontSize: 12, color: '#5B6573' }}>Left pair vs right pair</span>
                </div>
                {courts.map((c, i) => c.players.length === per && (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 800, minWidth: 0 }}>{nCourts > 1 ? `Court ${i + 1}` : 'Court'}</span>
                    <button className="chip-btn" disabled={busy} onClick={() => rpc('set_court_order', { p_match: m.id, p_ids: shuffled(c.players.map(p => p.id)) }, () => flash('Pairs shuffled'))}>Shuffle</button>
                    <button className="chip-btn" disabled={busy} onClick={async () => {
                      const { data, error } = await createClient().rpc('get_leaderboard')
                      if (error) return flash(error.message)
                      const order = balancedOrder(c.players.map(p => p.id), standings((data as Leaderboard).games))
                      rpc('set_court_order', { p_match: m.id, p_ids: order }, () => flash('Balanced by win rate'))
                    }}>Balance</button>
                  </div>
                ))}
              </div>
            )}

            {(m.liable?.length ?? 0) > 0 && (
              <div className="card stack" style={{ padding: '18px 20px', gap: 10 }}>
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

            <CostSplit m={m} tr={tr} fmt={fmt} personOf={personOf} busy={busy} rpc={rpc} link={link} />
          </>
        )}
      </div>

      {conf && <BookSheet court={booking} onClose={() => setBooking(null)} m={m} rpc={rpc} count={courts.find(c => c.court === booking)?.count ?? 0} />}
      {isOrg && <EditSheet open={editing} onClose={() => setEditing(false)} m={m} rpc={rpc} />}
      {conf && <AddPlayerSheet open={adding} onClose={() => setAdding(false)} m={m} exclude={members} inviteMsg={L.inviteMsg} rpc={rpc} />}
      {conf && !isOrg && (
        <Sheet open={mySpot} onClose={() => setMySpot(false)} title="You're in" subtitle={`${m.title} · ${L.dateLabel}, ${L.timeRange}`}>
          {myCourtBooked ? (
            <span style={{ fontSize: 14, color: '#5B6573', lineHeight: 1.45 }}>
              Your court&apos;s booked, so you&apos;re locked in. Ask {org.first} if you need to drop out. You&apos;ll still owe your share.
            </span>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <button className="btn-2" style={{ color: '#E0245E', fontWeight: 800 }} disabled={busy} onClick={() => {
                if (m.locked && !confirm('Sign-ups are closed. Drop out anyway?')) return
                setMySpot(false)
                rpc<{ promoted: string | null }>('leave_match', { p_match: m.id }, r => flash(r.promoted ? `Spot passed to ${r.promoted.split(' ')[0]}` : 'You dropped out'))
              }}>Drop out</button>
              <span style={{ fontSize: 13, color: '#5B6573', textAlign: 'center' }}>Your spot goes to the next person on the waitlist.</span>
            </div>
          )}
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
  const guests = Object.entries(m.billed_to ?? {})

  if (!m.split_ready) {
    return (
      <div className="card stack" style={{ padding: 20, gap: 6 }}>
        <span className="eyebrow">Cost split</span>
        <span style={{ fontSize: 14, color: '#5B6573', lineHeight: 1.45 }}>
          {m.status === 'booked'
            ? 'Starts once a booked court has its cost entered. Tap Edit on the court card to add it.'
            : 'Starts once a court is booked and its cost is entered. Whoever books a court pays for it, and it\'s split between the players on booked courts.'}
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
      {meId && !(m.split_ids ?? []).includes(meId) && m.viewer.role === 'confirmed' && (
        <span className="note" style={{ marginTop: -6 }}>Your court isn&apos;t booked yet, so you&apos;re not paying anything yet. Once it&apos;s booked, everyone on booked courts shares the total.</span>
      )}
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
      {guests.length > 0 && (
        <span style={{ fontSize: 12, color: '#5B6573', lineHeight: 1.45 }}>
          {guests.map(([g, payer]) => `${personOf(g).name}'s share goes to ${payer === meId ? 'you' : personOf(payer).first}`).join(' · ')}
        </span>
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

/** Book one court (or edit its booking). Whoever books it pays for it. */
function BookSheet({ court, onClose, m, rpc, count }: { court: number | null; onClose: () => void; m: MatchView; rpc: Rpc; count: number }) {
  const { flash } = useFeedback()
  const ic = m.court_info?.find(x => x.court === court)
  const booked = !!ic?.booked
  const init = () => ({ venue: m.venue, label: ic?.label ?? '', parking: m.parking ?? '', cost: String(ic?.cost ?? (m.court_cost || '')) })
  const [f, setF] = useState(init)
  const [was, setWas] = useState(court)
  if (court !== was) { setWas(court); if (court) setF(init()) }
  const set = (k: 'venue' | 'label' | 'parking' | 'cost') => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }))
  const cost = Number(f.cost || 0)
  const per = perCourt(m.format)
  const others = m.court_info?.filter(x => x.booked && x.court !== court) ?? []
  const otherLabels = others.map(x => x.label).filter(Boolean).join(' & ')
  const canCancel = booked && (m.viewer.role === 'organiser' || ic?.booked_by === m.viewer.id)
  if (!court) return null
  return (
    <Sheet open={court !== null} onClose={onClose} title={booked ? `Court ${court} details` : `Book court ${court}`}
      subtitle={booked ? 'Update what the players see.' : `The ${count} player${count === 1 ? '' : 's'} on this court get locked in. You pay for it; the cost is split between everyone on booked courts.`}>
      {!booked && count < per && (
        <span className="note" style={{ color: '#D9622B', marginTop: -6 }}>
          {count} of {per} on this court so far. You can still book it: the open spot{per - count > 1 ? 's stay' : ' stays'} open for anyone to join.
        </span>
      )}
      <label className="label"><span className="eyebrow">Venue</span>
        <input className="field" value={f.venue} onChange={set('venue')} placeholder="e.g. Al Quoz Sports Hall" maxLength={120} /></label>
      <label className="label"><span className="eyebrow">Court number</span>
        <input className="field" value={f.label} onChange={set('label')} placeholder="e.g. Court 3" maxLength={30} />
        {otherLabels && <span className="note">Already booked: {otherLabels}</span>}</label>
      <label className="label"><span className="eyebrow">Parking notes · optional</span>
        <input className="field" value={f.parking} onChange={set('parking')} placeholder="e.g. Free parking behind the hall" maxLength={200} /></label>
      <label className="label"><span className="eyebrow">Cost of this court</span>
        <div className="field-wrap">
          <span style={{ fontWeight: 800, color: '#0E7F66', fontSize: 14 }}>{m.currency}</span>
          <input type="number" inputMode="decimal" min={0} value={f.cost} onChange={set('cost')} placeholder="0" style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: '#12161C', fontSize: 16, outline: 'none' }} />
        </div>
        <span className="note">In the cost split as paid by {booked && ic?.booked_by !== m.viewer.id ? (ic?.booked_by_name?.split(' ')[0] ?? 'the booker') : 'you'}.</span>
      </label>
      <button className="btn" onClick={() => {
        if (!f.venue.trim() || !f.label.trim()) return flash('Add the venue and court number')
        if (Number.isNaN(cost) || cost < 0) return flash('Court cost must be a number')
        onClose()
        rpc<{ new: boolean }>('book_court', {
          p_match: m.id, p_court: court, p_venue: f.venue.trim(), p_label: f.label.trim(), p_parking: f.parking.trim(), p_cost: cost,
        }, r => flash(r.new ? `Court ${court} booked · its players are locked in` : 'Details updated'))
      }}>{booked ? 'Save details' : `Book court ${court} · lock in ${count}`}</button>
      {canCancel && (
        <button className="link-btn" style={{ alignSelf: 'center', color: '#E0245E' }} onClick={() => {
          if (!confirm(`Cancel the booking for court ${court}? Its cost leaves the split and its players can drop out again.`)) return
          onClose()
          rpc('cancel_court', { p_match: m.id, p_court: court }, () => flash(`Court ${court} booking cancelled`))
        }}>Cancel this booking</button>
      )}
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
    <Sheet open={open} onClose={onClose} title="Edit match" subtitle={m.status === 'booked' ? 'Dropping a booked court cancels its booking and cost' : 'Planning'}>
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

/** Add someone by name (a guest whose share you pay) or from the people you've played with. */
function AddPlayerSheet({ open, onClose, m, exclude, inviteMsg, rpc }: {
  open: boolean; onClose: () => void; m: MatchView; exclude: string[]; inviteMsg: string; rpc: Rpc
}) {
  const { flash } = useFeedback()
  const [all, setAll] = useState<PlayerOption[] | null>(null)
  const [name, setName] = useState('')
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) { setWasOpen(open); if (open) setName('') }
  useEffect(() => { if (open) loadPlayers().then(setAll, e => flash(e.message)) }, [open, flash])

  const left = m.size - m.confirmed_count
  const term = name.trim().toLowerCase()
  const known = (all ?? []).filter(p => !exclude.includes(p.id))
  const list = known.filter(p => !term || p.full_name.toLowerCase().includes(term))
  const exact = known.find(p => p.full_name.toLowerCase() === term)
  const where = (status: string) => (status === 'waitlist' ? ' · waitlist' : ' · confirmed')

  function addKnown(p: PlayerOption) {
    onClose()
    rpc<{ status: string }>('add_player', { p_match: m.id, p_user: p.id, p_name: null }, r => flash(`${p.full_name.split(' ')[0]} added${where(r.status)}`))
  }
  function addByName() {
    const n = name.trim()
    if (!n) return flash('Type a name')
    if (exact) return addKnown(exact)
    onClose()
    rpc<{ status: string }>('add_player', { p_match: m.id, p_user: null, p_name: n }, r => { loadPlayers(true); flash(`${n} added as a guest${where(r.status)}`) })
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add player">
      <span style={{ fontSize: 13, color: '#5B6573', marginTop: -8 }}>
        {left > 0 ? `${left} spot${left > 1 ? 's' : ''} free · they're confirmed straight away` : 'Match is full · they go on the waitlist'}
      </span>
      <form className="stack" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); addByName() }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" maxLength={60} aria-label="Player name"
            style={{ flex: 1, minWidth: 0, height: 48, borderRadius: 14, border: 'none', boxShadow: '0 0 0 1px #E6E9EE', padding: '0 14px', fontSize: 15, color: '#12161C', background: '#fff', outline: 'none' }} />
          <button type="submit" style={{ height: 48, padding: '0 18px', borderRadius: 14, border: 'none', background: '#0E9F7E', color: '#fff', fontWeight: 800, fontSize: 14, flex: 'none' }}>Add</button>
        </div>
        <span className="note" style={{ fontSize: 12 }}>Not on Goodminton? They&apos;re added as your guest and you pay their share.</span>
      </form>
      {list.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Played with before</span>
          {list.map(p => {
            const pp = person(p.id, p.full_name)
            return (
              <button key={p.id} type="button" onClick={() => addKnown(p)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', border: 'none', background: 'none', textAlign: 'left', width: '100%', color: '#12161C' }}>
                <Avatar p={pp} size={36} font={13} />
                <span style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>{p.full_name}</span>
                {p.is_guest && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: '#8A94A3' }}>GUEST</span>}
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0E7F66' }}>+ Add</span>
              </button>
            )
          })}
        </div>
      )}
      {all === null && <span className="note">Loading players…</span>}
      <a className="btn-2" href={whatsappUrl(inviteMsg)} target="_blank" rel="noreferrer" style={{ height: 46, color: '#128A5C' }}>Send invite link on WhatsApp</a>
    </Sheet>
  )
}
