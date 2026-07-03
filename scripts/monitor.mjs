/* =============================================================================
   Tamper monitor for the EGEC World Cup Predictor.
   Repo path: scripts/monitor.mjs

   Runs on the same schedule as the score updater, in GitHub Actions, using the
   Firebase Admin SDK (server-side, bypasses security rules, cannot be forged
   from any browser). Every run it:

     1. Reads the current players / predictions / results from Firestore.
     2. Compares them to a snapshot it saved on the previous run.
     3. Writes anything suspicious to the `flags` collection, which the
        organizer view reads and displays in the "Flags" panel.
     4. Saves a fresh snapshot for next time.

   WHAT IT CATCHES (from the moment it first runs — it cannot audit the past):
     - A prediction edited AFTER its match locked  (the main cheating signal)
     - An official score that changed AFTER the match was marked finished (audit)
     - A prediction that exists for a code with no player (orphan)
     - A player record that was removed unexpectedly

   WHAT IT CANNOT CATCH (needs real authentication, not monitoring):
     - A prediction tampered with BEFORE lock, or one player impersonating
       another — those are "valid" writes with no verifiable identity behind
       them, so nothing distinguishes them from a legitimate edit.
   ========================================================================== */

import fs from "fs";
import admin from "firebase-admin";

const SA = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
const LOCK_OFFSET_MIN = Number(process.env.MONITOR_LOCK_OFFSET_MIN || 60);
const SNAP_ID = "state";
const MAX_SIGS = 3000; // cap the dedupe list so the snapshot doc stays small

if (!SA.project_id) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT secret");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(SA) });
}
const db = admin.firestore();
const NOW = Date.now();

// ---- helpers ---------------------------------------------------------------

function normalizePick(p) {
  if (!p || p.h == null || p.a == null) return null;
  return `${p.h}-${p.a}${p.pen ? ":" + p.pen : ""}`;
}

function normalizeResult(r) {
  if (!r) return null;
  const status = r.status || "";
  const h = r.homeScore == null ? "" : r.homeScore;
  const a = r.awayScore == null ? "" : r.awayScore;
  const adv = r.advance || "";
  return `${status}:${h}-${a}:${adv}`;
}

function isFinished(resStr) {
  return typeof resStr === "string" && resStr.startsWith("finished:");
}

async function readCollection(name) {
  const out = {};
  const snap = await db.collection(name).get();
  snap.forEach((d) => (out[name === "_monitor" ? d.id : d.id] = d.data()));
  return out;
}

