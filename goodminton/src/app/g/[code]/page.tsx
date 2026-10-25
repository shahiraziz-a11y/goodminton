import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import type { GroupPreview } from '@/lib/types'
import { JoinGroup } from './JoinGroup'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { supabase, user } = await getUser()
  const { data } = await supabase.rpc('group_preview', { p_code: code })
  const g = (data ?? null) as GroupPreview | null
  if (g?.is_member) redirect(`/groups/${g.id}`)
  return <JoinGroup code={code} g={g} me={user ? { id: user.id, name: user.name } : null} />
}
