/* =============================================================================
   Auto score updater for the EGEC World Cup Predictor.
   Repo path: scripts/update-scores.mjs
   ========================================================================== */

import fs from "fs";
import admin from "firebase-admin";

const SA = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");

const TOKEN = (
  process.env.FOOTBALL_TOKEN ||
  "062dd9d5f4f04baab9ffac84d510befb"
)
  .trim()
  .replace(/\s+/g, "");

const COMP = process.env.COMPETITION || "WC";

if (!SA.project_id) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT secret");
  process.exit(1);
}

if (!TOKEN) {
  console.error("Missing FOOTBALL_TOKEN secret");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(SA)
});

const db = admin.firestore();

const ALIAS = {
  iriran: "iran",
  iran: "iran",

  congodr: "drcongo",
  drcongo: "drcongo",
  democraticrepublicofcongo: "drcongo",

  caboverde: "capeverde",
  capeverde: "capeverde",

  curacao: "curacao",
  curacaoo: "curacao",

  turkiye: "turkey",
  turkey: "turkey",

  korearepublic: "southkorea",
  republicofkorea: "southkorea",
  southkorea: "southkorea",

  unitedstates: "usa",
  unitedstatesofamerica: "usa",
  usa: "usa",

  cotedivoire: "ivorycoast",
  ivorycoast: "ivorycoast",

  bosniaandherzegovina: "bosnia",
  bosnia: "bosnia"
};

function norm(value) {
  const x = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");

  return ALIAS[x] || x;
}

async function main() {
  const ours = JSON.parse(fs.readFileSync("matches.json", "utf8")).matches || [];

  const res = await fetch(
    `https://api.football-data.org/v4/competitions/${COMP}/matches`,
    {
      headers: {
        "X-Auth-Token": TOKEN
      }
    }
  );

  if (!res.ok) {
    console.error("API error", res.status, await res.text());
    process.exit(1);
  }

  const data = await res.json();
  const api = data.matches || [];

  console.log(`API returned ${api.length} matches for ${COMP}`);

  const byPair = {};

  for (const am of api) {
    const key = `${norm(am.homeTeam?.name)}|${norm(am.awayTeam?.name)}`;
    byPair[key] = am;
  }

  let writes = 0;

  for (const m of ours) {
    const key = `${norm(m.home)}|${norm(m.away)}`;
    const am = byPair[key];

    if (!am) {
      console.log(`Skipped: ${m.home} vs ${m.away}`);
      continue;
    }

    let status = null;

    if (am.status === "FINISHED") {
      status = "finished";
    } else if (am.status === "IN_PLAY" || am.status === "PAUSED") {
      status = "live";
    }

    if (!status) {
      console.log(`Not started: ${m.home} vs ${m.away}`);
      continue;
    }

    const ft = am.score?.fullTime || {};
    const homeScore = ft.home;
    const awayScore = ft.away;

    if (homeScore == null || awayScore == null) {
      console.log(`No score yet: ${m.home} vs ${m.away}`);
      continue;
    }

    await db.collection("results").doc(m.id).set(
      {
        homeScore,
        awayScore,
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    writes++;

    console.log(`Updated: ${m.home} ${homeScore}-${awayScore} ${m.away} [${status}]`);
  }

  console.log(`Updated ${writes} result(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
