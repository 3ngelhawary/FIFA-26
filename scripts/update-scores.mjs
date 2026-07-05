// File: update-scores.mjs
/* =============================================================================
   Auto score updater for the EGEC World Cup Predictor.
   Repo path: scripts/update-scores.mjs

   Correctness principle (IMPORTANT):
   This job is MONOTONIC for results. It may add or upgrade a result
   (scheduled -> live -> finished, fill in penalties/advance), but it must
   NEVER erase or downgrade a result that is already stored. The feed
   occasionally drops a match from its date window or returns a stale/partial
   snapshot; without the regression guard below, a finished knockout result
   (including `advance`) gets wiped back to nulls whenever that happens.
   ========================================================================== */

import fs from "fs";
import admin from "firebase-admin";

const SA = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");

// Token MUST come from the environment. Never hardcode a credential here —
// anything committed to the repo is effectively public and must be rotated.
const TOKEN = (process.env.FOOTBALL_TOKEN || "").trim().replace(/\s+/g, "");

const COMP = process.env.COMPETITION || "WC";
const SEASON = (process.env.SEASON || process.env.FOOTBALL_SEASON || "2026").trim();
const MATCH_SETTLE_MS = 4 * 60 * 60 * 1000;

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

function isPlaceholderTeamName(value) {
  const s = String(value || "").trim();

  if (!s) return true;

  return /^(TBD|TBC|TBA|To be (confirmed|decided|determined|announced)|Winner of|Winners of|Loser of|Losers of|\d+(st|nd|rd|th) Group|[123]rd Group|[12]nd Group|[12]st Group)/i.test(s);
}

function isConcreteTeamName(value) {
  return !isPlaceholderTeamName(value);
}

function preferredTeamName(primary, fallback) {
  if (isConcreteTeamName(primary)) return String(primary).trim();
  if (isConcreteTeamName(fallback)) return String(fallback).trim();
  return "";
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

  // A decisive shootout tells us the winner directly.
  if (penalties && penalties.home !== penalties.away) {
    return penalties.home > penalties.away ? "home" : "away";
  }

  // No penalties yet, or a LEVEL snapshot caught mid-shootout (e.g. 4-4):
  // don't guess from the tied count — fall back to the feed's declared winner
  // (score.winner). If it hasn't published one yet, return null so the caller
  // leaves `advance` untouched instead of freezing an unresolved value.
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
  if (isConcreteTeamName(home)) updateData.home = String(home).trim();
  if (isConcreteTeamName(away)) updateData.away = String(away).trim();
  if (homeFlag && isConcreteTeamName(home)) updateData.homeFlag = homeFlag;
  if (awayFlag && isConcreteTeamName(away)) updateData.awayFlag = awayFlag;
  if (kickoff) updateData.kickoff = kickoff;
}

function clearScoreFields(updateData) {
  updateData.homeScore = null;
  updateData.awayScore = null;
  updateData.homePenScore = null;
  updateData.awayPenScore = null;
  updateData.advance = null;
}

/* ---------------------------------------------------------------------------
   REGRESSION GUARD — the real fix.
   Runs against the CURRENT Firestore doc right before every write. It strips
   out any field in `updateData` that would erase or downgrade information that
   is already stored, so a missing/partial/failed feed can never wipe a real
   result. This is what makes `clearScoreFields` (and an empty API response)
   safe: their nulls are dropped whenever a genuine value already exists.
--------------------------------------------------------------------------- */
const STATUS_RANK = { scheduled: 0, live: 1, finished: 2 };
const PRESERVE_IF_NULLED = ["homeScore", "awayScore", "homePenScore", "awayPenScore", "advance"];

