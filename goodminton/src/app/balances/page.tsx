import { redirect } from 'next/navigation'
import { getUser, siteOrigin } from '@/lib/supabase/server'
import type { LedgerMatch } from '@/lib/types'
import { Balances } from './Balances'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const { supabase, user } = await getUser()
  if (!user) redirect('/')
  const [{ data: ledger }, { data: profile }] = await Promise.all([
    supabase.rpc('my_ledger'),
    supabase.from('profiles').select('full_name').eq('id', user.id).single(),
  ])
  return <Balances meId={user.id} meName={profile?.full_name ?? ''} ledger={(ledger ?? []) as LedgerMatch[]} origin={await siteOrigin()} />
}
