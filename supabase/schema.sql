-- ============================================================
-- PING: Full Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- 1. PROFILES TABLE
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (display_name is null or char_length(display_name) between 1 and 40),
  created_at timestamptz default now() not null
);

-- Case-insensitive uniqueness: this unique index enforces that no two
-- usernames collide under lower(), so 'Anna' and 'anna' can't coexist.
-- (Replaces a plain `unique` on the column, which was case-sensitive and
-- thus inconsistent with the case-folding lookups the app relies on.)
create unique index profiles_username_lower_idx
  on public.profiles (lower(username));

-- 2. CONTACTS TABLE
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz default now() not null,
  unique (requester_id, addressee_id)
);

create index contacts_requester_idx on public.contacts (requester_id);
create index contacts_addressee_idx on public.contacts (addressee_id);

-- 3. PINGS TABLE
-- dismissed_by_sender / dismissed_by_receiver: per-side soft-delete flags.
-- Each side hides its own copy independently; the row is hard-deleted (and
-- any attached storage object is cleaned up by the section 8 trigger) only
-- once both flags are true. See section 9 for the dismiss_ping RPC.
create table public.pings (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('text', 'file')),
  content text,
  file_path text,
  file_name text,
  file_size bigint,
  dismissed_by_sender boolean not null default false,
  dismissed_by_receiver boolean not null default false,
  created_at timestamptz default now() not null
);

create index pings_sender_idx on public.pings (sender_id);
create index pings_receiver_idx on public.pings (receiver_id);
create index pings_pair_idx on public.pings (
  least(sender_id, receiver_id),
  greatest(sender_id, receiver_id),
  created_at
);

-- 4. AUTO-CREATE PROFILE ON SIGNUP (trigger)
-- The exception block makes the trigger raise a recognizable error for the
-- two ways the profile insert can fail; raising aborts the surrounding
-- transaction, so the auth.users insert is rolled back too — no orphaned
-- auth user, no auth user without a matching profile row.
--   - username_taken: collides (case-insensitively) with an existing user.
--   - invalid_username: missing from signup metadata, or fails the format
--     CHECK on profiles.username. This is the server-side backstop for the
--     client regex, so a crafted signUp call with bad/no metadata can't
--     create a profile that violates the format rule.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
exception
  when unique_violation then
    raise exception 'username_taken' using errcode = 'P0001';
  when check_violation or not_null_violation then
    raise exception 'invalid_username' using errcode = 'P0001';
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. ROW LEVEL SECURITY

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.pings enable row level security;

-- Profiles: authenticated users can read all, update own
create policy "Authenticated users can view profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Contacts: see own, send requests, addressee can accept/reject
create policy "Users can view their own contacts"
  on public.contacts for select
  to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "Users can send contact requests"
  on public.contacts for insert
  to authenticated
  with check (requester_id = auth.uid());

create policy "Addressee can update contact status"
  on public.contacts for update
  to authenticated
  using (addressee_id = auth.uid())
  with check (addressee_id = auth.uid());

create policy "Addressee can reject (delete) pending contacts"
  on public.contacts for delete
  to authenticated
  using (addressee_id = auth.uid() and status = 'pending');

-- Pings: see own (unless soft-dismissed by you), send to accepted contacts.
-- No public delete policy: hard-deletion happens only via the security-definer
-- dismiss_ping RPC (section 9), which sets the per-side flag and deletes the
-- row once both flags are true.
create policy "Users can view pings they sent or received"
  on public.pings for select
  to authenticated
  using (
    (sender_id = auth.uid() and not dismissed_by_sender)
    or (receiver_id = auth.uid() and not dismissed_by_receiver)
  );

create policy "Users can send pings to accepted contacts"
  on public.pings for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.contacts
      where status = 'accepted'
        and (
          (requester_id = auth.uid() and addressee_id = receiver_id)
          or
          (addressee_id = auth.uid() and requester_id = receiver_id)
        )
    )
  );

-- 6. REALTIME
alter publication supabase_realtime add table public.pings;
alter publication supabase_realtime add table public.contacts;

-- 7. STORAGE
-- Create a private bucket for file uploads.
-- If this fails, create it manually via Dashboard > Storage.
insert into storage.buckets (id, name, public)
values ('ping-files', 'ping-files', false);

