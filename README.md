# WC26 Fantasy Draft Hub · The League

Live hub for our 2026 World Cup fantasy league — draft order, full schedule, scores, and highlights, all in one page the whole league can follow.

**Live site → https://ysawiris.github.io/wc26-draft-tracker/**

## What's in it

- **Draft Board** — all 10 teams ranked by total goals scored in their World Cup group. Re-ranks itself automatically as goals go in. Tiebreaker is cards (yellow +1, red +2).
- **Schedule & Scores** — every group-stage match for groups B–L, grouped by day, with live status, scores, kickoff times, and a "▶ Highlights" link on every finished match. Filter by *your group*, *today*, *upcoming*, or *results*.
- **Live strip** — a persistent "Live now / Next up" bar with a countdown to the next kickoff, and which fantasy team each match's goals count toward.
- **Groups** — the full draw, B–L, with live per-country goal bars.

## How the draft order works

1. Each team was randomly assigned a World Cup group, B–L (Group A is out). One group goes unclaimed.
2. **Most total goals scored in your group** across the group stage takes the No. 1 pick.
3. **Tiebreaker:** more cards in your group — yellow = +1, red = +2.
4. Final ranking = official draft order, picks 1–10. (Draw assigned by Meta AI in the league chat, June 11 2026. Taco Corp = Group F.)

## Live scores (auto-updates)

A GitHub Action (`.github/workflows/update-scores.yml`) fetches scores from
[football-data.org](https://www.football-data.org) every ~10 minutes during the
tournament and commits `data/live.json`. The site reads that file and updates the
board, schedule, and live strip on its own — nobody has to touch anything.

**One-time setup to switch it on:**

1. Register for a free token at <https://www.football-data.org/client/register> (instant, free forever).
2. In this repo: **Settings → Secrets and variables → Actions → New repository secret**.
   Name it `FOOTBALL_DATA_TOKEN`, paste the token, save.
3. That's it. The next cron run (or **Actions → Update live scores → Run workflow**) goes live.

Until the token is added, the site runs in **schedule mode** — full fixtures and
kickoff dates show, and the board sits at 0–0 until goals land.

### Manual fallback

No token? You can still update goals by hand: edit `js/data.js` (each country's
`goals` / `yellows` / `reds`), commit, push — Pages redeploys in ~1 minute. Editable
straight from github.com on your phone.

## Project layout

```
index.html              # tabbed hub shell
css/styles.css          # gold & black World Cup theme
js/data.js              # teams, groups, draw (the seed — edit to update by hand)
js/schedule.js          # group-stage fixtures (FIFA pattern + confirmed dates)
js/live.js              # loads data/live.json, merges scores, highlights/calendar links
js/app.js               # rendering + tabs + countdown
scripts/fetch-scores.mjs# the Action's fetcher (football-data.org -> data/live.json)
.github/workflows/update-scores.yml  # 10-min cron
```

Plain HTML/CSS/JS, no build step. Hosted on GitHub Pages.
