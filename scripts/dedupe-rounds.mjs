// ============================================================
// Delete exact duplicate rounds (same player, day, course, gross, net).
// Keeps one copy per group (prefers a scorecard, then earliest created_at).
//
// Usage:
//   SUPABASE_SERVICE_KEY=your_service_role_key node scripts/dedupe-rounds.mjs
//   SUPABASE_SERVICE_KEY=your_key node scripts/dedupe-rounds.mjs --live
//
// Default is a dry run. Pass --live to actually delete.
// Optional: LEAGUE_ID=<uuid> to limit to one league.
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ngesupnegqzoytucipii.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const LIVE = process.argv.includes("--live");
const LEAGUE_ID = process.env.LEAGUE_ID || null;

if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_KEY env var.");
  console.error("Run as: SUPABASE_SERVICE_KEY=your_key node scripts/dedupe-rounds.mjs");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const exactKey = (r) => {
  const day = String(r.date ?? "").slice(0, 10);
  return `${r.player_id}|${day}|${r.course_id ?? ""}|${Number(r.gross)}|${Number(r.net)}`;
};

const keepRank = (r) => [
  r.scorecard_url ? 1 : 0,
  r.created_at ? Date.parse(r.created_at) : Number.MAX_SAFE_INTEGER,
  String(r.id ?? ""),
];

const isBetterKeep = (a, b) => {
  const ra = keepRank(a);
  const rb = keepRank(b);
  if (ra[0] !== rb[0]) return ra[0] > rb[0];
  if (ra[1] !== rb[1]) return ra[1] < rb[1];
  return ra[2] < rb[2];
};

async function fetchAllRounds() {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  while (true) {
    let query = supabase
      .from("rounds")
      .select("id, league_id, player_id, player_name, date, course_id, course_name, gross, net, round_status, attest_status, scorecard_url, created_at")
      .range(from, from + pageSize - 1);
    if (LEAGUE_ID) query = query.eq("league_id", LEAGUE_ID);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function deleteIds(ids) {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { error } = await supabase.from("rounds").delete().in("id", batch);
    if (error) {
      console.error("  Delete batch failed:", error.message);
    } else {
      deleted += batch.length;
    }
  }
  return deleted;
}

async function deleteScorecards(urls) {
  const paths = urls
    .map((url) => {
      const parts = url?.split("/scorecards/");
      return parts?.[1] ? `scorecards/${parts[1]}` : null;
    })
    .filter(Boolean);
  if (!paths.length) return;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await supabase.storage.from("scorecards").remove(batch);
    if (error) console.error("  Scorecard cleanup failed:", error.message);
  }
}

async function run() {
  console.log(`\nMode: ${LIVE ? "LIVE — will delete duplicate rounds" : "DRY RUN (pass --live to delete)"}\n`);
  if (LEAGUE_ID) console.log(`League: ${LEAGUE_ID}\n`);

  const rounds = await fetchAllRounds();
  console.log(`Loaded ${rounds.length} round(s).`);

  const groups = new Map();
  for (const r of rounds) {
    if (r.round_status === "in_progress") continue;
    if (r.attest_status === "rejected") continue;
    const key = exactKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const extras = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const keep = list.reduce((best, r) => (isBetterKeep(r, best) ? r : best));
    for (const r of list) {
      if (r.id !== keep.id) extras.push(r);
    }
  }

  console.log(`Duplicate extras: ${extras.length}`);
  extras.forEach((r) => {
    console.log(`  ${r.id}  ${r.player_name}  ${String(r.date).slice(0, 10)}  ${r.course_name}  G${r.gross}/N${r.net}`);
  });

  if (!extras.length) {
    console.log("Nothing to delete.\n");
    return;
  }

  if (!LIVE) {
    console.log("\nDry run only. Re-run with --live to delete these rows from All Rounds.\n");
    return;
  }

  const deleted = await deleteIds(extras.map((r) => r.id));
  await deleteScorecards(extras.map((r) => r.scorecard_url).filter(Boolean));
  console.log(`\nDeleted ${deleted} duplicate round(s).\n`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
