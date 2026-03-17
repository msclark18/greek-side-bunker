export const DEFAULT_CONFIG = {
  scoringFormat: "stroke", roundsPerCourse: 2, attestRequired: true, scorecardRequired: false,
  useHandicap: true, handicapPct: 100, useSlopeRating: true, maxHandicap: null,
  joinMode: "open", maxPlayers: null, hideScores: false, seasonStart: null, seasonEnd: null,
  googleSheetUrl: null,
  scoresToCount: null,
  entryFee: null,
  payoutCategories: [
    { id: "champion",      label: "🥇 Champion (Playoff Winner)",     pct: 50 },
    { id: "runnerUp",      label: "🥈 Runner-Up",                      pct: 20 },
    { id: "thirdPlace",    label: "🥉 Third Place",                    pct: 10 },
    { id: "regularNet",    label: "📊 Regular Season NET Winner",      pct: 10 },
    { id: "regularGross",  label: "📊 Regular Season GROSS Winner",    pct: 10 },
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
};
