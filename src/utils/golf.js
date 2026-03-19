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

export const isSeasonActive = (cfg) => {
  if (!cfg?.seasonStart && !cfg?.seasonEnd) return true;
  const now = new Date();
  if (cfg.seasonStart && new Date(cfg.seasonStart) > now) return false;
  if (cfg.seasonEnd && new Date(cfg.seasonEnd) < now) return false;
  return true;
};

export const ini = (n = "") => {
  if (!n || typeof n !== "string") return "?";
  return n.split(" ").map(w => w[0]).filter(Boolean).join("").toUpperCase().slice(0, 2) || "?";
};
