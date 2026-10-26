-- Booking courts one at a time: edge cases. Locking, who pays, permissions,
-- double booking, alerts, privacy, edits, singles, cancelling and balances.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@more.test'), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.fails(sql text) returns text language plpgsql as $$
begin
  execute sql;
  raise exception 'FAILED: expected error from %', sql;
exception when others then
  if sqlerrm like 'FAILED:%' then raise; end if;
  return sqlerrm;
end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$
  select id from public.profiles where email = u || '@more.test';
$$;
create function pg_temp.mid(title text) returns uuid language sql security definer as $$
  select id from public.matches where matches.title = $1;
$$;
create function pg_temp.slug(title text) returns text language sql security definer as $$
  select slug from public.matches where matches.title = $1;
$$;
-- "1:org,a,b,c | 2:d,e" (first names, by court then seat), waitlist as "w:…".
create function pg_temp.layout(title text) returns text language sql security definer as $$
  select string_agg(k || ':' || names, ' | ' order by k) from (
    select coalesce(mp.court::text, 'w') as k, string_agg(split_part(p.email, '@', 1), ',' order by mp.seq) as names
      from public.match_players mp join public.profiles p on p.id = mp.user_id join public.matches m on m.id = mp.match_id
     where m.title = $1 group by 1) x;
$$;
create function pg_temp.split(title text) returns text language sql security definer as $$
  select coalesce(string_agg(split_part(p.email, '@', 1), ',' order by x.ord), '')
    from public.matches m, unnest(public.split_ids(m.id)) with ordinality x(id, ord) join public.profiles p on p.id = x.id
   where m.title = $1;
$$;
-- "1:d:100 | 2:e:80" court expenses: court, payer, amount.
create function pg_temp.court_costs(title text) returns text language sql security definer as $$
  select coalesce(string_agg(e.court || ':' || split_part(p.email, '@', 1) || ':' || trim_scale(e.amount), ' | ' order by e.court), '')
    from public.expenses e join public.profiles p on p.id = e.paid_by join public.matches m on m.id = e.match_id
   where m.title = $1 and e.kind = 'court';
$$;
create function pg_temp.alerts(u text) returns text language sql security definer as $$
  select coalesce(string_agg(n.kind, ',' order by n.created_at, n.kind), '')
    from public.notifications n where n.user_id = (select id from public.profiles where email = u || '@more.test');
$$;
create function pg_temp.liable(title text) returns text language sql security definer as $$
  select coalesce(string_agg(split_part(p.email, '@', 1), ',' order by l.created_at), '')
    from public.match_liable l join public.profiles p on p.id = l.user_id join public.matches m on m.id = l.match_id
   where m.title = $1 and l.user_id = any (public.share_holders(m.id));
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@more.test', jsonb_build_object('full_name', initcap(n) || ' Test')
from unnest(array['org','a','b','c','d','e','f','g','h','i','j','out']) n;
-- Everyone has a device, so alerts are queued.
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select id, 'https://push.example/' || id, 'k', 'a' from public.profiles where email like '%@more.test';

set role authenticated;

-- ===========================================================================
-- A. Booking one court locks only that court. Any player can book any court.
-- ===========================================================================
select pg_temp.as_user('org');
select public.create_match('A', 'doubles', 2, '', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('A')) from unnest(array['a','b','c','d','e']) u;
select pg_temp.check(pg_temp.layout('A') = '1:org,a,b,c | 2:d,e', 'A: courts fill in join order');

-- Dan (on court 2) books court 1. He pays for it.
reset role; delete from public.notifications; set role authenticated;
select pg_temp.as_user('d');
select public.book_court(pg_temp.mid('A'), 1, 'Hall', 'Court 3', 'Gate B', 100) ->> 'new' as n \gset
select pg_temp.check(:'n' = 'true', 'A: first booking is new');
select pg_temp.check(pg_temp.court_costs('A') = '1:d:100', 'A: Dan pays court 1');
select pg_temp.check(pg_temp.split('A') = 'org,a,b,c', 'A: only court 1 shares court 1');

