-- ============================================================
-- GREEK SIDE BUNKER — FULL DATABASE RESET + SCHEMA
-- ============================================================

-- Required extensions
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- DROP EXISTING TABLES (safe order)
-- ------------------------------------------------------------

drop table if exists league_settings cascade;
drop table if exists rounds cascade;
drop table if exists courses cascade;
drop table if exists league_members cascade;
drop table if exists leagues cascade;
drop table if exists profiles cascade;

drop function if exists public.handle_new_user cascade;
drop function if exists add_creator_as_member cascade;

-- ============================================================
-- PROFILES
-- ============================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  avatar_url text,
  handicap numeric(4,1) default 0,
  ghin text default '',
  created_at timestamptz default now()
);

-- ============================================================
-- USER CREATION TRIGGER
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ============================================================
-- LEAGUES
-- ============================================================

create table leagues (
  id bigserial primary key,
  name text not null,
  description text default '',
  owner_id uuid references profiles(id) on delete cascade default auth.uid(),
  invite_code text unique default left(md5(gen_random_uuid()::text), 8),
  created_at timestamptz default now()
);

-- ============================================================
-- LEAGUE MEMBERS
-- ============================================================

create table league_members (
  id bigserial primary key,
  league_id bigint references leagues(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text not null default 'player',
  joined_at timestamptz default now(),
  unique(league_id, user_id)
);

-- ============================================================
-- COURSES
-- ============================================================

create table courses (
  id bigserial primary key,
  league_id bigint references leagues(id) on delete cascade,
  name text not null,
  par int not null,
  holes int not null default 18,
  slope int not null default 113,
  rating numeric(4,1) not null default 72.0,
  created_at timestamptz default now()
);

-- ============================================================
-- ROUNDS
-- ============================================================

create table rounds (
  id bigserial primary key,
  league_id bigint references leagues(id) on delete cascade,
  player_id uuid references profiles(id) on delete cascade,
  player_name text not null,
  attester_id uuid references profiles(id),
  attester_name text not null,
  attester_email text not null,
  course_id bigint references courses(id) on delete set null,
  course_name text not null,
  gross int not null,
  net int not null,
  course_handicap int not null,
  par int not null,
  date date not null,
  scorecard_url text,
  attest_status text not null default 'pending',
  attest_token uuid default gen_random_uuid(),
  attest_note text,
  attest_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================================
-- LEAGUE SETTINGS
-- ============================================================

create table league_settings (
  league_id bigint primary key references leagues(id) on delete cascade,
  payouts jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- ============================================================
-- AUTO ADD CREATOR TO LEAGUE
-- ============================================================

create or replace function add_creator_as_member()
returns trigger
language plpgsql
as $$
begin
  insert into league_members (league_id, user_id, role)
  values (new.id, new.owner_id, 'admin');
  return new;
end;
$$;

create trigger league_creator_member
after insert on leagues
for each row execute procedure add_creator_as_member();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles enable row level security;
alter table leagues enable row level security;
alter table league_members enable row level security;
alter table courses enable row level security;
alter table rounds enable row level security;
alter table league_settings enable row level security;

-- profiles
create policy "profiles_read"
on profiles for select
using (true);

create policy "profiles_update"
on profiles for update
using (auth.uid() = id);

-- leagues
create policy "leagues_read"
on leagues for select
using (
  owner_id = auth.uid()
  or exists (
    select 1
    from league_members lm
    where lm.league_id = id
    and lm.user_id = auth.uid()
  )
  or invite_code is not null
);

create policy "leagues_insert"
on leagues for insert
with check (true);

create policy "leagues_update"
on leagues for update
using (
  owner_id = auth.uid()
  or exists (
    select 1
    from league_members lm
    where lm.league_id = id
    and lm.user_id = auth.uid()
    and lm.role = 'admin'
  )
);

create policy "leagues_delete"
on leagues for delete
using (owner_id = auth.uid());

-- league_members
create policy "lm_read"
on league_members for select
using (
  user_id = auth.uid()
  or exists (
    select 1
    from league_members lm2
    where lm2.league_id = league_id
    and lm2.user_id = auth.uid()
  )
);

create policy "lm_insert"
on league_members for insert
with check (true);

create policy "lm_delete"
on league_members for delete
using (
  user_id = auth.uid()
  or exists (
    select 1
    from league_members lm2
    where lm2.league_id = league_id
    and lm2.user_id = auth.uid()
    and lm2.role = 'admin'
  )
);

-- courses
create policy "courses_read"
on courses for select
using (
  exists (
    select 1
    from league_members lm
    where lm.league_id = league_id
    and lm.user_id = auth.uid()
  )
);

create policy "courses_write"
on courses for all
using (
  exists (
    select 1
    from league_members lm
    where lm.league_id = league_id
    and lm.user_id = auth.uid()
    and lm.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from league_members lm
    where lm.league_id = league_id
    and lm.user_id = auth.uid()
    and lm.role = 'admin'
  )
);

-- rounds
create policy "rounds_read"
on rounds for select
using (
  exists (
    select 1
    from league_members lm
    where lm.league_id = league_id
    and lm.user_id = auth.uid()
  )
);

create policy "rounds_insert"
on rounds for insert
with check (
  player_id = auth.uid()
  and exists (
    select 1
    from league_members lm
    where lm.league_id = league_id
    and lm.user_id = auth.uid()
  )
);

create policy "rounds_update_player"
on rounds for update
using (player_id = auth.uid());

create policy "rounds_delete_admin"
on rounds for delete
using (
  exists (
    select 1
    from league_members lm
    where lm.league_id = league_id
    and lm.user_id = auth.uid()
    and lm.role = 'admin'
  )
);

-- league_settings
create policy "ls_read"
on league_settings for select
using (
  exists (
    select 1
    from league_members lm
    where lm.league_id = league_id
    and lm.user_id = auth.uid()
  )
);

create policy "ls_write"
on league_settings for all
using (
  exists (
    select 1
    from league_members lm
    where lm.league_id = league_id
    and lm.user_id = auth.uid()
    and lm.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from league_members lm
    where lm.league_id = league_id
    and lm.user_id = auth.uid()
    and lm.role = 'admin'
  )
);

-- ============================================================
-- STORAGE
-- ============================================================

insert into storage.buckets (id, name, public)
values ('scorecards', 'scorecards', true)
on conflict (id) do nothing;

create policy "sc_read"
on storage.objects for select
using (bucket_id = 'scorecards');

create policy "sc_insert"
on storage.objects for insert
with check (bucket_id = 'scorecards');

create policy "sc_delete"
on storage.objects for delete
using (bucket_id = 'scorecards');