# Goodminton

Badminton matches of 4 or 8, never in between. The organiser creates a match and shares one link in WhatsApp. Friends sign in with Google and tap to join. The first 4 are confirmed and everyone after that goes on a waitlist. When 4 are waiting, the organiser can book a second court and all of them are confirmed. The app also splits the costs and keeps track of who owes whom.

Built from the Claude Design handoff (`../project/Courtside Light.dc.html`; the design used the working name Courtside). It uses Next.js 16 (App Router) and Supabase (Google auth and Postgres).

## What's in this first build

- **Plan a match, book later:** create a plan with singles or doubles on 1–4 courts, date, time, duration and RSVP close; the venue is optional. Once enough people are in, the organiser taps **Court booked** and adds the venue, court numbers, parking and cost per court. When more courts were planned than people turned up, book only the courts you can fill (e.g. 1 of 2 with 5 signed up): the first players are confirmed, the unbooked court is dropped, and the rest go to the front of the waitlist. **Open another court** brings it back once enough are waiting. The court cost (per court × booked courts) then joins the split, and confirmed players are locked in: only the organiser can remove someone. Anyone removed after booking **still owes their share while their spot stays empty**. When someone takes the spot (waitlist, a new join, or an added player), the debt clears; the organiser can also tap Waive.
- **Edit a match:** the organiser can change the name, singles or doubles, courts, date, time, duration and RSVP close, plus booking details and cost. With fewer spots, the latest joiners (never the organiser) move to the front of the waitlist; with more, the waitlist moves up.
- **Organiser overrides:** remove any player, even after booking (the next on the waitlist moves up). Add players from your circle, or add a **guest** by name only, for friends without a Google login.
- **Leaderboard:** a podium, standings (wins, losses, win %, streak), best pairs and recent games.
- **Log a result:** tap the pair that won. From the home **+** button you pick any 4 players you've played with, guests included. From a match, each full court has Shuffle, Balance (pairs by win rate) and Log result. Whoever logged a result can remove it.
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
- **Push alerts:**
  - For players: moved up from the waitlist, court booked, another court added, time changed, added or removed by the organiser, moved to the waitlist.
  - For the organiser: someone joined or dropped out, match full.
  - People turn alerts on from a card on Home or on the match page. On iPhone this only works after adding the app to the Home Screen (iOS 16.4+), which is Apple's rule. Guests have no login, so they never get alerts.
- **Installable (PWA):** it opens full screen from a home-screen icon.
  - The home screen shows an "Add to Home Screen" card: a one-tap Install on Android and Chrome, and Share-sheet steps on iPhone. It disappears once installed or dismissed.
  - A service worker caches only static files and shows an offline page when there's no signal. Match data is always fetched live.

Not built yet (they're in the design): the "Still in?" check-in, weekly repeat, regulars first, and late-drop tags.

## Setup

1. **Supabase project:** create one at supabase.com.
2. **Database:** run each file in `supabase/migrations/` in order (`0001_…` to `0006_…`), either in the SQL editor or with `supabase db push`. When upgrading an existing project, run only the files you haven't run yet, and run them **before** deploying the new code.
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

## Push alerts setup

Alerts are written to `public.notifications` by database triggers. A Supabase Database Webhook sends each new row to `/api/push`, which delivers it to the person's devices.

1. **Keys:** generate VAPID keys (`npx web-push generate-vapid-keys`) and a random webhook secret.
2. **Vercel environment variables** (Production), then redeploy:
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: the public key.
   - `VAPID_PRIVATE_KEY`: the private key.
   - `VAPID_SUBJECT`: `mailto:` plus your email address.
   - `SUPABASE_SERVICE_ROLE_KEY`: from Supabase → Project Settings → API keys. **Server only; never prefix it with `NEXT_PUBLIC_`.**
   - `PUSH_WEBHOOK_SECRET`: the random secret.
3. **Supabase webhook:** go to Database → Webhooks → Create a new hook and set:
   - Table `notifications`, event **Insert**, type **HTTP Request**, method **POST**.
   - URL `https://<your-domain>/api/push`.
   - Header `x-push-secret` with the same secret value.

## Tests

```bash
npm test                                    # cost split and formatting (node:test)
npm run test:db -- -h localhost -U postgres # SQL: join order, privacy per role, locking, alerts,
                                            # second court, settlements, permissions, and
                                            # 20 simultaneous joins on the last spots
```

The SQL tests need a local Postgres 15+ and stub Supabase's `auth` schema (`supabase/tests/auth_stub.sql`).

## How it fits together

- `supabase/migrations/`: tables plus `SECURITY DEFINER` functions. The tables are closed to clients, and every read and write goes through a function.
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
