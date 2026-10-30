import { redirect } from 'next/navigation'
import { getUser, siteOrigin } from '@/lib/supabase/server'
import type { LedgerMatch } from '@/lib/types'
import { Balances } from './Balances'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const { supabase, user } = await getUser()
  if (!user) redirect('/')
  const [{ data: ledger }, { data: groups }] = await Promise.all([supabase.rpc('my_ledger'), supabase.rpc('my_groups')])
  return <Balances meId={user.id} meName={user.name} ledger={(ledger ?? []) as LedgerMatch[]} origin={await siteOrigin()} inGroup={!!(groups as unknown[] | null)?.length} />
}