-- Alerts: court 1's players and the organiser hear; Dan (who booked) and Eve (court 2) don't.
select pg_temp.check(pg_temp.alerts('a') = 'booked' and pg_temp.alerts('c') = 'booked', 'A: court 1 told');
select pg_temp.check(pg_temp.alerts('org') = 'booked', 'A: organiser told');
select pg_temp.check(pg_temp.alerts('d') = '' and pg_temp.alerts('e') = '', 'A: booker and court 2 not told');
reset role;
select pg_temp.check((select title from public.notifications where user_id = pg_temp.uid('org')) = 'D booked a court', 'A: organiser told who booked');
select pg_temp.check((select body from public.notifications where user_id = pg_temp.uid('a')) like '%· Hall · Court 3', 'A: alert names venue and court');
set role authenticated;

-- Court 1 locked, court 2 free.
select pg_temp.as_user('a');
select pg_temp.check(pg_temp.fails(format('select public.leave_match(%L)', pg_temp.mid('A'))) like '%locked in%', 'A: court 1 locked');
select pg_temp.as_user('e'); select public.leave_match(pg_temp.mid('A'));
select pg_temp.as_user('e'); select public.join_match(pg_temp.mid('A'));

-- Dan drops out of court 2 after booking court 1: he's still owed for court 1.
select pg_temp.as_user('d'); select public.leave_match(pg_temp.mid('A'));
select pg_temp.check(pg_temp.court_costs('A') = '1:d:100' and pg_temp.split('A') = 'org,a,b,c', 'A: booking stays with Dan');
-- Balances appear once sign-ups close (locked here for the check, then reopened).
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.my_ledger()) x where x ->> 'id' = pg_temp.mid('A')::text), 'A: nothing owed before sign-ups close');
reset role; update public.matches set lock_state = 'locked' where id = pg_temp.mid('A'); set role authenticated;
select public.my_ledger() as l \gset
select pg_temp.check(exists (select 1 from jsonb_array_elements(:'l'::jsonb) x where x ->> 'id' = pg_temp.mid('A')::text), 'A: Dan still sees what he''s owed');
select pg_temp.as_user('e');
select public.my_ledger() as l \gset
select pg_temp.check(not exists (select 1 from jsonb_array_elements(:'l'::jsonb) x where x ->> 'id' = pg_temp.mid('A')::text), 'A: court 2 player owes nothing yet');
select pg_temp.as_user('a');
select public.my_ledger() as l \gset
select pg_temp.check(exists (select 1 from jsonb_array_elements(:'l'::jsonb) x where x ->> 'id' = pg_temp.mid('A')::text), 'A: court 1 player owes');
reset role; update public.matches set lock_state = 'auto' where id = pg_temp.mid('A'); set role authenticated;

-- ===========================================================================
-- B. Double booking, editing and cancelling: only the booker or the organiser.
-- ===========================================================================
select pg_temp.as_user(u), public.join_match(pg_temp.mid('A')) from unnest(array['f','g']) u;
select pg_temp.check(pg_temp.layout('A') = '1:org,a,b,c | 2:e,f,g', 'B: court 2 has three');
select pg_temp.as_user('e'); select public.book_court(pg_temp.mid('A'), 2, 'Hall', 'Court 4', '', 80);
-- Fay books the same court a moment later: refused, names who has it.
select pg_temp.as_user('f');
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 2, %L, %L, %L, 90)', pg_temp.mid('A'), 'Hall', 'Court 9', '')) like '%Only E or the organiser%', 'B: no double booking');
select pg_temp.check(pg_temp.fails(format('select public.cancel_court(%L, 2)', pg_temp.mid('A'))) like '%Only E or the organiser%', 'B: others cannot cancel');
select pg_temp.check(pg_temp.court_costs('A') = '1:d:100 | 2:e:80', 'B: each booker pays their court');
select pg_temp.check(pg_temp.split('A') = 'org,a,b,c,e,f,g', 'B: seven share both courts');

