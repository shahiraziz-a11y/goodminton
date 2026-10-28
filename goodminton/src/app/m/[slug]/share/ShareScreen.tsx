'use client'

import Link from 'next/link'
import { Bars, Frame } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { matchLabels, whatsappUrl } from '@/lib/match'
import { person } from '@/lib/people'
import type { MatchView } from '@/lib/types'

export function ShareScreen({ m, link }: { m: MatchView; link: string }) {
  const { flash } = useFeedback()
  const L = matchLabels(m, link)
  const me = m.viewer.id && m.viewer.full_name ? person(m.viewer.id, m.viewer.full_name) : null
  const host = link.replace(/^https?:\/\//, '')
  const isNew = m.viewer.role === 'organiser' && m.confirmed_count === 1

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      flash('Link copied')
    } catch {
      flash('Copy failed. Press and hold the link to copy it.')
    }
  }

  return (
    <Frame back={`/m/${m.slug}`} me={me}>
      <div className="screen">
        <div className="stack" style={{ gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.12em', color: '#0E5A3A' }}>{isNew ? 'MATCH CREATED' : 'SHARE'}</span>
          <span className="h1">Rally the group.</span>
        </div>

        {/* Preview of how the link looks in a WhatsApp chat */}
        <div style={{ background: '#EFEAE2', borderRadius: 24, padding: '18px 14px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ background: '#D9FDD3', borderRadius: '12px 12px 4px 12px', padding: 4, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 290, alignSelf: 'flex-end' }}>
            <div style={{ borderRadius: 9, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10, background: '#0E4A30' }}>
                <Bars dark n={m.confirmed_count} size={m.size} />
                <div className="display" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-.02em', color: '#fff', lineHeight: 1.15 }}>{m.title}</div>
                <div className="display" style={{ fontSize: 12, fontWeight: 600, color: '#3FD3AE' }}>{L.timeRange}</div>
              </div>
              <div style={{ padding: '9px 12px', background: '#F0F2F5', display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#111B21' }}>{L.spotsLine}</span>
                <span style={{ fontSize: 12, color: '#54656F' }}>{L.dateLabel} · {m.venue || 'Venue TBC'}</span>
                <span style={{ fontSize: 12, color: '#8696A0' }}>{host.split('/')[0]}</span>
              </div>
            </div>
            <div style={{ fontSize: 14.5, lineHeight: 1.35, padding: '2px 6px 4px', color: '#111B21', wordBreak: 'break-word' }}>
              {L.inviteMsg.replace(link, '')}<span style={{ color: '#027EB5' }}>{link}</span>
            </div>
          </div>
        </div>

        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 6px 16px', borderRadius: 18 }}>
          <span style={{ flex: 1, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, color: '#6B6B66', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'all' }}>{host}</span>
          <button className="card" onClick={copy} style={{ height: 42, padding: '0 18px', borderRadius: 14, color: '#0E5A3A', fontWeight: 700, fontSize: 13 }}>Copy</button>
        </div>
        <a className="btn wa" href={whatsappUrl(L.inviteMsg)} target="_blank" rel="noreferrer">Share to WhatsApp</a>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Link className="btn-2" href={`/m/${m.slug}`}>View match</Link>
          <Link className="btn-2" href="/">Done</Link>
        </div>
      </div>
    </Frame>
  )
}
