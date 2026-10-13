export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const SUPABASE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
/**
 * The one public address of the app, e.g. https://goodminton-bice.vercel.app.
 * Share links and link previews always use it, and other Vercel addresses redirect to it.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')
export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY ?? 'AED'
