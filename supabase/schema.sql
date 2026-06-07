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
