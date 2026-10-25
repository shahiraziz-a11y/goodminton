import { notFound, redirect } from 'next/navigation'
import { getUser, siteOrigin } from '@/lib/supabase/server'
import type { GroupDetail } from '@/lib/types'
import { GroupScreen } from './GroupScreen'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, user } = await getUser()
  if (!user) redirect('/')
  const { data, error } = await supabase.rpc('get_group', { p_group: id })
  if (error || !data) notFound()
  return <GroupScreen meId={user.id} meName={user.name} g={data as GroupDetail} origin={await siteOrigin()} />
}
