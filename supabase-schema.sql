-- ============================================================
-- THE GREEK SHEET v2 — Full Schema
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- profiles: mirrors auth.users, stores display info
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  avatar_url  text,
  handicap    numeric(4,1) default 0,
  ghin        text default '',
  created_at  timestamptz default now()
);

-- auto-create profile on first Google sign-in
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, name, avatar_url)
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- leagues
create table if not exists leagues (
  id          bigserial primary key,
  name        text not null,
  description text default '',
  owner_id    uuid references profiles(id) on delete cascade,
  invite_code text unique default substr(md5(random()::text), 1, 8),
  created_at  timestamptz default now()
);

-- league_members: user ↔ league join table with role
create table if not exists league_members (
  id         bigserial primary key,
  league_id  bigint references leagues(id) on delete cascade,
  user_id    uuid references profiles(id) on delete cascade,
  role       text not null default 'player',  -- 'admin' | 'player'
  joined_at  timestamptz default now(),
  unique(league_id, user_id)
);

-- courses (scoped to a league)
create table if not exists courses (
  id         bigserial primary key,
  league_id  bigint references leagues(id) on delete cascade,
  name       text not null,
  par        int not null,
  holes      int not null default 18,
  slope      int not null default 113,
  rating     numeric(4,1) not null default 72.0,
  created_at timestamptz default now()
);

-- rounds
create table if not exists rounds (
  id               bigserial primary key,
  league_id        bigint references leagues(id) on delete cascade,
  player_id        uuid references profiles(id) on delete cascade,
  player_name      text not null,
  attester_id      uuid references profiles(id),
  attester_name    text not null,
  attester_email   text not null,
  course_id        bigint references courses(id) on delete set null,
  course_name      text not null,
  gross            int not null,
  net              int not null,
  course_handicap  int not null,
  par              int not null,
  date             date not null,
  scorecard_url    text,
  -- attestation
  attest_status    text not null default 'pending',  -- 'pending' | 'approved' | 'rejected'
  attest_token     uuid default gen_random_uuid(),   -- unique token emailed to attester
  attest_note      text,                             -- optional reject reason
  attest_at        timestamptz,
  created_at       timestamptz default now()
);

-- settings per league (payouts etc.)
create table if not exists league_settings (
  league_id   bigint primary key references leagues(id) on delete cascade,
  payouts     jsonb default '{}'::jsonb,
  updated_at  timestamptz default now()
);

-- ── Row Level Security ──────────────────────────────────────
alter table profiles       enable row level security;
alter table leagues        enable row level security;
alter table league_members enable row level security;
alter table courses        enable row level security;
alter table rounds         enable row level security;
alter table league_settings enable row level security;

-- profiles: anyone can read; only owner can update
create policy "profiles_read"   on profiles for select using (true);
create policy "profiles_update" on profiles for update using (auth.uid() = id);

-- leagues: members can read; any authed user can create
create policy "leagues_read"   on leagues for select using (
  exists (select 1 from league_members lm where lm.league_id = id and lm.user_id = auth.uid())
  or owner_id = auth.uid()
);
create policy "leagues_insert" on leagues for insert with check (auth.uid() = owner_id);
create policy "leagues_update" on leagues for update using (
  exists (select 1 from league_members lm where lm.league_id = id and lm.user_id = auth.uid() and lm.role = 'admin')
  or owner_id = auth.uid()
);
create policy "leagues_delete" on leagues for delete using (owner_id = auth.uid());

-- league_members: members can read their league's members
create policy "lm_read"   on league_members for select using (
  user_id = auth.uid() or
  exists (select 1 from league_members lm2 where lm2.league_id = league_id and lm2.user_id = auth.uid())
);
create policy "lm_insert" on league_members for insert with check (true); -- join via invite handled in app
create policy "lm_delete" on league_members for delete using (
  user_id = auth.uid() or
  exists (select 1 from league_members lm2 where lm2.league_id = league_id and lm2.user_id = auth.uid() and lm2.role = 'admin')
);

-- courses: league members can read/write
create policy "courses_read"   on courses for select using (
  exists (select 1 from league_members lm where lm.league_id = league_id and lm.user_id = auth.uid())
);
create policy "courses_write"  on courses for all using (
  exists (select 1 from league_members lm where lm.league_id = league_id and lm.user_id = auth.uid() and lm.role = 'admin')
) with check (
  exists (select 1 from league_members lm where lm.league_id = league_id and lm.user_id = auth.uid() and lm.role = 'admin')
);

-- rounds: league members can read; players can insert their own; attester endpoint uses service role
create policy "rounds_read" on rounds for select using (
  exists (select 1 from league_members lm where lm.league_id = league_id and lm.user_id = auth.uid())
);
create policy "rounds_insert" on rounds for insert with check (
  player_id = auth.uid() and
  exists (select 1 from league_members lm where lm.league_id = league_id and lm.user_id = auth.uid())
);
create policy "rounds_update_player" on rounds for update using (player_id = auth.uid());
create policy "rounds_delete_admin" on rounds for delete using (
  exists (select 1 from league_members lm where lm.league_id = league_id and lm.user_id = auth.uid() and lm.role = 'admin')
);

-- league_settings
create policy "ls_read"  on league_settings for select using (
  exists (select 1 from league_members lm where lm.league_id = league_id and lm.user_id = auth.uid())
);
create policy "ls_write" on league_settings for all using (
  exists (select 1 from league_members lm where lm.league_id = league_id and lm.user_id = auth.uid() and lm.role = 'admin')
) with check (
  exists (select 1 from league_members lm where lm.league_id = league_id and lm.user_id = auth.uid() and lm.role = 'admin')
);

-- ── Storage bucket ──────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('scorecards', 'scorecards', true)
on conflict (id) do nothing;

create policy "sc_read"   on storage.objects for select using (bucket_id = 'scorecards');
create policy "sc_insert" on storage.objects for insert with check (bucket_id = 'scorecards');
create policy "sc_delete" on storage.objects for delete using (bucket_id = 'scorecards');

-- ============================================================
-- EMAIL AUTH SETUP (do this in Supabase Dashboard UI)
-- ============================================================
-- Authentication → Providers → Email → make sure it's ENABLED
-- 
-- For confirmation emails to work:
--   Authentication → Email Templates → customize as desired
--   Authentication → URL Configuration:
--     Site URL: https://your-app.vercel.app
--     Redirect URLs: https://your-app.vercel.app/**
--
-- To DISABLE email confirmation (simpler for small leagues):
--   Authentication → Providers → Email
--   Toggle OFF "Confirm email" 
--   (Users can sign in immediately without verifying)
