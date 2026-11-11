import type { HomeMatch } from './types.ts'

/** Made-up people and matches shown to someone not in a group yet. Never stored or sent. */
export const SAMPLE_PEOPLE = { alex: 'Alex', sam: 'Sam', priya: 'Priya', jordan: 'Jordan', maya: 'Maya', leo: 'Leo' } as const

// Dubai time (UTC+4), whatever the phone or server is set to.
const at = (days: number, hour: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(hour - 4, 0, 0, 0); return d.toISOString() }
const base = { venue: 'Example Sports Hall', size: 4 as const, timezone: 'Asia/Dubai', format: 'doubles' as const, court_count: 1, duration_min: 90,
  locked: false, waitlist_count: 0, courts: null, weekly: false, group_id: null, group_name: null, my_role: 'confirmed' as const }

export const sampleMatches = (): { upcoming: HomeMatch; played: HomeMatch } => ({
  upcoming: { ...base, slug: 'sample-upcoming', title: 'Weekly Doubles', starts_at: at(3, 20), status: 'booked', booked_courts: 1,
    started: false, past: false, confirmed_count: 3, games_count: 0, last_winners: null },
  played: { ...base, slug: 'sample-played', title: 'Weekend Smash', starts_at: at(-4, 9), status: 'booked', booked_courts: 1,
    started: true, past: true, confirmed_count: 4, games_count: 6, last_winners: 'Alex & Sam' },
})

export const SAMPLE_PAIRS = [
  { a: 'Alex', b: 'Sam', w: 5, l: 1 },
  { a: 'Priya', b: 'Jordan', w: 3, l: 3 },
  { a: 'Maya', b: 'Leo', w: 1, l: 5 },
]

export const SAMPLE_GAMES = [
  { a: 'Alex & Sam', b: 'Priya & Jordan', score: '21–17', aWon: true },
  { a: 'Maya & Leo', b: 'Alex & Sam', score: '19–21', aWon: false },
]
