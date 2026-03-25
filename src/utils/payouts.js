// Pure payout-winner resolution — no React, no Supabase.
// Imported by Leaderboard.jsx and tested directly.

export const resolveCatMap = (cat) => {
  if (cat.mapTo) return { mapTo: cat.mapTo, mapRank: cat.mapRank ?? 1 };
  // Legacy id → type mapping kept for backwards compat
  const legacyIdToType = {
    champion: "playoff_1",
    runnerUp: "playoff_2",
    thirdPlace: "playoff_3",
    regularNet: "net_1",
    regularGross: "gross_1",
  };
  const type = cat.type ?? legacyIdToType[cat.id];
  if (!type || type === "none") return { mapTo: "none", mapRank: 1 };
  const m = type.match(/^(playoff|net|gross)_(\d+)$/);
  return m ? { mapTo: m[1], mapRank: Number(m[2]) } : { mapTo: "none", mapRank: 1 };
};

/**
 * Resolve payout winners for each category.
 *
 * @param {object} opts
 * @param {Array}  opts.cats           - payoutCategories config array
 * @param {Array}  opts.netLB          - net leaderboard [{name, ...}], sorted best first
 * @param {Array}  opts.grossLB        - gross leaderboard [{name, ...}], sorted best first
 * @param {object} opts.playoffResults - { champion, runnerUp, thirdPlace } — all nullable
 * @param {boolean} opts.exclusive     - one award per player/team
 * @param {string}  opts.precedence    - "net" | "gross" | "highest" (only when exclusive)
 * @param {object}  opts.lbOverrides   - { [catId]: { netLB, grossLB } } per-category LB override
 * @returns {{ [catId]: string | null }}
 */
export const resolvePayouts = ({
  cats,
  netLB,
  grossLB,
  playoffResults = {},
  exclusive = false,
  precedence = "gross",
  lbOverrides = {},
}) => {
  const { champion = null, runnerUp = null, thirdPlace = null } = playoffResults;

  const resolveDirect = ({ mapTo, mapRank }, cat, skip = new Set()) => {
    if (mapTo === "none") return cat.winner ?? null;
    if (mapTo === "playoff") {
      const cands = [champion, runnerUp, thirdPlace];
      return cands[mapRank - 1] ?? null;
    }
    const ovr = lbOverrides[cat.id];
    const lb = mapTo === "gross" ? (ovr?.grossLB ?? grossLB) : (ovr?.netLB ?? netLB);
    let rank = 0;
    for (const entry of lb) {
      if (!skip.has(entry.name)) {
        rank++;
        if (rank === mapRank) return entry.name;
      }
    }
    return null;
  };

  if (!exclusive) {
    return Object.fromEntries(
      cats.map(cat => [cat.id, resolveDirect(resolveCatMap(cat), cat)])
    );
  }

  // Exclusive: assign categories in priority order; each winner blocks
  // subsequent categories — no player/team can win more than one payout.
  const usedWinners = new Set();
  const orderedCats =
    precedence === "highest"
      ? [...cats].sort((a, b) => b.pct - a.pct)
      : [
          ...cats.filter(c => resolveCatMap(c).mapTo === precedence),
          ...cats.filter(c => resolveCatMap(c).mapTo !== precedence),
        ];

  const result = {};
  for (const cat of orderedCats) {
    const winner = resolveDirect(resolveCatMap(cat), cat, usedWinners);
    if (winner) usedWinners.add(winner);
    result[cat.id] = winner;
  }
  return result;
};
