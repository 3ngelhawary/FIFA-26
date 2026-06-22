# EGEC · World Cup 2026 Predictor 🏆

A scoreboard-style **office pick'em** for the 2026 World Cup. Colleagues predict
the exact scoreline of each match; predictions **lock 1 hour before kickoff**;
points are awarded automatically when results come in; a leaderboard ranks the office.

Runs as a static site — **no server, no build step** — perfect for GitHub Pages.

---

## Files

| File | What it does |
|------|--------------|
| `index.html` | The whole app (UI + logic). Self-contained. |
| `matches.json` | The fixtures and scores. **Edit this to update results.** |
| `config.js` | Settings: scoring, lock time, live-score token, multiplayer. |
| `README.md` | This file. |

The page reads `matches.json` and `config.js` at runtime. If they can't be fetched
(e.g. opened directly off disk), it falls back to a copy of the fixtures baked into
`index.html`, so it always renders.

---

## 1. Deploy to GitHub Pages (5 minutes)

1. Create a new repository, e.g. `egec-worldcup`.
2. Upload `index.html`, `matches.json`, `config.js`, `README.md` to the repo root.
3. Go to **Settings → Pages**.
4. Under **Source**, pick **Deploy from a branch**, branch `main`, folder `/ (root)`, **Save**.
5. Wait ~1 minute. Your site is live at
   `https://<your-username>.github.io/egec-worldcup/`.

Share that link with the office. Done.

> Tip: opening `index.html` by double-clicking won't fetch `matches.json` (browser
> security). To preview locally, run `python3 -m http.server` in the folder and open
> `http://localhost:8000`. On GitHub Pages it just works.

---

## 2. Keep scores up to date

You have three options, from simplest to fully automatic.

**A. Edit `matches.json` by hand (simplest).**
When a match ends, set its `status` to `"finished"` and fill `homeScore` / `awayScore`.
Commit the change — the live site picks it up within 30 seconds (it polls in the
background, no refresh needed). To add the rest of the tournament, copy a match block
and edit the teams, flags, `kickoff` (in **UTC**, the `Z` suffix), and `group`.

**B. Auto-pull live scores from an API.**
Get a free token at <https://www.football-data.org/> and paste it into `config.js`:

```js
liveScores: { provider: "football-data", apiToken: "YOUR_TOKEN", competitionId: "WC" }
```

The page will overlay live scores onto `matches.json`. Note: browser calls to this API
can be blocked by CORS on some networks — if so, use option C, which is more reliable.

**C. Auto-update `matches.json` with a GitHub Action (recommended for "set and forget").**
Store your API token as a repo secret (`Settings → Secrets → Actions → FOOTBALL_TOKEN`),
then add `.github/workflows/scores.yml`:

```yaml
name: Update scores
on:
  schedule: [{ cron: "*/15 * * * *" }]   # every 15 minutes
  workflow_dispatch:
permissions: { contents: write }
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Fetch + write matches.json
        env: { TOKEN: ${{ secrets.FOOTBALL_TOKEN }} }
        run: |
          # Your script here: call the API, transform to matches.json shape, save it.
          # Keep the same fields the app expects (id, home, away, kickoff, status, scores).
          echo "build matches.json from API response"
      - name: Commit if changed
        run: |
          git config user.name "score-bot"
          git config user.email "bot@users.noreply.github.com"
          git add matches.json
          git diff --cached --quiet || git commit -m "Update scores"
          git push
```

This commits new scores on a schedule; the live site reflects them automatically.

---

## 3. Make it multiplayer (shared picks + real leaderboard)

Out of the box the app runs in **local mode**: each person's picks are saved in their
own browser, and the leaderboard shows demo colleagues plus the current user. That's
great for trying it out, but picks aren't shared.

To run a real office-wide game where everyone's picks and standings are shared, switch
to **Firebase** (free tier is plenty):

1. Create a project at <https://console.firebase.google.com/> and add a **Web app**.
2. Enable **Firestore Database** (start in test mode, then add basic rules).
3. Copy your web config into `config.js`:

```js
storage: {
  mode: "firebase",
  firebase: {
    apiKey: "…", authDomain: "…", projectId: "…",
    storageBucket: "…", messagingSenderId: "…", appId: "…"
  }
}
```

Everyone who enters their name now writes to a shared `predictions` collection, and the
leaderboard becomes the real office standings, updating live.

> Note: the simple version trusts people to enter their own name. For a locked-down
> game, add Firebase Auth (e.g. Google sign-in restricted to your company domain) and
> Firestore rules so each person can only write their own document.

---

## 4. Customize

All in `config.js`:

- **`orgName`** — shown in the header and crest.
- **`lockOffsetMinutes`** — how long before kickoff picks lock (default `60`).
- **`scoring`** — `exactScore`, `correctOutcome`, and `correctGoalsBonus` points.
- **`refreshMs`** — how often the page re-checks scores.

---

## Scoring (default)

- **Exact score** (e.g. you said 3-1, it finished 3-1): **5 pts**
- **Correct result** (right winner or a draw, wrong score): **3 pts**
- **Bonus**: **+1** for each team whose goal count you nailed
- Otherwise: **0**

Tweak any of these in `config.js`.

---

Built for the EGEC office. Yalla, get your picks in before they lock. ⚽