-- The booker edits their own booking; the organiser edits anyone's. The payer never changes.
select pg_temp.as_user('e');
select public.book_court(pg_temp.mid('A'), 2, 'Hall', 'Court 5', '', 85) ->> 'new' as n \gset
select pg_temp.check(:'n' = 'false', 'B: second save is an edit');
select pg_temp.as_user('org'); select public.book_court(pg_temp.mid('A'), 1, 'Hall', 'Court 3', 'Gate B', 120);
select pg_temp.check(pg_temp.court_costs('A') = '1:d:120 | 2:e:85', 'B: edits keep the payer');
reset role;
select pg_temp.check((select courts from public.matches where id = pg_temp.mid('A')) = 'Court 3 & Court 5', 'B: court numbers updated');
set role authenticated;

-- Organiser cancels Eve's booking: court 2 unlocked, cost gone. Gus re-books and becomes the payer.
select pg_temp.as_user('org'); select public.cancel_court(pg_temp.mid('A'), 2);
select pg_temp.check(pg_temp.court_costs('A') = '1:d:120' and pg_temp.split('A') = 'org,a,b,c', 'B: cancel drops court 2 cost');
select pg_temp.as_user('org');
select pg_temp.check(pg_temp.fails(format('select public.cancel_court(%L, 2)', pg_temp.mid('A'))) like '%isn''t booked%', 'B: nothing to cancel');
select pg_temp.as_user('g'); select public.book_court(pg_temp.mid('A'), 2, 'Hall', 'Court 5', '', 85);
select pg_temp.check(pg_temp.court_costs('A') = '1:d:120 | 2:g:85', 'B: re-booking changes the payer');

-- Re-booking re-alerts court 2 (Eve and Fay), not court 1.
reset role; delete from public.notifications; set role authenticated;
select pg_temp.as_user('g'); select public.cancel_court(pg_temp.mid('A'), 2);
select pg_temp.as_user('g'); select public.book_court(pg_temp.mid('A'), 2, 'Hall', 'Court 5', '', 85);
select pg_temp.check(pg_temp.alerts('e') = 'booked' and pg_temp.alerts('f') = 'booked' and pg_temp.alerts('a') = '', 'B: only court 2 alerted');

-- ===========================================================================
-- C. Who may book, and input checks.
-- ===========================================================================
select pg_temp.as_user('out');
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 1, %L, %L, %L, 1)', pg_temp.mid('A'), 'H', 'C', '')) like '%Only players%', 'C: outsider cannot book');
select pg_temp.check(pg_temp.fails(format('select public.cancel_court(%L, 1)', pg_temp.mid('A'))) like '%Only D or the organiser%', 'C: outsider cannot cancel');
select pg_temp.as_user('org');
select public.create_match('C', 'doubles', 2, '', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('C')) from unnest(array['a','b','c','d','e','f','g','h','i']) u;
select pg_temp.check(pg_temp.layout('C') = '1:org,a,b,c | 2:d,e,f,g | w:h,i', 'C: full with a waitlist');
select pg_temp.as_user('h');
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 1, %L, %L, %L, 1)', pg_temp.mid('C'), 'H', 'C', '')) like '%Only players%', 'C: waitlist cannot book');
select pg_temp.as_user('a');
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 0, %L, %L, %L, 1)', pg_temp.mid('C'), 'H', 'C', '')) like '%isn''t part%', 'C: court 0');
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 3, %L, %L, %L, 1)', pg_temp.mid('C'), 'H', 'C', '')) like '%isn''t part%', 'C: court 3 of 2');
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 1, %L, %L, %L, 1)', pg_temp.mid('C'), '  ', 'C', '')) like '%venue%', 'C: venue required');
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 1, %L, %L, %L, 1)', pg_temp.mid('C'), 'H', ' ', '')) like '%court number%', 'C: court number required');
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 1, %L, %L, %L, -5)', pg_temp.mid('C'), 'H', 'C', '')) like '%negative%', 'C: no negative cost');
select public.book_court(pg_temp.mid('C'), 1, '  Big Hall  ', repeat('x', 40), ' Gate C ', null);
reset role;
select pg_temp.check((select char_length(label) from public.match_courts where match_id = pg_temp.mid('C')) = 30, 'C: long court number trimmed');
select pg_temp.check((select venue || '/' || parking from public.matches where id = pg_temp.mid('C')) = 'Big Hall/Gate C', 'C: venue and parking saved');
set role authenticated;