async function main() {
  // fixtures (labels + kickoff/lock times)
  const fixtures = JSON.parse(fs.readFileSync("matches.json", "utf8")).matches || [];
  const fx = {};
  for (const m of fixtures) fx[m.id] = m;

  const [players, predictions, results] = await Promise.all([
    readCollection("players"),
    readCollection("predictions"),
    readCollection("results"),
  ]);

  // label + lock time per match (prefer live result data, fall back to fixtures)
  const matchInfo = (id) => {
    const f = fx[id] || {};
    const r = results[id] || {};
    const home = r.home || f.home || "?";
    const away = r.away || f.away || "?";
    const kickoff = r.kickoff || f.kickoff || null;
    const lockAt = kickoff ? Date.parse(kickoff) - LOCK_OFFSET_MIN * 60000 : null;
    return { label: `${home} v ${away}`, lockAt };
  };

  // current compact state
  const curPicks = {};
  const curTop3 = {};
  for (const [code, d] of Object.entries(predictions)) {
    const picks = d.picks || {};
    const pm = {};
    for (const [mid, p] of Object.entries(picks)) {
      const v = normalizePick(p);
      if (v != null) pm[mid] = v;
    }
    curPicks[code] = pm;
    const t = d.top3 || {};
    curTop3[code] = t.first || t.second || t.third ? `${t.first || ""}|${t.second || ""}|${t.third || ""}` : "";
  }
  const curResults = {};
  for (const [id, r] of Object.entries(results)) curResults[id] = normalizeResult(r);
  const curPlayers = Object.keys(players);

  // previous snapshot
  const snapRef = db.collection("_monitor").doc(SNAP_ID);
  const snapDoc = await snapRef.get();
  const prev = snapDoc.exists ? snapDoc.data() : null;

  const flaggedSigs = new Set((prev && prev.flaggedSigs) || []);
  const newFlags = [];
  const addFlag = (sig, f) => {
    if (flaggedSigs.has(sig)) return;
    flaggedSigs.add(sig);
    newFlags.push({ ...f, sig });
  };

  if (!prev) {
    // First run = baseline. No history to compare against yet.
    console.log("No previous snapshot — establishing baseline.");
    await db.collection("flags").add({
      type: "baseline",
      severity: "info",
      message: "Monitoring started — baseline recorded.",
      detail: "Changes from this point on will be checked. Earlier activity can't be audited.",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      runAt: new Date(NOW).toISOString(),
    });
  } else {
    const prevPicks = prev.picks || {};
    const prevTop3 = prev.top3 || {};
    const prevResults = prev.results || {};
    const prevPlayers = new Set(prev.players || []);
    const prevTs = prev.ts || 0;

    // 1) Prediction edits after lock -----------------------------------------
    for (const [code, pm] of Object.entries(curPicks)) {
      const prevPm = prevPicks[code] || {};
      const mids = new Set([...Object.keys(pm), ...Object.keys(prevPm)]);
      for (const mid of mids) {
        if (!fx[mid]) continue; // ignore unknown match ids
        const cur = pm[mid] || null;
        const was = prevPm[mid] || null;
        if (cur === was) continue;
        const info = matchInfo(mid);
        if (info.lockAt == null) continue;
        const lockedPrev = prevTs >= info.lockAt;
        const lockedNow = NOW >= info.lockAt;
        if (!lockedNow) continue; // legitimate pre-lock edit — ignore
        const who = players[code] || {};
        addFlag(`lpe:${code}:${mid}:${was}=>${cur}:${lockedPrev ? "L" : "l"}`, {
          type: "late_pick_edit",
          severity: lockedPrev ? "high" : "med",
          message: lockedPrev
            ? "Prediction changed AFTER it was locked"
            : "Prediction changed right around lock time — verify",
          matchId: mid,
          matchLabel: info.label,
          playerCode: code,
          playerName: who.name || "",
          detail: `${was || "—"} → ${cur || "removed"}`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          runAt: new Date(NOW).toISOString(),
        });
      }
    }

    // 2) Score changed after the match was finished --------------------------
    for (const [id, cur] of Object.entries(curResults)) {
      const was = prevResults[id];
      if (!was || cur === was) continue;
      if (!isFinished(was)) continue; // only care once it was already final
      const info = matchInfo(id);
      addFlag(`scf:${id}:${was}=>${cur}`, {
        type: "score_changed_after_finished",
        severity: "med",
        message: "Official score changed after the match was finished",
        matchId: id,
        matchLabel: info.label,
        detail: `${was} → ${cur}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        runAt: new Date(NOW).toISOString(),
      });
    }

    // 3) Orphan predictions (code with no player) ----------------------------
    for (const code of Object.keys(curPicks)) {
      if (players[code]) continue;
      addFlag(`orph:${code}`, {
        type: "orphan_prediction",
        severity: "med",
        message: "Prediction exists for a code with no player record",
        playerCode: code,
        detail: "Could be a deleted player, or a prediction written directly to the database.",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        runAt: new Date(NOW).toISOString(),
      });
    }

    // 4) Player removed unexpectedly -----------------------------------------
    for (const code of prevPlayers) {
      if (players[code]) continue;
      addFlag(`prem:${code}`, {
        type: "player_removed",
        severity: "med",
        message: "A player record disappeared",
        playerCode: code,
        detail: "The read-only app can't delete players, so this came from outside it.",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        runAt: new Date(NOW).toISOString(),
      });
    }
  }

  // write flags
  for (const f of newFlags) await db.collection("flags").add(f);
  console.log(`${newFlags.length} new flag(s) written.`);

  // save snapshot for next run (keep the dedupe list bounded)
  const sigs = [...flaggedSigs].slice(-MAX_SIGS);
  await snapRef.set({
    ts: NOW,
    picks: curPicks,
    top3: curTop3,
    results: curResults,
    players: curPlayers,
    flaggedSigs: sigs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("Snapshot saved.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
