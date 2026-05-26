-- ============================================================
-- GREEK SIDE BUNKER — Actual Supabase Schema
-- Reflects the REAL database structure as of March 2026
-- 
-- NOTE: This database uses integer IDs (int8/bigserial),
-- NOT UUIDs, for leagues, courses, league_members, etc.
-- Only profiles, rounds use UUIDs.
--
-- Safe to use as reference. DO NOT re-run on existing DB
-- unless setting up fresh — use for documentation only.
-- ============================================================


-- ── EXTENSIONS ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ── PROFILES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  name                text,
  email               text,
  avatar_url          text,
  handicap            numeric(4,1),
  ghin                text,
  handicap_synced_at  timestamptz,
  created_at          timestamptz DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, avatar_url)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    new.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();


-- ── LEAGUES ─────────────────────────────────────────────────
-- Uses bigserial (auto-increment integer) for id
CREATE TABLE IF NOT EXISTS leagues (
  id              bigserial PRIMARY KEY,
  name            text NOT NULL,
  description     text,
  owner_id        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  invite_code     text UNIQUE DEFAULT substr(md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text), 1, 8),
  scoring_format  text DEFAULT 'stroke',
  created_at      timestamptz DEFAULT now()
);


-- ── LEAGUE MEMBERS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_members (
  id          bigserial PRIMARY KEY,
  league_id   bigint REFERENCES leagues(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  role        text DEFAULT 'player' CHECK (role IN ('admin', 'player')),
  paid        boolean DEFAULT false,
  joined_at   timestamptz DEFAULT now(),
  created_at  timestamptz,
  UNIQUE(league_id, user_id)
);


-- ── LEAGUE JOIN REQUESTS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_join_requests (
  id          bigserial PRIMARY KEY,
  league_id   bigint REFERENCES leagues(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  status      text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at  timestamptz DEFAULT now(),
  UNIQUE(league_id, user_id)
);


-- ── LEAGUE SETTINGS ──────────────────────────────────────────
-- config stores all league configuration as JSONB including:
--   scoringFormat, roundsPerCourse, attestRequired, scorecardRequired
--   useHandicap, handicapPct, useSlopeRating, maxHandicap
--   joinMode, maxPlayers, hideScores, seasonStart, seasonEnd
--   googleSheetUrl, scoresToCount, entryFee, payoutCategories
--   playoffEnabled, playoffFormat, playoffQualifiers, playoffSeedingBy
--   playoffBracket, playoffCourse, playoffDate
--   bylawsUrl, bylawsName (PDF stored in Supabase Storage)
--   ccCommissioner (CC commissioner on attestation emails)
CREATE TABLE IF NOT EXISTS league_settings (
  id          bigserial PRIMARY KEY,
  league_id   bigint UNIQUE REFERENCES leagues(id) ON DELETE CASCADE,
  config      jsonb DEFAULT '{}',
  payouts     jsonb DEFAULT '{}',
  updated_at  timestamptz DEFAULT now()
);


-- ── COURSES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id              bigserial PRIMARY KEY,
  league_id       bigint REFERENCES leagues(id) ON DELETE CASCADE,
  name            text NOT NULL,
  par             integer NOT NULL DEFAULT 72,
  holes           integer NOT NULL DEFAULT 18,
  slope           numeric(5,1) NOT NULL DEFAULT 113,
  rating          numeric(4,1) NOT NULL DEFAULT 72.0,
  playoff_only    boolean DEFAULT false,
  scorecard       jsonb,
  created_at      timestamptz DEFAULT now()
);


-- ── ROUNDS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rounds (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id       bigint REFERENCES leagues(id) ON DELETE CASCADE,
  player_id       uuid REFERENCES profiles(id) ON DELETE CASCADE,
  player_name     text,
  attester_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  attester_name   text,
  attester_email  text,
  course_id       bigint REFERENCES courses(id) ON DELETE SET NULL,
  course_name     text,
  gross           integer NOT NULL,
  net             integer,
  stableford_pts  integer,
  course_handicap integer,
  par             integer,
  date            date NOT NULL,
  scoring_format  text DEFAULT 'stroke',
  attest_status   text DEFAULT 'pending' CHECK (attest_status IN ('pending', 'approved', 'rejected')),
  attest_token    uuid DEFAULT uuid_generate_v4(),
  attest_at       timestamptz,
  attest_note     text,
  scorecard_url   text,
  hole_scores     jsonb DEFAULT NULL,
  hole_stats      jsonb DEFAULT NULL,
  round_status    text DEFAULT 'not_started'
                    CHECK (round_status IN ('not_started', 'in_progress', 'completed')),
  tracking_only         boolean DEFAULT false,  -- true = scores tracked but don't count toward standings
  group_id              uuid DEFAULT NULL,      -- links all rounds started together in a live group
  team_id               text DEFAULT NULL,      -- for scramble/best-ball team formats
  tournament_round_id   text DEFAULT NULL,      -- ties round to a specific tournament round config
  created_at      timestamptz DEFAULT now()
);


-- ── STORAGE BUCKETS ──────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('scorecards', 'scorecards', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('bylaws', 'bylaws', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('assets', 'assets', true)
ON CONFLICT (id) DO NOTHING;


-- ── STORAGE POLICIES ─────────────────────────────────────────
-- Scorecards
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload scorecards' AND tablename = 'objects') THEN
    CREATE POLICY "Authenticated users can upload scorecards" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'scorecards');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read scorecards' AND tablename = 'objects') THEN
    CREATE POLICY "Anyone can read scorecards" ON storage.objects FOR SELECT TO public USING (bucket_id = 'scorecards');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can delete scorecards' AND tablename = 'objects') THEN
    CREATE POLICY "Authenticated users can delete scorecards" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'scorecards');
  END IF;
END $$;

-- Bylaws
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload bylaws' AND tablename = 'objects') THEN
    CREATE POLICY "Authenticated users can upload bylaws" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'bylaws');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read bylaws' AND tablename = 'objects') THEN
    CREATE POLICY "Anyone can read bylaws" ON storage.objects FOR SELECT TO public USING (bucket_id = 'bylaws');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can delete bylaws' AND tablename = 'objects') THEN
    CREATE POLICY "Authenticated users can delete bylaws" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'bylaws');
  END IF;
