/* =============================================================================
   Auto score updater for the EGEC World Cup Predictor.

   Runs on a schedule via GitHub Actions (NOT in the browser). It:
     1. reads matches.json (your fixtures + our match IDs),
     2. fetches current scores from football-data.org,
     3. writes finished/live scores into Firestore -> results/{matchId},
   which every player's page picks up automatically.

   Repo path: scripts/update-scores.mjs
   Requires secrets: FIREBASE_SERVICE_ACCOUNT, FOOTBALL_TOKEN
   ========================================================================== */
import fs from "fs";
import admin from "firebase-admin";

const SA   = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
const TOKEN = process.env.FOOTBALL_TOKEN || "";
const COMP  = process.env.COMPETITION || "WC"; // football-data competition code

if (!SA.project_id) { console.error("Missing FIREBASE_SERVICE_ACCOUNT secret"); process.exit(1); }
if (!TOKEN)         { console.error("Missing FOOTBALL_TOKEN secret"); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(SA) });
const db = admin.firestore();

/* normalise team names so our names match the API's variants */
const ALIAS = {
  iriran:"iran", congodr:"drcongo", democraticrepublicofcongo:"drcongo",
  caboverde:"capeverde", turkiye:"turkey", korearepublic:"southkorea",
  republicofkorea:"southkorea", unitedstates:"usa", unitedstatesofamerica:"usa",
  cotedivoire:"ivorycoast", bosniaandherzegovina:"bosnia"
};
const norm = s => { const x = String(s||"").toLowerCase().replace(/[^a-z]/g,""); return ALIAS[x] || x; };

async function main() {
  const ours = JSON.parse(fs.readFileSync("matches.json","utf8")).matches || [];

  const res = await fetch(`https://api.football-data.org/v4/competitions/${COMP}/matches`, {
    headers: { "X-Auth-Token": TOKEN }
  });
  if (!res.ok) {
    console.error("API error", res.status, await res.text());
    process.exit(1);
  }
  const data = await res.json();
  const api = data.matches || [];
  console.log(`API returned ${api.length} matches for ${COMP}`);

  // index API matches by normalised "home|away"
  const byPair = {};
  for (const am of api) {
    byPair[norm(am.homeTeam?.name) + "|" + norm(am.awayTeam?.name)] = am;
  }

  let writes = 0;
  for (const m of ours) {
    const am = byPair[norm(m.home) + "|" + norm(m.away)];
    if (!am) continue;

    let status = null;
    if (am.status === "FINISHED") status = "finished";
    else if (am.status === "IN_PLAY" || am.status === "PAUSED") status = "live";
    if (!status) continue; // not started / postponed -> leave as scheduled

    const ft = am.score?.fullTime || {};
    const hs = ft.home, as = ft.away;
    if (hs == null || as == null) continue;

    await db.collection("results").doc(m.id).set({ homeScore: hs, awayScore: as, status });
    writes++;
    console.log(`  ${m.home} ${hs}-${as} ${m.away}  [${status}]`);
  }
  console.log(`Updated ${writes} result(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
