-- ONE-TIME, before turning on automatic database updates (README: "Automatic database updates").
-- Tells the Supabase CLI that migrations 0001-0012 are already in your database (you ran
-- them by hand), so it only applies newer ones. Run it in the Supabase SQL editor after running
-- 0012_reminders_weekly_scores.sql yourself. Safe to run twice.

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
insert into supabase_migrations.schema_migrations (version, name) values
  ('0001', 'init'),
  ('0002', 'booking_guests_games'),
  ('0003', 'edit_matches_singles_liability'),
  ('0004', 'replacement_clears_debt'),
  ('0005', 'push_notifications'),
  ('0006', 'book_some_courts'),
  ('0007', 'anyone_adds_players_guest_billing'),
  ('0008', 'home_groups'),
  ('0009', 'book_courts_one_at_a_time'),
  ('0010', 'open_matches_and_names'),
  ('0011', 'organiser_can_drop_out'),
  ('0012', 'reminders_weekly_scores')
on conflict (version) do nothing;

select version, name from supabase_migrations.schema_migrations order by version;