-- Booked at no cost: locked in, but nothing to split yet. Adding the cost starts the split.
select pg_temp.as_user('b');
select pg_temp.check(pg_temp.fails(format('select public.leave_match(%L)', pg_temp.mid('C'))) like '%locked in%', 'C: no-cost booking still locks');
select public.get_match(pg_temp.slug('C')) ->> 'split_ready' as r \gset
select pg_temp.check(:'r' = 'false', 'C: no split at zero cost');
select pg_temp.check(pg_temp.fails(format('select public.add_expense(%L, %L, 30)', pg_temp.mid('C'), 'Shuttles')) like '%cost is entered%', 'C: no expenses at zero cost');
select pg_temp.as_user('a'); select public.book_court(pg_temp.mid('C'), 1, 'Big Hall', 'Court 1', '', 60);
select pg_temp.as_user('b');
select public.get_match(pg_temp.slug('C')) ->> 'split_ready' as r \gset
select pg_temp.check(:'r' = 'false', 'C: cost entered, but no split until sign-ups close');
reset role; update public.matches set lock_state = 'locked' where id = pg_temp.mid('C'); set role authenticated;
select public.get_match(pg_temp.slug('C')) ->> 'split_ready' as r \gset
select pg_temp.check(:'r' = 'true', 'C: split once locked');
reset role; update public.matches set lock_state = 'auto' where id = pg_temp.mid('C'); set role authenticated;
select public.add_expense(pg_temp.mid('C'), 'Shuttles', 30);

-- Spot opens on booked court 1: the first in line takes it and is locked in at once.
select pg_temp.as_user('org'); select public.remove_player(pg_temp.mid('C'), pg_temp.uid('c'));
select pg_temp.check(pg_temp.layout('C') = '1:org,a,b,h | 2:d,e,f,g | w:i', 'C: Hana promoted into court 1');
select pg_temp.check(pg_temp.liable('C') = '', 'C: replaced straight away, Cara owes nothing');
select pg_temp.as_user('h');
select pg_temp.check(pg_temp.fails(format('select public.leave_match(%L)', pg_temp.mid('C'))) like '%locked in%', 'C: promoted player locked in');
-- Removing from unbooked court 2 never leaves a debt.
select pg_temp.as_user('org'); select public.remove_player(pg_temp.mid('C'), pg_temp.uid('d'));
select pg_temp.check(pg_temp.liable('C') = '', 'C: no debt from an unbooked court');
select pg_temp.check(pg_temp.layout('C') = '1:org,a,b,h | 2:e,f,g,i', 'C: Ivy fills court 2');

-- ===========================================================================
-- D. Open spots on booked courts fill first; debts clear when they do.
-- ===========================================================================
select pg_temp.as_user('org');
select public.create_match('D', 'doubles', 2, '', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('D')) from unnest(array['a','b','c','d','e','f']) u;
select pg_temp.as_user('d'); select public.book_court(pg_temp.mid('D'), 2, 'Hall', 'Court 8', '', 100);
-- Court 1 unbooked with room; court 2 booked with room.
select pg_temp.as_user('org'); select public.remove_player(pg_temp.mid('D'), pg_temp.uid('a'));
select pg_temp.check(pg_temp.layout('D') = '1:org,b,c | 2:d,e,f', 'D: a spot on each court');
select pg_temp.as_user('g'); select public.join_match(pg_temp.mid('D'));
select pg_temp.check(pg_temp.layout('D') = '1:org,b,c | 2:d,e,f,g', 'D: joiner takes the paid-for spot');
-- Booked court 2 is full; removing Eve leaves a debt until Hal takes her spot.
select pg_temp.as_user('org'); select public.remove_player(pg_temp.mid('D'), pg_temp.uid('e'));
select pg_temp.check(pg_temp.liable('D') = 'e', 'D: Eve owes for her empty spot');
select pg_temp.check(pg_temp.split('D') = 'd,f,g,e', 'D: Eve still in the split');
-- Cancelling the only booking clears every debt.
select pg_temp.as_user('d'); select public.cancel_court(pg_temp.mid('D'), 2);
reset role;
select pg_temp.check((select status from public.matches where id = pg_temp.mid('D')) = 'planning', 'D: back to planning');
set role authenticated;
select pg_temp.check(pg_temp.liable('D') = '', 'D: no booking, no debt');

