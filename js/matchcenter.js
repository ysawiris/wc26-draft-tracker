/* ============================================================
   Match Center — a Google-style full match panel, opened from a
   single "📊 Match" button on every fixture (replaces the old
   ▶ Highlights link and 📝 Recap modal). Works for finished, live
   and upcoming games.

   Modelled on Google's football match card (score hero, scorers
   row, Timeline / Stats / Group tabs, win-probability bar,
   comparison stats, live group table) but rendered in the hub's
   gold-on-dark theme.

   Decoupled from the renderers: it finds the fixture in the live
   Hub.ctx() by id on click, so it always reflects the latest data
   (live scores re-render the cards, never this panel directly).
   Goal-by-goal detail comes from data/recaps.json (finished games);
   live games lean on the live score, minute, cards and a modelled
   win probability. Real betting totals (over/under) come from
   data/odds.json for upcoming games.
   ============================================================ */

var MatchCenter = (function () {
  "use strict";

  var recapsById = {};
  var oddsLines = [];

  /* ---------------- shared helpers ---------------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z]+/g, " ")
      .trim();
  }

  /* The GROUPS country object for a fixture team name (flag, colours). */
  function country(name) {
    try { return (window.Live && Live.resolveCountry(name)) || null; }
    catch (err) { return null; }
  }
  function teamColor(name) {
    var c = country(name);
    return (c && (c.c1 || c.accent)) || "#c89638";
  }
  function flagFor(name) {
    var c = country(name);
    return c ? c.flag : "";
  }

  /* ---------------- data loads (both cheap + cache-busted) ---------------- */

  function loadRecaps() {
    return fetch("data/recaps.json?v=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) { recapsById = (data && data.byId) || {}; });
  }

  function loadOdds() {
    return fetch("data/odds.json?v=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) { oddsLines = (data && data.lines) || []; });
  }

  function oddsFor(fx) {
    var h = norm(fx.home.name), a = norm(fx.away.name);
    return oddsLines.find(function (l) {
      var lh = norm(l.home), la = norm(l.away);
      return (lh === h && la === a) || (lh === a && la === h);
    }) || null;
  }

  /* ---------------- status ---------------- */

  function isLive(fx) { return !!(window.Live && Live.INPLAY[fx.status]); }
  function isDone(fx) { return !!(window.Live && Live.FINISHED[fx.status]); }
  function hasScore(fx) { return fx.homeGoals != null && fx.awayGoals != null; }

  /* Minute elapsed as a number, best-effort (e.g. "53'", "90+2'" → 53 / 92). */
  function minuteNum(fx) {
    var m = String(fx.minute || "").match(/(\d+)(?:\+(\d+))?/);
    if (!m) return null;
    return Number(m[1]) + (m[2] ? Number(m[2]) : 0);
  }

  /* ---------------- win probability (transparent model) ----------------
     Remaining goals for each side ~ independent Poisson, mean scaled by the
     share of the match still to play (symmetric — no team-strength input, so
     a level game stays a coin-flip plus the draw mass). Finished games put all
     mass on the final score, so the winner reads ~100%. Clearly an estimate. */
  function poissonPmf(k, lambda) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    var p = Math.exp(-lambda);
    for (var i = 1; i <= k; i++) p *= lambda / i;
    return p;
  }

  /* Per-team expected goals. Pulls the shared Elo strength model from odds.js
     (one source of truth — Brazil 2.0/0.8, Morocco 1.6/0.8, …) so the win
     probability reflects who's actually better, then anchors the magnitude to
     the bookmaker total (data/odds.json) when one exists. Symmetric fallback
     if odds.js hasn't loaded. */
  function teamLambdas(fx) {
    var base = null;
    try {
      if (window.PickOdds && PickOdds.teamLambdas) base = PickOdds.teamLambdas(fx.home.name, fx.away.name);
    } catch (err) { base = null; }
    if (!base || base.home == null || base.away == null) base = { home: 1.3, away: 1.3 };
    var o = oddsFor(fx);
    var sum = base.home + base.away;
    if (o && o.impliedTotal && sum > 0) {
      var k = o.impliedTotal / sum; // keep the strength ratio, use the market total
      base = { home: base.home * k, away: base.away * k };
    }
    return base;
  }

  /* Win probability from the strength model + the live score and time left.
     Team-aware (the favourite shows through) and live (recomputes from the
     minute): remaining goals for each side ~ independent Poisson on its
     expected rate, scaled by the share of the match still to play. Finished
     games collapse onto the final score; upcoming games use the full pre-match
     rate. Returns home/draw/away plus a `pre` flag for labelling. */
  function winProb(fx) {
    var pre = !isLive(fx) && !isDone(fx);
    var hg = fx.homeGoals || 0, ag = fx.awayGoals || 0;
    var elapsed = isDone(fx) ? 95 : (isLive(fx) ? (minuteNum(fx) || 1) : 0);
    var remaining = Math.max(0, 95 - elapsed) / 95;
    var lam = teamLambdas(fx);
    var lh = lam.home * remaining, la = lam.away * remaining;
    var pH = 0, pD = 0, pA = 0;
    for (var h = 0; h <= 10; h++) {
      for (var a = 0; a <= 10; a++) {
        var p = poissonPmf(h, lh) * poissonPmf(a, la);
        var fh = hg + h, fa = ag + a;
        if (fh > fa) pH += p; else if (fh < fa) pA += p; else pD += p;
      }
    }
    var tot = pH + pD + pA || 1;
    return { h: pH / tot, d: pD / tot, a: pA / tot, pre: pre };
  }

  /* ---------------- live group table (real W/D/L/Pts) ---------------- */

  function groupTable(letter) {
    var g = window.GROUPS && GROUPS[letter];
    if (!g) return [];
    var ctx = window.Hub && Hub.ctx();
    var fixtures = (ctx && ctx.allFixtures) || [];

    var row = {};
    g.countries.forEach(function (c) {
      row[norm(c.name)] = { name: c.name, flag: c.flag, mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
    });

    fixtures.forEach(function (fx) {
      if (fx.group !== letter || !isDone(fx) || !hasScore(fx)) return;
      var H = row[norm(fx.home.name)], A = row[norm(fx.away.name)];
      if (!H || !A) return;
      var hg = fx.homeGoals, ag = fx.awayGoals;
      H.mp++; A.mp++; H.gf += hg; H.ga += ag; A.gf += ag; A.ga += hg;
      if (hg > ag) { H.w++; A.l++; H.pts += 3; }
      else if (hg < ag) { A.w++; H.l++; A.pts += 3; }
      else { H.d++; A.d++; H.pts += 1; A.pts += 1; }
    });

    return Object.keys(row).map(function (k) {
      var r = row[k]; r.gd = r.gf - r.ga; return r;
    }).sort(function (x, y) {
      return y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name);
    });
  }

  function rankIn(table, name) {
    var n = norm(name);
    for (var i = 0; i < table.length; i++) if (norm(table[i].name) === n) return i + 1;
    return null;
  }
  function ord(n) {
    var m = n % 100;
    if (m >= 11 && m <= 13) return n + "th";
    return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  }

  /* ---------------- fantasy owner of the group ---------------- */

  function ownerOf(letter) {
    try { return (window.TEAMS || []).find(function (t) { return t.group === letter; }) || null; }
    catch (err) { return null; }
  }

  /* ---------------- hero ---------------- */

  function statusChip(fx) {
    if (isLive(fx)) {
      var lbl = (fx.status === "PAUSED" || fx.status === "HALFTIME")
        ? "Half-time" : ("Live" + (fx.minute ? " · " + esc(fx.minute) : ""));
      return '<span class="mc-state live"><span class="mc-dot"></span>' + lbl + "</span>";
    }
    if (isDone(fx)) return '<span class="mc-state done">Full time</span>';
    if (fx.status === "POSTPONED" || fx.status === "SUSPENDED" || fx.status === "CANCELLED") {
      return '<span class="mc-state">' + esc(fx.status.charAt(0) + fx.status.slice(1).toLowerCase()) + "</span>";
    }
    var t = kickoffTime(fx);
    return '<span class="mc-state up">' + (t ? esc(t) : "Upcoming") + "</span>";
  }

  function kickoffTime(fx) {
    if (!fx.utcDate) return null;
    var d = new Date(fx.utcDate);
    if (isNaN(d)) return null;
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  function kickoffFull(fx) {
    if (!fx.utcDate) return fx.dateISO || "";
    var d = new Date(fx.utcDate);
    if (isNaN(d)) return fx.dateISO || "";
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) +
      " · " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function teamBlock(fx, side, table) {
    var team = fx[side];
    var rank = table && table.length ? rankIn(table, team.name) : null;
    var posPlayed = rank && table.some(function (r) { return r.mp > 0; });
    return '<div class="mc-team ' + side + '">' +
      '<span class="mc-flag">' + flagFor(team.name) + "</span>" +
      '<span class="mc-tname">' + esc(team.name) + "</span>" +
      (posPlayed ? '<span class="mc-pos">' + ord(rank) + "</span>" : "") +
      "</div>";
  }

  function scorersRow(fx) {
    var r = fx.matchId && recapsById[fx.matchId];
    if (!r || !r.goals || !r.goals.length) return "";
    var home = [], away = [];
    r.goals.forEach(function (g) {
      var tag = g.ownGoal ? " (og)" : g.penalty ? " (pen)" : "";
      var label = esc(g.player) + tag + " " + esc(g.minute);
      (g.side === "away" ? away : home).push(label);
    });
    return '<div class="mc-scorers">' +
      '<div class="mc-sc home">' + (home.join("<br>") || "&nbsp;") + "</div>" +
      '<div class="mc-sc-ico">⚽</div>' +
      '<div class="mc-sc away">' + (away.join("<br>") || "&nbsp;") + "</div>" +
      "</div>";
  }

  function hero(fx, table) {
    var score = hasScore(fx)
      ? fx.homeGoals + '<span class="mc-dash">–</span>' + fx.awayGoals
      : '<span class="mc-vs">vs</span>';
    var stage = "Group Stage · Group " + esc(fx.group) +
      (fx.matchday ? " · Matchday " + fx.matchday : "");
    return '<div class="mc-hero">' +
      '<div class="mc-hero-top">' +
        '<span class="mc-comp">FIFA World Cup 2026™</span>' + statusChip(fx) +
      "</div>" +
      '<div class="mc-scoreline">' +
        teamBlock(fx, "home", table) +
        '<div class="mc-nums">' + score + "</div>" +
        teamBlock(fx, "away", table) +
      "</div>" +
      '<div class="mc-stage">' + stage + "</div>" +
      scorersRow(fx) +
      ((isDone(fx) || isLive(fx))
        ? '<a class="mc-watch" target="_blank" rel="noopener" href="' +
            Live.highlightsUrl(fx.home.name, fx.away.name) + '">▶ Watch highlights</a>'
        : "") +
      "</div>";
  }

  /* ---------------- Timeline tab ---------------- */

  function goalLi(g) {
    var icon = g.ownGoal ? "🥅" : (g.penalty ? "⚽" : "⚽");
    var tags = "";
    if (g.ownGoal) tags += '<span class="mc-tag og">o.g.</span>';
    if (g.penalty) tags += '<span class="mc-tag pen">pen</span>';
    return '<li class="mc-ev ' + (g.side === "away" ? "away" : "home") + '">' +
      '<span class="mc-ev-min">' + esc(g.minute) + "</span>" +
      '<span class="mc-ev-ico">' + icon + "</span>" +
      '<span class="mc-ev-body"><b>' + esc(g.player) + "</b>" + tags +
        '<span class="mc-ev-team">' + flagFor(g.team) + " " + esc(g.team) + "</span></span>" +
      "</li>";
  }

  function timelinePanel(fx) {
    var r = fx.matchId && recapsById[fx.matchId];
    if (r && r.goals && r.goals.length) {
      var sorted = r.goals.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      return (r.summary ? '<p class="mc-summary">' + esc(r.summary) + "</p>" : "") +
        '<ul class="mc-evs">' + sorted.map(goalLi).join("") + "</ul>";
    }
    if (isLive(fx)) {
      return '<div class="mc-note live">' +
        '<span class="mc-dot"></span> Live — it\'s ' +
        (hasScore(fx) ? fx.homeGoals + "–" + fx.awayGoals : "underway") +
        (fx.minute ? " at " + esc(fx.minute) : "") + ". " +
        "Goal-by-goal detail lands when the match recap is generated after full time." +
        "</div>";
    }
    if (isDone(fx)) {
      return '<div class="mc-note">Final score ' + (hasScore(fx) ? fx.homeGoals + "–" + fx.awayGoals : "—") +
        ". A detailed timeline isn't available for this match yet.</div>";
    }
    // upcoming preview
    return '<div class="mc-note">Kicks off ' + esc(kickoffFull(fx)) + "." +
      (fx.venue ? " " + esc(fx.venue) + "." : "") + "</div>";
  }

  /* ---------------- Stats tab ---------------- */

  function winProbCard(fx) {
    var wp = winProb(fx);
    if (!wp) return "";
    var foot = isDone(fx) ? "Final result"
      : wp.pre ? "Pre-match estimate · team-strength model"
      : "Live estimate · team strength + score &amp; time left";
    var hc = teamColor(fx.home.name), ac = teamColor(fx.away.name);
    var pc = function (x) { return Math.round(x * 100); };
    return '<div class="mc-card mc-wp">' +
      '<div class="mc-card-h">Win probability</div>' +
      '<div class="mc-wp-legend">' +
        '<span class="l"><b style="color:' + hc + '">' + esc(fx.home.name) + "</b>" + pc(wp.h) + "%</span>" +
        '<span class="c">Draw ' + pc(wp.d) + "%</span>" +
        '<span class="r"><b style="color:' + ac + '">' + esc(fx.away.name) + "</b>" + pc(wp.a) + "%</span>" +
      "</div>" +
      '<div class="mc-wp-bar">' +
        '<span style="width:' + pc(wp.h) + "%;background:" + hc + '"></span>' +
        '<span class="draw" style="width:' + pc(wp.d) + '%"></span>' +
        '<span style="width:' + pc(wp.a) + "%;background:" + ac + '"></span>' +
      "</div>" +
      '<div class="mc-wp-foot">' + foot + "</div>" +
      "</div>";
  }

  function statRow(label, hv, av) {
    if (hv == null && av == null) return "";
    var h = hv == null ? 0 : hv, a = av == null ? 0 : av;
    var hLead = h > a ? " lead" : "", aLead = a > h ? " lead" : "";
    return '<div class="mc-srow">' +
      '<span class="mc-sv home' + hLead + '">' + h + "</span>" +
      '<span class="mc-slabel">' + label + "</span>" +
      '<span class="mc-sv away' + aLead + '">' + a + "</span>" +
      "</div>";
  }

  function statsPanel(fx) {
    var blocks = winProbCard(fx);

    // Per-match stats we actually have: goals + (when the live feed supplies
    // them) yellow/red cards and fouls. No invented shots/possession.
    var c = fx.cards || {};
    var ch = c.home || {}, ca = c.away || {};
    var rows = "";
    if (hasScore(fx)) rows += statRow("Goals", fx.homeGoals, fx.awayGoals);
    if (ch.y != null || ca.y != null) rows += statRow("Yellow cards", ch.y || 0, ca.y || 0);
    if (ch.r != null || ca.r != null) rows += statRow("Red cards", ch.r || 0, ca.r || 0);
    if (ch.f != null || ca.f != null) rows += statRow("Fouls", ch.f || 0, ca.f || 0);
    if (rows) {
      blocks += '<div class="mc-card mc-stats">' +
        '<div class="mc-card-h"><span>' + flagFor(fx.home.name) + "</span>Match stats<span>" +
          flagFor(fx.away.name) + "</span></div>" + rows + "</div>";
    }

    // Match facts.
    var owner = ownerOf(fx.group);
    var facts = "";
    function fact(k, v) { return v ? '<div class="mc-fact"><span>' + k + "</span><b>" + v + "</b></div>" : ""; }
    facts += fact("Kickoff", esc(kickoffFull(fx)));
    facts += fact("Venue", fx.venue ? esc(fx.venue) : "");
    facts += fact("Group", "Group " + esc(fx.group) + (fx.matchday ? " · MD" + fx.matchday : ""));
    facts += fact("Drafted by", owner ? esc(owner.name) + (owner.isMine ? " ⭐" : "") : "Unclaimed");

    // Upcoming: real betting total from odds.json.
    if (!isDone(fx) && !isLive(fx)) {
      var o = oddsFor(fx);
      if (o && o.line != null) {
        facts += fact("Projected total", o.line + " goals" +
          (o.overUS ? " · O " + esc(o.overUS) + " / U " + esc(o.underUS || "") : ""));
      }
    }
    if (facts) blocks += '<div class="mc-card mc-facts">' + facts + "</div>";

    return blocks || '<div class="mc-note">No stats yet.</div>';
  }

  /* ---------------- Group tab ---------------- */

  function groupPanel(fx) {
    var table = groupTable(fx.group);
    if (!table.length) return '<div class="mc-note">Group table unavailable.</div>';
    var played = table.some(function (r) { return r.mp > 0; });
    var here = [norm(fx.home.name), norm(fx.away.name)];
    var rows = table.map(function (r, i) {
      var on = here.indexOf(norm(r.name)) >= 0 ? " here" : "";
      var qual = i < 2 ? " q" : "";
      return '<tr class="' + on.trim() + qual + '">' +
        '<td class="mc-gt-pos">' + (i + 1) + "</td>" +
        '<td class="mc-gt-team">' + flagFor(r.name) + " " + esc(r.name) + "</td>" +
        "<td>" + r.mp + "</td><td>" + r.w + "</td><td>" + r.d + "</td><td>" + r.l + "</td>" +
        '<td class="mc-gt-gd">' + (r.gd > 0 ? "+" : "") + r.gd + "</td>" +
        '<td class="mc-gt-pts">' + r.pts + "</td>" +
      "</tr>";
    }).join("");

    return '<div class="mc-card mc-group">' +
      '<div class="mc-card-h">' + (played ? '<span class="mc-live-tag">Live</span>' : "") +
        "Group " + esc(fx.group) + " table</div>" +
      '<table class="mc-gt"><thead><tr>' +
        "<th></th><th></th><th>MP</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table>" +
      '<div class="mc-gt-key"><span class="mc-gt-q"></span>Top 2 advance (plus 8 best third-placed)</div>' +
      "</div>";
  }

  /* ---------------- overlay shell ---------------- */

  var overlay = null;
  var current = null;

  function close() {
    if (!overlay) return;
    document.removeEventListener("keydown", onKey);
    overlay.parentNode && overlay.parentNode.removeChild(overlay);
    overlay = null;
    current = null;
  }
  function onKey(e) { if (e.key === "Escape") close(); }

  // Finished games open on the goal Timeline; live and upcoming games open on
  // Stats so the (live) win probability is the first thing you see — same as
  // Google's match card during a match.
  function defaultTab(fx) { return isDone(fx) ? "timeline" : "stats"; }

  function renderPanels(fx) {
    return '<div class="mc-panel" data-p="timeline">' + timelinePanel(fx) + "</div>" +
      '<div class="mc-panel" data-p="stats">' + statsPanel(fx) + "</div>" +
      '<div class="mc-panel" data-p="group">' + groupPanel(fx) + "</div>";
  }

  /* The scrollable body (hero + tabs + panels + footer). Extracted so a live
     game can re-render it in place as scores tick in, without rebuilding the
     whole overlay. */
  function sheetInner(fx) {
    var table = groupTable(fx.group);
    return hero(fx, table) +
      '<div class="mc-tabs" role="tablist">' +
        '<button class="mc-tab" data-t="timeline">Timeline</button>' +
        '<button class="mc-tab" data-t="stats">Stats</button>' +
        '<button class="mc-tab" data-t="group">Group</button>' +
      "</div>" +
      '<div class="mc-panels">' + renderPanels(fx) + "</div>" +
      '<div class="mc-footlink">' +
        '<a target="_blank" rel="noopener" href="' + Live.googleMatchUrl(fx.home.name, fx.away.name) +
          '">View on Google ↗</a>' +
      "</div>";
  }

  function open(fx) {
    if (!fx) return;
    close();
    current = fx;

    overlay = document.createElement("div");
    overlay.className = "mc-overlay";
    overlay.innerHTML =
      '<div class="mc-sheet" role="dialog" aria-modal="true" aria-label="Match center">' +
        '<div class="mc-bar">' +
          '<button class="mc-back" aria-label="Close">‹</button>' +
          '<span class="mc-bar-title">' + esc(fx.home.name) + " vs " + esc(fx.away.name) + "</span>" +
          '<button class="mc-close" aria-label="Close">✕</button>' +
        "</div>" +
        '<div class="mc-scroll">' + sheetInner(fx) + "</div>" +
      "</div>";

    setActiveTab(defaultTab(fx));

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.classList.contains("mc-close") || e.target.classList.contains("mc-back")) {
        close(); return;
      }
      var t = e.target.closest(".mc-tab");
      if (t) setActiveTab(t.getAttribute("data-t"));
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  }

  /* Re-render the open panel in place from the latest Hub data — keeps a live
     match's score, minute and win probability ticking without the user
     reopening. Preserves the active tab and scroll position. */
  function refreshOpen() {
    if (!overlay || !current) return;
    var fx = fixtureById(current.id);
    if (!fx) return;
    current = fx;
    var scroll = overlay.querySelector(".mc-scroll");
    if (!scroll) return;
    var activeEl = overlay.querySelector(".mc-tab.is-active");
    var active = activeEl ? activeEl.getAttribute("data-t") : defaultTab(fx);
    var top = scroll.scrollTop;
    scroll.innerHTML = sheetInner(fx);
    setActiveTab(active);
    scroll.scrollTop = top;
  }

  function setActiveTab(name) {
    if (!overlay) return;
    overlay.querySelectorAll(".mc-tab").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-t") === name);
    });
    overlay.querySelectorAll(".mc-panel").forEach(function (p) {
      p.classList.toggle("is-active", p.getAttribute("data-p") === name);
    });
  }

  /* Find a fixture in the live Hub context by its id. */
  function fixtureById(id) {
    var ctx = window.Hub && Hub.ctx();
    if (!ctx || !ctx.allFixtures) return null;
    return ctx.allFixtures.find(function (fx) { return String(fx.id) === String(id); }) || null;
  }

  function openById(id) { open(fixtureById(id)); }

  /* ---------------- boot ---------------- */

  // Import the panel's data up front: recap summaries + goal lists
  // (data/recaps.json) and bookmaker totals (data/odds.json). The score, cards,
  // live group table and win probability come from the live Hub context.
  loadRecaps();
  loadOdds();

  // One delegated listener for every [data-mc] trigger (schedule cards + live
  // strip), so it survives the app's full re-renders without re-binding. Opens
  // the in-app Match Center; the panel itself carries a "View on Google ↗" link
  // at the bottom (Live.googleMatchUrl → plain search) for the full Google card.
  document.addEventListener("click", function (e) {
    var trig = e.target.closest && e.target.closest("[data-mc]");
    if (!trig) return;
    e.preventDefault();
    openById(trig.getAttribute("data-mc"));
  });
  // Keyboard activation for the role="button" live-strip cards.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var trig = e.target.closest && e.target.closest('[data-mc][role="button"]');
    if (!trig) return;
    e.preventDefault();
    openById(trig.getAttribute("data-mc"));
  });

  // After each render: refresh recap data, and if a live match's panel is open,
  // re-render it in place so its score, minute and win probability stay live.
  if (window.Hub) Hub.onRender(function () {
    loadRecaps();
    if (current && isLive(current)) refreshOpen();
  });

  return { open: open, openById: openById };
})();