-- Upload: authenticated users to their own folder
create policy "Users can upload to own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'ping-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Download: only if file is referenced in a ping you sent/received
create policy "Users can download files from their pings"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'ping-files'
    and exists (
      select 1 from public.pings
      where (sender_id = auth.uid() or receiver_id = auth.uid())
        and file_path = name
    )
  );

-- 8. CASCADE STORAGE CLEANUP ON PING DELETE
-- Without this, deleting a 'file' ping leaves the underlying object
-- orphaned in the bucket (download RLS blocks access, but storage leaks).
-- Runs as security definer so no caller-side delete policy on
-- storage.objects is required.
create or replace function public.handle_ping_delete()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if old.type = 'file' and old.file_path is not null then
    delete from storage.objects
    where bucket_id = 'ping-files'
      and name = old.file_path;
  end if;
  return old;
end;
$$;

create trigger on_ping_deleted
  before delete on public.pings
  for each row execute function public.handle_ping_delete();

-- 9. PER-SIDE DISMISS (soft-delete) + idempotent migration
-- Dismissing a ping flips the caller's flag; the row is hard-deleted (which
-- fires the section 8 storage cleanup) only once both flags are true. Block
-- below is idempotent so existing deployments can run just this section.

alter table public.pings
  add column if not exists dismissed_by_sender boolean not null default false;

alter table public.pings
  add column if not exists dismissed_by_receiver boolean not null default false;

drop policy if exists "Users can view pings they sent or received" on public.pings;
create policy "Users can view pings they sent or received"
  on public.pings for select
  to authenticated
  using (
    (sender_id = auth.uid() and not dismissed_by_sender)
    or (receiver_id = auth.uid() and not dismissed_by_receiver)
  );

-- Old broad delete policy is replaced by the security-definer RPC below.
drop policy if exists "Users can delete pings they sent or received" on public.pings;

create or replace function public.dismiss_ping(p_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_sender uuid;
  v_receiver uuid;
  v_by_sender boolean;
  v_by_receiver boolean;
begin
  select sender_id, receiver_id, dismissed_by_sender, dismissed_by_receiver
    into v_sender, v_receiver, v_by_sender, v_by_receiver
    from public.pings
    where id = p_id;

  if not found then
    return;
  end if;

  if auth.uid() = v_sender then
    v_by_sender := true;
  elsif auth.uid() = v_receiver then
    v_by_receiver := true;
  else
    raise exception 'not authorized';
  end if;

  if v_by_sender and v_by_receiver then
    delete from public.pings where id = p_id;
  else
    update public.pings
      set dismissed_by_sender = v_by_sender,
          dismissed_by_receiver = v_by_receiver
      where id = p_id;
  end if;
end;
$$;

grant execute on function public.dismiss_ping(uuid) to authenticated;

-- ============================================================
-- 10. INVITES (single-use, expiring contact-invite links)
-- Idempotent: existing deployments can run just this section.
-- A random UUID primary key serves as the unguessable token; it rides in the
-- URL fragment client-side so it never hits server access logs. Redemption
-- auto-accepts a contact in BOTH directions. All trust logic is in the two
-- security-definer RPCs below (mirrors the section 9 dismiss_ping pattern).
-- ============================================================

create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references public.profiles(id) on delete cascade,
  used_by     uuid references public.profiles(id) on delete set null,
  used_at     timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists invites_creator_idx on public.invites (creator_id);

alter table public.invites enable row level security;

-- Creators can see and create their own invites. No update/delete policies and
-- no select for other users: redemption goes through redeem_invite (security
-- definer), so a redeemer never needs to read the row directly.
drop policy if exists "Users can view their own invites" on public.invites;
create policy "Users can view their own invites"
  on public.invites for select
  to authenticated
  using (creator_id = auth.uid());

drop policy if exists "Users can create their own invites" on public.invites;
create policy "Users can create their own invites"
  on public.invites for insert
  to authenticated
  with check (creator_id = auth.uid());

-- create_invite: invalidate the caller's other open invites (keeps one active
-- link per user and kills any stale QR still on screen), then mint a fresh
-- 10-minute single-use invite. Returns the token id + its expiry.
create or replace function public.create_invite()
returns table (id uuid, expires_at timestamptz)
language plpgsql
security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_exp timestamptz;
begin
  update public.invites
    set expires_at = now()
    where public.invites.creator_id = auth.uid()
      and public.invites.used_at is null
      and public.invites.expires_at > now();

  v_exp := now() + interval '10 minutes';
  insert into public.invites (creator_id, expires_at)
    values (auth.uid(), v_exp)
    returning invites.id into v_id;

  return query select v_id, v_exp;