-- ===========================================================================
-- E. Privacy: court number, cost and booker only for confirmed players.
-- ===========================================================================
select pg_temp.as_user('out');
select public.get_match(pg_temp.slug('A')) as v \gset
select pg_temp.check((select bool_and(not (c ? 'label') and not (c ? 'cost') and not (c ? 'booked_by')) from jsonb_array_elements(:'v'::jsonb -> 'court_info') c)
                 and (:'v'::jsonb -> 'court_info' -> 0 ->> 'booked') = 'true', 'E: outsider sees only booked/not');
select pg_temp.check((select bool_and(x ? 'court') from jsonb_array_elements(:'v'::jsonb -> 'players') x), 'E: outsider sees which court is filling');
select pg_temp.as_user('i');
select public.get_match(pg_temp.slug('A')) as v \gset
select pg_temp.check(not ((:'v'::jsonb -> 'court_info' -> 0) ? 'label'), 'E: outsider to match A sees no court number');
reset role;
set role anon;
select pg_temp.check(not ((public.get_match(pg_temp.slug('A')) -> 'court_info' -> 0) ? 'cost'), 'E: anon sees no cost');
reset role;
set role authenticated;
select pg_temp.as_user('a');
select public.get_match(pg_temp.slug('A')) as v \gset
select pg_temp.check((:'v'::jsonb -> 'court_info' -> 0 ->> 'label') = 'Court 3' and (:'v'::jsonb -> 'court_info' -> 0 ->> 'booked_by') = pg_temp.uid('d')::text, 'E: player sees court and booker');
select pg_temp.check((:'v'::jsonb -> 'people') ? pg_temp.uid('d')::text, 'E: booker named even after dropping out');

-- ===========================================================================
-- F. Editing the match around bookings.
-- ===========================================================================
-- More courts: bookings untouched, the new court is open and unbooked.
select pg_temp.as_user('org');
select public.update_match(pg_temp.mid('A'), 'A', 'doubles', 3, (now() + interval '3 days')::date, '20:00', 90, 6);
select pg_temp.check(pg_temp.court_costs('A') = '1:d:120 | 2:g:85', 'F: adding a court keeps bookings');
reset role;
select pg_temp.check((select court_count || '/' || size || '/' || status from public.matches where id = pg_temp.mid('A')) = '3/12/booked', 'F: three courts');
set role authenticated;
-- Joiners go to court 2's open spot first (booked), then court 3.
select pg_temp.as_user(u), public.join_match(pg_temp.mid('A')) from unnest(array['h','i','j']) u;
select pg_temp.check(pg_temp.layout('A') = '1:org,a,b,c | 2:e,f,g,h | 3:i,j', 'F: booked court filled first');
-- Back to two courts: court 3's players move to the waitlist (nothing booked there).
select pg_temp.as_user('org');
select public.update_match(pg_temp.mid('A'), 'A', 'doubles', 2, (now() + interval '3 days')::date, '20:00', 90, 6) ->> 'demoted' as d \gset
select pg_temp.check(:'d' = '2' and pg_temp.layout('A') = '1:org,a,b,c | 2:e,f,g,h | w:i,j', 'F: court 3 players wait');
-- One court: court 2's booking is cancelled with its cost; its players wait, earlier joiners first.
select public.update_match(pg_temp.mid('A'), 'A', 'doubles', 1, (now() + interval '3 days')::date, '20:00', 90, 6) ->> 'demoted' as d \gset
select pg_temp.check(:'d' = '4' and pg_temp.layout('A') = '1:org,a,b,c | w:e,f,g,h,i,j', 'F: court 2 players wait in order');
select pg_temp.check(pg_temp.court_costs('A') = '1:d:120', 'F: court 2 cost gone');
-- Pairs: reorder within a court only.
select public.set_court_order(pg_temp.mid('A'), array[pg_temp.uid('org'), pg_temp.uid('c'), pg_temp.uid('a'), pg_temp.uid('b')]);
select pg_temp.check(pg_temp.layout('A') like '1:org,c,a,b%', 'F: pairs reordered on a booked court');
select public.update_match(pg_temp.mid('A'), 'A', 'doubles', 2, (now() + interval '3 days')::date, '20:00', 90, 6);
select pg_temp.check(pg_temp.fails(format('select public.set_court_order(%L, %L::uuid[])', pg_temp.mid('A'),
  array[pg_temp.uid('org'), pg_temp.uid('c'), pg_temp.uid('a'), pg_temp.uid('e')])) like '%same court%', 'F: no swaps across courts');
