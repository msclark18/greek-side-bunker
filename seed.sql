-- ============================================================
-- GREEK SIDE BUNKER — Seed Script
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
--
-- Creates 4 leagues, each with 32 members, courses, and scores:
--   1. Westside Stroke League      (stroke, handicap, playoffs)
--   2. Friday Stableford Series    (stableford, open join)
--   3. Greek Side Scramble League  (4-man scramble, 8 teams)
--   4. Greek Side Annual Tournament (scramble + texas scramble + best ball)
--
-- Safe to re-run: cleans up previous seed data first.
-- rounds table must have team_id (text) + tournament_round_id (text) columns.
-- ============================================================

-- ── Step 1: Clean up any previous seed runs ────────────────
DELETE FROM leagues WHERE name IN (
  'Westside Wednesday Stroke League',
  'Friday Stableford Series',
  'Greek Side Bunker Scramble League',
  'Greek Side Annual Tournament'
);
DELETE FROM profiles WHERE email LIKE '%@seedgolfer.dev';
DELETE FROM auth.users WHERE email LIKE '%@seedgolfer.dev';

-- ── Step 2: Relax constraints that block seed data ─────────
ALTER TABLE leagues  DISABLE TRIGGER USER;
ALTER TABLE rounds   ALTER COLUMN attester_name   DROP NOT NULL;
ALTER TABLE rounds   ALTER COLUMN attester_email  DROP NOT NULL;

-- ── Step 3: Main seed block ────────────────────────────────
DO $$
DECLARE
  mason_id        uuid;
  mason_hcp       numeric := 8.0;
  p               uuid[] := '{}';
  pid             uuid;

  league_stroke       bigint;
  league_stableford   bigint;
  league_scramble     bigint;
  league_tournament   bigint;

  cs1 bigint; cs2 bigint;
  cf1 bigint; cf2 bigint;
  csc bigint;
  ct1 bigint; ct2 bigint; ct3 bigint;

  i int; j int;
  gross int; net int; chcp int; par int;
  slope numeric; rating numeric; hcp numeric;
  rd date;
  teams_json jsonb;

  player_names text[] := ARRAY[
    'Tyler Adams',    'Jake Morrison',   'Connor Phillips', 'Bryce Henderson',
    'Logan Carter',   'Austin Reed',     'Dylan Foster',    'Chase Bennett',
    'Ethan Powell',   'Nathan Sullivan', 'Ryan Flores',     'Blake Mitchell',
    'Caleb Rivera',   'Hunter Brooks',   'Garrett Simmons', 'Tanner Gray',
    'Derek Hughes',   'Marcus Wood',     'Jaylen Price',    'Kevin Torres',
    'Colin Nguyen',   'Derrick James',   'Shane Wallace',   'Brett Coleman',
    'Cody Murphy',    'Travis Owens',    'Brock Peterson',  'Justin Bell',
    'Ian Harrison',   'Zach Cooper',     'Luke Bailey'
  ];

  player_hcps numeric[] := ARRAY[
     2.1,  4.3,  6.7,  8.2, 10.5, 12.1, 14.3, 15.8, 17.2, 18.9,
    20.1, 21.5, 22.8,  3.4,  5.6,  7.9,  9.1, 11.3, 13.7, 16.0,
    19.4, 23.1, 24.6,  1.2,  0.5, 25.3, 26.8, 28.1,  8.8, 11.9, 12.5
  ];

  scramble_team_names text[] := ARRAY[
    'Team Eagle','Team Albatross','Team Bogey Busters',
    'Team Mulligan','Team Fore!','Birdie Chasers','Sand Wedge'
  ];

