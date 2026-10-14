import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { matchLabels } from '@/lib/match'
import { createClient, siteOrigin } from '@/lib/supabase/server'
import { getPublicMatch } from '@/lib/supabase/public'
import type { MatchView } from '@/lib/types'
import { MatchScreen } from './MatchScreen'

type Params = { params: Promise<{ slug: string }> }

export const dynamic = 'force-dynamic'

// What WhatsApp shows when the link is pasted.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const m = await getPublicMatch(slug)
  if (!m) return { title: 'Goodminton' }
  const L = matchLabels(m, '')
  const description = `${L.when} · ${m.venue || 'Venue TBC'}`
  return {
    title: `${m.title} · ${L.spotsLine}`,
    description,
    openGraph: { title: `${m.title} · ${L.spotsLine}`, description, siteName: 'Goodminton', type: 'website' },
  }
}

export default async function Page({ params }: Params) {
  const { slug } = await params
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_match', { p_slug: slug })
  if (!data) notFound()
  const m = data as MatchView
  // Decided on the server so the first render matches; the screen refreshes itself while open.
  const started = Date.now() >= new Date(m.starts_at).getTime()
  return <MatchScreen m={m} link={`${await siteOrigin()}/m/${slug}`} started={started} />
}
