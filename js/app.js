/* Renders the draft board and group cards from LEAGUE / TEAMS / GROUPS. */

(function () {
  "use strict";

  /* ---------- derive ---------- */

  function groupGoals(g) { return g.countries.reduce(function (s, c) { return s + c.goals; }, 0); }
  function groupCardPoints(g) { return g.countries.reduce(function (s, c) { return s + c.yellows + c.reds * 2; }, 0); }
  function groupCards(g) {
    return g.countries.reduce(function (a, c) { return { y: a.y + c.yellows, r: a.r + c.reds }; }, { y: 0, r: 0 });
  }

  function buildStandings() {
    var rows = TEAMS.map(function (t) {
      var g = GROUPS[t.group];
      if (!g) throw new Error("Team '" + t.name + "' has unknown group '" + t.group + "'");
      return { team: t, group: g, goals: groupGoals(g), cardPoints: groupCardPoints(g), cards: groupCards(g) };
    });

    /* Most goals first; tiebreaker = MORE card points wins (yellow +1, red +2). */
    var sorted = rows.slice().sort(function (a, b) {
      if (b.goals !== a.goals) return b.goals - a.goals;
      return b.cardPoints - a.cardPoints;
    });

    return sorted.map(function (row, i) {
      var same = function (o) { return o && o.goals === row.goals && o.cardPoints === row.cardPoints; };
      return Object.assign({}, row, {
        rank: i + 1,
        tied: same(sorted[i - 1]) || same(sorted[i + 1])
      });
    });
  }

  function seasonStarted() {
    return Object.keys(GROUPS).some(function (k) {
      return groupGoals(GROUPS[k]) > 0 || groupCardPoints(GROUPS[k]) > 0;
    });
  }

  /* ---------- helpers ---------- */

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

  function crestHtml(team) {
    var lenCls = team.abbr.length >= 4 ? " len4" : team.abbr.length <= 1 ? " len1" : "";
    var inner;
    if (team.photo) {
      inner =
        '<img src="' + esc(team.photo) + '" alt="' + esc(team.name) + '" ' +
        "onerror=\"this.replaceWith(Object.assign(document.createElement('span'),{className:'mono',textContent:'" +
        esc(team.abbr) + "'}))\" />";
    } else {
      inner = '<span class="mono">' + esc(team.abbr) + "</span>";
    }
    var bg = team.accent
      ? ' style="background:radial-gradient(circle at 32% 28%, ' + team.accent + ', #140d05)"'
      : "";
    return '<div class="crest' + lenCls + '"' + bg + ">" + inner + "</div>";
  }

  function flagStrip(group) {
    return '<span class="flag-strip">' +
      group.countries.map(function (c) { return "<span>" + c.flag + "</span>"; }).join("") +
      "</span>";
  }

  /* ---------- render: draft board ---------- */

  function renderBoard(standings, started) {
    var list = document.getElementById("board-list");
    list.textContent = "";

    standings.forEach(function (row, i) {
      var t = row.team;
      var li = el("li", "row" +
        (started && row.rank === 1 ? " is-first" : "") +
        (t.isMine ? " is-mine" : ""));
      li.style.animationDelay = (i * 45) + "ms";
      if (t.accent) li.style.setProperty("--row-accent", t.accent);

      var rankCls = "rank" + (started ? "" : " prov");
      var rankInner = started
        ? row.rank + "<small>" + ordinal(row.rank) + "</small>"
        : "&ndash;";

      var managers = t.managers.join(" &amp; ");
      var tie = row.tied && started ? '<span class="tie-flag">Tied</span>' : "";

      li.innerHTML =
        '<div class="' + rankCls + '">' + rankInner + "</div>" +
        crestHtml(t) +
        '<div class="team">' +
          '<div class="team-top">' +
            '<span class="team-name">' + esc(t.name) + "</span>" +
            '<span class="div-badge div-' + esc(t.division) + '">' + esc(t.division) + "</span>" +
            tie +
          "</div>" +
          '<div class="team-managers">' + managers + "</div>" +
          '<div class="team-group">' +
            '<span class="group-chip">Group ' + row.group.letter + "</span>" +
            flagStrip(row.group) +
          "</div>" +
        "</div>" +
        '<div class="stats">' +
          '<span class="goals">' + row.goals + "</span>" +
          '<span class="goals-label">Group Goals</span>' +
          '<div class="tb">🟨 ' + row.cards.y + " · 🟥 " + row.cards.r + " · TB " + row.cardPoints + "</div>" +
        "</div>";

      list.appendChild(li);
    });
  }

  /* ---------- render: groups ---------- */

  function renderGroups() {
    var grid = document.getElementById("groups-grid");
    grid.textContent = "";

    var owner = {};
    TEAMS.forEach(function (t) { owner[t.group] = t; });

    Object.keys(GROUPS).forEach(function (letter) {
      var g = GROUPS[letter];
      var t = owner[letter];
      var card = el("div", "gcard" + (t ? "" : " unclaimed") + (t && t.isMine ? " mine" : ""));

      var head = el("div", "ghead");
      head.innerHTML =
        '<div class="gletter">' + letter + "</div>" +
        '<div class="gowner' + (t ? "" : " empty") + '">' +
          "<small>" + (t ? "Drafted by" : "Unclaimed") + "</small>" +
          "<b>" + (t ? esc(t.name) : "—") + "</b>" +
        "</div>";
      card.appendChild(head);

      g.countries.forEach(function (c) {
        var bar = el("div", "cbar");
        bar.style.background = "linear-gradient(105deg, " + c.c1 + " 0%, " + c.c2 + " 100%)";
        bar.innerHTML =
          '<span class="cflag">' + c.flag + "</span>" +
          '<span class="cname">' + esc(c.name) + "</span>" +
          '<span class="cgoals">' + c.goals + " ⚽</span>";
        card.appendChild(bar);
      });

      var cards = groupCards(g);
      card.appendChild(el("div", "gtotal",
        "<span>🟨 " + cards.y + " · 🟥 " + cards.r + " · TB " + groupCardPoints(g) + "</span>" +
        "<span>Goals <b>" + groupGoals(g) + "</b></span>"));

      grid.appendChild(card);
    });
  }

  /* ---------- render: meta + banner ---------- */

  function renderMeta(started) {
    var meta = document.getElementById("hero-meta");
    meta.innerHTML =
      '<span class="hero-pill"><b>10</b> teams</span>' +
      '<span class="hero-pill"><b>11</b> groups · 1 unclaimed</span>' +
      '<span class="hero-pill">Updated <b>' + esc(LEAGUE.lastUpdated) + "</b></span>";

    var banner = document.getElementById("banner");
    if (!started) {
      banner.hidden = false;
      banner.innerHTML =
        "⚽ <b>Group stage hasn't kicked off yet.</b> Every team sits at 0 goals — " +
        "the board goes live and re-ranks the moment goals start landing.";
    }

    document.getElementById("draw-note").textContent = LEAGUE.drawNote;
  }

  /* ---------- boot ---------- */

  try {
    var started = seasonStarted();
    renderBoard(buildStandings(), started);
    renderGroups();
    renderMeta(started);
  } catch (err) {
    document.getElementById("board-list").innerHTML =
      '<li class="row"><div></div><div></div><div class="team">' +
      '<div class="team-name">Data error</div>' +
      '<div class="team-managers">' + esc(err.message) + "</div></div><div></div></li>";
  }
})();