end;
$$;

grant execute on function public.create_invite() to authenticated;

-- redeem_invite: validate the token and, on success, auto-accept a contact in
-- both directions. Returns a status the UI maps to a message, plus the
-- creator's username on success.
--   status values: 'ok' | 'not_found' | 'expired' | 'used' | 'self'
-- "already contacts" is treated as success (idempotent): the invite is marked
-- used and we return ok + username, so re-scanning or scanning a known
-- contact's link is a friendly no-op rather than an error.
create or replace function public.redeem_invite(p_token uuid)
returns table (status text, username text)
language plpgsql
security definer set search_path = ''
as $$
declare
  v_creator uuid;
  v_used_at timestamptz;
  v_expires timestamptz;
  v_me uuid := auth.uid();
  v_existing uuid;
  v_username text;
begin
  select creator_id, used_at, expires_at
    into v_creator, v_used_at, v_expires
    from public.invites
    where id = p_token;

  if not found then
    return query select 'not_found'::text, null::text; return;
  end if;
  if v_used_at is not null then
    return query select 'used'::text, null::text; return;
  end if;
  if v_expires <= now() then
    return query select 'expired'::text, null::text; return;
  end if;
  if v_creator = v_me then
    return query select 'self'::text, null::text; return;
  end if;

  -- Atomically claim the token: the `used_at is null` guard makes this the
  -- single-use gate. The earlier read-based check is just for a friendly early
  -- return; THIS update is what actually prevents a double-redeem under
  -- concurrency (two redeemers can both pass the read above, but only one
  -- update can flip a still-null used_at). If we didn't claim it, someone else
  -- already did — treat as used.
  update public.invites
    set used_by = v_me, used_at = now()
    where id = p_token and used_at is null;
  if not found then
    return query select 'used'::text, null::text; return;
  end if;

  select public.profiles.username into v_username
    from public.profiles where public.profiles.id = v_creator;

  -- Look for an existing contact row in either direction.
  select id into v_existing
    from public.contacts
    where (requester_id = v_creator and addressee_id = v_me)
       or (requester_id = v_me and addressee_id = v_creator)
    limit 1;

  if v_existing is not null then
    -- Promote a pending row to accepted; leave an already-accepted row alone.
    update public.contacts set status = 'accepted'
      where public.contacts.id = v_existing
        and public.contacts.status <> 'accepted';
  else
    insert into public.contacts (requester_id, addressee_id, status)
      values (v_creator, v_me, 'accepted');
  end if;

  return query select 'ok'::text, v_username;
end;
$$;

grant execute on function public.redeem_invite(uuid) to authenticated;

-- ============================================================
-- 11. DURABLE MESSAGING — read/delivery state + mark_read/mark_delivered RPCs
-- Idempotent: existing deployments can run just this section.
-- Pings now persist as a durable conversation log. Two timestamps track
-- delivery and read state per message:
--   delivered_at: stamped when the receiver's client receives the realtime
--                 INSERT (or on next load if it was offline at send), via the
--                 mark_delivered RPC below.
--   read_at:      stamped when the receiver opens that chat with the tab
--                 focused, via the mark_read RPC below.
-- The per-side dismiss flags (section 9) still govern row visibility; these
-- columns are orthogonal to dismissal. Unread count = pings where
-- receiver_id = me, read_at is null, and not dismissed_by_receiver.
-- NOTE: pings has no UPDATE RLS policy (RLS is enabled with only SELECT/INSERT
-- policies), so clients CANNOT update delivered_at/read_at directly — these
-- stamps are written exclusively through the two security-definer RPCs below,
-- matching the dismiss_ping (section 9) mutation pattern.
-- ============================================================

