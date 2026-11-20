import { redirect } from 'next/navigation'
import { getUser, siteOrigin } from '@/lib/supabase/server'
import type { LedgerMatch } from '@/lib/types'
import { PersonBalance } from './PersonBalance'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, user } = await getUser()
  if (!user) redirect('/')
  const { data } = await supabase.rpc('my_ledger')
  return <PersonBalance meId={user.id} meName={user.name} other={id} ledger={(data ?? []) as LedgerMatch[]} origin={await siteOrigin()} />
}
