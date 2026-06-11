# WC26 Fantasy Draft Hub · The League

Live hub for our 2026 World Cup fantasy league — draft order, full schedule, scores, stats, and a what-if sandbox, all in one page the whole league can follow.

**Live site → https://ysawiris.github.io/wc26-draft-tracker/**

## What's in it

- **Draft Board** — all 10 teams ranked by total goals scored in their World Cup group. Re-ranks itself automatically as goals go in (tiebreaker: cards, yellow +1, red +2). Now with rank-movement arrows since the order last changed, games played + goal pace per team, 👑 on the leader, and a one-tap **📋 Copy draft order** button that formats the standings for the group chat (plus native share on phones).
- **Schedule & Scores** — every group-stage match for groups B–L, grouped by day, with live status, scores, kickoff times, a "▶ Highlights" link on finished matches and "＋ Calendar" on upcoming ones. Filter by *your group*, *today*, *upcoming*, or *results*.
- **Live strip** — a persistent "Live now / Next up" bar with a countdown to the next kickoff, and which fantasy team each match's goals count toward.
- **Groups** — the full draw, B–L, with live per-country goal bars and card counts.
- **Stats & Records** — an auto-written "Wire Report" (headlines generated from the live standings), the Record Book (top group, top-scoring country, dirtiest group, highest-scoring match, goals per match), each team's six-match "runway" progress, and goals by matchday.
- **What-If Machine** — add hypothetical goals and cards to any team's group and watch the draft order re-rank live. Scenarios never touch the real board, survive tab switches, and can be copied straight to the chat. Reset anytime.
- **Auto-refresh** — while the page is open it re-checks scores every 2 minutes (and immediately when you come back to the tab), with a freshness pill showing how current the scores are.
- **Add to home screen** — the site ships a web-app manifest and icon, so it installs like an app on phones.
- **Pick your team** — first visit asks "Whose board is this?" Each league member picks their own team (saved on their device) and the hub highlights *their* group, matches, and draft position. Change anytime via the 🏷 pill. Share links pre-assign a team: `https://ysawiris.github.io/wc26-draft-tracker/?team=GRS` (use the team's abbreviation from `js/data.js`).

## How the draft order works

1. Each team was randomly assigned a World Cup group, B–L (Group A is out). One group goes unclaimed.
2. **Most total goals scored in your group** across the group stage takes the No. 1 pick.
3. **Tiebreaker:** more cards in your group — yellow = +1, red = +2.
4. Final ranking = official draft order, picks 1–10. (Draw assigned by Meta AI in the league chat, June 11 2026. Taco Corp = Group F.)

## Live scores (fully automatic — no setup)

Two layers, both from **FIFA's public API**, no tokens:

1. **Baseline (cron)** — a GitHub Action (`.github/workflows/update-scores.yml`)
   pulls FIFA every ~10 minutes and commits `data/live.json`: kickoff times,
   scores, **and card counts** (the tiebreaker) for every group B–L match.
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
the live feed has no data of its own.

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
js/refresh.js           # 2-min auto-refresh + freshness pill
manifest.webmanifest    # PWA manifest (add-to-home-screen)
assets/icon.svg         # app icon
scripts/fetch-scores.mjs# the Action's fetcher (FIFA API -> data/live.json)
.github/workflows/update-scores.yml  # 10-min cron
```

Plain HTML/CSS/JS, no build step. Hosted on GitHub Pages.

### Architecture note

`js/app.js` exposes a tiny module API on `window.Hub`: feature modules register
with `Hub.onRender(fn)` and get the full derived state (`ctx`) after every render,
including the auto-refresh re-renders. New features = one JS file + one CSS file +
two tags in `index.html`, no changes to the core.
