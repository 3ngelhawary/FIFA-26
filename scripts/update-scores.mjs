// File: update-scores.mjs
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

function appFirebaseProjectId() {
  try {
    const configText = fs.readFileSync("config.js", "utf8");
    const match = configText.match(/projectId\s*:\s*["']([^"']+)["']/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

const APP_PROJECT_ID = appFirebaseProjectId();

if (APP_PROJECT_ID && APP_PROJECT_ID !== SA.project_id) {
  console.error(
    `Firebase project mismatch: website uses ${APP_PROJECT_ID}, service account uses ${SA.project_id}`
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(SA)
});

const db = admin.firestore();

const ALIAS = {
  iran: "iran",
  iriran: "iran",
  islamicrepublicofiran: "iran",

  congodr: "drcongo",
  drcongo: "drcongo",
  democraticrepublicofcongo: "drcongo",
  democraticrepublicofthecongo: "drcongo",
  drcongozaire: "drcongo",

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
  bosniaherzegovina: "bosnia",
  bosniaherzegowina: "bosnia",
  bosnia: "bosnia",

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

  if (penalties && penalties.home !== penalties.away) {
    return penalties.home > penalties.away ? "home" : "away";
  }

  return winnerSideFromApi(match);
}

function actualAdvanceSide(ours, apiMatch, score120) {
  if (!isKnockout(ours) || !score120) return null;

  if (score120.home > score120.away) return "home";
  if (score120.away > score120.home) return "away";

  return penaltyWinnerSide(apiMatch);
}

function apiStatusToAppStatus(apiStatus) {
  if (apiStatus === "FINISHED") return "finished";

  if (["IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT"].includes(apiStatus)) {
    return "live";
  }

  return "scheduled";
}

function localStatusToAppStatus(localStatus) {
  if (localStatus === "finished") return "finished";
  if (localStatus === "live") return "live";
  return "scheduled";
}

function validLocalScore(match) {
  return match.homeScore != null
    && match.awayScore != null
    && Number.isFinite(Number(match.homeScore))
    && Number.isFinite(Number(match.awayScore));
}

function applyCommonFields(updateData, home, away, kickoff, homeFlag, awayFlag) {
  if (home && !/^TBD/i.test(home)) updateData.home = home;
  if (away && !/^TBD/i.test(away)) updateData.away = away;
  if (homeFlag) updateData.homeFlag = homeFlag;
  if (awayFlag) updateData.awayFlag = awayFlag;
  if (kickoff) updateData.kickoff = kickoff;
}

function clearScoreFields(updateData) {
  updateData.homeScore = null;
  updateData.awayScore = null;
  updateData.homePenScore = null;
  updateData.awayPenScore = null;
  updateData.advance = null;
}

function buildLocalUpdate(match) {
  const status = localStatusToAppStatus(match.status);
  const updateData = {
    status,
    source: "matches.json",
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  applyCommonFields(
    updateData,
    match.home,
    match.away,
    match.kickoff,
    match.homeFlag,
    match.awayFlag
  );

  if (status === "finished" && validLocalScore(match)) {
    updateData.homeScore = Number(match.homeScore);
    updateData.awayScore = Number(match.awayScore);

    if (match.homePenScore != null && match.awayPenScore != null) {
      updateData.homePenScore = Number(match.homePenScore);
      updateData.awayPenScore = Number(match.awayPenScore);
    } else {
      updateData.homePenScore = null;
      updateData.awayPenScore = null;
    }

    if (isKnockout(match) && (match.advance === "home" || match.advance === "away")) {
      updateData.advance = match.advance;
    }
  } else {
    clearScoreFields(updateData);
  }

  updateData.liveMinute = null;
  updateData.liveText = null;

  return updateData;
}

function buildApiUpdate(match, apiMatch) {
  const status = apiStatusToAppStatus(apiMatch.status);
  const score120 = scoreAfter120(apiMatch);
  const homeScore = score120?.home;
  const awayScore = score120?.away;
  const homeName = apiMatch.homeTeam?.name || "";
  const awayName = apiMatch.awayTeam?.name || "";

  const updateData = {
    status,
    source: "football-data",
    externalId: apiMatch.id || match.externalId || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  applyCommonFields(
    updateData,
    homeName,
    awayName,
    apiMatch.utcDate,
    match.homeFlag,
    match.awayFlag
  );

  if (status !== "scheduled" && homeScore != null && awayScore != null) {
    updateData.homeScore = homeScore;
    updateData.awayScore = awayScore;

    const penalties = scorePair(apiMatch.score?.penalties);
    if (!penalties) {
      updateData.homePenScore = null;
      updateData.awayPenScore = null;
    } else if (penalties.home !== penalties.away || winnerSideFromApi(apiMatch)) {
      updateData.homePenScore = penalties.home;
      updateData.awayPenScore = penalties.away;
    }

    if (status === "finished" && isKnockout(match)) {
      const advance = actualAdvanceSide(match, apiMatch, score120);
      if (advance) updateData.advance = advance;
    }
  } else {
    clearScoreFields(updateData);
  }

  if (status === "live") {
    const liveMinute = getLiveMinute(apiMatch.utcDate || match.kickoff);

    updateData.liveMinute = liveMinute;
    updateData.liveText = apiMatch.status === "PENALTY_SHOOTOUT"
      ? "PEN"
      : liveMinute ? `${liveMinute}'` : "LIVE";
  } else {
    updateData.liveMinute = null;
    updateData.liveText = null;
  }

  return updateData;
}

function matchDateRange(matches) {
  const times = matches
    .map((match) => new Date(match.kickoff).getTime())
    .filter((value) => Number.isFinite(value));

  if (!times.length) return "";

  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));
  first.setUTCDate(first.getUTCDate() - 1);
  last.setUTCDate(last.getUTCDate() + 1);

  return `?dateFrom=${first.toISOString().slice(0, 10)}&dateTo=${last.toISOString().slice(0, 10)}`;
}

function createApiIndexes(apiMatches) {
  const byPair = {};
  const byReversePair = {};
  const byId = {};

  for (const apiMatch of apiMatches) {
    const homeKey = norm(apiMatch.homeTeam?.name);
    const awayKey = norm(apiMatch.awayTeam?.name);
    const key = `${homeKey}|${awayKey}`;
    const reverseKey = `${awayKey}|${homeKey}`;

    byPair[key] = apiMatch;
    byReversePair[reverseKey] = apiMatch;
    byId[String(apiMatch.id)] = apiMatch;
  }

  return { byPair, byReversePair, byId };
}

function findApiMatch(match, indexes) {
  const key = `${norm(match.home)}|${norm(match.away)}`;
  const externalId = match.externalId || (/^\d+$/.test(String(match.id)) ? match.id : "");

  return (externalId && indexes.byId[String(externalId)])
    || indexes.byPair[key]
    || indexes.byReversePair[key]
    || null;
}

function scoreLabel(updateData) {
  if (updateData.status === "finished" || updateData.status === "live") {
    if (updateData.homeScore != null && updateData.awayScore != null) {
      return `${updateData.homeScore}-${updateData.awayScore}`;
    }

    return "no score yet";
  }

  return "fixture synced";
}

async function fetchApiMatches(dateRange) {
  const url = `https://api.football-data.org/v4/competitions/${COMP}/matches${dateRange}`;

  const res = await fetch(url, {
    headers: {
      "X-Auth-Token": TOKEN
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.matches || [];
}

async function main() {
  const ours = JSON.parse(fs.readFileSync("matches.json", "utf8")).matches || [];
  const dateRange = matchDateRange(ours);
  let api = [];
  let apiFailed = false;

  try {
    api = await fetchApiMatches(dateRange);
    console.log(`API returned ${api.length} matches for ${COMP}${dateRange}`);
  } catch (error) {
    apiFailed = true;
    console.error(error.message);
    console.error("Continuing with matches.json sync so every app match has a Firestore record.");
  }

  const indexes = createApiIndexes(api);
  let writes = 0;
  let apiMatches = 0;
  let apiScoreWrites = 0;
  let localWrites = 0;
  let localScoreWrites = 0;
  let missingApi = 0;

  for (const match of ours) {
    const apiMatch = findApiMatch(match, indexes);
    let updateData;

    if (apiMatch) {
      apiMatches++;
      updateData = buildApiUpdate(match, apiMatch);

      if (updateData.status === "scheduled" && match.status === "finished" && validLocalScore(match)) {
        updateData = buildLocalUpdate(match);
        localWrites++;
        localScoreWrites++;
      } else if (updateData.homeScore != null && updateData.awayScore != null) {
        apiScoreWrites++;
      }
    } else {
      missingApi++;
      updateData = buildLocalUpdate(match);
      localWrites++;

      if (updateData.status === "finished" && validLocalScore(match)) {
        localScoreWrites++;
      }

      console.log(`No API match: ${match.id} ${match.home} vs ${match.away}; synced from matches.json`);
    }

    await db.collection("results").doc(match.id).set(updateData, { merge: true });
    writes++;

    const homeLabel = updateData.home || match.home;
    const awayLabel = updateData.away || match.away;
    const advanceLabel = updateData.advance ? ` advance=${updateData.advance}` : "";

    console.log(
      `Updated: ${match.id} ${homeLabel} ${scoreLabel(updateData)} ${awayLabel} `
      + `[${updateData.status}] source=${updateData.source}${advanceLabel} ${updateData.liveText || ""}`
    );
  }

  console.log(`Updated ${writes} Firestore result record(s).`);
  console.log(`API matched ${apiMatches}/${ours.length}; missing API matches ${missingApi}.`);
  console.log(`API score records ${apiScoreWrites}; matches.json score records ${localScoreWrites}.`);

  if (apiFailed) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
