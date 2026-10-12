# Goodminton

Badminton matches of 4 or 8, never in between. The organiser creates a match and shares one link in WhatsApp. Friends sign in with Google and tap to join. The first 4 are confirmed and everyone after that goes on a waitlist. When 4 are waiting, the organiser can book a second court and all of them are confirmed. The app also splits the costs and keeps track of who owes whom.

Built from the Claude Design handoff (`../project/Courtside Light.dc.html`; the design used the working name Courtside). It uses Next.js 16 (App Router) and Supabase (Google auth and Postgres).

## What's in this first build

- **Create a match:** 4 or 8 players, venue, court numbers, parking notes, date and time, duration, cost per court, and when RSVPs close.
- **Share:** a WhatsApp preview, Copy, and Share to WhatsApp. The link shows a rich preview card in chats.
- **Join with Google:** the first in are confirmed and the rest go on the waitlist. When a confirmed player drops out, the first person waiting is promoted automatically.
- **Privacy:** these rules are enforced in the database, not the browser.
  - The court number, parking and costs are visible to confirmed players only.
  - Player names are visible while spots are open. Once the match is full, the waitlist and outsiders see blank dots.
  - Only the organiser sees waitlist names.
- **Auto-lock:** sign-ups close by themselves at the chosen time before start. The organiser can also lock now or reopen.
- **Second court:** with 4 waiting, "I've booked court 2" moves the match to 8 players and adds the second court's cost to the split.
- **Cost split:** anyone confirmed can add expenses. The app works out who pays whom, and each payment can be marked paid. Nudge opens WhatsApp with a reminder.
- **Balances:** your total across all matches, a balance per friend, and the payment history.
- **For confirmed players:** Directions (Google Maps) and Add to calendar (an `.ics` file).
- **Installable (PWA):** it opens full screen from a home-screen icon.
  - The home screen shows an "Add to Home Screen" card: a one-tap Install on Android and Chrome, and Share-sheet steps on iPhone. It disappears once installed or dismissed.
  - A service worker caches only static files and shows an offline page when there's no signal. Match data is always fetched live.

Not built yet (they're in the design): the leaderboard and result logging, the "Still in?" check-in, weekly repeat, regulars first, and late-drop tags.

## Setup

1. **Supabase project:** create one at supabase.com.
2. **Database:** run `supabase/migrations/0001_init.sql`, either in the SQL editor or with `supabase db push`.
3. **Google sign-in:**
   - In Google Cloud Console, create an OAuth client of type "Web application".
   - Add the authorised redirect URI `https://<your-project>.supabase.co/auth/v1/callback`.
   - In Supabase, go to Authentication → Sign In / Providers → Google, turn it on, and paste in the client ID and secret.
4. **Redirect URLs:** in Supabase, go to Authentication → URL Configuration.
   - Set **Site URL** to your deployed URL.
   - Add `https://<your-domain>/auth/callback` and `http://localhost:3000/auth/callback` to the redirect URLs.
5. **Environment:** `cp .env.example .env.local` and fill in the project URL and the anon (publishable) key.
6. **Run it:** `npm install && npm run dev`.

Deploying on Vercel: set the project root to `goodminton/` and add the same environment variables.

## Tests

```bash
npm test                                    # cost split and formatting (node:test)
npm run test:db -- -h localhost -U postgres # SQL: join order, privacy per role, locking,
                                            # second court, settlements, permissions, and
                                            # 20 simultaneous joins on the last spots
```

The SQL tests need a local Postgres 15+ and stub Supabase's `auth` schema (`supabase/tests/auth_stub.sql`).

## How it fits together

- `supabase/migrations/0001_init.sql`: tables plus `SECURITY DEFINER` functions. The tables are closed to clients, and every read and write goes through a function.
  - Reads: `get_match`, `my_matches`, `my_ledger`.
  - Writes: `create_match`, `join_match`, `leave_match`, `set_lock`, `upgrade_match`, `add_expense`, `set_settled`.
  - `get_match` shapes the response for each viewer, so hidden data never leaves the database.
  - Each write locks the match row first, so two people can't both take the last spot.
- `src/lib/split.ts`: the cost split. The same function serves the match page and the balances page.
- `src/app/m/[slug]`: the match page (invite landing when signed out), its WhatsApp preview image, and the share screen.
- `src/proxy.ts`: keeps the Supabase session cookie fresh. Next 16 renamed `middleware` to `proxy`.

## Known limits

- No push or email alerts yet. Waitlisted players see their new status when they open the link (the page refreshes every 20 s while open).
- Pay, Settle and Mark paid only record a payment. No money moves.
- WhatsApp caches link previews, so the "spots left" in an old preview can be out of date.
- **Installed app on iPhone:** test Google sign-in from the home-screen app early. iOS runs home-screen apps with their own cookie storage, separate from Safari. Google sign-in leaves the app and comes back, so check it on a real phone after deploying.
- Organisers can't edit or cancel a match, or delete an expense, from the app yet.
