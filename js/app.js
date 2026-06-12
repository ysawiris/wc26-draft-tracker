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
  function groupFouls(g) { return g.countries.reduce(function (s, c) { return s + (c.fouls || 0); }, 0); }

  function ownerByGroup() {
    var o = {};
    TEAMS.forEach(function (t) { o[t.group] = t; });
    return o;
  }

  function buildStandings() {
    var rows = TEAMS.map(function (t) {
      var g = GROUPS[t.group];
      if (!g) throw new Error("Team '" + t.name + "' has unknown group '" + t.group + "'");
      return { team: t, group: g, goals: groupGoals(g), cardPoints: groupCardPoints(g), cards: groupCards(g), fouls: groupFouls(g) };
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
    if (Live.INPLAY[s]) {
      var label = s === "PAUSED" || s === "HALFTIME" ? "HALF-TIME"
        : "LIVE" + (fx.minute ? " · " + fx.minute : "");
      return { key: "live", label: label, live: true };
    }
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
          '<div class="fouls-row">⚠ ' + row.fouls + " fouls</div>" +
        "</div>";
      list.appendChild(li);
    });
  }

  /* ---------------- live / next-up strip ---------------- */

  var countdownTimer = null;

  var RAIL_WINDOW_MS = 7 * 86400000; // a week of kickoffs in the next-up rail
  var RAIL_MAX = 40;                  // safety cap so a busy week can't bloat the DOM

  function renderLive(fixtures) {
    var wrap = document.getElementById("livewrap");
    var now = new Date();
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

    var owners = ownerByGroup();
    var live = fixtures.filter(function (fx) { return Live.INPLAY[fx.status]; });

    // Everything still to come, soonest first.
    var future = fixtures
      .filter(function (fx) { return !Live.FINISHED[fx.status] && !Live.INPLAY[fx.status] && fxDate(fx) > now; })
      .sort(function (a, b) { return fxDate(a) - fxDate(b); });

    if (!live.length && !future.length) {
      wrap.innerHTML = '<div class="live-head">Group stage complete — draft order is final. 🏆</div>';
      return;
    }

    // The rail shows live games first, then the next week of kickoffs, then a
    // final card that hands off to the full schedule. Live no longer hides
    // what's next — you can always scroll ahead.
    var weekOut = new Date(now.getTime() + RAIL_WINDOW_MS);
    var upNext = future.filter(function (fx) { return fxDate(fx) <= weekOut; });
    if (!upNext.length) upNext = future.slice(0, 8); // quiet stretch: still show the next few
    upNext = upNext.slice(0, RAIL_MAX);

    var shown = live.concat(upNext);
    var lastShown = shown.length ? shown[shown.length - 1] : null;
    var hasMore = future.length > upNext.length;

    var head = live.length
      ? '<div class="live-head"><span class="live-dot"></span> Live now <span class="live-head-sub">· and what’s next</span></div>'
      : '<div class="live-head">Next up · <span id="countdown"></span></div>';

    var cards =
      live.map(function (fx) { return matchMini(fx, owners, true, now); }).join("") +
      upNext.map(function (fx) { return matchMini(fx, owners, false, now); }).join("") +
      moreCard(lastShown, hasMore);

    wrap.innerHTML = head + '<div class="live-cards">' + cards + "</div>";

    // Countdown only when nothing is live (the live head carries no countdown).
    if (!live.length && upNext.length) {
      var target = fxDate(upNext[0]);
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
  }

  /* Trailing rail card: jumps to the full Schedule tab, landing on the last
     game the rail showed so the user continues right where they left off. */
  function moreCard(lastFx, hasMore) {
    var anchor = lastFx ? lastFx.id : "";
    return '<button type="button" class="mini mini-more" data-goto-schedule="' + esc(anchor) + '">' +
      '<span class="mini-more-ico">📅</span>' +
      '<span class="mini-more-label">' + (hasMore ? "Full schedule" : "Open schedule") + "</span>" +
      '<span class="mini-more-sub">' + (hasMore ? "See the rest →" : "All 72 matches →") + "</span>" +
      "</button>";
  }

  function scoreOrTime(fx) {
    if (fx.homeGoals != null && fx.awayGoals != null) return fx.homeGoals + "–" + fx.awayGoals;
    var t = fmtTime(fx);
    return t || "TBD";
  }

  function matchMini(fx, owners, isLive, now) {
    var owner = owners[fx.group];
    var ownerTag = owner
      ? '<span class="mini-owner" style="--ac:' + (owner.accent || "#c89638") + '">' + esc(owner.abbr) + "</span>"
      : (fx.exhibition ? '<span class="mini-exh">Exhibition</span>' : "");
    // Today's games show just the kickoff time; only future days carry a date label.
    var isToday = now && dayKey(fxDate(fx)) === dayKey(now);
    var when = (isLive || isToday) ? "" : '<div class="mini-when">' + fmtDay(fxDate(fx)) + "</div>";
    return '<div class="mini' + (isLive ? " live" : "") + (fx.exhibition ? " exh" : "") + '">' +
      '<div class="mini-grp">Grp ' + fx.group + " " + ownerTag + "</div>" +
      when +
      '<div class="mini-row"><span>' + fx.home.flag + " " + esc(fx.home.name) + "</span></div>" +
      '<div class="mini-score">' + scoreOrTime(fx) +
        (isLive ? ' <span class="mini-live">●</span>' +
          (fx.minute ? '<span class="mini-min">' + esc(fx.minute) + "</span>" : "") : "") + "</div>" +
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

  /* "🟨2 🟥1" chip for one side of a fixture; empty when no cards. */
  function cardChips(c) {
    if (!c || (!c.y && !c.r)) return "";
    var bits = [];
    if (c.y) bits.push("🟨" + c.y);
    if (c.r) bits.push("🟥" + c.r);
    return '<span class="m-cards">' + bits.join(" ") + "</span>";
  }

  function matchCard(fx, owners, now) {
    var st = statusInfo(fx);
    var owner = owners[fx.group];
    var card = el("div", "match" + (st.live ? " is-live" : "") +
      (owner && owner.isMine ? " is-mine" : "") + (fx.exhibition ? " exh" : ""));
    if (fx.id) card.id = "sched-" + fx.id; // anchor for the rail's "full schedule" jump

    var hg = fx.homeGoals, ag = fx.awayGoals;
    var hasScore = hg != null && ag != null;
    var center = hasScore
      ? '<div class="m-score">' + hg + '<span>–</span>' + ag + "</div>"
      : '<div class="m-kick">' + (fmtTime(fx) || "TBD") + "</div>";

    var pill = '<span class="m-pill ' + st.key + '">' + (st.live ? '<span class="live-dot sm"></span>' : "") + st.label + "</span>";

    var ownerChip = owner
      ? '<span class="owner-chip" style="--ac:' + (owner.accent || "#c89638") + '">⚽ ' + esc(owner.name) + (owner.isMine ? " ⭐" : "") + "</span>"
      : fx.exhibition
        ? '<span class="owner-chip empty">Not in the league draw — doesn\'t count</span>'
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
        '<div class="m-team home"><span class="m-flag">' + fx.home.flag + '</span>' +
          '<span class="m-stack"><span class="m-name">' + esc(fx.home.name) + "</span>" +
          (fx.cards ? cardChips(fx.cards.home) : "") + "</span></div>" +
        center +
        '<div class="m-team away"><span class="m-flag">' + fx.away.flag + '</span>' +
          '<span class="m-stack"><span class="m-name">' + esc(fx.away.name) + "</span>" +
          (fx.cards ? cardChips(fx.cards.away) : "") + "</span></div>" +
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

  function renderMeta(started, fixtures, allFx, liveData) {
    var done = allFx.filter(function (fx) { return Live.FINISHED[fx.status]; }).length;
    var totalGoals = (liveData && liveData.matches || []).reduce(function (s, m) {
      if (!Live.FINISHED[m.status] && !Live.INPLAY[m.status]) return s;
      return s + (m.homeGoals || 0) + (m.awayGoals || 0);
    }, 0);
    var live = (liveData && liveData.matchCount) || 0;

    document.getElementById("hero-meta").innerHTML =
      '<span class="hero-pill"><b>10</b> teams</span>' +
      '<span class="hero-pill"><b>' + totalGoals + '</b> goals scored</span>' +
      '<span class="hero-pill"><b>' + done + "/" + allFx.length + "</b> matches played</span>" +
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

  function setTab(name, opts) {
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
    // Callers that scroll to a specific element themselves pass noScroll so the
    // page-top scroll doesn't fight their scrollIntoView.
    if (!(opts && opts.noScroll)) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* Open the Schedule tab and scroll to one fixture, flashing it briefly.
     Forces the "all" filter first so the target is guaranteed to be mounted. */
  function gotoScheduleAt(anchorId) {
    scheduleFilter = "all";
    document.querySelectorAll("#schedule-filters .chip").forEach(function (c) {
      c.classList.toggle("is-active", c.dataset.filter === "all");
    });
    renderSchedule(currentFixtures);
    setTab("schedule", { noScroll: true });
    // Let the panel unhide/layout, then center the anchor and flash it. Uses
    // window.scrollTo (not scrollIntoView) — body's overflow-x:hidden makes the
    // viewport the scroller, where scrollIntoView is unreliable.
    setTimeout(function () {
      var node = anchorId && document.getElementById("sched-" + anchorId);
      if (!node) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
      var y = node.getBoundingClientRect().top + window.pageYOffset - (window.innerHeight / 2) + 40;
      window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
      node.classList.add("flash");
      setTimeout(function () { node.classList.remove("flash"); }, 1500);
    }, 60);
  }

  function wireTabs() {
    document.addEventListener("click", function (e) {
      var jump = e.target.closest("[data-goto-schedule]");
      if (jump) { e.preventDefault(); gotoScheduleAt(jump.getAttribute("data-goto-schedule")); return; }
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
    // The "my group" chip's label and visibility are owned by js/my-team.js.
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
    Live.applyFouls(liveData && liveData.fouls && liveData.fouls.byCountry);

    // All groups (A–L) are league fixtures now and drive every standing/stat.
    // The exhibition track is currently empty (concat kept as an extension point).
    var fixtures = buildFixtures();
    var allFixtures = fixtures.concat(buildExhibitionFixtures());
    Live.attachToFixtures(allFixtures, matches,
      liveData && liveData.cards && liveData.cards.byMatch);
    currentFixtures = allFixtures;

    var started = seasonStarted(fixtures);
    var standings = buildStandings();

    renderBoard(standings, started, firstRender);
    renderLive(allFixtures);
    renderSchedule(allFixtures);
    renderGroups();
    renderMeta(started, fixtures, allFixtures, liveData);
    firstRender = false;

    lastCtx = {
      league: LEAGUE,
      teams: TEAMS,
      groups: GROUPS,
      fixtures: fixtures,
      allFixtures: allFixtures,
      standings: standings,
      started: started,
      liveData: liveData || null,
      helpers: {
        esc: esc, el: el, ordinal: ordinal, crestHtml: crestHtml,
        fxDate: fxDate, dayKey: dayKey, fmtDay: fmtDay, fmtTime: fmtTime,
        statusInfo: statusInfo, groupGoals: groupGoals, groupCardPoints: groupCardPoints,
        groupCards: groupCards, groupFouls: groupFouls, ownerByGroup: ownerByGroup, buildStandings: buildStandings
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