BEGIN

  -- ── Resolve or create Mason's account ─────────────────────
  SELECT p.id, COALESCE(p.handicap, 8.0)
    INTO mason_id, mason_hcp
    FROM profiles p
   WHERE lower(p.email) = 'mason.clark16@gmail.com'
   LIMIT 1;

  IF mason_id IS NULL THEN
    SELECT id INTO mason_id FROM auth.users
     WHERE lower(email) = 'mason.clark16@gmail.com' LIMIT 1;
    IF mason_id IS NOT NULL THEN
      INSERT INTO profiles (id, name, email, handicap)
      VALUES (mason_id, 'Mason Clark', 'mason.clark16@gmail.com', 8.0)
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END IF;

  -- Last resort: create a real auth + profile row so seed works
  -- even before first login. You can link your real account later
  -- by logging in (the profile row will already exist).
  IF mason_id IS NULL THEN
    mason_id := gen_random_uuid();
    RAISE NOTICE 'mason.clark16@gmail.com not found — creating placeholder account (id: %)', mason_id;
    INSERT INTO auth.users (
      id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin, is_sso_user, is_anonymous
    ) VALUES (
      mason_id, 'authenticated', 'authenticated',
      'mason.clark16@gmail.com',
      '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Mason Clark"}'::jsonb,
      false, false, false
    );
    INSERT INTO profiles (id, name, email, handicap)
    VALUES (mason_id, 'Mason Clark', 'mason.clark16@gmail.com', 8.0);
  END IF;

  RAISE NOTICE 'Mason Clark ID: %  HCP: %', mason_id, mason_hcp;

  -- ── Create 31 fake seed players ───────────────────────────
  FOR i IN 1..31 LOOP
    pid := gen_random_uuid();
    p   := array_append(p, pid);

    INSERT INTO auth.users (
      id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin, is_sso_user, is_anonymous
    ) VALUES (
      pid, 'authenticated', 'authenticated',
      lower(replace(player_names[i], ' ', '.')) || i || '@seedgolfer.dev',
      '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', player_names[i]),
      false, false, false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO profiles (id, name, email, handicap, created_at)
    VALUES (
      pid, player_names[i],
      lower(replace(player_names[i], ' ', '.')) || i || '@seedgolfer.dev',
      player_hcps[i], now()
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- ============================================================
  -- LEAGUE 1 — Stroke Play
  -- ============================================================
  INSERT INTO leagues (name, description, owner_id)
  VALUES (
    'Westside Wednesday Stroke League',
    'Competitive 18-hole stroke play with handicaps and playoffs',
    mason_id
  ) RETURNING id INTO league_stroke;

  INSERT INTO courses (league_id, name, par, holes, slope, rating, scorecard)
  VALUES (league_stroke, 'Pebble Creek Golf Club', 72, 18, 131.0, 72.8,
    '{"tee_name":"White","holes":[
      {"hole":1,  "par":4,"stroke_index":7, "yardage":385},
      {"hole":2,  "par":5,"stroke_index":13,"yardage":520},
      {"hole":3,  "par":3,"stroke_index":17,"yardage":165},
      {"hole":4,  "par":4,"stroke_index":1, "yardage":430},
      {"hole":5,  "par":4,"stroke_index":11,"yardage":360},
      {"hole":6,  "par":4,"stroke_index":5, "yardage":400},
      {"hole":7,  "par":3,"stroke_index":15,"yardage":145},
      {"hole":8,  "par":5,"stroke_index":3, "yardage":545},
      {"hole":9,  "par":4,"stroke_index":9, "yardage":395},
      {"hole":10, "par":4,"stroke_index":4, "yardage":415},
      {"hole":11, "par":3,"stroke_index":16,"yardage":175},
      {"hole":12, "par":5,"stroke_index":8, "yardage":510},
      {"hole":13, "par":4,"stroke_index":2, "yardage":440},
      {"hole":14, "par":4,"stroke_index":12,"yardage":370},
      {"hole":15, "par":3,"stroke_index":18,"yardage":140},
      {"hole":16, "par":5,"stroke_index":6, "yardage":560},
      {"hole":17, "par":4,"stroke_index":10,"yardage":390},
      {"hole":18, "par":4,"stroke_index":14,"yardage":405}
    ]}'::jsonb
  ) RETURNING id INTO cs1;
  INSERT INTO courses (league_id, name, par, holes, slope, rating)
  VALUES (league_stroke, 'Ridgemont Country Club', 71, 18, 124.0, 70.5) RETURNING id INTO cs2;

  INSERT INTO league_settings (league_id, config) VALUES (league_stroke, jsonb_build_object(
    'scoringFormat',       'stroke',
    'roundsPerCourse',     3,
    'attestRequired',      true,
    'scorecardRequired',   false,
    'useHandicap',         true,
    'handicapPct',         100,
    'useSlopeRating',      true,
    'maxHandicap',         28,
    'joinMode',            'invite',
    'maxPlayers',          40,
    'scoresToCount',       5,
    'entryFee',            100,
    'exclusiveWinners',    true,
    'exclusivePrecedence', 'gross',
    'tournamentMode',      false,
    'scrambleTeams',       '[]'::jsonb,
    'ccCommissioner',      false,
    'playoffEnabled',      true,
    'playoffFormat',       'match',
    'playoffQualifiers',   4,
    'playoffSeedingBy',    'net',
    'payoutCategories', '[
      {"id":"champion",     "label":"Champion",                    "pct":50,"mapTo":"playoff","mapRank":1},
      {"id":"runnerUp",     "label":"Runner-Up",                   "pct":20,"mapTo":"playoff","mapRank":2},
      {"id":"thirdPlace",   "label":"Third Place",                 "pct":10,"mapTo":"playoff","mapRank":3},
      {"id":"regularNet",   "label":"Regular Season — Net 1st",    "pct":10,"mapTo":"net",    "mapRank":1},
      {"id":"regularGross", "label":"Regular Season — Gross 1st",  "pct":10,"mapTo":"gross",  "mapRank":1}
    ]'::jsonb
  ));

  INSERT INTO league_members (league_id, user_id, role, paid)
  VALUES (league_stroke, mason_id, 'admin', true);
  FOR i IN 1..31 LOOP
    INSERT INTO league_members (league_id, user_id, role, paid)
    VALUES (league_stroke, p[i], 'player', (i % 4 != 0))
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Mason's rounds (4 completed: 2 per course)
  -- Leaves 1 slot open on each course so Mason can start a fresh live round from the UI
  chcp := round(mason_hcp * 131.0 / 113.0 + (72.8 - 72))::int;
  FOR j IN 0..3 LOOP
    rd    := '2025-04-02'::date + (j * 14);
    gross := 72 + chcp + floor(random() * 10)::int - 2;
    net   := gross - chcp;
    INSERT INTO rounds (league_id, player_id, player_name, course_id, course_name,
                        gross, net, course_handicap, par, date, scoring_format, attest_status)
    VALUES (league_stroke, mason_id, 'Mason Clark',
      CASE WHEN j % 2 = 0 THEN cs1 ELSE cs2 END,
      CASE WHEN j % 2 = 0 THEN 'Pebble Creek Golf Club' ELSE 'Ridgemont Country Club' END,
      gross, net, chcp,
      CASE WHEN j % 2 = 0 THEN 72 ELSE 71 END,
      rd, 'stroke', 'approved');
  END LOOP;

  -- Fake player rounds (6 rounds each, alternating courses)
  FOR i IN 1..31 LOOP
    hcp := player_hcps[i];
    FOR j IN 0..5 LOOP
      rd := '2025-04-02'::date + (j * 14) + floor(random() * 2)::int;
      IF j % 2 = 0 THEN
        slope := 131.0; rating := 72.8; par := 72;
        chcp  := round(hcp * slope / 113.0 + (rating - par))::int;
        gross := par + chcp + floor(random() * 12)::int - 3;
        net   := gross - chcp;
        INSERT INTO rounds (league_id, player_id, player_name, course_id, course_name,
                            gross, net, course_handicap, par, date, scoring_format, attest_status)
        VALUES (league_stroke, p[i], player_names[i], cs1, 'Pebble Creek Golf Club',
                gross, net, chcp, par, rd, 'stroke', 'approved');
      ELSE
        slope := 124.0; rating := 70.5; par := 71;
        chcp  := round(hcp * slope / 113.0 + (rating - par))::int;
        gross := par + chcp + floor(random() * 12)::int - 3;
        net   := gross - chcp;
        INSERT INTO rounds (league_id, player_id, player_name, course_id, course_name,
                            gross, net, course_handicap, par, date, scoring_format, attest_status)
        VALUES (league_stroke, p[i], player_names[i], cs2, 'Ridgemont Country Club',
                gross, net, chcp, par, rd, 'stroke', 'approved');
      END IF;
    END LOOP;
  END LOOP;

  -- ============================================================
  -- LEAGUE 2 — Stableford
  -- ============================================================
  INSERT INTO leagues (name, description, owner_id)
  VALUES (
    'Friday Stableford Series',
    'Standard Stableford — points based on net score relative to par',
    mason_id
  ) RETURNING id INTO league_stableford;

  INSERT INTO courses (league_id, name, par, holes, slope, rating)
  VALUES (league_stableford, 'Oakwood Links',     72, 18, 118.0, 69.8) RETURNING id INTO cf1;
  INSERT INTO courses (league_id, name, par, holes, slope, rating)
  VALUES (league_stableford, 'Sunrise Valley GC', 70, 18, 122.0, 71.1) RETURNING id INTO cf2;

  INSERT INTO league_settings (league_id, config) VALUES (league_stableford, jsonb_build_object(
    'scoringFormat',    'stableford',
    'roundsPerCourse',  2,
    'attestRequired',   false,
    'useHandicap',      true,
    'handicapPct',      100,
    'useSlopeRating',   true,
    'maxHandicap',      36,
    'joinMode',         'open',
    'scoresToCount',    4,
    'entryFee',         50,
    'exclusiveWinners', false,
    'tournamentMode',   false,
    'scrambleTeams',    '[]'::jsonb,
    'playoffEnabled',   false,
    'payoutCategories', '[
      {"id":"champion","label":"Stableford Champion","pct":60,"mapTo":"gross","mapRank":1},
      {"id":"runnerUp","label":"Runner-Up",           "pct":25,"mapTo":"gross","mapRank":2},
      {"id":"ctpPot",  "label":"Closest to Pin Pot",  "pct":15,"mapTo":"none", "mapRank":1}
    ]'::jsonb
  ));

  INSERT INTO league_members (league_id, user_id, role, paid)
  VALUES (league_stableford, mason_id, 'admin', true);
  FOR i IN 1..31 LOOP
    INSERT INTO league_members (league_id, user_id, role, paid)
    VALUES (league_stableford, p[i], 'player', true) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Mason's stableford rounds
  slope := 118.0; rating := 69.8; par := 72;
  chcp  := round(mason_hcp * slope / 113.0 + (rating - par))::int;
  FOR j IN 0..4 LOOP
    rd    := '2025-05-02'::date + (j * 21);
    gross := par + chcp + floor(random() * 10)::int - 3;
    net   := gross - chcp;
    INSERT INTO rounds (league_id, player_id, player_name, course_id, course_name,
                        gross, net, stableford_pts, course_handicap, par, date, scoring_format, attest_status)
    VALUES (league_stableford, mason_id, 'Mason Clark', cf1, 'Oakwood Links',
            gross, net, GREATEST(20, LEAST(55, 36 + (par - net))), chcp, par,
            rd, 'stableford', 'approved');
  END LOOP;

  -- Fake player stableford rounds
  FOR i IN 1..31 LOOP
    hcp := player_hcps[i];
    FOR j IN 0..4 LOOP
      rd := '2025-05-02'::date + (j * 21) + floor(random() * 3)::int;
      IF j % 2 = 0 THEN
        slope := 118.0; rating := 69.8; par := 72;
        chcp  := round(hcp * slope / 113.0 + (rating - par))::int;
        gross := par + chcp + floor(random() * 14)::int - 4;
        net   := gross - chcp;
        INSERT INTO rounds (league_id, player_id, player_name, course_id, course_name,
                            gross, net, stableford_pts, course_handicap, par, date, scoring_format, attest_status)
        VALUES (league_stableford, p[i], player_names[i], cf1, 'Oakwood Links',
                gross, net, GREATEST(20, LEAST(55, 36 + (par - net))), chcp, par,
                rd, 'stableford', 'approved');
      ELSE
        slope := 122.0; rating := 71.1; par := 70;
        chcp  := round(hcp * slope / 113.0 + (rating - par))::int;
        gross := par + chcp + floor(random() * 14)::int - 4;
        net   := gross - chcp;
        INSERT INTO rounds (league_id, player_id, player_name, course_id, course_name,
                            gross, net, stableford_pts, course_handicap, par, date, scoring_format, attest_status)
        VALUES (league_stableford, p[i], player_names[i], cf2, 'Sunrise Valley GC',
                gross, net, GREATEST(20, LEAST(55, 36 + (par - net))), chcp, par,
                rd, 'stableford', 'approved');
      END IF;
    END LOOP;
  END LOOP;

  -- ============================================================
  -- LEAGUE 3 — 4-Man Scramble
  -- ============================================================
  INSERT INTO leagues (name, description, owner_id)
  VALUES (
    'Greek Side Bunker Scramble League',
    'Annual 4-man scramble — 8 teams, 4 rounds, 25% handicap',
    mason_id
  ) RETURNING id INTO league_scramble;

  INSERT INTO courses (league_id, name, par, holes, slope, rating)
  VALUES (league_scramble, 'The Pines Golf Club', 72, 18, 127.0, 71.5) RETURNING id INTO csc;

  -- Teams: mason + p[1..3], then groups of 4
  teams_json := jsonb_build_array(jsonb_build_object(
    'id', 'sc-team-1', 'name', 'Team Birdie',
    'players', jsonb_build_array(mason_id, p[1], p[2], p[3])
  ));
  FOR i IN 1..7 LOOP
    teams_json := teams_json || jsonb_build_array(jsonb_build_object(
      'id',      'sc-team-' || (i + 1),
      'name',    scramble_team_names[i],
      'players', jsonb_build_array(p[i*4], p[i*4+1], p[i*4+2], p[i*4+3])
    ));
  END LOOP;

  INSERT INTO league_settings (league_id, config) VALUES (league_scramble, jsonb_build_object(
    'scoringFormat',    'scramble',
    'attestRequired',   false,
    'useHandicap',      true,
    'handicapPct',      25,
    'useSlopeRating',   true,
    'joinMode',         'invite',
    'entryFee',         200,
    'exclusiveWinners', false,
    'tournamentMode',   false,
    'scrambleTeamSize', 4,
    'teamsFixed',       true,
    'scrambleTeams',    teams_json,
    'playoffEnabled',   false,
    'payoutCategories', '[
      {"id":"t1","label":"1st Place","pct":50,"mapTo":"gross","mapRank":1},
      {"id":"t2","label":"2nd Place","pct":30,"mapTo":"gross","mapRank":2},
      {"id":"t3","label":"3rd Place","pct":20,"mapTo":"gross","mapRank":3}
    ]'::jsonb
  ));

  INSERT INTO league_members (league_id, user_id, role, paid)
  VALUES (league_scramble, mason_id, 'admin', true);
  FOR i IN 1..31 LOOP
    INSERT INTO league_members (league_id, user_id, role, paid)
    VALUES (league_scramble, p[i], 'player', true) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Team 1 (mason's team) rounds — 4 rounds, shared team score
  FOR j IN 0..3 LOOP
    rd    := '2025-06-07'::date + (j * 28);
    gross := 62 + floor(random() * 9)::int;
    chcp  := round((mason_hcp + player_hcps[1] + player_hcps[2] + player_hcps[3]) / 4
                   * 0.25 * 127.0 / 113.0)::int;
    net   := gross - chcp;
    INSERT INTO rounds (league_id, player_id, player_name, course_id, course_name,
                        gross, net, course_handicap, par, date, scoring_format, attest_status, team_id)
    VALUES
      (league_scramble, mason_id, 'Mason Clark',  csc, 'The Pines Golf Club', gross, net, chcp, 72, rd, 'scramble', 'approved', 'sc-team-1'),
      (league_scramble, p[1], player_names[1],    csc, 'The Pines Golf Club', gross, net, chcp, 72, rd, 'scramble', 'approved', 'sc-team-1'),
      (league_scramble, p[2], player_names[2],    csc, 'The Pines Golf Club', gross, net, chcp, 72, rd, 'scramble', 'approved', 'sc-team-1'),
      (league_scramble, p[3], player_names[3],    csc, 'The Pines Golf Club', gross, net, chcp, 72, rd, 'scramble', 'approved', 'sc-team-1');
  END LOOP;

  -- Teams 2–8 rounds
  FOR i IN 1..7 LOOP
    FOR j IN 0..3 LOOP
      rd    := '2025-06-07'::date + (j * 28);
      gross := 62 + floor(random() * 9)::int;
      chcp  := round((player_hcps[i*4] + player_hcps[i*4+1] + player_hcps[i*4+2] + player_hcps[i*4+3]) / 4
                     * 0.25 * 127.0 / 113.0)::int;
      net   := gross - chcp;
      INSERT INTO rounds (league_id, player_id, player_name, course_id, course_name,
                          gross, net, course_handicap, par, date, scoring_format, attest_status, team_id)
      VALUES
        (league_scramble, p[i*4],   player_names[i*4],   csc, 'The Pines Golf Club', gross, net, chcp, 72, rd, 'scramble', 'approved', 'sc-team-'||(i+1)),
        (league_scramble, p[i*4+1], player_names[i*4+1], csc, 'The Pines Golf Club', gross, net, chcp, 72, rd, 'scramble', 'approved', 'sc-team-'||(i+1)),
        (league_scramble, p[i*4+2], player_names[i*4+2], csc, 'The Pines Golf Club', gross, net, chcp, 72, rd, 'scramble', 'approved', 'sc-team-'||(i+1)),
        (league_scramble, p[i*4+3], player_names[i*4+3], csc, 'The Pines Golf Club', gross, net, chcp, 72, rd, 'scramble', 'approved', 'sc-team-'||(i+1));
    END LOOP;
  END LOOP;

  -- ============================================================
  -- LEAGUE 4 — Tournament (2-man, 3 rounds over 2 days)
  -- ============================================================
  INSERT INTO leagues (name, description, owner_id)
  VALUES (
    'Greek Side Annual Tournament',
    'Two-day invitational: Front 9 Scramble · Back 9 Texas Scramble · 18-Hole Best Ball',
    mason_id
  ) RETURNING id INTO league_tournament;

  INSERT INTO courses (league_id, name, par, holes, slope, rating)
  VALUES (league_tournament, 'Harbor Ridge — Front 9', 36,  9, 128.0, 34.9) RETURNING id INTO ct1;
  INSERT INTO courses (league_id, name, par, holes, slope, rating)
  VALUES (league_tournament, 'Harbor Ridge — Back 9',  36,  9, 125.0, 35.2) RETURNING id INTO ct2;
  INSERT INTO courses (league_id, name, par, holes, slope, rating)
  VALUES (league_tournament, 'Lakeside Country Club',  72, 18, 130.0, 72.5) RETURNING id INTO ct3;

  -- 16 two-man teams: mason + p[1], then pairs p[2]&p[3] ... p[30]&p[31]
  teams_json := jsonb_build_array(jsonb_build_object(
    'id', 'tr-team-1', 'name', 'Clark & Adams',
    'players', jsonb_build_array(mason_id, p[1])
  ));
  FOR i IN 1..15 LOOP
    teams_json := teams_json || jsonb_build_array(jsonb_build_object(
      'id',      'tr-team-' || (i + 1),
      'name',    player_names[i*2] || ' & ' || player_names[i*2+1],
      'players', jsonb_build_array(p[i*2], p[i*2+1])
    ));
  END LOOP;

  INSERT INTO league_settings (league_id, config) VALUES (league_tournament, jsonb_build_object(
    'scoringFormat',       'tournament',
    'tournamentMode',      true,
    'teamsFixed',          true,
    'scrambleTeamSize',    2,
    'scrambleTeams',       teams_json,
    'attestRequired',      false,
    'useHandicap',         true,
    'useSlopeRating',      true,
    'entryFee',            300,
    'exclusiveWinners',    true,
    'exclusivePrecedence', 'gross',
    'playoffEnabled',      false,
    'tournamentRounds', jsonb_build_array(
      jsonb_build_object(
        'id','tr-round-1','day',1,
        'label','Morning Scramble (Front 9)',
        'holes',9,'format','scramble','teamSize',2,
        'courseId',ct1,'handicapPct',25,'scrambleHcpMethod','lowest'
      ),
      jsonb_build_object(
        'id','tr-round-2','day',1,
        'label','Afternoon Texas Scramble (Back 9)',
        'holes',9,'format','texas_scramble','teamSize',2,
        'courseId',ct2,'handicapPct',50,'scrambleHcpMethod','each'
      ),
      jsonb_build_object(
        'id','tr-round-3','day',2,
        'label','Best Ball — 18 Holes',
        'holes',18,'format','best_ball','teamSize',2,
        'courseId',ct3,'handicapPct',100,'scrambleHcpMethod','each'
      )
    ),
    'payoutCategories', '[
      {"id":"tChamp", "label":"Tournament Champion","pct":40,"mapTo":"gross","mapRank":1},
      {"id":"tRunner","label":"Runner-Up",           "pct":25,"mapTo":"gross","mapRank":2},
      {"id":"tThird", "label":"Third Place",         "pct":15,"mapTo":"gross","mapRank":3},
      {"id":"bbNet",  "label":"Best Ball Net Winner","pct":20,"mapTo":"net",  "mapRank":1}
    ]'::jsonb
  ));

  INSERT INTO league_members (league_id, user_id, role, paid)
  VALUES (league_tournament, mason_id, 'admin', true);
  FOR i IN 1..31 LOOP
    INSERT INTO league_members (league_id, user_id, role, paid)
    VALUES (league_tournament, p[i], 'player', true) ON CONFLICT DO NOTHING;
  END LOOP;

  -- ── Tournament round scores ──────────────────────────────
  -- Scramble/Texas: both teammates share the same gross.
  -- Best Ball: each player has their own score.

  -- Team 1: mason & p[1]
  FOR j IN 1..3 LOOP
    rd    := CASE WHEN j <= 2 THEN '2025-09-13'::date ELSE '2025-09-14'::date END;
    gross := CASE WHEN j=1 THEN 32 + floor(random()*8)::int
                  WHEN j=2 THEN 33 + floor(random()*8)::int
                  ELSE          68 + floor(random()*10)::int END;
    par   := CASE WHEN j <= 2 THEN 36 ELSE 72 END;

    chcp := CASE
      WHEN j=1 THEN round(LEAST(mason_hcp, player_hcps[1]) * 0.25 * 128.0/113.0)::int
      WHEN j=2 THEN round(mason_hcp * 0.50 * 125.0/113.0)::int
      ELSE          round(mason_hcp * 1.00 * 130.0/113.0 + (72.5-72))::int END;
    INSERT INTO rounds (league_id, player_id, player_name, course_id, course_name,
                        gross, net, course_handicap, par, date, scoring_format,
                        attest_status, team_id, tournament_round_id)
    VALUES (league_tournament, mason_id, 'Mason Clark',
      CASE WHEN j=1 THEN ct1 WHEN j=2 THEN ct2 ELSE ct3 END,
      CASE WHEN j=1 THEN 'Harbor Ridge — Front 9' WHEN j=2 THEN 'Harbor Ridge — Back 9' ELSE 'Lakeside Country Club' END,
      gross, gross-chcp, chcp, par, rd,
      CASE WHEN j=1 THEN 'scramble' WHEN j=2 THEN 'texas_scramble' ELSE 'best_ball' END,
      'approved','tr-team-1',
      CASE WHEN j=1 THEN 'tr-round-1' WHEN j=2 THEN 'tr-round-2' ELSE 'tr-round-3' END);

    IF j = 3 THEN gross := 70 + floor(random()*12)::int; END IF;
    chcp := CASE
      WHEN j=1 THEN round(LEAST(mason_hcp, player_hcps[1]) * 0.25 * 128.0/113.0)::int
      WHEN j=2 THEN round(player_hcps[1] * 0.50 * 125.0/113.0)::int
      ELSE          round(player_hcps[1] * 1.00 * 130.0/113.0 + (72.5-72))::int END;
    INSERT INTO rounds (league_id, player_id, player_name, course_id, course_name,
                        gross, net, course_handicap, par, date, scoring_format,
                        attest_status, team_id, tournament_round_id)
    VALUES (league_tournament, p[1], player_names[1],
      CASE WHEN j=1 THEN ct1 WHEN j=2 THEN ct2 ELSE ct3 END,
      CASE WHEN j=1 THEN 'Harbor Ridge — Front 9' WHEN j=2 THEN 'Harbor Ridge — Back 9' ELSE 'Lakeside Country Club' END,
      gross, gross-chcp, chcp, par, rd,
      CASE WHEN j=1 THEN 'scramble' WHEN j=2 THEN 'texas_scramble' ELSE 'best_ball' END,
      'approved','tr-team-1',
      CASE WHEN j=1 THEN 'tr-round-1' WHEN j=2 THEN 'tr-round-2' ELSE 'tr-round-3' END);
  END LOOP;

  -- Teams 2–16
  FOR i IN 1..15 LOOP
    FOR j IN 1..3 LOOP
      rd    := CASE WHEN j <= 2 THEN '2025-09-13'::date ELSE '2025-09-14'::date END;
      gross := CASE WHEN j=1 THEN 32 + floor(random()*9)::int
                    WHEN j=2 THEN 33 + floor(random()*9)::int
                    ELSE          68 + floor(random()*14)::int END;
      par   := CASE WHEN j <= 2 THEN 36 ELSE 72 END;

      chcp := CASE
        WHEN j=1 THEN round(LEAST(player_hcps[i*2],player_hcps[i*2+1]) * 0.25 * 128.0/113.0)::int
        WHEN j=2 THEN round(player_hcps[i*2] * 0.50 * 125.0/113.0)::int
        ELSE          round(player_hcps[i*2] * 1.00 * 130.0/113.0 + (72.5-72))::int END;
      INSERT INTO rounds (league_id, player_id, player_name, course_id, course_name,
                          gross, net, course_handicap, par, date, scoring_format,
                          attest_status, team_id, tournament_round_id)
      VALUES (league_tournament, p[i*2], player_names[i*2],
        CASE WHEN j=1 THEN ct1 WHEN j=2 THEN ct2 ELSE ct3 END,
        CASE WHEN j=1 THEN 'Harbor Ridge — Front 9' WHEN j=2 THEN 'Harbor Ridge — Back 9' ELSE 'Lakeside Country Club' END,
        gross, gross-chcp, chcp, par, rd,
        CASE WHEN j=1 THEN 'scramble' WHEN j=2 THEN 'texas_scramble' ELSE 'best_ball' END,
        'approved','tr-team-'||(i+1),
        CASE WHEN j=1 THEN 'tr-round-1' WHEN j=2 THEN 'tr-round-2' ELSE 'tr-round-3' END);

      IF j = 3 THEN gross := 70 + floor(random()*14)::int; END IF;
      chcp := CASE
        WHEN j=1 THEN round(LEAST(player_hcps[i*2],player_hcps[i*2+1]) * 0.25 * 128.0/113.0)::int
        WHEN j=2 THEN round(player_hcps[i*2+1] * 0.50 * 125.0/113.0)::int
        ELSE          round(player_hcps[i*2+1] * 1.00 * 130.0/113.0 + (72.5-72))::int END;
      INSERT INTO rounds (league_id, player_id, player_name, course_id, course_name,
                          gross, net, course_handicap, par, date, scoring_format,
                          attest_status, team_id, tournament_round_id)
      VALUES (league_tournament, p[i*2+1], player_names[i*2+1],
        CASE WHEN j=1 THEN ct1 WHEN j=2 THEN ct2 ELSE ct3 END,
        CASE WHEN j=1 THEN 'Harbor Ridge — Front 9' WHEN j=2 THEN 'Harbor Ridge — Back 9' ELSE 'Lakeside Country Club' END,
        gross, gross-chcp, chcp, par, rd,
        CASE WHEN j=1 THEN 'scramble' WHEN j=2 THEN 'texas_scramble' ELSE 'best_ball' END,
        'approved','tr-team-'||(i+1),
        CASE WHEN j=1 THEN 'tr-round-1' WHEN j=2 THEN 'tr-round-2' ELSE 'tr-round-3' END);
    END LOOP;
  END LOOP;

  RAISE NOTICE '=== Seed complete ===';
  RAISE NOTICE 'Stroke League ID:      %', league_stroke;
  RAISE NOTICE 'Stableford League ID:  %', league_stableford;
  RAISE NOTICE 'Scramble League ID:    %', league_scramble;
  RAISE NOTICE 'Tournament League ID:  %', league_tournament;

END $$;

-- ── Step 4: Restore constraints and trigger ───────────────
ALTER TABLE leagues ENABLE TRIGGER USER;

-- ── Step 5: Mark all seed rounds as completed ─────────────
-- The app filters on round_status = 'completed' for the leaderboard.
-- Seed rounds are inserted without this column so we set it here.
UPDATE rounds SET round_status = 'completed'
WHERE attest_status = 'approved' AND (round_status IS NULL OR round_status != 'completed');
