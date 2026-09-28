export const calcCourseHcp = (idx, slope, par, rating, cfg) => {
  const safeIdx = Number(idx) || 0;
  const safeSlope = Number(slope) || 113;
  const safePar = Number(par) || 72;
  const safeRating = Number(rating) || 72;
  const safePct = Number(cfg?.handicapPct) || 100;
  const raw = cfg?.useSlopeRating
    ? (safeIdx * (safeSlope / 113)) + (safeRating - safePar)
    : safeIdx;
  const capped = cfg?.maxHandicap ? Math.min(raw, cfg.maxHandicap) : raw;
  return Math.round(capped * (safePct / 100));
};

export const calcStableford = (gross, hcp, par) => {
  const g = Number(gross) || 0;
  const h = Number(hcp) || 0;
  const p = Number(par) || 72;
  return Math.max(0, 2 + (p - (g - h)));
};

export const toPM = (v, p) => {
  const d = (Number(v) || 0) - (Number(p) || 0);
  return d === 0 ? "E" : d > 0 ? `+${d}` : `${d}`;
};

export const pmCls = (v, p) => {
  const d = (Number(v) || 0) - (Number(p) || 0);
  return d < 0 ? "under" : d > 0 ? "over" : "even";
};

const seasonEndDate = (end) => {
  if (!end) return null;
  return new Date(String(end).includes("T") ? end : `${end}T23:59:59`);
};

export const isSeasonActive = (cfg, now = new Date()) => {
  if (!cfg?.seasonStart && !cfg?.seasonEnd) return true;
  if (cfg.seasonStart && new Date(cfg.seasonStart) > now) return false;
  const end = seasonEndDate(cfg.seasonEnd);
  if (end && end < now) return false;
  return true;
};

export const isAfterSeasonEnd = (cfg, now = new Date()) => {
  const end = seasonEndDate(cfg?.seasonEnd);
  return !!(end && now > end);
};

export const ini = (n = "") => {
  if (!n || typeof n !== "string") return "?";
  return n.split(" ").map(w => w[0]).filter(Boolean).join("").toUpperCase().slice(0, 2) || "?";
};

/** Same player, calendar day, course, gross, and net. */
export const exactRoundKey = (r) => {
  const day = String(r.date ?? "").slice(0, 10);
  return `${r.player_id}|${day}|${r.course_id ?? ""}|${Number(r.gross)}|${Number(r.net)}`;
};

/** Same player, calendar day, course, gross, and net — keep the first. */
export const dedupeExactRounds = (rounds = []) => {
  const seen = new Set();
  return (rounds ?? []).filter(r => {
    const key = exactRoundKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const findDuplicateRound = (rounds = [], candidate, { ignoreId } = {}) => {
  if (candidate == null || candidate.gross == null || candidate.net == null || !candidate.date) return null;
  const key = exactRoundKey(candidate);
  return (rounds ?? []).find(r => {
    if (ignoreId && r.id === ignoreId) return false;
    if (r.round_status === "in_progress") return false;
    if (r.attest_status === "rejected") return false;
    return exactRoundKey(r) === key;
  }) ?? null;
};

/** Completed round already on the books for this player / day / course. */
export const findExistingRoundOnDayCourse = (rounds = [], candidate, { ignoreId } = {}) => {
  if (!candidate?.player_id || !candidate?.date || candidate.course_id == null) return null;
  const day = String(candidate.date).slice(0, 10);
  const course = String(candidate.course_id);
  return (rounds ?? []).find(r => {
    if (ignoreId && r.id === ignoreId) return false;
    if (r.round_status === "in_progress") return false;
    if (r.attest_status === "rejected") return false;
    return String(r.player_id) === String(candidate.player_id)
      && String(r.date ?? "").slice(0, 10) === day
      && String(r.course_id ?? "") === course;
  }) ?? null;
};