alter table public.pings add column if not exists delivered_at timestamptz;
alter table public.pings add column if not exists read_at      timestamptz;

-- Sender-side read/delivery receipts rely on Realtime UPDATE events carrying
-- the FULL new row (not just the PK + changed columns). With the default
-- replica identity, an UPDATE payload omits unchanged columns like receiver_id,
-- so the client's "is this message in the open chat?" guard (which reads
-- payload.new.receiver_id) would see undefined and drop the live receipt.
-- REPLICA IDENTITY FULL makes Postgres emit every column on UPDATE. Idempotent.
alter table public.pings replica identity full;

-- Partial index: the durable unread-count query filters on
-- (receiver_id, read_at is null) and the receiver's own non-dismissed rows.
create index if not exists pings_unread_idx
  on public.pings (receiver_id)
  where read_at is null;

-- mark_read: stamp read_at = now() on every ping the caller has received from
-- a given counterparty that is still unread. p_other is the counterparty's
-- user id (the "recipientId" the client already tracks per chat). Security
-- definer with an explicit auth check: the caller may only mark their OWN
-- received messages read, so no pair-membership lookup is needed beyond
-- receiver_id = auth.uid(). Mirrors the dismiss_ping (section 9) pattern.
create or replace function public.mark_read(p_other uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.pings
    set read_at = now()
    where receiver_id = auth.uid()
      and sender_id = p_other
      and read_at is null
      and not dismissed_by_receiver;
end;
$$;

grant execute on function public.mark_read(uuid) to authenticated;

-- mark_delivered: stamp delivered_at = now() on a single ping the caller has
-- received, if not already stamped. p_id is the ping's id. The caller may only
-- mark a message delivered when they are its receiver (receiver_id =
-- auth.uid()); the `delivered_at is null` guard makes repeat calls a no-op.
-- This exists because pings has no UPDATE RLS policy — the receiver's client
-- cannot write delivered_at directly, so it goes through this RPC. Mirrors the
-- mark_read / dismiss_ping pattern.
create or replace function public.mark_delivered(p_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.pings
    set delivered_at = now()
    where id = p_id
      and receiver_id = auth.uid()
      and delivered_at is null;
end;
$$;

grant execute on function public.mark_delivered(uuid) to authenticated;

-- ============================================================
-- 12. DISAPPEARING MESSAGES — per-pair TTL + set_disappearing / purge RPCs
-- + a daily pg_cron sweep (set_disappearing, then purge_expired_pings + cron).
-- Idempotent: existing deployments can run just this section.
-- Per-conversation, opt-in disappearing messages: one timer per pair, stored on
-- the single contacts row. disappearing_ttl is a Postgres interval; null = off.
-- Offered values client-side are 24h and 7d. Either side of the pair may change
-- it (set_disappearing, below). Expired messages are hidden client-side at load
-- time (belt) and physically deleted by a daily pg_cron sweep calling
-- purge_expired_pings() (suspenders); deletion fires the section-8 storage
-- cleanup trigger so attached files are removed too.
-- NOTE: contacts' only UPDATE RLS policy authorizes the ADDRESSEE
-- (with check addressee_id = auth.uid()); it is not column-restricted, so the
-- addressee could technically update disappearing_ttl directly, but the
-- REQUESTER has no UPDATE policy at all and would be blocked. To let EITHER side
-- set the timer through one path, it is written exclusively through the
-- set_disappearing security-definer RPC below, matching the dismiss_ping
-- (section 9) mutation pattern with an explicit either-side membership check.
-- ============================================================

alter table public.contacts
  add column if not exists disappearing_ttl interval;  -- null = off

-- A disappearing_ttl change must propagate live to the OTHER side's open chat
-- (the client's contacts realtime subscriptions, filtered on requester_id /
-- addressee_id, call loadContacts → refreshDisappearingControl on a contacts
-- UPDATE). REPLICA IDENTITY FULL makes Postgres emit the full row on UPDATE so
-- the realtime payload + server-side row filter see every column — the same
-- reason pings carries it (section 11). This is the first live contacts UPDATE
-- path the client relies on. Idempotent.
alter table public.contacts replica identity full;

-- set_disappearing: set (or clear) the pair's disappearing-messages timer.
-- p_contact_id is the contacts row id; p_ttl is the new interval (null = off,
-- e.g. '24 hours', '7 days'). Authorized to EITHER side of the pair: the caller
-- must be the requester_id or addressee_id of that row (mirrors dismiss_ping's
-- explicit auth.uid() membership check). Security definer so it can update a row
-- the caller's RLS UPDATE policy would otherwise block.
create or replace function public.set_disappearing(p_contact_id uuid, p_ttl interval)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_requester uuid;
  v_addressee uuid;
begin
  -- Only accepted pairs have a conversation; setting a timer on a pending row
  -- is meaningless (no pings can be sent until accepted). Silent return on a
  -- missing-or-pending row, matching the not-found idiom of dismiss_ping.
  select requester_id, addressee_id
    into v_requester, v_addressee
    from public.contacts
    where id = p_contact_id
      and status = 'accepted';

  if not found then
    return;
  end if;

  if auth.uid() <> v_requester and auth.uid() <> v_addressee then
    raise exception 'not authorized';
  end if;

  update public.contacts
    set disappearing_ttl = p_ttl
    where id = p_contact_id;
end;
$$;

grant execute on function public.set_disappearing(uuid, interval) to authenticated;

-- purge_expired_pings: physically delete every ping older than its pair's
-- disappearing_ttl. A ping's pair is the unordered {sender_id, receiver_id}
-- couple; the contacts row for that pair has {requester_id, addressee_id} equal
-- to it in either direction. Pairs with a null disappearing_ttl (timer off) are
-- skipped by the inner join + the explicit `is not null` guard. Deletion fires
-- the section-8 on_ping_deleted trigger, so attached storage objects are removed
-- too. Security definer so it can delete across pairs regardless of caller RLS.
-- NOT granted to authenticated: only the daily pg_cron sweep (service role)
-- runs this. Clients rely on the load-time expiry filter for promptness; this
-- function is the suspenders that actually reclaims rows + storage.
create or replace function public.purge_expired_pings()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.pings p
  using public.contacts c
  where c.disappearing_ttl is not null
    and (
      (c.requester_id = p.sender_id and c.addressee_id = p.receiver_id)
      or
      (c.requester_id = p.receiver_id and c.addressee_id = p.sender_id)
    )
    and now() - p.created_at > c.disappearing_ttl;
end;
$$;

-- Cron/service-role only (open-question #1). Postgres grants EXECUTE to PUBLIC
-- by default, and `authenticated`/`anon` are PUBLIC members — so simply NOT
-- adding a `grant ... to authenticated` is NOT enough: we must REVOKE the
-- default PUBLIC grant, otherwise any logged-in user could trigger a global
-- purge across all pairs (the function is security definer and bypasses RLS).
-- The service role is not constrained by these grants, so pg_cron still runs it.
revoke execute on function public.purge_expired_pings() from public;
revoke execute on function public.purge_expired_pings() from anon, authenticated;

-- Daily pg_cron sweep. REQUIRES the pg_cron extension to be enabled in the
-- Supabase Dashboard (Database -> Extensions) before this runs — a DEFERRED
-- HUMAN step. The DO block below makes re-running section 12 safe: it unschedules
-- any existing job of the same name first, then schedules a fresh 03:17 UTC daily
-- run. If pg_cron is not yet enabled, this block emits a NOTICE and skips the
-- schedule call (it does NOT fail), so the rest of section 12 (column,
-- set_disappearing, purge_expired_pings) applies fine on its own, and the
-- client-side load-time filter keeps expiry prompt meanwhile.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unschedule any prior job of this name so re-running the section doesn't
    -- error on a duplicate; an explicit IF EXISTS guard is clearer than relying
    -- on cron.unschedule's no-op-on-missing behavior across pg_cron versions.
    if exists (select 1 from cron.job where jobname = 'purge-expired-pings') then
      perform cron.unschedule('purge-expired-pings');
    end if;
    perform cron.schedule(
      'purge-expired-pings',
      '17 3 * * *',
      $cron$ select public.purge_expired_pings(); $cron$
    );
  else
    raise notice 'pg_cron not enabled; skipping cron.schedule for purge-expired-pings. Enable the pg_cron extension and re-run section 12.';
  end if;
end;
$$;
