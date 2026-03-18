-- ============================================================
-- GREEK SIDE BUNKER — Supabase SQL Schema
-- Safe to run on existing databases — uses IF NOT EXISTS
-- and ALTER TABLE ... ADD COLUMN IF NOT EXISTS throughout
-- ============================================================


-- ── EXTENSIONS ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ── PROFILES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  name            text,
  email           text,
  avatar_url      text,
  handicap        numeric(4,1),
  ghin            text,
  handicap_synced_at timestamptz,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS handicap_synced_at timestamptz;


-- ── LEAGUES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leagues (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  description text,
  owner_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  invite_code text UNIQUE DEFAULT substr(md5(random()::text), 1, 8),
  scoring_format text DEFAULT 'stroke',
  created_at  timestamptz DEFAULT now()
);


-- ── LEAGUE MEMBERS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_members (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id   uuid REFERENCES leagues(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  role        text DEFAULT 'player' CHECK (role IN ('admin', 'player')),
  paid        boolean DEFAULT false,
  joined_at   timestamptz DEFAULT now(),
  UNIQUE(league_id, user_id)
);


-- ── LEAGUE JOIN REQUESTS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_join_requests (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id   uuid REFERENCES leagues(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  status      text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at  timestamptz DEFAULT now(),
  UNIQUE(league_id, user_id)
);


-- ── LEAGUE SETTINGS ──────────────────────────────────────────
-- config stores all league configuration as JSONB
-- payouts stores payout tracking as JSONB
CREATE TABLE IF NOT EXISTS league_settings (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id   uuid UNIQUE REFERENCES leagues(id) ON DELETE CASCADE,
  config      jsonb DEFAULT '{}',
  payouts     jsonb DEFAULT '{}',
  updated_at  timestamptz DEFAULT now()
);


-- ── COURSES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id   uuid REFERENCES leagues(id) ON DELETE CASCADE,
  name        text NOT NULL,
  par         integer NOT NULL DEFAULT 72,
  holes       integer NOT NULL DEFAULT 18,
  slope       numeric(5,1) NOT NULL DEFAULT 113,
  rating      numeric(4,1) NOT NULL DEFAULT 72.0,
  playoff_only boolean DEFAULT false,
  scorecard   jsonb,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS playoff_only boolean DEFAULT false;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS scorecard jsonb;


-- ── ROUNDS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rounds (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id       uuid REFERENCES leagues(id) ON DELETE CASCADE,
  player_id       uuid REFERENCES profiles(id) ON DELETE CASCADE,
  player_name     text,
  attester_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  attester_name   text,
  attester_email  text,
  course_id       uuid REFERENCES courses(id) ON DELETE SET NULL,
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

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS attest_token uuid DEFAULT uuid_generate_v4();
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS attest_at timestamptz;
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS attest_note text;
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS stableford_pts integer;


-- ── STORAGE BUCKETS ──────────────────────────────────────────

-- Scorecards bucket (already exists if you've been using the app)
INSERT INTO storage.buckets (id, name, public)
VALUES ('scorecards', 'scorecards', true)
ON CONFLICT (id) DO NOTHING;

-- Bylaws bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('bylaws', 'bylaws', true)
ON CONFLICT (id) DO NOTHING;


-- ── STORAGE POLICIES (no RLS on tables, storage only) ────────

-- Scorecards
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload scorecards' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Authenticated users can upload scorecards"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'scorecards');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read scorecards' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Anyone can read scorecards"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'scorecards');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can delete scorecards' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Authenticated users can delete scorecards"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'scorecards');
  END IF;
END $$;

-- Bylaws
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload bylaws' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Authenticated users can upload bylaws"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'bylaws');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read bylaws' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Anyone can read bylaws"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'bylaws');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can delete bylaws' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Authenticated users can delete bylaws"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'bylaws');
  END IF;
END $$;


-- ── PROFILE AUTO-CREATE TRIGGER ──────────────────────────────
-- Automatically creates a profile row when a new user signs up
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


-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_league_members_league_id ON league_members(league_id);
CREATE INDEX IF NOT EXISTS idx_league_members_user_id ON league_members(user_id);
CREATE INDEX IF NOT EXISTS idx_rounds_league_id ON rounds(league_id);
CREATE INDEX IF NOT EXISTS idx_rounds_player_id ON rounds(player_id);
CREATE INDEX IF NOT EXISTS idx_rounds_course_id ON rounds(course_id);
CREATE INDEX IF NOT EXISTS idx_courses_league_id ON courses(league_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_league_id ON league_join_requests(league_id);


-- ============================================================
-- NOTES
-- ============================================================
-- RLS is intentionally disabled on all tables.
-- Security is handled at the application layer.
--
-- Storage policies are the ONLY policies — they allow
-- authenticated users to upload/delete and public to read.
--
-- To run on an existing database safely:
-- All CREATE TABLE statements use IF NOT EXISTS
-- All ALTER TABLE statements use ADD COLUMN IF NOT EXISTS
-- All INSERT INTO storage.buckets use ON CONFLICT DO NOTHING
-- All storage policies use DO $$ BEGIN IF NOT EXISTS blocks
-- The profile trigger uses CREATE OR REPLACE + DROP IF EXISTS
-- ============================================================