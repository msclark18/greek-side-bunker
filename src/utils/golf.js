export const calcCourseHcp = (idx, slope, par, rating, cfg) => {
  const raw = cfg.useSlopeRating ? (idx * (slope / 113)) + (rating - par) : idx;
  const capped = cfg.maxHandicap ? Math.min(raw, cfg.maxHandicap) : raw;
  return Math.round(capped * (cfg.handicapPct / 100));
};

export const calcStableford = (gross, hcp, par) => Math.max(0, 2 + (par - (gross - hcp)));

export const toPM = (v, p) => {
  const d = v - p;
  return d === 0 ? "E" : d > 0 ? `+${d}` : `${d}`;
};

export const pmCls = (v, p) => {
  const d = v - p;
  return d < 0 ? "under" : d > 0 ? "over" : "even";
};

export const isSeasonActive = (cfg) => {
  if (!cfg.seasonStart && !cfg.seasonEnd) return true;
  const now = new Date();
  if (cfg.seasonStart && new Date(cfg.seasonStart) > now) return false;
  if (cfg.seasonEnd && new Date(cfg.seasonEnd) < now) return false;
  return true;
};

export const ini = (n = "") =>
  n.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
