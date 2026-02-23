-- ============================================================
-- PING: Full Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- 1. PROFILES TABLE
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  created_at timestamptz default now() not null
);

create index profiles_username_lower_idx on public.profiles (lower(username));

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
create table public.pings (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('text', 'file')),
  content text,
  file_path text,
  file_name text,
  file_size bigint,
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
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
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

-- Pings: see own, send to accepted contacts only
create policy "Users can view pings they sent or received"
  on public.pings for select
  to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

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

create policy "Users can delete pings they sent or received"
  on public.pings for delete
  to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

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
