import { createBrowserClient } from '@supabase/ssr'
import { SUPABASE_KEY, SUPABASE_URL } from './env'

export const createClient = () => createBrowserClient(SUPABASE_URL, SUPABASE_KEY)

/** Starts Google sign-in and comes back to `next` afterwards. */
export function signInWithGoogle(next: string) {
  return createClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
  })
}