function guardAgainstRegression(prev, updateData) {
  if (!prev) return updateData;

  const prevRank = STATUS_RANK[prev.status] ?? 0;
  const nextRank = STATUS_RANK[updateData.status] ?? 0;

  // Never downgrade status (finished -> live/scheduled, live -> scheduled).
  // A downgrade means this run carries no fresher result, so also drop its
  // live annotations rather than stamping stale minutes on a settled match.
  if (updateData.status != null && nextRank < prevRank) {
    delete updateData.status;
    delete updateData.liveMinute;
    delete updateData.liveText;
  }

  // Never overwrite an existing concrete value with null. A real advance /
  // score / pen tally already recorded must survive a blank or partial feed.
  for (const field of PRESERVE_IF_NULLED) {
    if (updateData[field] === null && prev[field] != null) {
      delete updateData[field];
    }
  }

  return updateData;
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
    // No local result to assert. We DELIBERATELY clear here for the first-time
    // creation of a scheduled fixture — but the regression guard will strip
    // these nulls (and the "scheduled" downgrade) whenever a real result is
    // already stored, so this can no longer wipe a finished knockout.
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
  const homeName = preferredTeamName(apiMatch.homeTeam?.name, match.home);
  const awayName = preferredTeamName(apiMatch.awayTeam?.name, match.away);

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
      // Decisive shootout, or the feed has declared a winner -> record it.
      updateData.homePenScore = penalties.home;
      updateData.awayPenScore = penalties.away;
    }
    // Otherwise: a LEVEL snapshot caught mid-shootout with no winner yet —
    // leave pen scores out so we don't freeze a tied 4-4 into the result.

    if (status === "finished" && isKnockout(match)) {
      // Only write `advance` when we can actually name the side that went
      // through. If the winner is still unknown (feed lag / level snapshot),
      // omit it — merge keeps whatever is stored instead of writing null.
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

function matchApiQuery(matches) {
  const times = matches
    .map((match) => new Date(match.kickoff).getTime())
    .filter((value) => Number.isFinite(value));

  if (!times.length) return "";

  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));
  first.setUTCDate(first.getUTCDate() - 1);
  last.setUTCDate(last.getUTCDate() + 1);

  const params = new URLSearchParams();
  if (SEASON) params.set("season", SEASON);
  params.set("dateFrom", first.toISOString().slice(0, 10));
  params.set("dateTo", last.toISOString().slice(0, 10));

  return `?${params.toString()}`;
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

function matchById(matches) {
  const map = new Map();

  for (const match of matches) {
    map.set(String(match.id), match);
  }

  return map;
}

function winningSideFromLocal(match) {
  if (!match) return null;

  if (match.advance === "home" || match.advance === "away") return match.advance;

  if (match.homeScore != null && match.awayScore != null) {
    const home = Number(match.homeScore);
    const away = Number(match.awayScore);

    if (Number.isFinite(home) && Number.isFinite(away)) {
      if (home > away) return "home";
      if (away > home) return "away";
    }
  }

  if (match.homePenScore != null && match.awayPenScore != null) {
    const homePen = Number(match.homePenScore);
    const awayPen = Number(match.awayPenScore);

    if (Number.isFinite(homePen) && Number.isFinite(awayPen)) {
      if (homePen > awayPen) return "home";
      if (awayPen > homePen) return "away";
    }
  }

  return null;
}

function sourceSideFromLocal(match, sourceType) {
  const winner = winningSideFromLocal(match);

  if (!winner) return null;
  if (sourceType === "winner") return winner;
  if (sourceType === "loser") return winner === "home" ? "away" : "home";

  return null;
}

function resolveSourceParticipant(source, matchesById, depth = 0) {
  if (!source || !source.matchId || depth > 20) return null;

  const sourceMatch = matchesById.get(String(source.matchId));

  if (!sourceMatch || localStatusToAppStatus(sourceMatch.status) !== "finished") return null;

  const side = sourceSideFromLocal(sourceMatch, source.type);

  if (!side) return null;

  const name = sourceMatch[side];
  const flag = sourceMatch[`${side}Flag`] || "";

  if (isConcreteTeamName(name)) {
    return { name: String(name).trim(), flag };
  }

  return resolveSourceParticipant(sourceMatch[`${side}Source`], matchesById, depth + 1);
}

function resolveBracketParticipants(matches) {
  const matchesById = matchById(matches);
  let changed = false;

  for (const match of matches) {
    const home = resolveSourceParticipant(match.homeSource, matchesById);
    const away = resolveSourceParticipant(match.awaySource, matchesById);

    if (home && match.home !== home.name) {
      match.home = home.name;
      match.homeFlag = home.flag;
      changed = true;
    }

    if (away && match.away !== away.name) {
      match.away = away.name;
      match.awayFlag = away.flag;
      changed = true;
    }
  }

  return changed;
}

function resolveBracketParticipantsFully(matches) {
  for (let i = 0; i < 12; i++) {
    if (!resolveBracketParticipants(matches)) return;
  }
}

async function loadStoredResults(matches) {
  const refs = matches.map((match) => db.collection("results").doc(String(match.id)));
  const snaps = refs.length ? await db.getAll(...refs) : [];
  const stored = new Map();

  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i];
    if (snap.exists) stored.set(String(matches[i].id), snap.data());
  }

  return stored;
}

