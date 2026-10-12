import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { CreateMatch } from './CreateMatch'

export default async function Page() {
  const { user } = await getUser()
  if (!user) redirect('/')
  return <CreateMatch />
}
