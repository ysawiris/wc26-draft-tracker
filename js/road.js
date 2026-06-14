/* ============================================================
   ROAD TO #1 — the viewer's personal race command center.

   One hub serves the whole league, so this panel is all about
   YOUR team (picked via js/my-team.js). It sits at the top of the
   Draft Board and answers the only question a manager actually
   cares about mid-tournament: "where do I stand, and what do I
   need?" — goals back of the lead, the cushion on the team
   chasing me, how many of my group's matches are still to play,
   plus the betting-model's read on my finish (reused straight
   from window.PickOdds.forecast). It leads the Odds tab — the
   personal summary above the full bookmaker-style forecast.

   Self-contained Hub module: registers Hub.onRender, writes into
   #road-host, re-derives on every refresh. No team claimed → a
   one-tap prompt that opens the team picker (and grows adoption
   of the whole hub).
   ============================================================ */

(function () {
  "use strict";

  var HOST_ID = "road-host";

  /* Group goals are monotonic and every group plays 6 matches. */
  var GROUP_MATCHES = 6;

  /* "What needs to happen" example scenarios, written by the
     generate-scenarios GitHub Action into data/scenarios.json (computed
     scorelines + a free-LLM narrative, with a built-in writer fallback).
     Loaded once, async; a successful load re-renders the panel in place.
     Absent file → the block simply doesn't show, everything else is intact. */
  var scenByTeam = null;
  var scenLoaded = false;
  var lastCtxRoad = null;

  function loadScenarios() {
    /* Cache-bust like the other data/*.json reads — GitHub Pages serves
       these with a 10-minute max-age. */
    fetch("data/scenarios.json?v=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        scenByTeam = (data && data.byTeam) || {};
        scenLoaded = true;
        if (lastCtxRoad) render(lastCtxRoad); /* inject into the live panel */
      });
  }

  function finished(st) { return !!(window.Live && Live.FINISHED && Live.FINISHED[st]); }
  function inplay(st) { return !!(window.Live && Live.INPLAY && Live.INPLAY[st]); }

  function myTeam() {
    return (window.MyTeam && MyTeam.current && MyTeam.current()) || null;
  }

  /* Best-effort projection from the shared odds engine. Cached there by
     fingerprint, so calling it every render is cheap; null if odds.js
     hasn't loaded or there's nothing to simulate yet. */
  function projectionFor(ctx, abbr) {
    try {
      var fc = window.PickOdds && PickOdds.forecast ? PickOdds.forecast(ctx) : null;
      if (!fc || !fc.rows) return null;
      var row = fc.rows.find(function (r) { return r.abbr === abbr; });
      return row ? { row: row, pre: !!fc.pre } : null;
    } catch (_) { return null; }
  }

  function pct(p) {
    if (p == null) return null;
    if (p <= 0) return "0%";
    if (p < 0.01) return "<1%";
    return Math.round(p * 100) + "%";
  }

  function shareBaseUrl() {
    return location.origin + location.pathname;
  }

  /* ---------------- derive everything for one team ---------------- */

  function derive(ctx, mine) {
    var st = ctx.standings;
    var n = st.length;
    var idx = st.findIndex(function (r) { return r.team.abbr === mine.abbr; });
    if (idx < 0) return null;
    var row = st[idx];
    var leader = st[0];
    var above = st[idx - 1]; // one pick better
    var below = st[idx + 1]; // one pick worse (the chaser)

    var groupFx = ctx.fixtures.filter(function (fx) { return fx.group === mine.group; });
    var played = groupFx.filter(function (fx) { return finished(fx.status); }).length;
    var liveFx = groupFx.filter(function (fx) { return inplay(fx.status); });
    var total = groupFx.length || GROUP_MATCHES;

    var proj = projectionFor(ctx, mine.abbr);

    /* The whole panel hinges on whether YOUR group is underway — not the
       league. Other groups kicking off first must not read as "you're behind"
       when every team in your group is still on zero. */
    var myStarted = played > 0 || liveFx.length > 0;
    var upcoming = groupFx
      .filter(function (fx) { return !finished(fx.status) && !inplay(fx.status); })
      .sort(function (a, b) { return ctx.helpers.fxDate(a) - ctx.helpers.fxDate(b); });
    var nextFx = upcoming[0] || null;

    return {
      ctx: ctx, team: mine, row: row, n: n,
      rank: row.rank,
      goals: row.goals,
      myStarted: myStarted,
      nextFx: nextFx,
      amLeader: row.rank === 1,
      isLast: row.rank === n,
      goalsBack: leader.goals - row.goals,
      leaderName: leader.team.name,
      cushion: below ? row.goals - below.goals : null,   // goals clear of the chaser
      belowName: below ? below.team.name : null,
      climb: above ? above.goals - row.goals : null,     // goals to take the next spot
      aboveName: above ? above.team.name : null,
      tiedTop: row.rank === 1 && below ? (row.goals === below.goals) : false,
      played: played,
      left: total - played,
      total: total,
      liveFx: liveFx,
      group: ctx.groups[mine.group],
      proj: proj
    };
  }

  /* ---------------- status line ---------------- */

  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }
  function matches(n) { return n + (n === 1 ? " match" : " matches"); }
  function goalAdj(n) { return n + "-goal"; }   // adjectival: "2-goal swing"
  function first(name) { return String(name).split(" ")[0]; }

  /* "Sat, Jun 14 · 9:00 AM" for prose (time only when the feed carries it). */
  function kickoffProse(d) {
    var fx = d.nextFx; if (!fx) return null;
    var h = d.ctx.helpers, dt = h.fxDate(fx);
    var day = dt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    var t = h.fmtTime(fx);
    return day + (t ? " · " + t : "");
  }
  /* "Jun 14" for the compact metric tile. */
  function shortKickoff(d) {
    var fx = d.nextFx; if (!fx) return null;
    return d.ctx.helpers.fxDate(fx).toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function statusLine(d) {
    var T = d.team.name;
    var G = "Group " + d.group.letter;
    if (!d.myStarted) {
      var names = d.group.countries.map(function (c) { return c.name; });
      var list = names.slice(0, 3).join(", ") + " & " + names[3];
      var ko = kickoffProse(d);
      return T + "'s race is still on the start line — " + G + " (" + list +
        ") is level at 0, all " + d.total + " matches and every goal up for grabs" +
        (ko ? ". First whistle " + ko + "." : ".");
    }
    var lead;
    if (d.amLeader) {
      if (d.tiedTop) {
        lead = T + " is top of the board but dead level with " + d.belowName +
          " — only the card tiebreaker is holding the No. 1 pick.";
      } else if (d.cushion == null) {
        lead = T + " holds the No. 1 pick.";
      } else {
        lead = T + " holds the No. 1 pick, " + plural(d.cushion, "goal") +
          " clear of " + d.belowName + ".";
      }
    } else {
      lead = T + " sits " + d.rank + d.ctx.helpers.ordinal(d.rank) + ", " +
        plural(d.goalsBack, "goal") + " back of " + d.leaderName +
        (d.goalsBack <= 2 ? " — one big afternoon flips it." : ".");
    }
    var tail = d.left === d.total
      ? " All " + d.total + " of " + G + "'s matches still to play."
      : " " + d.left + " of " + G + "'s " + d.total + " matches still to play.";
    return lead + tail;
  }

  function projLine(d) {
    if (!d.proj) return null;
    var r = d.proj.row;
    var ord = d.ctx.helpers.ordinal;
    var ep = Math.round(r.expPick);
    return "Model read: " + pct(r.probs[0]) + " shot at the top pick, projected to finish ~" +
      ep + ord(ep) + (d.proj.pre ? " (preseason, strength-based)." : ".");
  }

  /* ---------------- "what you need" — the actionable read ---------------- */

  function needLine(d) {
    if (!d.myStarted) {
      return "Outscore Group " + d.group.letter +
        " and the No. 1 pick is yours — most group goals wins, and you start level with the field.";
    }
    var ord = d.ctx.helpers.ordinal;
    if (d.amLeader) {
      if (d.tiedTop) return "Dead level on top — the next goal decides the pick. Pull clear.";
      if (d.cushion == null) return "Out front with the pick in hand — keep the gap and it's yours.";
      return "Hold your " + goalAdj(d.cushion) + " cushion over " + matches(d.left) +
        " and the No. 1 pick is yours.";
    }
    var target;
    if (d.climb == null || !d.aboveName) {
      target = "every goal tightens the race";
    } else if (d.climb === 0) {
      target = "you're level with " + first(d.aboveName) + " for " + (d.rank - 1) + ord(d.rank - 1) +
        " — one goal breaks the tie";
    } else {
      target = "a " + goalAdj(d.climb) + " swing grabs " + (d.rank - 1) + ord(d.rank - 1) +
        " off " + first(d.aboveName);
    }
    var chase = d.goalsBack === 0
      ? "you're level with " + first(d.leaderName) + " on goals for the top pick"
      : plural(d.goalsBack, "goal") + " behind " + first(d.leaderName) + " for No. 1";
    return target + "; " + chase + " — " + matches(d.left) + " left.";
  }

  /* ---------------- copy-for-the-chat text ---------------- */

  function copyText(d) {
    var line2 = !d.myStarted
      ? "🟢 Level at 0 — all " + d.total + " of Group " + d.group.letter + "'s matches to play"
      : d.amLeader
        ? "👑 Holds the No. 1 pick" + (d.cushion != null ? " (+" + d.cushion + " on " + first(d.belowName) + ")" : "")
        : d.rank + d.ctx.helpers.ordinal(d.rank) + " · " + plural(d.goalsBack, "goal") + " back of " + d.leaderName;
    var lines = [
      "🏆 " + d.team.name + " — Road to the No. 1 pick",
      line2,
      d.myStarted ? matches(d.left) + " left in the group" : "Group kicks off " + (kickoffProse(d) || "soon")
    ];
    if (d.proj) {
      var ep = Math.round(d.proj.row.expPick);
      lines.push("Model: " + pct(d.proj.row.probs[0]) + " for #1 · projected ~" + ep + d.ctx.helpers.ordinal(ep));
    }
    lines.push(shareBaseUrl() + "?team=" + d.team.abbr);
    return lines.join("\n");
  }

  /* ---------------- clipboard (mirrors board-extras) ---------------- */

  function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    }
    return fallbackCopy(text);
  }
  function fallbackCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("copy failed"));
    });
  }

  /* ---------------- render ---------------- */

  function metric(val, key, cls) {
    return '<div class="rm' + (cls ? " " + cls : "") + '">' +
      '<span class="rm-val">' + val + "</span>" +
      '<span class="rm-key">' + key + "</span></div>";
  }

  /* Four glanceable tiles. Pre-kickoff they describe the open race instead of
     a cross-group "X back of No. 1" gap that doesn't mean anything yet. */
  function metricsFor(d, esc) {
    if (!d.myStarted) {
      var ko = shortKickoff(d);
      var m4p = d.proj
        ? metric(pct(d.proj.row.probs[0]), "model: shot at No. 1")
        : metric("open", "race wide open");
      return metric(d.total, "matches to play") +
        (ko ? metric(ko, "group kicks off") : metric("—", "kickoff TBD")) +
        metric("0", "goals — all level") +
        m4p;
    }
    var m1 = d.amLeader
      ? metric("👑", "you hold No. 1", "is-crown")
      : metric(d.goalsBack, "back of No. 1");
    var m2;
    if (d.isLast && d.climb != null) m2 = metric(d.climb, "to climb a spot");
    else if (d.cushion != null) m2 = metric("+" + d.cushion, "cushion on " + esc(first(d.belowName)));
    else m2 = metric("—", "no chaser");
    var m3 = metric(d.left, d.left === 1 ? "group match left" : "group matches left");
    var m4 = d.proj
      ? metric(pct(d.proj.row.probs[0]), "model: shot at No. 1")
      : metric(d.left * 4, "goals on the table");
    return m1 + m2 + m3 + m4;
  }

  function liveStrip(d, esc) {
    if (!d.liveFx.length) return "";
    var items = d.liveFx.map(function (fx) {
      var score = (fx.homeGoals != null && fx.awayGoals != null) ? fx.homeGoals + "–" + fx.awayGoals : "vs";
      var min = fx.minute ? ' <span class="rl-min">' + esc(fx.minute) + "</span>" : "";
      return '<span class="rl-item">' + fx.home.flag + " " + esc(fx.home.name) +
        ' <b>' + score + "</b> " + esc(fx.away.name) + " " + fx.away.flag + min + "</span>";
    }).join("");
    return '<div class="road-live"><span class="rl-dot"></span><span class="rl-tag">In your group, now</span>' + items + "</div>";
  }

  function projTrack(d) {
    if (!d.proj) return "";
    var r = d.proj.row, n = d.n, ord = d.ctx.helpers.ordinal;
    var pos = function (pick) { return ((pick - 1) / (n - 1)) * 100; };
    var ep = Math.round(r.expPick);
    var bandL = pos(r.lo), bandW = pos(r.hi) - pos(r.lo);
    var head = d.myStarted ? "Projected finish" : "Preseason projection";
    return '<div class="road-proj">' +
      '<div class="rp-head">' + head + ' <b>~' + ep + ord(ep) + "</b>" +
        '<span class="rp-range">likely ' + r.lo + (r.lo !== r.hi ? "–" + r.hi : "") + "</span></div>" +
      '<div class="rp-track">' +
        '<div class="rp-band" style="left:' + bandL + "%;width:" + Math.max(bandW, 2) + '%"></div>' +
        (d.myStarted ? '<div class="rp-now" style="left:' + pos(d.rank) + '%" title="where you are now"></div>' : "") +
        '<div class="rp-exp" style="left:' + pos(ep) + '%" title="projected finish"></div>' +
      "</div>" +
      '<div class="rp-scale"><span>No. 1</span><span>No. ' + n + "</span></div>" +
      '<div class="rp-legend">' +
        (d.myStarted ? '<span class="rp-k rp-k-now">Now</span>' : "") +
        '<span class="rp-k rp-k-exp">Projected</span>' +
        '<span class="rp-k rp-k-band">Likely range</span>' +
      "</div>" +
    "</div>";
  }

  /* ---------------- "what needs to happen" scenarios ---------------- */

  /* Country name -> flag, drawn from YOUR group's four countries (every
     scoreline in your scenarios is between two of them). */
  function scenFlagMap(d) {
    var map = {};
    d.group.countries.forEach(function (c) { map[c.name] = c.flag; });
    return map;
  }

  function scenLineHtml(line, flags, esc) {
    var fh = flags[line.home] || "";
    var fa = flags[line.away] || "";
    return '<span class="rs-line">' +
      '<span class="rs-fl">' + fh + "</span>" +
      '<b class="rs-sc">' + line.hg + "&ndash;" + line.ag + "</b>" +
      '<span class="rs-fl">' + fa + "</span></span>";
  }

  function scenCardHtml(s, flags, esc) {
    var lines = (s.lines || []).map(function (l) { return scenLineHtml(l, flags, esc); }).join("");
    var tag = s.needsHelp
      ? '<span class="rs-need" title="Only wins if the chasers stall">needs help</span>'
      : '<span class="rs-safe" title="Clear of the field regardless">bulletproof</span>';
    return '<div class="rs-card rs-' + esc(s.key) + '">' +
      '<div class="rs-card-head">' +
        '<span class="rs-label">' + esc(s.label) + "</span>" +
        '<span class="rs-target">&rarr; ' + s.targetTotal + ' goals</span>' + tag +
      "</div>" +
      '<div class="rs-lines">' + lines + "</div>" +
      '<p class="rs-blurb">' + esc(s.blurb || "") + "</p>" +
    "</div>";
  }

  /* The whole block, or "" when no scenarios are loaded for this team (file
     not loaded yet, unclaimed group, or a fully-played group with nothing
     left to decide). */
  function scenarioBlock(d) {
    if (!scenLoaded || !scenByTeam) return "";
    var entry = scenByTeam[d.team.abbr];
    if (!entry || !entry.scenarios || !entry.scenarios.length) return "";
    var esc = d.ctx.helpers.esc;
    var flags = scenFlagMap(d);

    var aiBadge = entry.ai
      ? '<span class="rs-ai" title="Narrated by AI from the model\'s numbers">&#10024; AI</span>'
      : "";
    var watch = (entry.rivals || []).map(function (r) {
      return '<span class="rs-rival">' + esc(r.owner) + ' <small>Grp ' + esc(r.group) +
        " &middot; ~" + r.proj + "</small></span>";
    }).join("");
    var cards = entry.scenarios.map(function (s) { return scenCardHtml(s, flags, esc); }).join("");

    return '<section class="road-scen">' +
      '<div class="rs-head"><span class="rs-eyebrow">&#128302; What needs to happen</span>' + aiBadge + "</div>" +
      (entry.intro ? '<p class="rs-intro">' + esc(entry.intro) + "</p>" : "") +
      (watch ? '<div class="rs-watch"><span class="rs-watch-k">Groups to keep down</span>' + watch + "</div>" : "") +
      '<div class="rs-cards">' + cards + "</div>" +
      '<p class="rs-foot">Example scorelines that get you there &mdash; auto-generated, sharpens as goals go in.</p>' +
    "</section>";
  }

  function renderTeam(host, d) {
    var esc = d.ctx.helpers.esc;
    var ord = d.ctx.helpers.ordinal;
    var accent = d.team.accent || "#c89638";

    var flags = d.group.countries.map(function (c) { return c.flag; }).join(" ");
    var rankNum = d.myStarted ? d.rank : "–";
    var rankOrd = d.myStarted ? ord(d.rank) : "";

    var pl = projLine(d);

    host.innerHTML =
      '<div class="road-card" style="--team-accent:' + accent + '">' +
        '<div class="road-head">' +
          '<span class="road-eyebrow">🛣 Road to No. 1</span>' +
          '<button type="button" class="road-team-pill" data-road="switch">🏷 ' +
            esc(d.team.name) + ' <span class="rtp-caret">▾</span></button>' +
        "</div>" +
        liveStrip(d, esc) +
        '<div class="road-top">' +
          '<div class="road-rank' + (d.myStarted && d.rank === 1 ? " is-first" : "") + (d.myStarted ? "" : " is-pre") + '">' +
            '<span class="rr-num">' + rankNum + "</span>" +
            (rankOrd ? '<span class="rr-ord">' + rankOrd + "</span>" : "") +
            '<span class="rr-label">' + (d.myStarted ? "your pick" : "all square") + "</span>" +
          "</div>" +
          '<div class="road-status">' +
            '<p class="road-line">' + esc(statusLine(d)) + "</p>" +
            (pl ? '<p class="road-proj-line">' + esc(pl) + "</p>" : "") +
            '<div class="road-group">Group ' + d.group.letter + ' <span class="rg-flags">' + flags + "</span></div>" +
          "</div>" +
        "</div>" +
        '<div class="road-metrics">' + metricsFor(d, esc) + "</div>" +
        '<div class="road-need"><span class="rn-icon">🎯</span><span class="rn-text">' + esc(needLine(d)) + "</span></div>" +
        projTrack(d) +
        scenarioBlock(d) +
        '<div class="road-actions">' +
          '<button type="button" class="road-btn primary" data-road="copy">📋 Copy my status</button>' +
          '<button type="button" class="road-btn" data-road="board">🏆 See the draft board →</button>' +
        "</div>" +
      "</div>";
  }

  function renderEmpty(host) {
    host.innerHTML =
      '<div class="road-card road-empty">' +
        '<span class="road-eyebrow">🛣 Road to No. 1</span>' +
        '<p class="road-empty-line">Claim your team to unlock your personal race to the No. 1 pick — ' +
          "your gap to the lead, the cushion on the team chasing you, matches left, and the model's read on your finish.</p>" +
        '<button type="button" class="road-btn primary" data-road="switch">🏷 Pick your team</button>' +
      "</div>";
  }

  /* ---------------- main render ---------------- */

  var lastDerived = null;

  function render(ctx) {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    lastCtxRoad = ctx; /* so a late scenarios.json load can re-render in place */
    var mine = myTeam();
    if (!mine) { lastDerived = null; renderEmpty(host); return; }
    var d = derive(ctx, mine);
    if (!d) { lastDerived = null; host.textContent = ""; return; }
    lastDerived = d;
    renderTeam(host, d);
  }

  /* ---------------- actions ---------------- */

  function onClick(e) {
    var btn = e.target.closest("[data-road]");
    if (!btn) return;
    var action = btn.getAttribute("data-road");

    if (action === "switch") {
      if (window.MyTeam && MyTeam.open) MyTeam.open();
      return;
    }
    if (action === "board") {
      if (window.Hub && Hub.setTab) Hub.setTab("board");
      return;
    }
    if (action === "copy" && lastDerived) {
      writeClipboard(copyText(lastDerived)).then(function () {
        if (btn.getAttribute("data-flashing")) return;
        btn.setAttribute("data-flashing", "1");
        var original = btn.textContent;
        btn.textContent = "Copied ✓";
        btn.classList.add("is-copied");
        setTimeout(function () {
          btn.textContent = original;
          btn.classList.remove("is-copied");
          btn.removeAttribute("data-flashing");
        }, 1600);
      }).catch(function () {});
    }
  }

  /* ---------------- boot ---------------- */

  document.addEventListener("click", onClick);
  if (window.Hub && Hub.onRender) Hub.onRender(render);
  loadScenarios(); /* async; re-renders the panel once the file lands */

  window.RoadTo1 = { render: render };
})();
