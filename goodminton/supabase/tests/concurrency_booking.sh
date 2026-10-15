#!/usr/bin/env bash
# Five people tap "Book court 2" at the same moment. Exactly one booking (and one
# charge) must survive; the others get "Only X or the organiser can change this booking".
# Then 6 people join at once: the 2 open spots go to the booked court first, 4 wait.
set -euo pipefail
PSQL=(psql -X -q -v ON_ERROR_STOP=1 "$@")

"${PSQL[@]}" <<'SQL'
insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'race' || i || '@gmail.com', jsonb_build_object('full_name', 'Race ' || i)
from generate_series(0, 12) i;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'race0@gmail.com'), false);
set role authenticated;
select public.create_match('Race to book', 'doubles', 2, '', (now() + interval '2 days')::date, '20:00', 'UTC', 60, 2);
SQL
MID=$("${PSQL[@]}" -At -c "select id from public.matches where title = 'Race to book'")
# race1..race5 join: court 1 = race0..race3, court 2 = race4, race5.
for i in 1 2 3 4 5; do
  "${PSQL[@]}" -At -c "select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'race$i@gmail.com'), false);
    set role authenticated; select public.join_match('$MID');" >/dev/null
done

for i in 0 1 2 4 5; do
  ( "${PSQL[@]}" -At -c "
      select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'race$i@gmail.com'), false);
      set role authenticated;
      select pg_sleep(0.2);
      select public.book_court('$MID', 2, 'Hall', 'Court ' || $i, '', 100);" >/dev/null 2>&1 || true ) &
done
wait
# The organiser (race0) may edit; everyone else after the winner is refused.
ROWS=$("${PSQL[@]}" -At -c "select count(*) || ' ' || (select count(*) from public.expenses where match_id = '$MID' and kind = 'court')
  from public.match_courts where match_id = '$MID'")
echo "booking rows/expenses: $ROWS"
[ "$ROWS" = "1 1" ] || { echo "FAILED: expected one booking and one charge"; exit 1; }

for i in 6 7 8 9 10 11; do
  "${PSQL[@]}" -At -c "
    select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'race$i@gmail.com'), false);
    set role authenticated;
    select pg_sleep(0.2);
    select public.join_match('$MID');" >/dev/null &
done
wait
RESULT=$("${PSQL[@]}" -At -c "
  select count(*) filter (where court = 1) || ' ' || count(*) filter (where court = 2) || ' ' || count(*) filter (where status = 'waitlist')
  from public.match_players where match_id = '$MID'")
echo "court1/court2/waitlist: $RESULT"
[ "$RESULT" = "4 4 4" ] || { echo "FAILED: expected '4 4 4'"; exit 1; }
echo "BOOKING CONCURRENCY CHECK PASSED"
