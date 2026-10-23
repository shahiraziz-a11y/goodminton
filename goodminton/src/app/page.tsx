import { getUser } from '@/lib/supabase/server'
import type { HomeMatch, HomeStats, LedgerMatch } from '@/lib/types'
import { Home, SignIn } from './Home'

export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; reason?: string }> }) {
  const { supabase, user } = await getUser()
  if (!user) {
    const q = await searchParams
    return <SignIn failed={q.error === 'signin'} reason={q.reason} />
  }
  const [{ data: matches }, { data: ledger }, { data: stats }] = await Promise.all([supabase.rpc('my_matches'), supabase.rpc('my_ledger'), supabase.rpc('my_stats')])
  return <Home meId={user.id} meName={user.name} matches={(matches ?? []) as HomeMatch[]} ledger={(ledger ?? []) as LedgerMatch[]} stats={(stats ?? null) as HomeStats | null} />
}
