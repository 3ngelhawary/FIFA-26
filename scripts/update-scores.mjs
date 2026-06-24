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

function getLiveMinute(kickoff) {
  if (!kickoff) return null;

  const kickoffTime = new Date(kickoff).getTime();

  if (Number.isNaN(kickoffTime)) return null;

  const diffMinutes = Math.floor((Date.now() - kickoffTime) / 60000);

  if (diffMinutes < 1) return 1;
  if (diffMinutes <= 45) return diffMinutes;
  if (diffMinutes <= 60) return "45+";
  if (diffMinutes <= 105) return diffMinutes - 15;
  if (diffMinutes <= 120) return "90+";

  return null;
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
  const byId = {};

  for (const am of api) {
    const key = `${norm(am.homeTeam?.name)}|${norm(am.awayTeam?.name)}`;
    byPair[key] = am;
    byId[String(am.id)] = am;
  }

  let writes = 0;

  for (const m of ours) {
    const key = `${norm(m.home)}|${norm(m.away)}`;
    const externalId = m.externalId || (/^\d+$/.test(String(m.id)) ? m.id : "");
    const am = (externalId && byId[String(externalId)]) || byPair[key];

    if (!am) {
      console.log(`Skipped: ${m.home} vs ${m.away}`);
      continue;
    }

    let status = "scheduled";

    if (am.status === "FINISHED") {
      status = "finished";
    } else if (am.status === "IN_PLAY" || am.status === "PAUSED") {
      status = "live";
    }

    const ft = am.score?.fullTime || {};
    const homeScore = ft.home;
    const awayScore = ft.away;
    const homeName = am.homeTeam?.name || "";
    const awayName = am.awayTeam?.name || "";

    const updateData = {
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (homeName && !/^TBD/i.test(homeName)) updateData.home = homeName;
    if (awayName && !/^TBD/i.test(awayName)) updateData.away = awayName;
    if (am.utcDate) updateData.kickoff = am.utcDate;

    if (status !== "scheduled") {
      if (homeScore == null || awayScore == null) {
        console.log(`No score yet: ${m.home} vs ${m.away}`);
        continue;
      }
      updateData.homeScore = homeScore;
      updateData.awayScore = awayScore;
    }

    const hasFixtureUpdate = updateData.home || updateData.away || updateData.kickoff;
    if (status === "scheduled" && !hasFixtureUpdate) {
      console.log(`Not started: ${m.home} vs ${m.away}`);
      continue;
    }

    if (status === "live") {
      const liveMinute = getLiveMinute(m.kickoff);

      updateData.liveMinute = liveMinute;
      updateData.liveText = liveMinute ? `${liveMinute}'` : "LIVE";
    } else {
      updateData.liveMinute = null;
      updateData.liveText = null;
    }

    await db.collection("results").doc(m.id).set(updateData, { merge: true });

    writes++;

    const homeLabel = updateData.home || m.home;
    const awayLabel = updateData.away || m.away;
    const scoreLabel = status === "scheduled" ? "fixture synced" : `${updateData.homeScore}-${updateData.awayScore}`;

    console.log(
      `Updated: ${homeLabel} ${scoreLabel} ${awayLabel} [${status}] ${
        updateData.liveText || ""
      }`
    );
  }

  console.log(`Updated ${writes} result(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
