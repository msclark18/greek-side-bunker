export const DEFAULT_CONFIG = {
  scoringFormat: "stroke", roundsPerCourse: 2, attestRequired: true, scorecardRequired: false, ccCommissioner: false,
  useHandicap: true, handicapPct: 100, useSlopeRating: true, maxHandicap: null,
  joinMode: "open", maxPlayers: null, hideScores: false, seasonStart: null, seasonEnd: null,
  googleSheetUrl: null,
  scoresToCount: null,
  entryFee: null,
  exclusiveWinners: false,
  exclusivePrecedence: "gross",
  // Scramble teams
  scrambleTeamSize: 2,
  scrambleTeams: [],
  teamsFixed: true,
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
};

export const FORMAT_LABELS = {
  stroke: "Stroke Play",
  stableford: "Stableford",
  match: "Match Play",
  scramble: "Scramble",
  texas_scramble: "Texas Scramble",
  best_ball: "Best Ball",
};
