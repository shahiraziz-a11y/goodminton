import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import type { GroupListing } from '@/lib/types'
import { Discover } from './Discover'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const { supabase, user } = await getUser()
  if (!user) redirect('/')
  const { data } = await supabase.rpc('list_groups')
  return <Discover meId={user.id} meName={user.name} initial={(data ?? []) as GroupListing[]} />
}
