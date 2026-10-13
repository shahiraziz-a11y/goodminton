import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import type { Leaderboard as Data } from '@/lib/types'
import { Leaderboard } from './Leaderboard'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const { supabase, user } = await getUser()
  if (!user) redirect('/')
  const { data } = await supabase.rpc('get_leaderboard')
  return <Leaderboard meId={user.id} meName={user.name} data={(data ?? { games: [], people: {} }) as Data} />
}
