/* =============================================================================
   Auto score updater for the EGEC World Cup Predictor.
   Repo path: scripts/update-scores.mjs
   ========================================================================== */

import fs from "fs";
import admin from "firebase-admin";

const SA = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");

// Token MUST come from the environment. Never hardcode a credential here —
// anything committed to the repo is effectively public and must be rotated.
const TOKEN = (process.env.FOOTBALL_TOKEN || "").trim().replace(/\s+/g, "");

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

// Every spelling a feed might use for a country must normalize to ONE token,
// and that token must equal what matches.json normalizes to. norm() strips
// everything except a-z, so hyphens/accents/"and"/"the" all collapse away —
// but only the forms listed here are aliased to a canonical token.
const ALIAS = {
  // Iran  (matches.json uses "IR Iran")
  iran: "iran",
  iriran: "iran",
  islamicrepublicofiran: "iran",

  // DR Congo  (matches.json uses "Congo DR")
  congodr: "drcongo",
  drcongo: "drcongo",
  democraticrepublicofcongo: "drcongo",
  democraticrepublicofthecongo: "drcongo",
  drcongozaire: "drcongo",

  // Cape Verde  (matches.json uses "Cabo Verde")
  caboverde: "capeverde",
  capeverde: "capeverde",

  // Curaçao
  curacao: "curacao",
  curacaoo: "curacao",

  // Türkiye  (matches.json uses "Turkey")
  turkiye: "turkey",
  turkey: "turkey",

  // South Korea
  korearepublic: "southkorea",
  republicofkorea: "southkorea",
  southkorea: "southkorea",

  // USA  (matches.json uses "United States")
  unitedstates: "usa",
  unitedstatesofamerica: "usa",
  usa: "usa",

  // Côte d'Ivoire  (matches.json uses "Ivory Coast")
  cotedivoire: "ivorycoast",
  ivorycoast: "ivorycoast",

  // Bosnia and Herzegovina  (feeds often render "Bosnia-Herzegovina")
  bosniaandherzegovina: "bosnia",
  bosniaherzegovina: "bosnia",
  bosniaherzegowina: "bosnia",
  bosnia: "bosnia",

  // Czechia  (feeds may still use "Czech Republic")
  czechia: "czechia",
  czechrepublic: "czechia"
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

function isKnockout(match) {
  return !!(match && (match.round || match.group === "KO"));
}

function scoreValue(node, side) {
  if (!node) return null;

  const keys = side === "home" ? ["home", "homeTeam"] : ["away", "awayTeam"];

  for (const key of keys) {
    if (node[key] == null) continue;

    const value = Number(node[key]);
    if (Number.isFinite(value)) return value;
  }

  return null;
}

function scorePair(node) {
  const home = scoreValue(node, "home");
  const away = scoreValue(node, "away");

  if (home == null || away == null) return null;

  return { home, away };
}

function addScorePairs(a, b) {
  if (!a || !b) return null;

  return {
    home: a.home + b.home,
    away: a.away + b.away
  };
}

function subtractScorePairs(a, b) {
  if (!a || !b) return null;

  const pair = {
    home: a.home - b.home,
    away: a.away - b.away
  };

  return pair.home >= 0 && pair.away >= 0 ? pair : null;
}

function scoreAfter120(match) {
  const score = match.score || {};
  const duration = score.duration || "REGULAR";
  const fullTime = scorePair(score.fullTime);
  const regularTime = scorePair(score.regularTime);
  const extraTime = scorePair(score.extraTime);
  const penalties = scorePair(score.penalties);

  if (duration === "PENALTY_SHOOTOUT" || penalties) {
    return addScorePairs(regularTime, extraTime)
      || subtractScorePairs(fullTime, penalties)
      || fullTime;
  }

  if (duration === "EXTRA_TIME") {
    return addScorePairs(regularTime, extraTime) || fullTime;
  }

  return fullTime;
}

function winnerSideFromApi(match) {
  const winner = match.score?.winner || "";

  if (winner === "HOME_TEAM" || winner === "HOME") return "home";
  if (winner === "AWAY_TEAM" || winner === "AWAY") return "away";

  return null;
}

function penaltyWinnerSide(match) {
  const penalties = scorePair(match.score?.penalties);

  if (penalties) {
    if (penalties.home > penalties.away) return "home";
    if (penalties.away > penalties.home) return "away";
  }

  return winnerSideFromApi(match);
}

function actualAdvanceSide(ours, apiMatch, score120) {
  if (!isKnockout(ours) || !score120) return null;

  if (score120.home > score120.away) return "home";
  if (score120.away > score120.home) return "away";

  return penaltyWinnerSide(apiMatch);
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
    } else if (["IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT"].includes(am.status)) {
      status = "live";
    }

    const score120 = scoreAfter120(am);
    const homeScore = score120?.home;
    const awayScore = score120?.away;
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

      const penalties = scorePair(am.score?.penalties);
      if (penalties) {
        updateData.homePenScore = penalties.home;
        updateData.awayPenScore = penalties.away;
      } else {
        updateData.homePenScore = null;
        updateData.awayPenScore = null;
      }

      if (status === "finished" && isKnockout(m)) {
        updateData.advance = actualAdvanceSide(m, am, score120);
      }
    }

    const hasFixtureUpdate = updateData.home || updateData.away || updateData.kickoff;
    if (status === "scheduled" && !hasFixtureUpdate) {
      console.log(`Not started: ${m.home} vs ${m.away}`);
      continue;
    }

    if (status === "live") {
      const liveMinute = getLiveMinute(am.utcDate || m.kickoff);

      updateData.liveMinute = liveMinute;
      updateData.liveText = am.status === "PENALTY_SHOOTOUT"
        ? "PEN"
        : liveMinute ? `${liveMinute}'` : "LIVE";
    } else {
      updateData.liveMinute = null;
      updateData.liveText = null;
    }

    await db.collection("results").doc(m.id).set(updateData, { merge: true });

    writes++;

    const homeLabel = updateData.home || m.home;
    const awayLabel = updateData.away || m.away;
    const scoreLabel = status === "scheduled" ? "fixture synced" : `${updateData.homeScore}-${updateData.awayScore}`;
    const advanceLabel = updateData.advance ? ` advance=${updateData.advance}` : "";

    console.log(
      `Updated: ${homeLabel} ${scoreLabel} ${awayLabel} [${status}]${advanceLabel} ${
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
