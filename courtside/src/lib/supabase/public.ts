import { createClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './env'
import type { MatchView } from '../types'

/** The match as a signed-out stranger sees it. Used for link previews, so nothing private leaks. */
export async function getPublicMatch(slug: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  const { data } = await supabase.rpc('get_match', { p_slug: slug })
  return data as MatchView | null
}