END $$;

-- Assets (logo, images used in emails)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read assets' AND tablename = 'objects') THEN
    CREATE POLICY "Anyone can read assets" ON storage.objects FOR SELECT TO public USING (bucket_id = 'assets');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload assets' AND tablename = 'objects') THEN
    CREATE POLICY "Authenticated users can upload assets" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'assets');
  END IF;
END $$;


-- ── LEAGUE INVITES ───────────────────────────────────────────
-- Stores pending invitations for users who don't have an account yet.
-- Consumed by consumePendingInvites() in App.jsx on first login.
CREATE TABLE IF NOT EXISTS league_invites (
  id          bigserial PRIMARY KEY,
  league_id   bigint NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  email       text NOT NULL,
  name        text NOT NULL,
  handicap    numeric(4,1),
  ghin        text,
  invited_by  text,                          -- email of the commissioner who sent it
  invited_at  timestamptz DEFAULT now(),
  UNIQUE (league_id, email)
);

CREATE INDEX IF NOT EXISTS idx_league_invites_email ON league_invites(email);


-- ── COURSE CACHE ─────────────────────────────────────────────
-- Global cache of courses from GolfCourseAPI — shared across all leagues.
-- Populated automatically when users search for courses.
-- api_id = the external API's course ID (prevents duplicate inserts).
CREATE TABLE IF NOT EXISTS course_cache (
  id          bigserial PRIMARY KEY,
  api_id      integer UNIQUE NOT NULL,
  club_name   text NOT NULL,
  course_name text NOT NULL,
  location    jsonb,
  tees        jsonb,
  cached_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_cache_search
  ON course_cache USING gin(to_tsvector('english', club_name || ' ' || course_name));
CREATE INDEX IF NOT EXISTS idx_course_cache_api_id ON course_cache(api_id);


-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_league_members_league_id ON league_members(league_id);
CREATE INDEX IF NOT EXISTS idx_league_members_user_id ON league_members(user_id);
CREATE INDEX IF NOT EXISTS idx_rounds_league_id ON rounds(league_id);
CREATE INDEX IF NOT EXISTS idx_rounds_player_id ON rounds(player_id);
CREATE INDEX IF NOT EXISTS idx_rounds_course_id ON rounds(course_id);
CREATE INDEX IF NOT EXISTS idx_courses_league_id ON courses(league_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_league_id ON league_join_requests(league_id);

-- Additional indexes to reduce full table scans on commonly filtered columns
CREATE INDEX IF NOT EXISTS idx_rounds_round_status ON rounds(round_status);
CREATE INDEX IF NOT EXISTS idx_rounds_attest_status ON rounds(attest_status);
CREATE INDEX IF NOT EXISTS idx_rounds_attest_token ON rounds(attest_token);
CREATE INDEX IF NOT EXISTS idx_rounds_group_id ON rounds(group_id);
-- Composite index for the most common query pattern (fetch all rounds for a league, filter by status)
CREATE INDEX IF NOT EXISTS idx_rounds_league_round_status ON rounds(league_id, round_status);
CREATE INDEX IF NOT EXISTS idx_rounds_league_attest_status ON rounds(league_id, attest_status);


-- ============================================================
-- KNOWN TRIGGERS TO AVOID
-- ============================================================
-- The following triggers were found in the DB and REMOVED
-- because they conflicted with app-level member insertion:
--
--   add_owner_to_league_members_trigger (function: add_owner_to_league_members)
--   add_owner_member (function: add_owner_member)
--
-- DO NOT recreate these triggers. The app handles member
-- insertion in createLeague() in App.jsx.
--
-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- NOTE: Vercel API routes using SUPABASE_SERVICE_KEY bypass RLS entirely.

-- Enable RLS on all tables
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues              ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds               ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_invites       ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_cache         ENABLE ROW LEVEL SECURITY;

-- Helper function: returns all league_ids the current user belongs to.
-- SECURITY DEFINER bypasses RLS on league_members — breaks the circular dep.
CREATE OR REPLACE FUNCTION public.get_my_league_ids()
RETURNS SETOF bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT league_id
  FROM public.league_members
  WHERE user_id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.get_my_league_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_league_ids() TO anon;

-- Helper function: returns true if current user is admin of the given league.
-- SECURITY DEFINER bypasses RLS — used in league_members policies to avoid
-- infinite recursion (policies on league_members cannot subquery league_members directly).
CREATE OR REPLACE FUNCTION public.is_league_admin(p_league_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members
    WHERE league_id = p_league_id AND user_id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_league_admin(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_league_admin(bigint) TO anon;

-- ── PROFILES ─────────────────────────────────────────────────
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO authenticated USING (
  id = auth.uid()
  OR id IN (
    SELECT user_id FROM public.league_members
    WHERE league_id IN (SELECT public.get_my_league_ids())
  )
);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- ── LEAGUES ──────────────────────────────────────────────────
-- SELECT open to all authenticated users (needed for invite_code lookup before joining)
CREATE POLICY "leagues_select" ON leagues FOR SELECT TO authenticated USING (true);
CREATE POLICY "leagues_insert" ON leagues FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "leagues_update" ON leagues FOR UPDATE TO authenticated
  USING (id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "leagues_delete" ON leagues FOR DELETE TO authenticated
  USING (id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin'));

-- ── LEAGUE MEMBERS ───────────────────────────────────────────
CREATE POLICY "league_members_select" ON league_members FOR SELECT TO authenticated
  USING (league_id IN (SELECT public.get_my_league_ids()));
-- INSERT/UPDATE/DELETE use is_league_admin() to avoid infinite recursion
-- (subquerying league_members directly inside a league_members policy causes 42P17)
CREATE POLICY "league_members_insert" ON league_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_league_admin(league_id));
CREATE POLICY "league_members_update" ON league_members FOR UPDATE TO authenticated
  USING (public.is_league_admin(league_id));
CREATE POLICY "league_members_delete" ON league_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_league_admin(league_id));

-- ── LEAGUE SETTINGS ──────────────────────────────────────────
CREATE POLICY "league_settings_select" ON league_settings FOR SELECT TO authenticated
  USING (league_id IN (SELECT public.get_my_league_ids()));
CREATE POLICY "league_settings_insert" ON league_settings FOR INSERT TO authenticated
  WITH CHECK (league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "league_settings_update" ON league_settings FOR UPDATE TO authenticated
  USING (league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin'));

-- ── COURSES ──────────────────────────────────────────────────
CREATE POLICY "courses_select" ON courses FOR SELECT TO authenticated
  USING (league_id IN (SELECT public.get_my_league_ids()));
CREATE POLICY "courses_insert" ON courses FOR INSERT TO authenticated
  WITH CHECK (league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "courses_update" ON courses FOR UPDATE TO authenticated
  USING (league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "courses_delete" ON courses FOR DELETE TO authenticated
  USING (league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin'));

-- ── ROUNDS ───────────────────────────────────────────────────
CREATE POLICY "rounds_select" ON rounds FOR SELECT TO authenticated
  USING (league_id IN (SELECT public.get_my_league_ids()));
-- Allow inserting rounds on behalf of other league members (companion scoring)
CREATE POLICY "rounds_insert" ON rounds FOR INSERT TO authenticated
  WITH CHECK (
    league_id IN (SELECT public.get_my_league_ids())
    AND player_id IN (
      SELECT user_id FROM league_members
      WHERE league_id = ANY(SELECT public.get_my_league_ids())
    )
  );
-- Allow updating rounds by admins, players updating their own completed rounds, or group leaders entering companion scores
CREATE POLICY "rounds_update" ON rounds FOR UPDATE TO authenticated
  USING (
    league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin')
    OR (player_id = auth.uid() AND attest_status = 'pending')
    OR (player_id = auth.uid() AND round_status = 'completed')
    OR (league_id IN (SELECT public.get_my_league_ids()) AND round_status = 'in_progress')
  );
CREATE POLICY "rounds_delete" ON rounds FOR DELETE TO authenticated
  USING (
    league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin')
    OR (player_id = auth.uid() AND attest_status = 'pending')
  );

-- ── LEAGUE JOIN REQUESTS ─────────────────────────────────────
CREATE POLICY "join_requests_select" ON league_join_requests FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin')
  );
CREATE POLICY "join_requests_insert" ON league_join_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "join_requests_update" ON league_join_requests FOR UPDATE TO authenticated
  USING (league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "join_requests_delete" ON league_join_requests FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin')
  );

-- ── LEAGUE INVITES ───────────────────────────────────────────
CREATE POLICY "league_invites_select" ON league_invites FOR SELECT TO authenticated
  USING (
    lower(email) = lower((SELECT email FROM profiles WHERE id = auth.uid()))
    OR league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin')
  );
CREATE POLICY "league_invites_insert" ON league_invites FOR INSERT TO authenticated
  WITH CHECK (league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "league_invites_delete" ON league_invites FOR DELETE TO authenticated
  USING (
    lower(email) = lower((SELECT email FROM profiles WHERE id = auth.uid()))
    OR league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid() AND role = 'admin')
  );

-- ── COURSE CACHE ─────────────────────────────────────────────
-- Global shared cache — any authenticated user can read/write
CREATE POLICY "course_cache_select" ON course_cache FOR SELECT TO authenticated USING (true);
CREATE POLICY "course_cache_insert" ON course_cache FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "course_cache_update" ON course_cache FOR UPDATE TO authenticated USING (true);