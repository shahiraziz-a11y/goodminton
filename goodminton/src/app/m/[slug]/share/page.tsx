import { notFound, redirect } from 'next/navigation'
import { createClient, siteOrigin } from '@/lib/supabase/server'
import type { MatchView } from '@/lib/types'
import { ShareScreen } from './ShareScreen'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_match', { p_slug: slug })
  if (!data) notFound()
  const m = data as MatchView
  if (m.viewer.role === 'anon') redirect(`/m/${slug}`)
  return <ShareScreen m={m} link={`${await siteOrigin()}/m/${slug}`} />
}
