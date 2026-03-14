-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles enable row level security;
alter table leagues enable row level security;
alter table league_members enable row level security;
alter table courses enable row level security;
alter table rounds enable row level security;
alter table league_settings enable row level security;

-- ============================================================
-- PROFILES
-- ============================================================

create policy "profiles_read"
on profiles
for select
using (true);

create policy "profiles_update"
on profiles
for update
using (auth.uid() = id);

-- ============================================================
-- LEAGUES
-- ============================================================

create policy "leagues_read"
on leagues
for select
using (
  owner_id = auth.uid()
  OR id IN (
    SELECT league_id
    FROM league_members
    WHERE user_id = auth.uid()
  )
);

create policy "leagues_insert"
on leagues
for insert
with check (owner_id = auth.uid());

create policy "leagues_update"
on leagues
for update
using (
  owner_id = auth.uid()
  OR id IN (
    SELECT league_id
    FROM league_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);

create policy "leagues_delete"
on leagues
for delete
using (owner_id = auth.uid());

-- ============================================================
-- LEAGUE MEMBERS
-- IMPORTANT: allow reading membership rows
-- ============================================================

create policy "league_members_read"
on league_members
for select
using (true);

create policy "league_members_insert"
on league_members
for insert
with check (true);

create policy "league_members_delete"
on league_members
for delete
using (
  user_id = auth.uid()
  OR league_id IN (
    SELECT league_id
    FROM league_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);

-- ============================================================
-- COURSES
-- ============================================================

create policy "courses_read"
on courses
for select
using (
  league_id IN (
    SELECT league_id
    FROM league_members
    WHERE user_id = auth.uid()
  )
);

create policy "courses_write"
on courses
for all
using (
  league_id IN (
    SELECT league_id
    FROM league_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
)
with check (
  league_id IN (
    SELECT league_id
    FROM league_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);

-- ============================================================
-- ROUNDS
-- ============================================================

create policy "rounds_read"
on rounds
for select
using (
  league_id IN (
    SELECT league_id
    FROM league_members
    WHERE user_id = auth.uid()
  )
);

create policy "rounds_insert"
on rounds
for insert
with check (
  player_id = auth.uid()
  AND league_id IN (
    SELECT league_id
    FROM league_members
    WHERE user_id = auth.uid()
  )
);

create policy "rounds_update_player"
on rounds
for update
using (player_id = auth.uid());

create policy "rounds_delete_admin"
on rounds
for delete
using (
  league_id IN (
    SELECT league_id
    FROM league_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);

-- ============================================================
-- LEAGUE SETTINGS
-- ============================================================

create policy "league_settings_read"
on league_settings
for select
using (
  league_id IN (
    SELECT league_id
    FROM league_members
    WHERE user_id = auth.uid()
  )
);

create policy "league_settings_write"
on league_settings
for all
using (
  league_id IN (
    SELECT league_id
    FROM league_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
)
with check (
  league_id IN (
    SELECT league_id
    FROM league_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);

-- ============================================================
-- NEW: rounds columns for stableford and scoring format
-- ============================================================

alter table rounds
  add column if not exists stableford_pts integer,
  add column if not exists scoring_format text default 'stroke';

-- ============================================================
-- NEW: league_join_requests table
-- ============================================================

create table if not exists league_join_requests (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid references leagues(id) on delete cascade,
  user_id    uuid references profiles(id) on delete cascade,
  status     text default 'pending',
  created_at timestamptz default now(),
  unique(league_id, user_id)
);

alter table league_join_requests enable row level security;

create policy "join_requests_insert"
  on league_join_requests for insert
  with check (auth.uid() = user_id);

create policy "join_requests_select"
  on league_join_requests for select
  using (
    auth.uid() = user_id or
    exists (
      select 1 from league_members
      where league_id = league_join_requests.league_id
      and user_id = auth.uid()
      and role = 'admin'
    )
  );

create policy "join_requests_update"
  on league_join_requests for update
  using (
    exists (
      select 1 from league_members
      where league_id = league_join_requests.league_id
      and user_id = auth.uid()
      and role = 'admin'
    )
  );

-- ============================================================
-- NEW: allow commissioners to update other players' handicaps
-- ============================================================

create policy "profiles_update_by_admin"
  on profiles for update
  using (
    auth.uid() = id or
    exists (
      select 1 from league_members lm1
      join league_members lm2 on lm1.league_id = lm2.league_id
      where lm1.user_id = auth.uid()
      and lm1.role = 'admin'
      and lm2.user_id = profiles.id
    )
  );

create policy "rounds_update_attester"
on rounds for update
using (attester_id = auth.uid());