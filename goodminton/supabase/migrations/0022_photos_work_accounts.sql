-- 1. Google profile photos: keep profiles.avatar_url fresh and let the app read
--    the photos of people in my groups.
-- 2. Work accounts (@careem.com): can't use the app, and aren't in any group, so they
--    don't show up in player lists. Their old matches, games and balances stay.
-- Run once, after 0021. Safe to run again.

do $$ begin
  if to_regprocedure('public.roll_recurring(timestamp with time zone, uuid)') is null then
    raise exception 'Run 0021_added_recently_weekly_ahead.sql first, then this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Photos
-- ---------------------------------------------------------------------------

-- Google sends the photo again on every sign-in; keep the newest.
create or replace function public.sync_avatar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text := coalesce(nullif(new.raw_user_meta_data ->> 'avatar_url', ''), nullif(new.raw_user_meta_data ->> 'picture', ''));
begin
  if v is not null then
    update public.profiles set avatar_url = v where id = new.id and avatar_url is distinct from v;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_updated_avatar on auth.users;
create trigger on_auth_user_updated_avatar after update of raw_user_meta_data on auth.users
  for each row execute function public.sync_avatar();

update public.profiles p
   set avatar_url = coalesce(nullif(u.raw_user_meta_data ->> 'avatar_url', ''), nullif(u.raw_user_meta_data ->> 'picture', ''))
  from auth.users u
 where u.id = p.id and p.avatar_url is null
   and coalesce(nullif(u.raw_user_meta_data ->> 'avatar_url', ''), nullif(u.raw_user_meta_data ->> 'picture', '')) is not null;

-- Photos of me and the people in my groups: { id: url }.
create or replace function public.people_photos() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(p.id, p.avatar_url), '{}'::jsonb)
    from public.profiles p
   where p.avatar_url is not null and not p.is_guest
     and p.id in (select public.circle_of(auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- 2. Work accounts
-- ---------------------------------------------------------------------------

create or replace function public.blocked_email(p_email text) returns boolean
language sql immutable as $$
  select lower(coalesce(p_email, '')) ~ '@careem\.com$';
$$;

-- Every RPC that changes something starts here.
create or replace function public.require_user() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and public.blocked_email(email)) then
    raise exception 'Please sign in with your personal Google account, not your work account' using errcode = '28000';
  end if;
  return auth.uid();
end $$;

-- Never in a group, however they'd be added.
create or replace function public.no_blocked_members() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = new.user_id and public.blocked_email(email)) then return null; end if;
  return new;
end $$;
drop trigger if exists group_members_no_blocked on public.group_members;
create trigger group_members_no_blocked before insert on public.group_members
  for each row execute function public.no_blocked_members();

delete from public.group_members gm using public.profiles p
 where p.id = gm.user_id and public.blocked_email(p.email);

revoke all on function public.sync_avatar() from public, anon, authenticated;
revoke all on function public.no_blocked_members() from public, anon, authenticated;
revoke all on function public.people_photos() from public, anon;
grant execute on function public.people_photos() to authenticated;
