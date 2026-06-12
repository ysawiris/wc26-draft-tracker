/* ============================================================
   Group-stage fixtures for groups A–L.

   Pairings are generated from FIFA's fixed round-robin template
   (verified against the real 2026 schedule); dates are the
   confirmed per-match calendar dates (ESPN + Wikipedia, June 2026).
   Exact kickoff times, venues, status and scores are layered on
   from the live feed (data/live.json) when available.
   ============================================================ */

/* Positions are 0-indexed into GROUPS[letter].countries (draw order 1–4).
   MD1: 1v2, 3v4 · MD2: 1v3, 4v2 · MD3: 4v1, 2v3 */
var FIXTURE_PATTERN = [
  { matchday: 1, pairs: [[0, 1], [2, 3]] },
  { matchday: 2, pairs: [[0, 2], [3, 1]] },
  { matchday: 3, pairs: [[3, 0], [1, 2]] }
];

/* Six dates per group, in pattern order:
   [MD1a, MD1b, MD2a, MD2b, MD3a, MD3b]. Group D's MD1 is split
   across Jun 12–13, which is why dates are stored per match. */
var GROUP_DATES = {
  A: ["2026-06-11", "2026-06-12", "2026-06-19", "2026-06-18", "2026-06-25", "2026-06-25"],
  B: ["2026-06-12", "2026-06-12", "2026-06-18", "2026-06-18", "2026-06-24", "2026-06-24"],
  C: ["2026-06-13", "2026-06-13", "2026-06-19", "2026-06-19", "2026-06-24", "2026-06-24"],
  D: ["2026-06-12", "2026-06-13", "2026-06-19", "2026-06-19", "2026-06-25", "2026-06-25"],
  E: ["2026-06-14", "2026-06-14", "2026-06-20", "2026-06-20", "2026-06-25", "2026-06-25"],
  F: ["2026-06-14", "2026-06-14", "2026-06-20", "2026-06-20", "2026-06-25", "2026-06-25"],
  G: ["2026-06-15", "2026-06-15", "2026-06-21", "2026-06-21", "2026-06-26", "2026-06-26"],
  H: ["2026-06-15", "2026-06-15", "2026-06-21", "2026-06-21", "2026-06-26", "2026-06-26"],
  I: ["2026-06-16", "2026-06-16", "2026-06-22", "2026-06-22", "2026-06-26", "2026-06-26"],
  J: ["2026-06-16", "2026-06-16", "2026-06-22", "2026-06-22", "2026-06-27", "2026-06-27"],
  K: ["2026-06-17", "2026-06-17", "2026-06-23", "2026-06-23", "2026-06-27", "2026-06-27"],
  L: ["2026-06-17", "2026-06-17", "2026-06-23", "2026-06-23", "2026-06-27", "2026-06-27"]
};

/* No exhibition groups right now. Group A used to live here (it kicked off
   before the league draw), but it's now a full league group in GROUP_DATES —
   unclaimed like Group I, yet counted in the draft math. Kept as an extension
   point in case a future group needs to ride the schedule without scoring. */
var EXHIBITION_GROUPS = {};

function buildExhibitionFixtures() {
  var fixtures = [];

  Object.keys(EXHIBITION_GROUPS).forEach(function (letter) {
    var group = EXHIBITION_GROUPS[letter];
    var idx = 0;

    FIXTURE_PATTERN.forEach(function (round) {
      round.pairs.forEach(function (pair) {
        var home = group.countries[pair[0]];
        var away = group.countries[pair[1]];
        fixtures.push({
          id: letter + "-x" + (idx + 1),
          group: letter,
          matchday: round.matchday,
          exhibition: true,
          home: { name: home.name, flag: home.flag },
          away: { name: away.name, flag: away.flag },
          dateISO: group.dates[idx],
          utcDate: null,
          status: "SCHEDULED",
          homeGoals: null,
          awayGoals: null,
          venue: null,
          minute: null,
          cards: null
        });
        idx += 1;
      });
    });
  });

  return fixtures;
}

/* Build the full fixture list for groups A–L from the seed groups. */
function buildFixtures() {
  var fixtures = [];

  Object.keys(GROUP_DATES).forEach(function (letter) {
    var group = GROUPS[letter];
    if (!group) return;
    var teams = group.countries;
    var dates = GROUP_DATES[letter];
    var idx = 0;

    FIXTURE_PATTERN.forEach(function (round) {
      round.pairs.forEach(function (pair) {
        var home = teams[pair[0]];
        var away = teams[pair[1]];
        fixtures.push({
          id: letter + "-" + (idx + 1),
          group: letter,
          matchday: round.matchday,
          home: { name: home.name, flag: home.flag },
          away: { name: away.name, flag: away.flag },
          dateISO: dates[idx],
          // Layered on from the live feed when present:
          utcDate: null,
          status: "SCHEDULED",
          homeGoals: null,
          awayGoals: null,
          venue: null,
          minute: null,
          cards: null
        });
        idx += 1;
      });
    });
  });

  return fixtures;
}
