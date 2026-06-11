/* Orchestrates the WC26 league hub: loads live data, merges it over the
   seed, and renders the board, live strip, schedule, groups and rules.
   Exposes window.Hub so feature modules (stats, simulator, board extras,
   auto-refresh) can read derived state and re-render after every update. */

(function () {
  "use strict";

  /* ---------------- derive ---------------- */

  function groupGoals(g) { return g.countries.reduce(function (s, c) { return s + c.goals; }, 0); }
  function groupCardPoints(g) { return g.countries.reduce(function (s, c) { return s + c.yellows + c.reds * 2; }, 0); }
  function groupCards(g) { return g.countries.reduce(function (a, c) { return { y: a.y + c.yellows, r: a.r + c.reds }; }, { y: 0, r: 0 }); }

  function ownerByGroup() {
    var o = {};
    TEAMS.forEach(function (t) { o[t.group] = t; });
    return o;
  }

  function buildStandings() {
    var rows = TEAMS.map(function (t) {
      var g = GROUPS[t.group];
      if (!g) throw new Error("Team '" + t.name + "' has unknown group '" + t.group + "'");
      return { team: t, group: g, goals: groupGoals(g), cardPoints: groupCardPoints(g), cards: groupCards(g) };
    });
    var sorted = rows.slice().sort(function (a, b) {
      if (b.goals !== a.goals) return b.goals - a.goals;
      return b.cardPoints - a.cardPoints;
    });
    return sorted.map(function (row, i) {
      var same = function (o) { return o && o.goals === row.goals && o.cardPoints === row.cardPoints; };
      return Object.assign({}, row, { rank: i + 1, tied: same(sorted[i - 1]) || same(sorted[i + 1]) });
    });
  }

  /* ---------------- helpers ---------------- */

  function ordinal(n) {
    var m = n % 100;
    if (m >= 11 && m <= 13) return "th";
    return { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* Date object for a fixture: prefer the exact kickoff (utcDate) else local noon of dateISO. */
  function fxDate(fx) {
    if (fx.utcDate) { var d = new Date(fx.utcDate); if (!isNaN(d)) return d; }
    var p = fx.dateISO.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
  }
  function dayKey(d) { return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function fmtDay(d) { return DOW[d.getDay()] + " · " + MON[d.getMonth()] + " " + d.getDate(); }
  function fmtTime(fx) {
    if (!fx.utcDate) return null;
    var d = new Date(fx.utcDate);
    if (isNaN(d)) return null;
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function statusInfo(fx) {
    var s = fx.status;
    if (Live.INPLAY[s]) return { key: "live", label: s === "PAUSED" || s === "HALFTIME" ? "HALF-TIME" : "LIVE", live: true };
    if (Live.FINISHED[s]) return { key: "ft", label: "Full-time", done: true };
    if (s === "POSTPONED" || s === "SUSPENDED" || s === "CANCELLED") return { key: "off", label: s.charAt(0) + s.slice(1).toLowerCase() };
    return { key: "up", label: "Upcoming", upcoming: true };
  }

  function seasonStarted(fixtures) {
    return fixtures.some(function (fx) { return Live.INPLAY[fx.status] || Live.FINISHED[fx.status]; }) ||
      Object.keys(GROUPS).some(function (k) { return groupGoals(GROUPS[k]) > 0; });
  }

  /* ---------------- crest ---------------- */

  function crestHtml(team) {
    var lenCls = team.abbr.length >= 4 ? " len4" : team.abbr.length <= 1 ? " len1" : "";
    var inner = team.photo
      ? '<img src="' + esc(team.photo) + '" alt="' + esc(team.name) + '" ' +
        "onerror=\"this.replaceWith(Object.assign(document.createElement('span'),{className:'mono',textContent:'" + esc(team.abbr) + "'}))\" />"
      : '<span class="mono">' + esc(team.abbr) + "</span>";
    var bg = team.accent ? ' style="background:radial-gradient(circle at 32% 28%, ' + team.accent + ', #140d05)"' : "";
    return '<div class="crest' + lenCls + '"' + bg + ">" + inner + "</div>";
  }

  /* ---------------- draft board ---------------- */

  function renderBoard(standings, started, animate) {
    var list = document.getElementById("board-list");
    list.textContent = "";
    document.getElementById("board-hint").textContent = started
      ? "Live group-goal standings — re-ranks automatically as goals go in."
      : "Provisional until the group stage starts. Everyone's on zero — first goals set the order.";

    standings.forEach(function (row, i) {
      var t = row.team;
      var li = el("li", "row" + (started && row.rank === 1 ? " is-first" : "") + (t.isMine ? " is-mine" : ""));
      li.dataset.abbr = t.abbr;
      if (animate) li.style.animationDelay = (i * 40) + "ms";
      else li.style.animation = "none";
      if (t.accent) li.style.setProperty("--row-accent", t.accent);

      var rankInner = started ? row.rank + "<small>" + ordinal(row.rank) + "</small>" : "&ndash;";
      var managers = t.managers.join(" &amp; ");
      var tie = row.tied && started ? '<span class="tie-flag">Tied</span>' : "";
      var flags = row.group.countries.map(function (c) { return "<span>" + c.flag + "</span>"; }).join("");

      li.innerHTML =
        '<div class="rank' + (started ? "" : " prov") + '">' + rankInner + "</div>" +
        crestHtml(t) +
        '<div class="team">' +
          '<div class="team-top">' +
            '<span class="team-name">' + esc(t.name) + "</span>" +
            '<span class="div-badge div-' + esc(t.division) + '">' + esc(t.division) + "</span>" + tie +
          "</div>" +
          '<div class="team-managers">' + managers + "</div>" +
          '<div class="team-group"><span class="group-chip">Group ' + row.group.letter + "</span>" +
            '<span class="flag-strip">' + flags + "</span></div>" +
        "</div>" +
        '<div class="stats">' +
          '<span class="goals">' + row.goals + "</span>" +
          '<span class="goals-label">Goals</span>' +
          '<div class="tb">🟨 ' + row.cards.y + " · 🟥 " + row.cards.r + " · TB " + row.cardPoints + "</div>" +
        "</div>";
      list.appendChild(li);
    });
  }

  /* ---------------- live / next-up strip ---------------- */

  var countdownTimer = null;

  function renderLive(fixtures) {
    var wrap = document.getElementById("livewrap");
    var now = new Date();
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

    var live = fixtures.filter(function (fx) { return Live.INPLAY[fx.status]; });
    var owners = ownerByGroup();

    if (live.length) {
      wrap.innerHTML = '<div class="live-head"><span class="live-dot"></span> Live now</div>' +
        '<div class="live-cards">' + live.map(function (fx) { return matchMini(fx, owners, true); }).join("") + "</div>";
      return;
    }

    // Otherwise: next upcoming kickoff + a countdown.
    var upcoming = fixtures
      .filter(function (fx) { return !Live.FINISHED[fx.status] && fxDate(fx) > now; })
      .sort(function (a, b) { return fxDate(a) - fxDate(b); });

    if (!upcoming.length) {
      wrap.innerHTML = '<div class="live-head">Group stage complete — draft order is final. 🏆</div>';
      return;
    }

    var next = upcoming[0];
    var nextDay = dayKey(fxDate(next));
    var sameDay = upcoming.filter(function (fx) { return dayKey(fxDate(fx)) === nextDay; }).slice(0, 4);

    wrap.innerHTML =
      '<div class="live-head">Next up · <span id="countdown"></span></div>' +
      '<div class="live-cards">' + sameDay.map(function (fx) { return matchMini(fx, owners, false); }).join("") + "</div>";

    var target = fxDate(next);
    var tick = function () {
      var diff = target - new Date();
      var node = document.getElementById("countdown");
      if (!node) return;
      if (diff <= 0) { node.textContent = "kicking off"; return; }
      var d = Math.floor(diff / 86400000), h = Math.floor(diff / 3600000) % 24,
          m = Math.floor(diff / 60000) % 60, s = Math.floor(diff / 1000) % 60;
      node.textContent = (d ? d + "d " : "") + (h || d ? h + "h " : "") + m + "m " + s + "s";
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function scoreOrTime(fx) {
    if (fx.homeGoals != null && fx.awayGoals != null) return fx.homeGoals + "–" + fx.awayGoals;
    var t = fmtTime(fx);
    return t || "TBD";
  }

  function matchMini(fx, owners, isLive) {
    var owner = owners[fx.group];
    var ownerTag = owner ? '<span class="mini-owner" style="--ac:' + (owner.accent || "#c89638") + '">' + esc(owner.abbr) + "</span>" : "";
    return '<div class="mini' + (isLive ? " live" : "") + '">' +
      '<div class="mini-grp">Grp ' + fx.group + " " + ownerTag + "</div>" +
      '<div class="mini-row"><span>' + fx.home.flag + " " + esc(fx.home.name) + "</span></div>" +
      '<div class="mini-score">' + scoreOrTime(fx) + (isLive ? ' <span class="mini-live">●</span>' : "") + "</div>" +
      '<div class="mini-row"><span>' + fx.away.flag + " " + esc(fx.away.name) + "</span></div>" +
      "</div>";
  }

  /* ---------------- schedule ---------------- */

  var scheduleFilter = "all";

  function passesFilter(fx, now) {
    if (scheduleFilter === "mine") { var t = TEAMS.find(function (x) { return x.isMine; }); return t && fx.group === t.group; }
    if (scheduleFilter === "today") return dayKey(fxDate(fx)) === dayKey(now);
    if (scheduleFilter === "upcoming") return !Live.FINISHED[fx.status] && !Live.INPLAY[fx.status];
    if (scheduleFilter === "results") return Live.FINISHED[fx.status];
    return true;
  }

  function renderSchedule(fixtures) {
    var host = document.getElementById("schedule-list");
    var now = new Date();
    var owners = ownerByGroup();
    host.textContent = "";

    var shown = fixtures.filter(function (fx) { return passesFilter(fx, now); })
      .sort(function (a, b) { return fxDate(a) - fxDate(b) || a.group.localeCompare(b.group); });

    if (!shown.length) {
      host.appendChild(el("p", "empty-note", "No matches for this filter yet."));
      return;
    }

    var lastDay = null;
    shown.forEach(function (fx) {
      var d = fxDate(fx);
      var key = dayKey(d);
      if (key !== lastDay) {
        lastDay = key;
        var isToday = key === dayKey(now);
        host.appendChild(el("div", "day-head" + (isToday ? " today" : ""),
          fmtDay(d) + (isToday ? ' <span class="today-pill">Today</span>' : "")));
      }
      host.appendChild(matchCard(fx, owners, now));
    });
  }

  function matchCard(fx, owners, now) {
    var st = statusInfo(fx);
    var owner = owners[fx.group];
    var card = el("div", "match" + (st.live ? " is-live" : "") + (owner && owner.isMine ? " is-mine" : ""));

    var hg = fx.homeGoals, ag = fx.awayGoals;
    var hasScore = hg != null && ag != null;
    var center = hasScore
      ? '<div class="m-score">' + hg + '<span>–</span>' + ag + "</div>"
      : '<div class="m-kick">' + (fmtTime(fx) || "TBD") + "</div>";

    var pill = '<span class="m-pill ' + st.key + '">' + (st.live ? '<span class="live-dot sm"></span>' : "") + st.label + "</span>";

    var ownerChip = owner
      ? '<span class="owner-chip" style="--ac:' + (owner.accent || "#c89638") + '">⚽ ' + esc(owner.name) + (owner.isMine ? " ⭐" : "") + "</span>"
      : '<span class="owner-chip empty">Unclaimed</span>';

    var actions = "";
    if (st.done) {
      actions = '<a class="m-act" target="_blank" rel="noopener" href="' + Live.highlightsUrl(fx.home.name, fx.away.name) + '">▶ Highlights</a>';
    } else if (!st.live) {
      var cal = Live.calendarUrl(fx.home.name, fx.away.name, fx.group, fx.utcDate);
      if (cal) actions = '<a class="m-act ghost" target="_blank" rel="noopener" href="' + cal + '">＋ Calendar</a>';
    }

    card.innerHTML =
      '<div class="m-meta"><span class="m-grp">Group ' + fx.group + " · MD" + fx.matchday + "</span>" + pill + "</div>" +
      '<div class="m-body">' +
        '<div class="m-team home"><span class="m-flag">' + fx.home.flag + '</span><span class="m-name">' + esc(fx.home.name) + "</span></div>" +
        center +
        '<div class="m-team away"><span class="m-flag">' + fx.away.flag + '</span><span class="m-name">' + esc(fx.away.name) + "</span></div>" +
      "</div>" +
      '<div class="m-foot">' + ownerChip + actions + "</div>";
    return card;
  }

  /* ---------------- groups ---------------- */

  function renderGroups() {
    var grid = document.getElementById("groups-grid");
    grid.textContent = "";
    var owner = ownerByGroup();

    Object.keys(GROUPS).forEach(function (letter) {
      var g = GROUPS[letter];
      var t = owner[letter];
      var card = el("div", "gcard" + (t ? "" : " unclaimed") + (t && t.isMine ? " mine" : ""));
      card.innerHTML =
        '<div class="ghead"><div class="gletter">' + letter + "</div>" +
          '<div class="gowner' + (t ? "" : " empty") + '"><small>' + (t ? "Drafted by" : "Unclaimed") + "</small>" +
          "<b>" + (t ? esc(t.name) : "—") + "</b></div></div>";

      g.countries.forEach(function (c) {
        var bar = el("div", "cbar");
        bar.style.background = "linear-gradient(105deg, " + c.c1 + " 0%, " + c.c2 + " 100%)";
        bar.innerHTML = '<span class="cflag">' + c.flag + '</span><span class="cname">' + esc(c.name) +
          '</span><span class="cgoals">' + c.goals + " ⚽</span>";
        card.appendChild(bar);
      });

      var cards = groupCards(g);
      card.appendChild(el("div", "gtotal",
        "<span>🟨 " + cards.y + " · 🟥 " + cards.r + "</span><span>Goals <b>" + groupGoals(g) + "</b></span>"));
      grid.appendChild(card);
    });
  }

  /* ---------------- meta / rules ---------------- */

  function renderMeta(started, fixtures, liveData) {
    var done = fixtures.filter(function (fx) { return Live.FINISHED[fx.status]; }).length;
    var totalGoals = Object.keys(GROUPS).reduce(function (s, k) { return s + groupGoals(GROUPS[k]); }, 0);
    var live = (liveData && liveData.matchCount) || 0;

    document.getElementById("hero-meta").innerHTML =
      '<span class="hero-pill"><b>10</b> teams</span>' +
      '<span class="hero-pill"><b>' + totalGoals + '</b> goals tracked</span>' +
      '<span class="hero-pill"><b>' + done + "/" + fixtures.length + "</b> matches played</span>" +
      '<span class="hero-pill">' + (live ? "🟢 Live feed on" : "Schedule mode") + "</span>";

    document.getElementById("draw-note").textContent = LEAGUE.drawNote;

    var connected = liveData && liveData.matchCount > 0;
    var hasCards = !!(liveData && liveData.cards && liveData.cards.byCountry &&
      Object.keys(liveData.cards.byCountry).length);
    document.getElementById("live-explain").innerHTML =
      "<h3>Live updates</h3>" +
      "<p>" + (connected
        ? "✅ The live feed is connected, straight from FIFA. Scores" + (hasCards ? ", cards" : "") +
          " and the draft order refresh automatically every few minutes during matches — no one has to touch anything."
        : "Scores update automatically once the live feed is switched on. Until then you're seeing the full schedule and kickoff dates; the draft board moves the moment goals start landing.") +
      "</p>" +
      "<p class=\"muted\">All kickoff times are shown in your local timezone. Disputes about goals or cards? The official FIFA match report wins, then the commissioner.</p>";
  }

  /* ---------------- tabs ---------------- */

  function tabNames() {
    return Array.prototype.map.call(document.querySelectorAll("#tabs .tab"), function (b) { return b.dataset.tab; });
  }

  function setTab(name) {
    document.querySelectorAll(".tab[data-tab]").forEach(function (b) {
      var on = b.dataset.tab === name;
      b.classList.toggle("is-active", on);
      if (on && b.closest("#tabs") && b.scrollIntoView) b.scrollIntoView({ inline: "center", block: "nearest" });
    });
    tabNames().forEach(function (n) {
      var panel = document.getElementById("tab-" + n);
      if (!panel) return;
      var on = n === name;
      panel.hidden = !on;
      panel.classList.toggle("is-active", on);
    });
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function wireTabs() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".tab[data-tab]");
      if (btn) setTab(btn.dataset.tab);
    });
    document.querySelector(".brand").addEventListener("click", function (e) { e.preventDefault(); setTab("board"); });
    var hash = (location.hash || "").replace("#", "");
    if (tabNames().indexOf(hash) >= 0) setTab(hash);
  }

  function wireFilters() {
    document.getElementById("schedule-filters").addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      scheduleFilter = chip.dataset.filter;
      document.querySelectorAll("#schedule-filters .chip").forEach(function (c) {
        c.classList.toggle("is-active", c === chip);
      });
      renderSchedule(currentFixtures);
    });
    // Label the "my group" chip from data instead of hardcoding the letter.
    var mine = TEAMS.find(function (t) { return t.isMine; });
    var mineChip = document.querySelector('#schedule-filters .chip[data-filter="mine"]');
    if (mine && mineChip) mineChip.textContent = "⭐ My group (" + mine.group + ")";
  }

  /* ---------------- Hub (feature-module API) ---------------- */

  var currentFixtures = [];
  var lastCtx = null;
  var firstRender = true;
  var renderCallbacks = [];

  function renderAll(liveData) {
    var matches = (liveData && liveData.matches) || [];
    Live.applyMatches(matches);
    Live.applyCards(liveData && liveData.cards && liveData.cards.byCountry);

    var fixtures = buildFixtures();
    Live.attachToFixtures(fixtures, matches);
    currentFixtures = fixtures;

    var started = seasonStarted(fixtures);
    var standings = buildStandings();

    renderBoard(standings, started, firstRender);
    renderLive(fixtures);
    renderSchedule(fixtures);
    renderGroups();
    renderMeta(started, fixtures, liveData);
    firstRender = false;

    lastCtx = {
      league: LEAGUE,
      teams: TEAMS,
      groups: GROUPS,
      fixtures: fixtures,
      standings: standings,
      started: started,
      liveData: liveData || null,
      helpers: {
        esc: esc, el: el, ordinal: ordinal, crestHtml: crestHtml,
        fxDate: fxDate, dayKey: dayKey, fmtDay: fmtDay, fmtTime: fmtTime,
        statusInfo: statusInfo, groupGoals: groupGoals, groupCardPoints: groupCardPoints,
        groupCards: groupCards, ownerByGroup: ownerByGroup, buildStandings: buildStandings
      }
    };

    renderCallbacks.forEach(function (fn) {
      try { fn(lastCtx); } catch (err) { console.error("Hub module render failed:", err); }
    });
    return lastCtx;
  }

  window.Hub = {
    /* Latest derived state (null before first render). */
    ctx: function () { return lastCtx; },
    /* Register fn(ctx) to run after every full render. If a render already
       happened, fn runs immediately with the latest ctx. */
    onRender: function (fn) {
      renderCallbacks.push(fn);
      if (lastCtx) {
        try { fn(lastCtx); } catch (err) { console.error("Hub module render failed:", err); }
      }
    },
    /* Re-fetch data/live.json and re-render everything. Resolves with ctx. */
    refresh: function () {
      return Live.load().then(renderAll).catch(function () { return renderAll(null); });
    },
    setTab: setTab
  };

  /* ---------------- boot ---------------- */

  try {
    wireTabs();
    wireFilters();
    Live.load().then(renderAll).catch(function () { renderAll(null); });
  } catch (err) {
    document.getElementById("board-list").innerHTML =
      '<li class="row"><div></div><div></div><div class="team">' +
      '<div class="team-name">Data error</div><div class="team-managers">' + esc(err.message) + "</div></div><div></div></li>";
  }
})();
