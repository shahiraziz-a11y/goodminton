#!/usr/bin/env bash
# 20 friends tap "join" on a 4-player match at the same moment.
# Expect exactly 4 confirmed (organiser + 3) and 17 on the waitlist.
set -euo pipefail
PSQL=(psql -X -q -v ON_ERROR_STOP=1 "$@")

"${PSQL[@]}" <<'SQL'
insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), 'rush' || i || '@gmail.com', jsonb_build_object('full_name', 'Rush ' || i)
from generate_series(0, 20) i;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'rush0@gmail.com'), false);
set role authenticated;
select public.create_match('Rush hour', 4, 'Hall', 'Court 1', '', (now() + interval '2 days')::date, '20:00', 'UTC', 60, 2, 0);
SQL

MID=$("${PSQL[@]}" -At -c "select id from public.matches where title = 'Rush hour'")
for i in $(seq 1 20); do
  "${PSQL[@]}" -At -c "
    select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'rush$i@gmail.com'), false);
    set role authenticated;
    select pg_sleep(0.2);
    select public.join_match('$MID');" >/dev/null &
done
wait

RESULT=$("${PSQL[@]}" -At -c "
  select count(*) filter (where status = 'confirmed') || ' ' || count(*) filter (where status = 'waitlist')
  from public.match_players where match_id = '$MID'")
echo "confirmed/waitlist: $RESULT"
# Organiser + 20 joiners = 4 confirmed, 17 waiting.
[ "$RESULT" = "4 17" ] || { echo "FAILED: expected '4 17'"; exit 1; }
echo "CONCURRENCY CHECK PASSED"
