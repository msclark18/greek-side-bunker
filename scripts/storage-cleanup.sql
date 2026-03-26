-- ============================================================
-- GSB Storage Cleanup
-- Run each block individually in Supabase → SQL Editor
-- ============================================================

-- ── 1. See what you're working with ────────────────────────
-- Shows all scorecard files, their size, and whether the
-- associated round still exists.
SELECT
  o.name                                        AS file,
  round(((o.metadata->>'size')::numeric / 1024 / 1024), 2) AS size_mb,
  o.created_at,
  r.id IS NOT NULL                              AS round_exists,
  r.round_status
FROM storage.objects o
LEFT JOIN rounds r ON r.id::text = split_part(o.name, '/', 2)::text
                   OR r.scorecard_url LIKE '%' || split_part(o.name, '/', 2) || '%'
WHERE o.bucket_id = 'scorecards'
ORDER BY o.created_at ASC;


-- ── 2. Summary: total files and space used ─────────────────
SELECT
  count(*)                                                        AS total_files,
  round(sum((metadata->>'size')::numeric) / 1024 / 1024, 2)     AS total_mb
FROM storage.objects
WHERE bucket_id = 'scorecards';


-- ── 3. Orphaned files (round was deleted) ──────────────────
-- Safe to delete — no round references these anymore.
SELECT o.name, o.created_at,
  round(((o.metadata->>'size')::numeric / 1024), 0) AS size_kb
FROM storage.objects o
LEFT JOIN rounds r ON r.scorecard_url LIKE '%' || split_part(o.name, '/', 2) || '%'
WHERE o.bucket_id = 'scorecards'
  AND r.id IS NULL
ORDER BY o.created_at ASC;


-- ── 4 & 5. DELETING files ──────────────────────────────────
-- Supabase blocks direct SQL deletes from storage.objects.
-- Use the JS script instead:
--
--   SUPABASE_SERVICE_KEY=your_key node scripts/storage-cleanup.mjs
--
-- Get your service role key from:
--   Supabase Dashboard → Settings → API → service_role
