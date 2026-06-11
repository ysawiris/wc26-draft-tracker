# WC26 Fantasy Draft Order Tracker

Live tracker for our fantasy league's draft order, decided by the 2026 FIFA World Cup group stage.

## How the draft order works

1. Each fantasy team was randomly assigned a World Cup group, **B–L** (Group A excluded — they already started). 10 teams, 11 groups, so one group goes unclaimed.
2. **Most total goals scored in your group** across the whole group stage decides the draft order — most goals gets the 1st pick.
3. **Tiebreaker:** more cards in your group wins the tie. Yellow = +1, red = +2.
4. Final ranking = official draft order, picks 1–10.

## Updating scores after a matchday

Everything lives in [`js/data.js`](js/data.js). For each country, bump:

- `goals` — total goals that country has scored in the group stage
- `yellows` / `reds` — total cards that country has received

Then update `LAST_UPDATED`, commit, and push. GitHub Pages redeploys automatically in ~1 minute.

You can also edit `js/data.js` straight from github.com (pencil icon) — no laptop needed.

## The draw

The group assignment in `js/data.js` was generated with a single run of Python's
`random.SystemRandom().shuffle()` over the letters B–L, mapped to the teams in the
order Christopher posted them. The exact command and output are recorded in `DRAW_NOTE`.

## Stack

Plain HTML/CSS/JS, no build step. Hosted on GitHub Pages.
