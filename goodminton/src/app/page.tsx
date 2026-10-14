import { getUser } from '@/lib/supabase/server'
import type { HomeMatch, LedgerMatch } from '@/lib/types'
import { Home, SignIn } from './Home'

export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; reason?: string }> }) {
  const { supabase, user } = await getUser()
  if (!user) {
    const q = await searchParams
    return <SignIn failed={q.error === 'signin'} reason={q.reason} />
  }
  const [{ data: matches }, { data: ledger }] = await Promise.all([supabase.rpc('my_matches'), supabase.rpc('my_ledger')])
  return <Home meId={user.id} meName={user.name} matches={(matches ?? []) as HomeMatch[]} ledger={(ledger ?? []) as LedgerMatch[]} />
}
