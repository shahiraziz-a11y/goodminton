export type Format = 'singles' | 'doubles'
export const perCourt = (f: Format) => (f === 'singles' ? 2 : 4)

export type Role = 'anon' | 'outsider' | 'organiser' | 'confirmed' | 'waitlist'

export type VisiblePlayer = { id: string; full_name: string; promoted: boolean; joined_at: string; is_guest?: boolean; court: number; extra?: boolean }
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
  /** status: my place on the player list (an organiser may not be playing). */
  viewer: { id: string | null; role: Role; wait_pos: number | null; full_name: string | null; status?: 'confirmed' | 'waitlist' | null }
  confirmed_count: number
  waitlist_count: number
  players: MatchPlayer[]
  waitlist: { id: string; full_name: string; is_guest?: boolean }[] | null
  /** Removed after the court was booked; still in the cost split until waived. */
  liable: { id: string; full_name: string }[] | null
  /** Everyone who shares the costs: confirmed players plus liable ones. */
  split_ids: string[] | null
  court_info: CourtInfo[]
  /** Part of a weekly series (this week or a later one exists). */
  repeat_weekly: boolean
  /** This match will make next week's when it starts. */
  repeats: boolean
  /** Old "regulars first" fields: always off since migration 0016. */
  regulars_first: boolean
  regulars_until: string | null
  is_regular: boolean
  /** Games logged in this match, newest first. */
  games: MatchGame[]
  /** The group this match belongs to; joining the match also joins the group. */
  group: { id: string; name: string } | null
  is_member: boolean
  /** The game plan (players only): one entry per game, by round then court. */
  plan?: PlanEntry[] | null
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
  weekly: boolean
  group_id: string | null
  group_name: string | null
  /** My place in it; null when I'm not in it (every match is listed). */
  my_role: 'organiser' | 'confirmed' | 'waitlist' | null
  /** First names of the winners of the latest game logged in this match. */
  last_winners: string | null
}

/** Home stats from my_stats: weeks in a row with a game (Dubai weeks, Monday start) and lifetime totals. */
export type HomeStats = { week_streak: number; played_this_week: boolean; matches_played: number; games_played: number }

export type LedgerMatch = {
  id: string
  group_id?: string | null
  group_name?: string | null
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
  score_a?: number | null
  score_b?: number | null
}

export type MatchGame = {
  id: string
  created_by: string
  winner: 'a' | 'b'
  score_a: number | null
  score_b: number | null
  a: { id: string; full_name: string }[]
  b: { id: string; full_name: string }[]
}

export type Leaderboard = { games: Game[]; people: Record<string, string>; group?: { id: string; name: string } | null }

/** From my_groups: newest activity first. */
export type MyGroup = { id: string; name: string; my_role: 'owner' | 'member'; members: number; last_match: string | null }
export type GroupMember = { id: string; full_name: string; is_guest: boolean; role: 'owner' | 'member' }
export type GroupDetail = { id: string; name: string; invite_code: string; owner_id: string; my_role: 'owner' | 'member'; members: GroupMember[] }
export type GroupPreview = { id: string; name: string; owner: string; members: number; is_member: boolean }

export type PlanEntry = {
  id: string
  round: number
  court: number
  game_id: string | null
  a: { id: string; full_name: string }[]
  b: { id: string; full_name: string }[]
  winner: 'a' | 'b' | null
  score_a: number | null
  score_b: number | null
}
