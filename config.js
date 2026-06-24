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
    correctGoalsBonus: 1,// +bonus per team whose goal count you nailed

    // --- Streak bonus ------------------------------------------------------
    // Consecutive correct OUTCOMES (in kickoff order) earn an escalating bonus
    // once the run reaches streakMin. Each match in the run from streakMin
    // onward adds streakBonus points. Set streakBonus:0 to disable.
    streakMin: 3,
    streakBonus: 2,

    // --- Joker / double-down ----------------------------------------------
    // Players may pick ONE match per day as their Joker before it locks.
    // That match's points are multiplied by jokerMultiplier.
    jokerEnabled: true,
    jokerMultiplier: 2
  },

  // --- Top 3 Winners Prediction -------------------------------------------
  // Active only between openAt and closeAt. Times below use Cairo time (+03:00).
  top3: {
    openAt: "2026-06-28T00:00:00+03:00",
    closeAt: "2026-07-01T00:00:00+03:00",
    firstPts: 100,
    secondPts: 75,
    thirdPts: 50,
    exactOrderBonus: 100
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
      apiKey: "AIzaSyCGnZ1hgam5OkYoh0jF7moa3h4h7b1czfg",
      authDomain: "egec-world-cup.firebaseapp.com",
      projectId: "egec-world-cup",
      storageBucket: "egec-world-cup.firebasestorage.app",
      messagingSenderId: "280867142554",
      appId: "1:280867142554:web:895cdc3ac8e99d33bdd823"
    }
  },

  refreshMs: 30000
};
