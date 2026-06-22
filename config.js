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

  // --- Shared storage (REQUIRED) -------------------------------------------
  // This app runs in SHARED mode only: all accounts, predictions and the
  // leaderboard live in one Firebase project, so every device sees the same
  // game. Paste your Firebase web-app config below (all six fields).
  //
  // Setup (one time, free, no card):
  //   1. console.firebase.google.com -> create project -> add a Web app
  //   2. Build -> Firestore Database -> Create database
  //   3. Paste the config values here
  //   4. Firestore -> Rules -> allow read, write -> Publish:
  //        rules_version = '2';
  //        service cloud.firestore {
  //          match /databases/{database}/documents {
  //            match /{doc=**} { allow read, write: if true; }
  //          }
  //        }
  //
  // Until these are filled in (and rules allow access), the app shows a setup
  // screen instead of running.
  storage: {
    firebase: {
      apiKey: "",
      authDomain: "",
      projectId: "",
      storageBucket: "",
      messagingSenderId: "",
      appId: ""
    }
  },

  refreshMs: 30000
};
