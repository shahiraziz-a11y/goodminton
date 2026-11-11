import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Frame } from '@/components/Chrome'
import { person } from '@/lib/people'
import { getUser } from '@/lib/supabase/server'
import type { BoardView } from '@/lib/types'
import { PegBoard } from './PegBoard'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { supabase, user } = await getUser()
  if (!user) redirect(`/m/${slug}`)
  const { data } = await supabase.rpc('get_board', { p_slug: slug })
  if (!data) {
    return (
      <Frame me={person(user.id, user.name)} tab="play" back="/play">
        <div className="screen">
          <div className="card stack" style={{ padding: 28, gap: 8, textAlign: 'center', alignItems: 'center' }}>
            <span className="display" style={{ fontSize: 17, fontWeight: 700 }}>Only players in this match can run the board</span>
            <Link href={`/m/${slug}`} className="chip-btn" style={{ height: 38, display: 'flex', alignItems: 'center' }}>Open the match</Link>
          </div>
        </div>
      </Frame>
    )
  }
  return <PegBoard meId={user.id} meName={user.name} initial={data as BoardView} />
}
