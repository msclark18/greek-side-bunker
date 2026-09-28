/** Distinct regular-season courses a player has an approved round on. */
export const distinctCoursesPlayed = (rounds = [], regularCourseIds = []) => {
  const ids = new Set((regularCourseIds ?? []).map(id => String(id)));
  const played = new Set();
  for (const r of rounds ?? []) {
    const cid = String(r.course_id);
    if (ids.has(cid)) played.add(cid);
  }
  return played.size;
};

export const netAverage = (rounds = []) => {
  const valid = (rounds ?? []).filter(r => r.net != null && !Number.isNaN(Number(r.net)));
  if (!valid.length) return null;
  return valid.reduce((s, r) => s + Number(r.net), 0) / valid.length;
};

/** Best net at each regular-season course, then average those course-bests. */
export const bestNetPerCourseAverage = (rounds = [], regularCourseIds = []) => {
  const ids = new Set((regularCourseIds ?? []).map(id => String(id)));
  const bestByCourse = {};
  for (const r of rounds ?? []) {
    const cid = String(r.course_id);
    if (!ids.has(cid) || r.net == null || Number.isNaN(Number(r.net))) continue;
    const net = Number(r.net);
    if (bestByCourse[cid] == null || net < bestByCourse[cid]) bestByCourse[cid] = net;
  }
  const bests = Object.values(bestByCourse);
  if (!bests.length) return null;
  return bests.reduce((s, n) => s + n, 0) / bests.length;
};

/** NCAA-style pairing for a power-of-two bracket. Returns [[seedA, seedB], ...]. */
export const standardPairs = (size) => {
  const n = Number(size);
  if (!n || n < 2) return [];
  const getPairs = (s) => {
    if (s === 2) return [[1, 2]];
    return getPairs(s / 2).flatMap(([a, b]) => [[a, s + 1 - a], [s + 1 - b, b]]);
  };
  return getPairs(n);
};

export const matchCourseByName = (courses = [], name) => {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  return (courses ?? []).find(c => (c.name ?? "").toLowerCase() === n)
    ?? (courses ?? []).find(c => {
      const cn = (c.name ?? "").toLowerCase();
      return cn.includes(n) || n.includes(cn);
    })
    ?? null;
};

export const qualificationStatus = (coursesPlayed, totalCourses, { minCourses = 2, byePriorityCourses = 4, noByeMaxCourses = 2 } = {}) => {
  if (coursesPlayed >= byePriorityCourses) return "byePriority";
  if (coursesPlayed >= minCourses && coursesPlayed > noByeMaxCourses) return "qualified";
  if (coursesPlayed >= minCourses) return "qualifiedNoBye";
  return "notQualified";
};

const QUAL_LABELS = {
  byePriority: "Bye priority",
  qualified: "Qualified",
  qualifiedNoBye: "Qualified — no bye",
  notQualified: "Not qualified",
};

export const qualificationLabel = (status) => QUAL_LABELS[status] ?? status;

/**
 * Build a course-eligibility playoff field.
 * Round 1 cuts to `cutTo` (default 8). Seeds 1–`byePriorityCourses` are reserved
 * for players who completed that many courses, then 3-course players if needed.
 * Byes go to 4/4 then 3/4 in seed order; a player with only `noByeMaxCourses`
 * courses never gets a Round 1 bye unless the remaining field would be odd.
 */
