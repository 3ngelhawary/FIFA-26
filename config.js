/* =============================================================================
   EGEC World Cup Predictor — Configuration
   Edit this file to control the game. No build step required.
   ========================================================================== */
window.CONFIG = {
  // --- Branding -------------------------------------------------------------
  orgName: "EGEC",
  seasonLabel: "World Cup 2026",

  // --- Prediction lock ------------------------------------------------------
  // Predictions for a match lock this many minutes BEFORE kickoff.
  // Before lock, colleagues see only WHO predicted (names). After lock, the
  // actual scorelines are revealed.
  lockOffsetMinutes: 60,

  // --- Scoring rules --------------------------------------------------------
  scoring: {
    exactScore: 5,       // predicted the exact final score
    correctOutcome: 3,   // right winner / draw, wrong score
    correctGoalsBonus: 1 // +bonus per team whose goal count you nailed
  },

  // --- Organizer (admin) ----------------------------------------------------
  // Anyone who enters this code unlocks the Organizer panel, where they can
  // enter match scores and add players. Change it before you share the app.
  adminCode: "EGEC2026",

  // --- Live scores (optional) ----------------------------------------------
  // The page always reads matches.json. Paste a football-data.org token to
  // auto-pull live scores. Organizer-entered scores always take priority.
  liveScores: { provider: "football-data", apiToken: "", competitionId: "WC" },

  // --- Storage --------------------------------------------------------------
  // mode "local"    -> everything saved in THIS browser (good for testing /
  //                    single-device, and for the preview).
  // mode "firebase" -> shared across all devices: real accounts, real roster,
  //                    real office leaderboard. Paste your project config.
  storage: {
    mode: "local", // "local" | "firebase"
    firebase: {
      apiKey: "", authDomain: "", projectId: "",
      storageBucket: "", messagingSenderId: "", appId: ""
    }
  },

  refreshMs: 30000
};
