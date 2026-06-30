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
    exactScore: 5,       // predicted the exact final score (after 120')
    correctOutcome: 3,   // right winner / draw, wrong score (after 120')
    correctGoalsBonus: 1,// +bonus per team whose goal count you nailed
    advanceBonus: 3      // knockout only: correctly predicted who advances
                         // (the winner of the tie — on penalties if you
                         //  predicted a draw after 120 minutes)
  },

  // --- Top 3 Winners Prediction -------------------------------------------
  // Active only between openAt and closeAt. Times below use Cairo time (+03:00).
  top3: {
    openAt: "2026-06-28T00:00:00+03:00",
    closeAt: "2026-06-28T22:00:00+03:00",
    firstPts: 30,
    secondPts: 20,
    thirdPts: 10,
    exactOrderBonus: 25
  },

  // --- Team boost (Egypt ×2) ----------------------------------------------
  // Doubles a player's TOTAL points (scoreline + advance bonus) on the boosted
  // team's knockout matches, from the Round of 32 to the end of their run.
  // A one-time login notification announces it; it stops appearing if the team
  // is knocked out. To boost a different team change `team`, or set
  // enabled:false to switch the whole feature off.
  boost: {
    enabled: true,
    team: "Egypt",
    multiplier: 2,
    knockoutOnly: true   // only Round of 32 onward
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