export const buildCoursePlayoff = ({
  players = [],
  roundsByPlayer = {},
  regularCourses = [],
  minCourses = 2,
  byePriorityCourses = 4,
  noByeMaxCourses = 2,
  cutTo = 8,
  maxField = 16,
  seedBestPerCourse = false,
} = {}) => {
  const courseIds = (regularCourses ?? []).map(c => c.id);
  const totalCourses = courseIds.length;

  const annotated = (players ?? []).map(p => {
    const pr = roundsByPlayer[p.id] ?? roundsByPlayer[String(p.id)] ?? [];
    const coursesPlayed = distinctCoursesPlayed(pr, courseIds);
    const netAvg = seedBestPerCourse ? bestNetPerCourseAverage(pr, courseIds) : netAverage(pr);
    const nets = pr.map(r => Number(r.net)).filter(n => !Number.isNaN(n));
    const bestNet = nets.length ? Math.min(...nets) : null;
    const status = qualificationStatus(coursesPlayed, totalCourses, { minCourses, byePriorityCourses, noByeMaxCourses });
    return { ...p, coursesPlayed, totalCourses, netAvg, bestNet, status };
  });

  const byNet = (a, b) =>
    a.netAvg - b.netAvg
    || b.coursesPlayed - a.coursesPlayed
    || (a.bestNet ?? 999) - (b.bestNet ?? 999)
    || String(a.name ?? "").localeCompare(String(b.name ?? ""));
  const eligible = annotated.filter(p => p.coursesPlayed >= minCourses && p.netAvg != null);

  // Seeds 1–N (N = bye-priority course count, default 4) are reserved for
  // 4-course players, then 3-course players if those slots are not full.
  // Everyone else is seeded no higher than N+1, then by net.
  const reservedCount = byePriorityCourses;
  const fourPlus = eligible.filter(p => p.coursesPlayed >= byePriorityCourses).sort(byNet);
  const threeOfFourEligible = eligible
    .filter(p => p.coursesPlayed > noByeMaxCourses && p.coursesPlayed < byePriorityCourses)
    .sort(byNet);
  const reserved = [...fourPlus, ...threeOfFourEligible].slice(0, reservedCount);
  const reservedIds = new Set(reserved.map(p => p.id));
  const rest = eligible.filter(p => !reservedIds.has(p.id)).sort(byNet);
  const field = [...reserved, ...rest].slice(0, maxField).map((p, i) => ({ ...p, seed: i + 1 }));
  const ineligible = annotated
    .filter(p => !field.some(f => f.id === p.id))
    .sort((a, b) => (b.coursesPlayed - a.coursesPlayed) || String(a.name ?? "").localeCompare(String(b.name ?? "")));

  const n = field.length;
  const bracketSize = n <= cutTo ? cutTo : maxField;
  const numByes = Math.max(0, bracketSize - n);

  const fourOfFour = field.filter(p => p.coursesPlayed >= byePriorityCourses);
  const threeOfFour = field.filter(p => p.coursesPlayed > noByeMaxCourses && p.coursesPlayed < byePriorityCourses);
  const byePool = [...fourOfFour, ...threeOfFour];
  const byeRecipients = byePool.slice(0, numByes);
  const byeIds = new Set(byeRecipients.map(p => p.id));

  let remaining = field.filter(p => !byeIds.has(p.id));
  if (remaining.length % 2 === 1) {
    const extra = remaining[0];
    byeRecipients.push(extra);
    byeIds.add(extra.id);
    remaining = remaining.filter(p => p.id !== extra.id);
  }

  const byeMatchups = field
    .filter(p => byeIds.has(p.id))
    .map(p => ({
      p1: p.name,
      p2: null,
      winner: p.name,
      isBye: true,
      seed1: p.seed,
      seed2: null,
    }));

  const playInMatchups = [];
  const half = remaining.length / 2;
  for (let i = 0; i < half; i++) {
    const high = remaining[i];
    const low = remaining[remaining.length - 1 - i];
    playInMatchups.push({
      p1: high.name,
      p2: low.name,
      winner: null,
      isBye: false,
      seed1: high.seed,
      seed2: low.seed,
    });
  }

  const round1Matchups = orderMatchupsForBracket(
    [...byeMatchups, ...playInMatchups],
    bracketSize,
  );
  const seeds = field.map(p => ({ ...p, hasBye: byeIds.has(p.id) }));

  return {
    seeds,
    ineligible,
    byeRecipients: byeRecipients.map(p => p.name),
    round1Matchups,
    bracketSize,
    cutTo,
    fieldSize: n,
  };
};

/** Place Round 1 matchups into standard bracket slots so adjacent winners feed QF. */
export const orderMatchupsForBracket = (matchups = [], bracketSize = 16) => {
  const pairs = standardPairs(bracketSize);
  if (!pairs.length) return matchups;
  const used = new Set();
  const ordered = [];
  for (const [s1, s2] of pairs) {
    const match = matchups.find((m, i) => {
      if (used.has(i)) return false;
      const seeds = [m.seed1, m.seed2].filter(s => s != null);
      if (m.isBye) return seeds[0] === s1 || seeds[0] === s2;
      return seeds.includes(s1) && seeds.includes(s2);
    });
    if (match) {
      used.add(matchups.indexOf(match));
      ordered.push(match);
    }
  }
  matchups.forEach((m, i) => { if (!used.has(i)) ordered.push(m); });
  return ordered;
};

export const pairAdjacentWinners = (matchups = []) => {
  const next = [];
  for (let i = 0; i < matchups.length; i += 2) {
    const a = matchups[i];
    const b = matchups[i + 1];
    next.push({
      p1: a?.winner ?? null,
      p2: b?.winner ?? null,
      winner: null,
      isBye: false,
    });
  }
  return next;
};