function applyStoredResultsToMatches(matches, storedResults) {
  for (const match of matches) {
    const stored = storedResults.get(String(match.id));

    if (stored) {
      applyMergedResultToLocalMatch(match, { ...match, ...stored });
    }
  }
}

function countBy(items, getter) {
  const counts = {};

  for (const item of items) {
    const key = getter(item) || "UNKNOWN";
    counts[key] = (counts[key] || 0) + 1;
  }

  return counts;
}

function compactCounts(counts) {
  return Object.keys(counts)
    .sort()
    .map((key) => `${key}:${counts[key]}`)
    .join(", ") || "none";
}

function matchHasSettledByTime(match) {
  const kickoffTime = new Date(match.kickoff).getTime();

  return Number.isFinite(kickoffTime) && Date.now() >= kickoffTime + MATCH_SETTLE_MS;
}

function apiHasUsableScore(apiMatch) {
  const status = apiStatusToAppStatus(apiMatch?.status);
  const score120 = scoreAfter120(apiMatch || {});

  return (status === "finished" || status === "live")
    && score120?.home != null
    && score120?.away != null;
}

function logApiDiagnostics(query, payload) {
  const api = payload.matches || [];
  const resultSet = payload.resultSet || {};
  const filters = payload.filters || {};
  const competition = payload.competition || {};
  const season = payload.season || {};

  console.log(`API endpoint: /v4/competitions/${COMP}/matches${query}`);
  console.log(`API competition: ${competition.name || COMP} (${competition.code || COMP})`);
  console.log(`API season: ${season.startDate || "unknown"} to ${season.endDate || "unknown"}`);
  console.log(`API filters: ${JSON.stringify(filters)}`);
  console.log(`API resultSet: ${JSON.stringify(resultSet)}`);
  console.log(`API status counts: ${compactCounts(countBy(api, (match) => match.status))}`);
  console.log(
    `API returned IDs sample: ${api.slice(0, 12).map((match) => match.id).join(", ") || "none"}`
  );
}

function validateApiCoverage(ours, api, indexes) {
  const errors = [];

  if (!api.length) {
    errors.push(`API returned 0 matches for COMPETITION=${COMP}, SEASON=${SEASON}.`);
  }

  const settledLocalPending = ours.filter((match) => {
    return localStatusToAppStatus(match.status) !== "finished" && matchHasSettledByTime(match);
  });

  const missingSettled = [];
  const unusableSettled = [];

  for (const match of settledLocalPending) {
    const apiMatch = findApiMatch(match, indexes);

    if (!apiMatch) {
      missingSettled.push(match);
      continue;
    }

    if (!apiHasUsableScore(apiMatch)) {
      unusableSettled.push({ match, apiMatch });
    }
  }

  if (missingSettled.length) {
    errors.push(
      "API did not match settled app fixtures: "
      + missingSettled.map((match) => `${match.id} ${match.home} vs ${match.away}`).join("; ")
    );
  }

  if (unusableSettled.length) {
    errors.push(
      "API matched settled fixtures but did not provide finished/live scores: "
      + unusableSettled.map(({ match, apiMatch }) => {
        return `${match.id} apiId=${apiMatch.id} apiStatus=${apiMatch.status}`;
      }).join("; ")
    );
  }

  return errors;
}


function setOrDelete(target, field, value) {
  if (value === undefined || value === null || value === "") {
    delete target[field];
  } else {
    target[field] = value;
  }
}

function applyMergedResultToLocalMatch(match, merged) {
  if (!match || !merged) return;

  if (isConcreteTeamName(merged.home)) match.home = String(merged.home).trim();
  if (isConcreteTeamName(merged.away)) match.away = String(merged.away).trim();
  if (merged.homeFlag && isConcreteTeamName(match.home)) match.homeFlag = merged.homeFlag;
  if (merged.awayFlag && isConcreteTeamName(match.away)) match.awayFlag = merged.awayFlag;
  if (merged.kickoff) match.kickoff = merged.kickoff;
  if (merged.externalId) match.externalId = String(merged.externalId);

  const status = localStatusToAppStatus(merged.status);
  match.status = status;

  if ((status === "finished" || status === "live")
    && merged.homeScore != null
    && merged.awayScore != null
    && Number.isFinite(Number(merged.homeScore))
    && Number.isFinite(Number(merged.awayScore))) {
    match.homeScore = Number(merged.homeScore);
    match.awayScore = Number(merged.awayScore);
  } else {
    delete match.homeScore;
    delete match.awayScore;
  }

  setOrDelete(match, "homePenScore", merged.homePenScore != null ? Number(merged.homePenScore) : null);
  setOrDelete(match, "awayPenScore", merged.awayPenScore != null ? Number(merged.awayPenScore) : null);
  setOrDelete(match, "advance", merged.advance === "home" || merged.advance === "away" ? merged.advance : null);

  if (status === "live") {
    setOrDelete(match, "liveMinute", merged.liveMinute);
    setOrDelete(match, "liveText", merged.liveText);
  } else {
    delete match.liveMinute;
    delete match.liveText;
  }
}

