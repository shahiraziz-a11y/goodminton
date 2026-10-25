import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import type { Leaderboard as Data, MyGroup } from '@/lib/types'
import { Leaderboard } from './Leaderboard'

export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { supabase, user } = await getUser()
  if (!user) redirect('/')
  const { group } = await searchParams
  const [{ data }, { data: groups }] = await Promise.all([
    supabase.rpc('get_leaderboard', group ? { p_group: group } : {}), supabase.rpc('my_groups')])
  return <Leaderboard meId={user.id} meName={user.name} data={(data ?? { games: [], people: {} }) as Data} groups={(groups ?? []) as MyGroup[]} />
}
