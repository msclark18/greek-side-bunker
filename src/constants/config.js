export const DEFAULT_PLAYOFF_SCHEDULE = [
  { id: "round1", label: "Round 1", start: "2026-10-01", end: "2026-10-07", courseName: "Mountain Dell" },
  { id: "quarters", label: "Quarterfinals", start: "2026-10-08", end: "2026-10-14", courseName: "Old Mill" },
  { id: "semis", label: "Semifinals", start: "2026-10-15", end: "2026-10-21", courseName: "Bonneville" },
  { id: "final", label: "Championship", start: "2026-10-22", end: "2026-10-28", courseName: "Bonneville" },
];

export const DEFAULT_CONFIG = {
  scoringFormat: "stroke", roundsPerCourse: 2, attestRequired: true, scorecardRequired: false, ccCommissioner: false, notifyCommissionerOnSubmit: false,
  allowGroupPosting: false,
  useHandicap: true, handicapPct: 100, useSlopeRating: true, maxHandicap: null,
  joinMode: "open", maxPlayers: null, hideScores: false, seasonStart: null, seasonEnd: "2026-09-30",
  googleSheetUrl: null,
  scoresToCount: null,
  entryFee: null,
  exclusiveWinners: false,
  exclusivePrecedence: "gross",
  // Scramble teams
  scrambleTeamSize: 2,
  scrambleTeams: [],
  teamsFixed: true,
  // Flights (optional grouping for any league type)
  flights: [],
  // Tournament mode
  tournamentMode: false,
  tournamentRounds: [],
  payoutCategories: [
    { id: "champion",      label: "Champion",                       pct: 50, mapTo: "playoff", mapRank: 1 },
    { id: "runnerUp",      label: "Runner-Up",                      pct: 20, mapTo: "playoff", mapRank: 2 },
    { id: "thirdPlace",    label: "Third Place",                    pct: 10, mapTo: "playoff", mapRank: 3 },
    { id: "regularNet",    label: "Regular Season — Net 1st",       pct: 10, mapTo: "net",     mapRank: 1 },
    { id: "regularGross",  label: "Regular Season — Gross 1st",     pct: 10, mapTo: "gross",   mapRank: 1 },
  ],
  playoffEnabled: true,
  playoffFormat: "match",
  playoffQualifiers: 4,
  playoffSeedingBy: "net",
  playoffBracket: [],
  playoffCourse: null,
  playoffDate: null,
  playoffQualification: "courses",
  playoffMinCourses: 2,
  playoffByePriorityCourses: 4,
  playoffNoByeMaxCourses: 2,
  playoffCutTo: 8,
  playoffMaxField: 16,
  playoffSeedBestPerCourse: true,
  playoffThirdPlace: false,
  playoffSchedule: DEFAULT_PLAYOFF_SCHEDULE,
  playoffWeatherBuffer: "Oct. 29–Nov. 8 is reserved strictly as an emergency weather buffer.",
  playoffLocked: false,
};

export const FORMAT_LABELS = {
  stroke: "Stroke Play",
  stableford: "Stableford",
  match: "Match Play",
  scramble: "Scramble",
  texas_scramble: "Texas Scramble",
  best_ball: "Best Ball",
};

export function mergeLeagueConfig(saved) {
  const cfg = { ...DEFAULT_CONFIG, ...(saved ?? {}) };
  if (!cfg.seasonEnd) cfg.seasonEnd = DEFAULT_CONFIG.seasonEnd;
  if (!cfg.playoffSchedule?.length) cfg.playoffSchedule = DEFAULT_PLAYOFF_SCHEDULE;
  if (!cfg.playoffQualification) cfg.playoffQualification = "courses";
  return cfg;
}
