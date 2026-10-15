export type Format = 'singles' | 'doubles'
export const perCourt = (f: Format) => (f === 'singles' ? 2 : 4)

export type Role = 'anon' | 'outsider' | 'organiser' | 'confirmed' | 'waitlist'

export type VisiblePlayer = { id: string; full_name: string; promoted: boolean; joined_at: string; is_guest?: boolean; court: number }
export type HiddenPlayer = { hidden: true; court: number }
export type MatchPlayer = VisiblePlayer | HiddenPlayer

export type Expense = { id?: string; label?: string; amount: number; paid_by: string }
export type Settlement = { from: string; to: string; amount: number }

/** One per court. Number, cost and booker are only sent to confirmed players. */
export type CourtInfo = { court: number; booked: boolean; label?: string; cost?: number; booked_by?: string; booked_by_name?: string }

/** Shape returned by the get_match RPC. Private fields are null unless the viewer may see them. */
export type MatchView = {
  id: string
  slug: string
  title: string
  size: 4 | 8
  venue: string
  format: Format
  court_count: number
  status: 'planning' | 'booked'
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
  waitlist: { id: string; full_name: string; is_guest?: boolean }[] | null
  /** Removed after the court was booked; still in the cost split until waived. */
  liable: { id: string; full_name: string }[] | null
  /** Everyone who shares the costs: confirmed players plus liable ones. */
  split_ids: string[] | null
  court_info: CourtInfo[]
  /** True once a court is booked with a cost: only then are costs split. */
  split_ready: boolean
  /** Guest (no login) → who pays their share. */
  billed_to: Record<string, string> | null
  /** Player → who added them (when someone else did). */
  added_by: Record<string, string>
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
  format: Format
  court_count: number
  status: 'planning' | 'booked'
  duration_min: number
  started: boolean
  past: boolean
  locked: boolean
  confirmed_count: number
  waitlist_count: number
  /** Court numbers, for confirmed players only. */
  courts: string | null
  games_count: number
  booked_courts: number
  /** My place in it; null when I'm not in it (every match is listed). */
  my_role: 'organiser' | 'confirmed' | 'waitlist' | null
  /** First names of the winners of the latest game logged in this match. */
  last_winners: string | null
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

export type PlayerOption = { id: string; full_name: string; is_guest: boolean }

export type Game = {
  id: string
  played_on: string
  match_title: string | null
  created_by: string
  /** 1 player (singles) or 2 (doubles) per side. */
  a: string[]
  b: string[]
  winner: 'a' | 'b'
}

export type Leaderboard = { games: Game[]; people: Record<string, string> }