function writeMatchesJson(matches) {
  const content = `${JSON.stringify({ matches }, null, 2)}\n`;
  fs.writeFileSync("matches.json", content, "utf8");
}

function scoreLabel(view) {
  if (view.status === "finished" || view.status === "live") {
    if (view.homeScore != null && view.awayScore != null) {
      return `${view.homeScore}-${view.awayScore}`;
    }

    return "no score yet";
  }

  return "fixture synced";
}

async function fetchApiMatches(query) {
  const url = `https://api.football-data.org/v4/competitions/${COMP}/matches${query}`;

  const res = await fetch(url, {
    headers: {
      "X-Auth-Token": TOKEN
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  return await res.json();
}

async function main() {
  const ours = JSON.parse(fs.readFileSync("matches.json", "utf8")).matches || [];
  const storedResults = await loadStoredResults(ours);

  applyStoredResultsToMatches(ours, storedResults);
  resolveBracketParticipantsFully(ours);

  const apiQuery = matchApiQuery(ours);
  let apiPayload = { matches: [] };
  let api = [];
  let apiFailed = false;

  try {
    apiPayload = await fetchApiMatches(apiQuery);
    api = apiPayload.matches || [];
    logApiDiagnostics(apiQuery, apiPayload);
  } catch (error) {
    apiFailed = true;
    console.error(error.message);
    console.error("Continuing with matches.json sync so every app match has a Firestore record.");
  }

  const indexes = createApiIndexes(api);
  const apiCoverageErrors = validateApiCoverage(ours, api, indexes);

  if (apiCoverageErrors.length) {
    apiFailed = true;
    console.error("API COVERAGE CHECK FAILED:");
    for (const error of apiCoverageErrors) console.error(`- ${error}`);
    console.error("The Action is marked failed on purpose so RESULT PENDING cannot hide a broken API feed.");
  }

  let writes = 0;
  let apiMatches = 0;
  let apiScoreWrites = 0;
  let localWrites = 0;
  let localScoreWrites = 0;
  let missingApi = 0;
  let preserved = 0;

  for (const match of ours) {
    resolveBracketParticipantsFully(ours);

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

    // Strip anything that would erase/downgrade a previously stored result.
    const resultRef = db.collection("results").doc(match.id);
    const prev = storedResults.get(String(match.id)) || null;

    const before = JSON.stringify(updateData);
    guardAgainstRegression(prev, updateData);
    if (JSON.stringify(updateData) !== before) preserved++;

    await resultRef.set(updateData, { merge: true });
    writes++;

    // Log the POST-MERGE view so the output reflects what is actually stored.
    const merged = { ...(prev || {}), ...updateData };
    storedResults.set(String(match.id), merged);
    applyMergedResultToLocalMatch(match, merged);
    resolveBracketParticipantsFully(ours);

    const homeLabel = merged.home || match.home;
    const awayLabel = merged.away || match.away;
    const advanceLabel = merged.advance ? ` advance=${merged.advance}` : "";

    console.log(
      `Updated: ${match.id} ${homeLabel} ${scoreLabel(merged)} ${awayLabel} `
      + `[${merged.status || "scheduled"}] source=${updateData.source}${advanceLabel} ${merged.liveText || ""}`
    );
  }

  writeMatchesJson(ours);
  console.log("matches.json refreshed from the merged result view.");
  console.log(`Updated ${writes} Firestore result record(s).`);
  console.log(`API matched ${apiMatches}/${ours.length}; missing API matches ${missingApi}.`);
  console.log(`API score records ${apiScoreWrites}; matches.json score records ${localScoreWrites}.`);
  console.log(`Regression guard preserved existing data on ${preserved} record(s).`);

  if (apiFailed) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
