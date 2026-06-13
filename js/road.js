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

    return {
      ctx: ctx, team: mine, row: row, n: n,
      rank: row.rank,
      goals: row.goals,
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

  function statusLine(d) {
    var T = d.team.name;
    var G = "Group " + d.group.letter;
    if (!d.ctx.started) {
      var names = d.group.countries.map(function (c) { return c.name; });
      var list = names.slice(0, 3).join(", ") + " & " + names[3];
      return T + "'s race hasn't kicked off yet — " + list + " carry all " +
        d.total + " of " + G + "'s matches, every goal still to play for.";
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
    var tail = " " + d.left + " of " + G + "'s " + d.total + " matches still to play.";
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

  /* ---------------- copy-for-the-chat text ---------------- */

  function copyText(d) {
    var line2 = d.amLeader
      ? "👑 Holds the No. 1 pick" + (d.cushion != null ? " (+" + d.cushion + " on " + d.belowName + ")" : "")
      : d.rank + d.ctx.helpers.ordinal(d.rank) + " · " + plural(d.goalsBack, "goal") + " back of " + d.leaderName;
    var lines = [
      "🏆 " + d.team.name + " — Road to the No. 1 pick",
      line2,
      d.left + "/" + d.total + " group matches left"
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
    return '<div class="road-proj">' +
      '<div class="rp-head">Projected finish <b>~' + ep + ord(ep) + "</b>" +
        '<span class="rp-range">likely ' + r.lo + (r.lo !== r.hi ? "–" + r.hi : "") + "</span></div>" +
      '<div class="rp-track">' +
        '<div class="rp-band" style="left:' + bandL + "%;width:" + Math.max(bandW, 2) + '%"></div>' +
        '<div class="rp-now" style="left:' + pos(d.rank) + '%" title="where you are now"></div>' +
        '<div class="rp-exp" style="left:' + pos(ep) + '%" title="projected finish"></div>' +
      "</div>" +
      '<div class="rp-scale"><span>No. 1</span><span>No. ' + n + "</span></div>" +
    "</div>";
  }

  function renderTeam(host, d) {
    var esc = d.ctx.helpers.esc;
    var ord = d.ctx.helpers.ordinal;
    var accent = d.team.accent || "#c89638";

    var flags = d.group.countries.map(function (c) { return c.flag; }).join(" ");
    var rankNum = d.ctx.started ? d.rank : "–";
    var rankOrd = d.ctx.started ? ord(d.rank) : "";

    // Metric 1: gap to #1 (or crown when leading)
    var m1 = d.amLeader
      ? metric("👑", "you hold No. 1", "is-crown")
      : metric(d.goalsBack, "back of No. 1");
    // Metric 2: cushion on chaser, or climb to the next spot if last
    var m2;
    if (d.isLast && d.climb != null) m2 = metric(d.climb, "to climb a spot");
    else if (d.cushion != null) m2 = metric("+" + d.cushion, "cushion on " + esc(d.belowName.split(" ")[0]));
    else m2 = metric("—", "no chaser");
    // Metric 3: matches left in the group
    var m3 = metric(d.left, "group matches left");
    // Metric 4: model shot at #1
    var m4 = d.proj
      ? metric(pct(d.proj.row.probs[0]), "model: shot at No. 1")
      : metric(d.left * 4, "goals on the table");

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
          '<div class="road-rank' + (d.ctx.started && d.rank === 1 ? " is-first" : "") + '">' +
            '<span class="rr-num">' + rankNum + "</span>" +
            (rankOrd ? '<span class="rr-ord">' + rankOrd + "</span>" : "") +
            '<span class="rr-label">your pick</span>' +
          "</div>" +
          '<div class="road-status">' +
            '<p class="road-line">' + esc(statusLine(d)) + "</p>" +
            (pl ? '<p class="road-proj-line">' + esc(pl) + "</p>" : "") +
            '<div class="road-group">Group ' + d.group.letter + ' <span class="rg-flags">' + flags + "</span></div>" +
          "</div>" +
        "</div>" +
        '<div class="road-metrics">' + m1 + m2 + m3 + m4 + "</div>" +
        projTrack(d) +
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

  window.RoadTo1 = { render: render };
})();
