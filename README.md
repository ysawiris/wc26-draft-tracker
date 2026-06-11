# WC26 Fantasy Draft Order Tracker

Live tracker for our fantasy league's draft order, decided by the 2026 FIFA World Cup group stage.

**Live site → https://ysawiris.github.io/wc26-draft-tracker/**

## How the draft order works

1. Each team was randomly assigned a World Cup group, **B–L** (Group A is out — they already started). 10 teams, 11 groups, so one group goes unclaimed.
2. **Most total goals scored in your group** across the whole group stage decides the order — most goals gets the No. 1 pick.
3. **Tiebreaker:** more cards in your group wins the tie. Yellow = +1, red = +2.
4. Final ranking = official draft order, picks 1–10.

## The draw

Assigned by Meta AI in the league chat (June 11, 2026).

| Group | Team | Manager(s) | Division |
|-------|------|-----------|----------|
| **B** | Purdy Pitches | Alex Mikhail, Michael Shanoudi | West |
| **C** | Ms. Jackson ouuuuu | Mario Rofael | East |
| **D** | Gallactic Rebel Scum | Joe Hanna | West |
| **E** | Nicolodeons! | John Ghali | East |
| **F** | Taco Corp | Shaan Hurley, Youssef Sawiris | West |
| **G** | Commissioner's Infirmary 2.0 | Christopher Malek | East |
| **H** | Big Blue Wrecking Crew | George Hanna, Hanni Fakhoury | East |
| **J** | Fiko Fins | Rafik Zarifa | West |
| **K** | The Metcalf Matrix | David Masoud | West |
| **L** | Another Rebuilding Year | Zack Girgis, Andrew Ishak | East |

Group **I** (France, Senegal, Iraq, Norway) is unclaimed.

## Updating scores after a matchday

Everything lives in [`js/data.js`](js/data.js). For each country, bump:

- `goals` — total goals that country has scored in the group stage
- `yellows` / `reds` — total cards that country has received

Then update `LEAGUE.lastUpdated`, commit, and push. GitHub Pages redeploys automatically in ~1 minute. The board re-ranks itself and the "group stage hasn't started" banner disappears as soon as any goal is entered.

You can also edit `js/data.js` straight from github.com (pencil icon) — no laptop needed.

## Team photos

Drop a photo in `assets/` and point a team's `photo` field at it in `js/data.js`.
Taco Corp already expects `assets/taco-corp.jpg` — add that file and it shows as the crest (falls back to a monogram until then).

## Stack

Plain HTML/CSS/JS, no build step. Hosted on GitHub Pages.
