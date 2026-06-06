-- ============================================================
-- PING: Backfill missing profiles for existing auth users
-- ============================================================
--
-- WHEN TO RUN THIS
--   Run it ONCE, in the Supabase SQL Editor, *after* schema.sql has been
--   applied (so public.profiles and the on_auth_user_created trigger exist).
--
-- WHY IT EXISTS
--   The on_auth_user_created trigger only creates a profile for users that
--   sign up *after* the schema is in place. Any account created before then
--   (e.g. while debugging) exists in auth.users but has no profiles row, so
--   the app fails with "Kunde inte ladda profil." This script creates the
--   missing rows for those orphaned users.
--
-- SAFE TO RE-RUN
--   `on conflict (id) do nothing` makes this idempotent: users that already
--   have a profile are skipped, so running it again is harmless.
--
-- NOTE
--   Only users whose signup metadata carries a username are backfilled.
--   Accounts with no username in raw_user_meta_data are skipped (there is
--   nothing valid to insert, given the username NOT NULL + format CHECK).
-- ============================================================

insert into public.profiles (id, username)
select id, raw_user_meta_data ->> 'username'
from auth.users
where raw_user_meta_data ->> 'username' is not null
on conflict (id) do nothing;
