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
    var todayK = dayKey(now);
    var tomorrowK = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

    // Bucket every fixture by its LOCAL calendar day. "Today" holds finished,
    // live AND still-to-come games alike — so a result stays in the strip until
    // the date itself rolls over to tomorrow, never the instant the match ends.
    // Bucketing on the day (not the status) means an unexpected terminal status
    // can't make today's game vanish.
    // Anything in play floats to the very front of the rail in its own "Live
    // now" section, regardless of which calendar day it kicked off on.
    var liveGames = fixtures
      .filter(function (fx) { return Live.INPLAY[fx.status]; })
      .sort(function (a, b) { return fxDate(a) - fxDate(b); });
    var todayGames = fixtures
      .filter(function (fx) { return dayKey(fxDate(fx)) === todayK && !Live.INPLAY[fx.status]; })
      .sort(function (a, b) { return fxDate(a) - fxDate(b); });
    var tomorrowGames = fixtures
      .filter(function (fx) { return dayKey(fxDate(fx)) === tomorrowK && !Live.INPLAY[fx.status]; })
      .sort(function (a, b) { return fxDate(a) - fxDate(b); });

    // "Next up": games beyond tomorrow that haven't kicked off, soonest first,
    // capped to the coming week (a quiet stretch still shows the next few).
    var weekOut = new Date(now.getTime() + RAIL_WINDOW_MS);
    var laterAll = fixtures
      .filter(function (fx) {
        var k = dayKey(fxDate(fx));
        if (k === todayK || k === tomorrowK) return false;
        return !Live.FINISHED[fx.status] && !Live.INPLAY[fx.status] && fxDate(fx) > now;
      })
      .sort(function (a, b) { return fxDate(a) - fxDate(b); });
    var later = laterAll.filter(function (fx) { return fxDate(fx) <= weekOut; });
    if (!later.length) later = laterAll.slice(0, 8);
    later = later.slice(0, RAIL_MAX);

    if (!liveGames.length && !todayGames.length && !tomorrowGames.length && !later.length) {
      wrap.innerHTML = '<div class="live-head">Group stage complete — draft order is final. 🏆</div>';
      return;
    }

    var anyLive = liveGames.length > 0;

    // The next kickoff still to come — the countdown target. Suppressed while a
    // game is live (the live card itself carries the moment).
    var nextKick = null;
    if (!anyLive) {
      var pending = todayGames.concat(tomorrowGames, later).filter(function (fx) {
        return !Live.FINISHED[fx.status] && !Live.INPLAY[fx.status] && fxDate(fx) > now;
      });
      if (pending.length) nextKick = pending[0]; // each bucket is already kickoff-sorted, today first
    }

    // Section list. Live games lead; then Today / Tomorrow / Next up. With
    // nothing live, today or tomorrow, the rail collapses to a single "Next up".
    var sections = [];
    if (liveGames.length) sections.push({ key: "live", label: "Live now", games: liveGames, live: true });
    if (todayGames.length) sections.push({ key: "today", label: "Today", games: todayGames });
    if (tomorrowGames.length) sections.push({ key: "tomorrow", label: "Tomorrow", games: tomorrowGames });
    if (later.length) sections.push({ key: "later", label: "Next up", games: later });

    var hasMore = laterAll.length > later.length; // games left beyond the rail window/cap
    var lastShown = null;

    // One continuous rail. Each section contributes a vertical "spine" label
    // (Today / Tomorrow / Next up) followed by its cards, so the whole strip
    // stays a single horizontal row the user scrolls straight through.
    // The countdown rides in its own fixed-width card at the head of the rail —
    // never inside a vertical spine, where its ever-changing length stretched
    // every card to match the rotated text's height.
    var rail = nextKick ? nextKickCard(nextKick, owners, now) : "";
    sections.forEach(function (sec) {
      // Each section is already in kickoff order (sec.games sorted ascending).
      var games = sec.games;
      if (games.length) lastShown = games[games.length - 1];

      var meta = sec.live ? ' · <span class="rail-sec-cd">now</span>' : "";
      rail += '<div class="rail-sec' + (sec.live ? " rail-sec-live" : "") + '"><span class="rail-sec-inner">' +
        (sec.live ? '<span class="live-dot sm"></span> ' : "") +
        sec.label + meta + "</span></div>";

      rail += games.map(function (fx) {
        return matchMini(fx, owners, Live.INPLAY[fx.status], now);
      }).join("");
    });
    rail += moreCard(lastShown, hasMore);

    wrap.innerHTML = '<div class="live-cards">' + rail + "</div>";

    // Countdown only when nothing is live (nextKick is null in that case).
    if (nextKick) {
      var target = fxDate(nextKick);
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
    var done = Live.FINISHED[fx.status];
    // Today's games show just the kickoff time; only future days carry a date label.
    var isToday = now && dayKey(fxDate(fx)) === dayKey(now);
    var when = (isLive || done || isToday) ? "" : '<div class="mini-when">' + fmtDay(fxDate(fx)) + "</div>";
    return '<div class="mini mc-mini' + (isLive ? " live" : done ? " done" : "") + (fx.exhibition ? " exh" : "") + '"' +
      ' data-mc="' + esc(fx.id) + '" role="button" tabindex="0" aria-label="Open match center for ' + esc(fx.home.name) + " vs " + esc(fx.away.name) + '">' +
      '<div class="mini-grp">Grp ' + fx.group + " " + ownerTag +
        (done ? '<span class="mini-ft">FT</span>' : "") + "</div>" +
      when +
      '<div class="mini-row"><span>' + fx.home.flag + " " + esc(fx.home.name) + "</span></div>" +
      '<div class="mini-score">' + scoreOrTime(fx) +
        (isLive ? ' <span class="mini-live">●</span>' +
          (fx.minute ? '<span class="mini-min">' + esc(fx.minute) + "</span>" : "") : "") + "</div>" +
      '<div class="mini-row"><span>' + fx.away.flag + " " + esc(fx.away.name) + "</span></div>" +
      "</div>";
  }

  /* Head-of-rail countdown to the next kickoff. Fixed width, so the ticking
     digits never reflow; card height matches the others, so it never stretches
     the strip the way the old vertical-spine countdown did. */
  function nextKickCard(fx, owners, now) {
    var owner = owners[fx.group];
    var ownerTag = owner
      ? '<span class="mini-owner" style="--ac:' + (owner.accent || "#c89638") + '">' + esc(owner.abbr) + "</span>"
      : "";
    var sameDay = dayKey(fxDate(fx)) === dayKey(now);
    var when = (sameDay ? "Today" : fmtDay(fxDate(fx))) + (fmtTime(fx) ? " · " + fmtTime(fx) : "");
    return '<div class="mini mini-next">' +
      '<div class="mini-grp"><span class="next-kick-ico">⏱</span> Next kickoff' +
        (ownerTag ? " " + ownerTag : "") + "</div>" +
      '<div class="next-kick-cd"><span id="countdown"></span></div>' +
      '<div class="next-kick-match">' +
        fx.home.flag + " " + esc(fx.home.name) + " v " + fx.away.flag + " " + esc(fx.away.name) + "</div>" +
      '<div class="next-kick-when">' + esc(when) + "</div>" +
      "</div>";
  }

  /* ---------------- schedule ---------------- */

  var scheduleFilter = "next";

  function passesFilter(fx, now) {
    if (scheduleFilter === "mine") { var t = TEAMS.find(function (x) { return x.isMine; }); return t && fx.group === t.group; }
    if (scheduleFilter === "today") return dayKey(fxDate(fx)) === dayKey(now);
    // "next" = everything still to come, live games included (the default view).
    if (scheduleFilter === "next") return !Live.FINISHED[fx.status];
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

    // The "Live now" band is sourced from ALL fixtures so an in-play game is
    // unmissable regardless of the active day/upcoming filter (e.g. a match that
    // kicked off before midnight while the Today filter is on). Scoped to the
    // viewer's group under "My group"; omitted in the finished-only Results view.
    var liveGames = scheduleFilter === "results" ? [] :
      fixtures.filter(function (fx) {
        if (!Live.INPLAY[fx.status]) return false;
        if (scheduleFilter === "mine") {
          var t = TEAMS.find(function (x) { return x.isMine; });
          return t && fx.group === t.group;
        }
        return true;
      }).sort(function (a, b) { return fxDate(a) - fxDate(b); });

    if (!shown.length && !liveGames.length) {
      host.appendChild(el("p", "empty-note", "No matches for this filter yet."));
      toggleJumpToday(fixtures, now);
      return;
    }

    if (liveGames.length) {
      host.appendChild(el("div", "sched-live-head",
        '<span class="live-dot sm"></span> Live now ' +
        '<span class="sched-live-count">' + liveGames.length +
        (liveGames.length === 1 ? " match" : " matches") + "</span>"));
      var liveGrid = el("div", "sched-day sched-live");
      liveGames.forEach(function (fx) { liveGrid.appendChild(matchCard(fx, owners, now)); });
      host.appendChild(liveGrid);
    }

    // The day grid excludes whatever is already in the Live now band (dedup by id).
    var liveIds = {};
    liveGames.forEach(function (fx) { if (fx.id != null) liveIds[fx.id] = true; });
    var dayList = shown.filter(function (fx) { return !liveIds[fx.id]; });

    // Group by day: a full-width day header, then that day's matches in a grid
    // (2-up on desktop, 1-up on mobile). Keeping each day in its own grid means
    // an odd match count never leaves a hole that the next day bleeds into.
    var lastDay = null;
    var dayGrid = null;
    dayList.forEach(function (fx) {
      var d = fxDate(fx);
      var key = dayKey(d);
      if (key !== lastDay) {
        lastDay = key;
        var isToday = key === dayKey(now);
        host.appendChild(el("div", "day-head" + (isToday ? " today" : ""),
          fmtDay(d) + (isToday ? ' <span class="today-pill">Today</span>' : "")));
        dayGrid = el("div", "sched-day");
        host.appendChild(dayGrid);
      }
      dayGrid.appendChild(matchCard(fx, owners, now));
    });

    toggleJumpToday(fixtures, now);
    updateStickyHeads();

    // The Match Center opens via a single delegated [data-mc] click listener
    // (js/matchcenter.js), so a filter-only re-render needs no per-card
    // re-binding here.
  }

  /* Day headers are sticky but stay transparent in the flow (so they blend with
     the fixed background glow); they only frost once pinned. A header is "stuck"
     when its top reaches the sticky offset — toggle the class so CSS can react. */
  var STICK_AT = 57; // .day-head sticky top (56px) + 1px tolerance
  var stickyRaf = null;
  function updateStickyHeads() {
    stickyRaf = null;
    var heads = document.querySelectorAll("#schedule-list .day-head");
    for (var i = 0; i < heads.length; i++) {
      heads[i].classList.toggle("is-stuck", heads[i].getBoundingClientRect().top <= STICK_AT);
    }
  }
  function scheduleStickyUpdate() {
    if (stickyRaf == null) stickyRaf = requestAnimationFrame(updateStickyHeads);
  }

  /* Show the "Jump to today" shortcut only when there are matches today and the
     Today filter isn't already the active view. */
  function toggleJumpToday(fixtures, now) {
    var btn = document.querySelector("#schedule-filters [data-jump-today]");
    if (!btn) return;
    var hasToday = fixtures.some(function (fx) { return dayKey(fxDate(fx)) === dayKey(now); });
    btn.hidden = !hasToday || scheduleFilter === "today";
  }

  /* Scroll the Schedule to today's section, switching to the full list first if
     today's matches aren't in the current filter. */
  function jumpToToday() {
    var head = document.querySelector("#schedule-list .day-head.today");
    if (!head) {
      scheduleFilter = "all";
      document.querySelectorAll("#schedule-filters .chip[data-filter]").forEach(function (c) {
        c.classList.toggle("is-active", c.dataset.filter === "all");
      });
      renderSchedule(currentFixtures);
      head = document.querySelector("#schedule-list .day-head.today");
    }
    // If today's only matches are in play they sit in the "Live now" band (no
    // today day-header), so fall back to that band rather than no-op.
    var target = head || document.querySelector("#schedule-list .sched-live-head");
    if (!target) return;
    var y = target.getBoundingClientRect().top + window.pageYOffset - 64;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }

  /* "🟨2 🟥1 ⚠9" chip for one side of a fixture; empty when nothing to show. */
  function cardChips(c) {
    if (!c || (!c.y && !c.r && !c.f)) return "";
    var bits = [];
    if (c.y) bits.push("🟨" + c.y);
    if (c.r) bits.push("🟥" + c.r);
    if (c.f) bits.push("⚠" + c.f);
    return '<span class="m-cards">' + bits.join(" ") + "</span>";
  }

  /* One team's line inside a card: flag · name · (cards) · score.
     Scores only render once a match has them; winner/loser get emphasis
     on finished games (live and upcoming stay neutral). */
  function teamRow(team, goals, hasScore, win, lose, chips) {
    return '<div class="m-row' + (win ? " win" : "") + (lose ? " lose" : "") + '">' +
      '<span class="m-flag">' + team.flag + "</span>" +
      '<span class="m-name">' + esc(team.name) + "</span>" +
      (chips || "") +
      (hasScore ? '<span class="m-pts">' + goals + "</span>" : "") +
    "</div>";
  }

  function matchCard(fx, owners, now) {
    var st = statusInfo(fx);
    var owner = owners[fx.group];
    var card = el("div", "match" + (st.live ? " is-live" : "") + (st.done ? " is-done" : "") +
      (owner && owner.isMine ? " is-mine" : "") + (fx.exhibition ? " exh" : ""));
    if (fx.id) card.id = "sched-" + fx.id; // anchor for the rail's "full schedule" jump

    var hg = fx.homeGoals, ag = fx.awayGoals;
    var hasScore = hg != null && ag != null;
    // Winner emphasis only on finished games — a live 0–0 shouldn't dim anyone.
    var homeWin = !!(st.done && hasScore && hg > ag);
    var awayWin = !!(st.done && hasScore && ag > hg);

    // Upcoming games carry their kickoff time in the pill (the date sits in the
    // day header), so the row no longer needs a centre "TBD/time" column.
    var pillLabel = st.upcoming ? (fmtTime(fx) || "Upcoming") : st.label;
    var pill = '<span class="m-pill ' + st.key + (st.upcoming ? " time" : "") + '">' +
      (st.live ? '<span class="live-dot sm"></span>' : "") + pillLabel + "</span>";

    var rows =
      teamRow(fx.home, hg, hasScore, homeWin, awayWin, fx.cards ? cardChips(fx.cards.home) : "") +
      teamRow(fx.away, ag, hasScore, awayWin, homeWin, fx.cards ? cardChips(fx.cards.away) : "");

    var ownerChip = owner
      ? '<span class="owner-chip" style="--ac:' + (owner.accent || "#c89638") + '">⚽ ' + esc(owner.name) + (owner.isMine ? " ⭐" : "") + "</span>"
      : fx.exhibition
        ? '<span class="owner-chip empty">Not in the league draw — doesn\'t count</span>'
        : '<span class="owner-chip empty">Unclaimed</span>';

    // Calendar stays a useful utility on upcoming games. The in-app Match
    // Center (score, scorers, win-probability, live group table) is the primary
    // action on every game — it replaces the old ▶ Highlights link and
    // 📝 Recap modal; highlights now live inside the panel.
    var actions = "";
    if (!st.done && !st.live) {
      var cal = Live.calendarUrl(fx.home.name, fx.away.name, fx.group, fx.utcDate);
      if (cal) actions = '<a class="m-act ghost" target="_blank" rel="noopener" href="' + cal + '">＋ Calendar</a>';
    }
    actions += '<button type="button" class="m-act mc-act" data-mc="' + esc(fx.id) +
      '" aria-haspopup="dialog">📊 Match Center</button>';

    card.innerHTML =
      '<div class="m-meta"><span class="m-grp">Group ' + fx.group + " · MD" + fx.matchday + "</span>" + pill + "</div>" +
      '<div class="m-rows">' + rows + "</div>" +
      '<div class="m-foot">' + ownerChip + '<span class="m-actions">' + actions + "</span></div>";
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
      var jump = e.target.closest("[data-jump-today]");
      if (jump) { e.preventDefault(); jumpToToday(); return; }
      var chip = e.target.closest(".chip");
      if (!chip || !chip.dataset.filter) return;
      scheduleFilter = chip.dataset.filter;
      document.querySelectorAll("#schedule-filters .chip[data-filter]").forEach(function (c) {
        c.classList.toggle("is-active", c === chip);
      });
      renderSchedule(currentFixtures);
    });
    // The "my group" chip's label and visibility are owned by js/my-team.js.
    window.addEventListener("scroll", scheduleStickyUpdate, { passive: true });
    window.addEventListener("resize", scheduleStickyUpdate, { passive: true });
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
