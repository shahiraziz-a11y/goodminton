import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import type { MyGroup } from '@/lib/types'
import { CreateMatch } from './CreateMatch'

export default async function Page({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { supabase, user } = await getUser()
  if (!user) redirect('/')
  const [{ group }, { data }] = await Promise.all([searchParams, supabase.rpc('my_groups')])
  return <CreateMatch groups={(data ?? []) as MyGroup[]} initialGroup={group} />
}
