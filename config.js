/* =============================================================================
   EGEC World Cup Predictor — Configuration
   Edit this file to control the game. No build step required.
   ========================================================================== */
window.CONFIG = {
  // --- Branding -------------------------------------------------------------
  orgName: "EGEC",
  seasonLabel: "World Cup 2026 — Office Predictor",

  // --- Prediction lock ------------------------------------------------------
  // Predictions for a match lock this many minutes BEFORE kickoff.
  lockOffsetMinutes: 60,

  // --- Scoring rules --------------------------------------------------------
  // Points awarded once a match is finished.
  scoring: {
    exactScore: 5,      // predicted the exact final score (e.g. 3-1 = 3-1)
    correctOutcome: 3,  // predicted the right winner / draw, wrong score
    correctGoalsBonus: 1 // +bonus per team whose goal count you nailed (optional flavour)
  },

  // --- Live scores ----------------------------------------------------------
  // The page always reads matches.json (works on plain GitHub Pages).
  // OPTIONAL: paste a football-data.org token to auto-pull live scores.
  // Leave "" to disable and rely on matches.json instead.
  liveScores: {
    provider: "football-data", // currently the only built-in provider
    apiToken: "",              // <-- your football-data.org token (optional)
    competitionId: "WC"        // football-data.org code for the World Cup
  },

  // --- Multiplayer (shared picks + leaderboard across employees) ------------
  // mode "local"    -> picks stored in this browser only (great for testing).
  // mode "firebase" -> picks shared by everyone, real company leaderboard.
  // To enable firebase: set mode to "firebase" and paste your project config.
  storage: {
    mode: "local", // "local" | "firebase"
    firebase: {
      apiKey: "",
      authDomain: "",
      projectId: "",
      storageBucket: "",
      messagingSenderId: "",
      appId: ""
    }
  },

  // Refresh interval for scores/leaderboard (milliseconds).
  refreshMs: 30000
};
