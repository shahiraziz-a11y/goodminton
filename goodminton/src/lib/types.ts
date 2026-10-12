export type Role = 'anon' | 'outsider' | 'organiser' | 'confirmed' | 'waitlist'

export type VisiblePlayer = { id: string; full_name: string; promoted: boolean; joined_at: string }
export type HiddenPlayer = { hidden: true }
export type MatchPlayer = VisiblePlayer | HiddenPlayer

export type Expense = { id?: string; label?: string; amount: number; paid_by: string }
export type Settlement = { from: string; to: string; amount: number }

/** Shape returned by the get_match RPC. Private fields are null unless the viewer may see them. */
export type MatchView = {
  id: string
  slug: string
  title: string
  size: 4 | 8
  venue: string
  starts_at: string
  duration_min: number
  rsvp_close_hours: number
  court_cost: number
  currency: string
  timezone: string
  lock_state: 'auto' | 'locked' | 'open'
  locked: boolean
  past: boolean
  created_at: string
  courts: string | null
  parking: string | null
  organiser: { id: string; full_name: string }
  viewer: { id: string | null; role: Role; wait_pos: number | null; full_name: string | null }
  confirmed_count: number
  waitlist_count: number
  players: MatchPlayer[]
  waitlist: { id: string; full_name: string }[] | null
  expenses: Expense[] | null
  settlements: Settlement[] | null
  people: Record<string, string> | null
}

export type HomeMatch = {
  slug: string
  title: string
  venue: string
  size: 4 | 8
  starts_at: string
  timezone: string
  past: boolean
  locked: boolean
  confirmed_count: number
  waitlist_count: number
}

export type LedgerMatch = {
  id: string
  slug: string
  title: string
  starts_at: string
  timezone: string
  currency: string
  players: string[]
  expenses: Expense[]
  settlements: Settlement[]
  people: Record<string, string>
}

export const isVisible = (p: MatchPlayer): p is VisiblePlayer => !('hidden' in p)
