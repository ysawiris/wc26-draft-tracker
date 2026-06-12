/* ============================================================
   Live layer: loads data/live.json (written by the GitHub Action)
   and merges real scores over the seed. Everything degrades
   gracefully when there's no live data yet.
   ============================================================ */

var Live = (function () {
  "use strict";

  /* Normalize a country name for fuzzy matching API names to seed names. */
  function norm(s) {
    return String(s)
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents
      .replace(/&/g, " and ")
      .replace(/[^a-z]+/g, " ")
      .trim();
  }

  var ALIASES = {
    "turkey": "türkiye",
    "cote d ivoire": "ivory coast",
    "cabo verde": "cape verde",
    "congo dr": "dr congo",
    "dr congo": "dr congo",
    "democratic republic of the congo": "dr congo",
    "islamic republic of iran": "iran",
    "ir iran": "iran",
    "united states of america": "united states",
    "usa": "united states",
    "czechia": "czech republic",
    "bosnia and herzegovina": "bosnia and herzegovina",
    "korea republic": "south korea"
  };

  /* Map an API team name to a seed country name (or null if unmatched). */
  function resolveCountry(apiName) {
    var n = norm(apiName);
    if (ALIASES[n]) n = norm(ALIASES[n]);
    var found = null;
    Object.keys(GROUPS).forEach(function (letter) {
      GROUPS[letter].countries.forEach(function (c) {
        if (norm(c.name) === n) found = c;
      });
    });
    return found;
  }

  var FINISHED = { FINISHED: 1, AWARDED: 1 };
  var INPLAY = { IN_PLAY: 1, PAUSED: 1, LIVE: 1, HALFTIME: 1 };



  function isCounted(status) { return FINISHED[status] || INPLAY[status]; }

  /* Overlay goals from live matches onto the seed GROUPS (mutates a fresh copy
     of counts only — we reset goals to 0 then sum from matches). */
  function applyMatches(matches) {
    if (!matches || !matches.length) return false;

    // Reset seed goals to 0 before summing live results.
    Object.keys(GROUPS).forEach(function (letter) {
      GROUPS[letter].countries.forEach(function (c) { c.goals = 0; });
    });

    matches.forEach(function (m) {
      if (!isCounted(m.status)) return;
      if (m.homeGoals == null || m.awayGoals == null) return;
      var h = resolveCountry(m.home);
      var a = resolveCountry(m.away);
      if (h) h.goals += m.homeGoals;
      if (a) a.goals += m.awayGoals;
    });

    return true;
  }

  /* Overlay card counts from the live feed onto the seed. Resets seed
     yellows/reds ONLY when the feed provides card data — otherwise the
     manual numbers in data.js stay authoritative. */
  function applyCards(byCountry) {
    if (!byCountry || !Object.keys(byCountry).length) return false;

    Object.keys(GROUPS).forEach(function (letter) {
      GROUPS[letter].countries.forEach(function (c) { c.yellows = 0; c.reds = 0; });
    });

    Object.keys(byCountry).forEach(function (name) {
      var c = resolveCountry(name);
      if (!c) return;
      c.yellows += byCountry[name].y || 0;
      c.reds += byCountry[name].r || 0;
    });

    return true;
  }

  /* Overlay foul counts from the live feed onto the seed. Same pattern as
     applyCards — resets only when feed data is present. */
  function applyFouls(byCountry) {
    if (!byCountry || !Object.keys(byCountry).length) return false;

    Object.keys(GROUPS).forEach(function (letter) {
      GROUPS[letter].countries.forEach(function (c) { c.fouls = 0; });
    });

    Object.keys(byCountry).forEach(function (name) {
      var c = resolveCountry(name);
      if (!c) return;
      c.fouls += byCountry[name].f || 0;
    });

    return true;
  }

  /* Match an API match to a generated fixture by group + the unordered pair
     of teams, then copy status/score/time (and per-match card counts, when
     cardsByMatch is given) onto the fixture in ITS orientation. */
  function attachToFixtures(fixtures, matches, cardsByMatch) {
    if (!matches || !matches.length) return 0;
    var attached = 0;

    fixtures.forEach(function (fx) {
      var fxHome = norm(fx.home.name);
      var fxAway = norm(fx.away.name);

      var hit = matches.find(function (m) {
        if (m.group !== fx.group) return false;
        var mh = canon(m.home);
        var ma = canon(m.away);
        return (mh === fxHome && ma === fxAway) || (mh === fxAway && ma === fxHome);
      });
      if (!hit) return;

      attached += 1;
      fx.status = hit.status || fx.status;
      fx.utcDate = hit.utcDate || fx.utcDate;
      fx.venue = hit.venue || fx.venue;
      fx.minute = hit.minute || fx.minute;

      var sameOrientation = canon(hit.home) === fxHome;
      if (hit.homeGoals != null && hit.awayGoals != null) {
        fx.homeGoals = sameOrientation ? hit.homeGoals : hit.awayGoals;
        fx.awayGoals = sameOrientation ? hit.awayGoals : hit.homeGoals;
      }

      var perMatch = cardsByMatch && hit.id != null && cardsByMatch[hit.id];
      if (perMatch) {
        var home = { y: 0, r: 0 };
        var away = { y: 0, r: 0 };
        Object.keys(perMatch).forEach(function (name) {
          var n = canon(name);
          if (n === fxHome) home = perMatch[name];
          else if (n === fxAway) away = perMatch[name];
        });
        fx.cards = { home: home, away: away };
      }
    });

    return attached;
  }

  /* Canonicalize an API team name to its normalized seed form. Aliases
     apply to every API name (e.g. "Korea Republic" → "South Korea",
     "Czechia" → "Czech Republic"), so live rows still match the seed. */
  function canon(apiName) {
    var c = resolveCountry(apiName);
    if (c) return norm(c.name);
    var n = norm(apiName);
    return ALIASES[n] ? norm(ALIASES[n]) : n;
  }

  function load() {
    // Cache-bust: GitHub Pages serves this with max-age=600, so a bare
    // refetch can read a CDN copy up to 10 minutes stale.
    return fetch("data/live.json?v=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        // During match windows the browser also polls FIFA directly;
        // that layer overlays fresher scores/cards when it has them.
        try {
          return window.LiveDirect ? LiveDirect.overlay(data) : data;
        } catch (err) {
          console.error("LiveDirect overlay failed:", err);
          return data;
        }
      });
  }

  /* YouTube highlights search for a fixture — always works, no API key. */
  function highlightsUrl(home, away) {
    var q = home + " vs " + away + " World Cup 2026 highlights";
    return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
  }

  /* Google Calendar "add event" link for a fixture kickoff (90-min block). */
  function calendarUrl(home, away, group, utcDate) {
    if (!utcDate) return null;
    var start = new Date(utcDate);
    if (isNaN(start)) return null;
    var end = new Date(start.getTime() + 110 * 60000);
    var fmt = function (d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); };
    var params =
      "action=TEMPLATE" +
      "&text=" + encodeURIComponent(home + " vs " + away + " (Group " + group + ")") +
      "&dates=" + fmt(start) + "/" + fmt(end) +
      "&details=" + encodeURIComponent("2026 FIFA World Cup · Group " + group);
    return "https://www.google.com/calendar/render?" + params;
  }

  return {
    load: load,
    applyMatches: applyMatches,
    applyCards: applyCards,
    applyFouls: applyFouls,
    attachToFixtures: attachToFixtures,
    resolveCountry: resolveCountry,
    isCounted: isCounted,
    FINISHED: FINISHED,
    INPLAY: INPLAY,
    highlightsUrl: highlightsUrl,
    calendarUrl: calendarUrl
  };
})();
