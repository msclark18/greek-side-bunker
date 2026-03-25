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
-- ── NOTES ────────────────────────────────────────────────────
-- RLS is intentionally disabled on all tables.
-- Security is handled at the application layer.
-- Storage policies are the ONLY policies.
-- ============================================================