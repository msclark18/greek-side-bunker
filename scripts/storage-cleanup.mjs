// ============================================================
// GSB Storage Cleanup — deletes orphaned scorecard & bylaw files
// via the Supabase Storage API (SQL can't do this directly).
//
// Usage:
//   SUPABASE_SERVICE_KEY=your_service_role_key node scripts/storage-cleanup.mjs
//
// Get your service role key from:
//   Supabase Dashboard → Settings → API → service_role
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ngesupnegqzoytucipii.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_KEY env var.");
  console.error("Run as: SUPABASE_SERVICE_KEY=your_key node scripts/storage-cleanup.mjs");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Config ──────────────────────────────────────────────────
const DELETE_ORPHANS     = true;   // delete files with no matching round/league
const DELETE_OLDER_THAN  = null;   // e.g. "1 year" | "6 months" | null to skip
const DRY_RUN            = false;   // set to false to actually delete
// ────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nMode: ${DRY_RUN ? "DRY RUN (nothing will be deleted)" : "LIVE — will delete files"}\n`);

  await cleanScorecards();
  await cleanBylaws();
}

// ── Scorecards ───────────────────────────────────────────────
async function cleanScorecards() {
  console.log("── Scorecards ──────────────────────────────────────");

  const { data: files, error: listErr } = await supabase.storage
    .from("scorecards")
    .list("scorecards", { limit: 1000 });

  if (listErr) { console.error("Failed to list scorecard files:", listErr.message); return; }
  if (!files?.length) { console.log("No scorecard files found.\n"); return; }

  console.log(`Found ${files.length} file(s).`);

  const { data: rounds } = await supabase
    .from("rounds")
    .select("scorecard_url, created_at")
    .not("scorecard_url", "is", null);

  const referencedIds = new Set(
    (rounds || []).map(r => {
      const parts = r.scorecard_url?.split("/scorecards/");
      return parts?.[1]?.split(".")[0];
    }).filter(Boolean)
  );

  const cutoff = DELETE_OLDER_THAN
    ? new Date(Date.now() - parseDuration(DELETE_OLDER_THAN))
    : null;

  const orphaned = [];
  const old      = [];

  for (const file of files) {
    const fileId   = file.name.split(".")[0];
    const isOrphan = !referencedIds.has(fileId);
    const isOld    = cutoff && new Date(file.created_at) < cutoff;

    if (isOrphan && DELETE_ORPHANS) orphaned.push(`scorecards/${file.name}`);
    else if (isOld)                 old.push(`scorecards/${file.name}`);
  }

  console.log(`  Orphaned: ${orphaned.length}  |  Old: ${old.length}  |  Keeping: ${files.length - orphaned.length - old.length}`);
  await deleteFiles("scorecards", [...orphaned, ...old]);

  if (!DRY_RUN && old.length > 0 && cutoff) {
    await supabase.from("rounds")
      .update({ scorecard_url: null })
      .lt("created_at", cutoff.toISOString())
      .not("scorecard_url", "is", null);
  }
  console.log();
}

// ── Bylaws ───────────────────────────────────────────────────
async function cleanBylaws() {
  console.log("── Bylaws ──────────────────────────────────────────");

  const { data: files, error: listErr } = await supabase.storage
    .from("bylaws")
    .list("bylaws", { limit: 1000 });

  if (listErr) { console.error("Failed to list bylaw files:", listErr.message); return; }
  if (!files?.length) { console.log("No bylaw files found.\n"); return; }

  console.log(`Found ${files.length} file(s).`);

  // Each file is named {league_id}.pdf
  const { data: leagues } = await supabase.from("leagues").select("id");
  const leagueIds = new Set((leagues || []).map(l => l.id));

  const orphaned = files
    .filter(f => !leagueIds.has(f.name.replace(".pdf", "")))
    .map(f => `bylaws/${f.name}`);

  console.log(`  Orphaned (league deleted): ${orphaned.length}  |  Keeping: ${files.length - orphaned.length}`);
  await deleteFiles("bylaws", orphaned);
  console.log();
}

// ── Shared delete helper ─────────────────────────────────────
async function deleteFiles(bucket, paths) {
  if (!paths.length) { console.log("  Nothing to delete."); return; }

  if (DRY_RUN) {
    console.log("  Would delete:");
    paths.forEach(p => console.log("   ", p));
    console.log("  Set DRY_RUN = false to actually delete.");
    return;
  }

  let deleted = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await supabase.storage.from(bucket).remove(batch);
    if (error) console.error(`  Batch error:`, error.message);
    else deleted += batch.length;
  }
  console.log(`  Deleted ${deleted} file(s).`);
}

function parseDuration(str) {
  const [n, unit] = str.trim().split(" ");
  const ms = { year: 365, years: 365, month: 30, months: 30, week: 7, weeks: 7, day: 1, days: 1 };
  return Number(n) * (ms[unit] ?? 1) * 86400000;
}

run().catch(e => { console.error(e); process.exit(1); });
