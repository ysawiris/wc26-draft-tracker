# WC26 Fantasy Draft Hub · The League

Live hub for our 2026 World Cup fantasy league — draft order, full schedule, scores, stats, and a what-if sandbox, all in one page the whole league can follow.

**Live site → https://ysawiris.github.io/wc26-draft-tracker/**

## What's in it

- **Draft Board** — all 10 teams ranked by total goals scored in their World Cup group. Re-ranks itself automatically as goals go in (tiebreaker: cards, yellow +1, red +2). Now with rank-movement arrows since the order last changed, games played + goal pace per team, 👑 on the leader, and a one-tap **📋 Copy draft order** button that formats the standings for the group chat (plus native share on phones).
- **Schedule & Scores** — every group-stage match for groups A–L, grouped by day, with live status, scores, kickoff times, a "▶ Highlights" link on finished matches and "＋ Calendar" on upcoming ones. Filter by *your group*, *today*, *upcoming*, or *results*.
- **Live strip** — a persistent "Live now / Next up" bar with a countdown to the next kickoff, and which fantasy team each match's goals count toward.
- **Groups** — the full draw, A–L, with live per-country goal bars and card counts.
- **Stats & Records** — an auto-written "Wire Report" (headlines generated from the live standings), the Record Book (top group, top-scoring country, dirtiest group, highest-scoring match, goals per match), each team's six-match "runway" progress, and goals by matchday.
- **What-If Machine** — add hypothetical goals and cards to any team's group and watch the draft order re-rank live. Scenarios never touch the real board, survive tab switches, and can be copied straight to the chat. Reset anytime.
- **Auto-refresh** — while the page is open it re-checks scores every 2 minutes (and immediately when you come back to the tab), with a freshness pill showing how current the scores are.
- **Pick Odds** — a Monte Carlo forecast tab driven by **real betting markets**: a cron pulls DraftKings over/under totals (via ESPN's public API) every 4 hours, strips the vig, and converts each match's line into market-implied expected goals — those rates drive thousands of simulations of the remaining group stage (Elo-informed strength model fills unpriced matches; cards tiebreak included). You get the favorite for the No. 1 pick with moneylines, your expected pick, a bookmaker-style board, the posted market lines for the next 48h, and the full pick-probability matrix.
- **The Race** — a bump chart at the top of Stats showing the draft order day by day, rebuilt from every finished match. Your team's line glows; riser/faller chips call out the day's biggest moves.
- **Goal alerts** — while the hub is open, goals, red cards, and draft-order changes pop as toasts (with a 👑 special when someone takes the No. 1 pick), and the scoring team's row flashes on the board. The 🔔 in the top bar cycles: toasts only → toasts + browser notifications (with a goal horn) → off.
- **📸 Share card** — one tap renders the live draft order as a branded PNG and opens the share sheet (or downloads it) — made for the group chat.
- **Add to home screen** — web-app manifest, icon, and a real service worker: installs like an app, loads instantly, and works offline with the last-known scores. Fresh data and new deploys still always win while online.
- **Pick your team** — first visit asks "Whose board is this?" Each league member picks their own team (saved on their device) and the hub highlights *their* group, matches, and draft position. Change anytime via the 🏷 pill. Share links pre-assign a team: `https://ysawiris.github.io/wc26-draft-tracker/?team=GRS` (use the team's abbreviation from `js/data.js`).

## How the draft order works

1. Each team was randomly assigned a World Cup group, A–L. With 10 teams and 12 groups, two groups (A and I) go unclaimed.
2. **Most total goals scored in your group** across the group stage takes the No. 1 pick.
3. **Tiebreaker:** more cards in your group — yellow = +1, red = +2.
4. Final ranking = official draft order, picks 1–10. (Draw assigned by Meta AI in the league chat, June 11 2026. Taco Corp = Group F.)

## Live scores (fully automatic — no setup)

Two layers, both from **FIFA's public API**, no tokens:

1. **Baseline (cron)** — a GitHub Action (`.github/workflows/update-scores.yml`)
   pulls FIFA every ~10 minutes and commits `data/live.json`: kickoff times,
   scores, **and card counts** (the tiebreaker) for every group A–L match.
   Works even when nobody has the site open.
2. **Direct (browser)** — during match windows each open browser also polls
   FIFA directly (`js/live-direct.js`): every 60s while a match is in play,
   every 2 min around kickoff, idle otherwise. Goals, the match minute
   ("LIVE · 63'"), live card counts, and a ⚽ goal-ticker with scorers land
   within about a minute — no waiting on cron → commit → CDN.

`live.json` fetches are cache-busted (GitHub Pages serves it with
`max-age=600`, which would otherwise feed clients a CDN copy up to 10 min stale).

If FIFA's API ever goes down, the script falls back to
[football-data.org](https://www.football-data.org) when a `FOOTBALL_DATA_TOKEN`
repo secret is configured (optional, scores only).

### Manual fallback

You can always hand-correct: edit `js/data.js` (each country's `goals` /
`yellows` / `reds`), commit, push — Pages redeploys in ~1 minute. Editable
straight from github.com on your phone. Note manual numbers only show while
the live feed has no data of its own. Members' installed copies pick the edit
up on their next visit (stale-while-revalidate) — or immediately if you also
bump `VERSION` in `sw.js`.

## Project layout

```
index.html              # tabbed hub shell
css/styles.css          # gold & black World Cup theme
css/board-extras.css    # board toolbar, movement arrows, flourishes
css/stats.css           # Stats & Records tab
css/simulator.css       # What-If Machine tab
css/extras.css          # freshness pill
js/data.js              # teams, groups, draw (the seed — edit to update by hand)
js/my-team.js           # per-viewer team picker (?team= links, localStorage)
js/schedule.js          # group-stage fixtures (FIFA pattern + confirmed dates)
js/live.js              # loads data/live.json, merges scores, highlights/calendar links
js/app.js               # rendering + tabs + countdown + the Hub module API
js/board-extras.js      # copy/share, rank movement, pace, crown/last-pick
js/stats.js             # wire report, record book, runway, matchday bars
js/simulator.js         # what-if deltas + live re-ranking
js/odds.js              # Pick Odds tab — Monte Carlo forecast of the final order
js/race.js              # The Race — rank-history bump chart (Stats tab)
js/alerts.js            # goal/card/rank toasts, browser notifications, goal horn
js/share-card.js        # 📸 branded PNG of the draft order via canvas + share sheet
js/refresh.js           # 2-min auto-refresh + freshness pill
js/sw-register.js       # service-worker registration + "new version" pill
sw.js                   # service worker — offline shell, network-first live.json
manifest.webmanifest    # PWA manifest (add-to-home-screen)
assets/icon.svg         # app icon
scripts/fetch-scores.mjs# the Action's fetcher (FIFA API -> data/live.json)
scripts/fetch-odds.mjs  # betting-totals fetcher (ESPN/DraftKings -> data/odds.json)
.github/workflows/update-scores.yml  # 10-min cron
.github/workflows/update-odds.yml    # 4-hour cron for market lines
```

Plain HTML/CSS/JS, no build step. Hosted on GitHub Pages.

**Deploy rule:** bump `VERSION` at the top of `sw.js` (e.g. `wc26-v1` →
`wc26-v2`) on any deploy that changes js/, css/, index.html, or the manifest —
returning visitors then get a "↻ tap to refresh" pill and the update lands
immediately. Forgot the bump? Not fatal: assets are stale-while-revalidate,
so each member self-heals on their next visit. `data/live.json` is always
network-first, so scores stay fresh regardless.

### Architecture note

`js/app.js` exposes a tiny module API on `window.Hub`: feature modules register
with `Hub.onRender(fn)` and get the full derived state (`ctx`) after every render,
including the auto-refresh re-renders. New features = one JS file + one CSS file +
two tags in `index.html`, no changes to the core.
