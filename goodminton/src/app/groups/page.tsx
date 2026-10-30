import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import type { MyGroup } from '@/lib/types'
import { GroupsList } from './GroupsList'

export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { supabase, user } = await getUser()
  if (!user) redirect('/')
  const { data } = await supabase.rpc('my_groups')
  const { new: startNew } = await searchParams
  return <GroupsList meId={user.id} meName={user.name} groups={(data ?? []) as MyGroup[]} startNew={startNew === '1'} />
}