-- Doubles to singles on a booked court: the latest joiners wait; the organiser keeps a spot.
select public.update_match(pg_temp.mid('A'), 'A', 'singles', 1, (now() + interval '3 days')::date, '20:00', 90, 6);
select pg_temp.check(pg_temp.layout('A') like '1:org,c | w:a,b,%', 'F: singles keeps organiser and first in seat order');
select pg_temp.check(pg_temp.split('A') = 'org,c', 'F: two share the court');
select pg_temp.check(pg_temp.liable('A') = '', 'F: moved by the organiser, not liable');

-- ===========================================================================
-- G. Singles, one court at a time.
-- ===========================================================================
select pg_temp.as_user('org');
select public.create_match('G', 'singles', 2, '', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 60, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('G')) from unnest(array['a','b','c']) u;
select pg_temp.check(pg_temp.layout('G') = '1:org,a | 2:b,c', 'G: two per court');
select pg_temp.as_user('c'); select public.book_court(pg_temp.mid('G'), 2, 'Club', 'Court 2', '', 40);
select pg_temp.as_user('b');
select pg_temp.check(pg_temp.fails(format('select public.leave_match(%L)', pg_temp.mid('G'))) like '%locked in%', 'G: court 2 locked');
select pg_temp.as_user('a'); select public.leave_match(pg_temp.mid('G'));
select pg_temp.check(pg_temp.split('G') = 'b,c', 'G: court 2 pays court 2');

-- ===========================================================================
-- H. Played matches can't change; home shows partial bookings.
-- ===========================================================================
select pg_temp.as_user('org');
select x ->> 'booked_courts' as bc from jsonb_array_elements(public.my_matches()) x where x ->> 'slug' = pg_temp.slug('G') \gset
select pg_temp.check(:'bc' = '1', 'H: home shows 1 booked court');
reset role;
update public.matches set starts_at = now() - interval '3 hours' where id = pg_temp.mid('G');
set role authenticated;
select pg_temp.as_user('c');
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 1, %L, %L, %L, 40)', pg_temp.mid('G'), 'Club', 'Court 1', '')) like '%already been played%', 'H: no booking after the match');
select pg_temp.check(pg_temp.fails(format('select public.cancel_court(%L, 2)', pg_temp.mid('G'))) like '%already been played%', 'H: no cancelling after the match');

-- ===========================================================================
-- I. The previous app's all-courts booking still works (organiser only).
-- ===========================================================================
select pg_temp.as_user('org');
select public.create_match('I', 'doubles', 2, '', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('I')) from unnest(array['a','b','c','d']) u;
select pg_temp.as_user('a');
select pg_temp.check(pg_temp.fails(format('select public.book_match(%L, %L, %L, %L, 50)', pg_temp.mid('I'), 'Hall', 'Court 1', '')) like '%Only the organiser%', 'I: old booking is organiser only');
select pg_temp.as_user('org'); select public.book_match(pg_temp.mid('I'), 'Hall', 'Court 1', '', 50);
select pg_temp.check(pg_temp.court_costs('I') = '1:org:50 | 2:org:50', 'I: books every court');
select pg_temp.as_user('d');
select pg_temp.check(pg_temp.fails(format('select public.leave_match(%L)', pg_temp.mid('I'))) like '%locked in%', 'I: everyone locked');

reset role;
\o
\echo COURT BOOKING EDGE CASES PASSED
