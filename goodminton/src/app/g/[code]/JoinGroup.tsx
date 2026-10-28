'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Frame, GoogleButton } from '@/components/Chrome'
import { useFeedback } from '@/components/Feedback'
import { person } from '@/lib/people'
import { createClient, signInWithGoogle } from '@/lib/supabase/client'
import type { GroupPreview } from '@/lib/types'

/** The group invite link: shows the group, signs you in if needed, and joins. */
export function JoinGroup({ code, g, me }: { code: string; g: GroupPreview | null; me: { id: string; name: string } | null }) {
  const router = useRouter()
  const { flash } = useFeedback()
  const [busy, setBusy] = useState(false)

  async function join() {
    setBusy(true)
    const { data, error } = await createClient().rpc('join_group', { p_code: code })
    if (error) { setBusy(false); return flash(error.message) }
    flash(`You're in ${g?.name}`)
    router.push(`/groups/${data}`)
  }

  return (
    <Frame me={me ? person(me.id, me.name) : null}>
      <div className="screen" style={{ minHeight: 'calc(100dvh - 140px)', justifyContent: 'center', gap: 24 }}>
        {!g ? (
          <div className="stack" style={{ gap: 10 }}>
            <span className="h1">Link expired</span>
            <span style={{ fontSize: 15, color: '#6B6B66', lineHeight: 1.5 }}>This invite link doesn&apos;t work any more. Ask whoever sent it for a new one.</span>
          </div>
        ) : (
          <>
            <div style={{ background: '#0E4A30', color: '#fff', borderRadius: 28, padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: '#9FE0BC' }}>{g.owner} invited you to</span>
              <span className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1.05, overflowWrap: 'anywhere' }}>{g.name}</span>
              <span style={{ fontSize: 14, color: '#CFE3D5' }}>{g.members} member{g.members === 1 ? '' : 's'} on Goodminton</span>
            </div>
            <span style={{ fontSize: 14, color: '#6B6B66', lineHeight: 1.5 }}>Join to see the group&apos;s matches, sign up for spots, and keep track of results and who owes what.</span>
            {me ? (
              <button className="btn" disabled={busy} onClick={join}>{busy ? 'Joining…' : `Join ${g.name}`}</button>
            ) : (
              <GoogleButton busy={busy} label="Continue with Google to join" onClick={async () => {
                setBusy(true)
                const { error } = await signInWithGoogle(`/g/${code}`)
                if (error) { setBusy(false); flash(error.message) }
              }} />
            )}
          </>
        )}
      </div>
    </Frame>
  )
}
