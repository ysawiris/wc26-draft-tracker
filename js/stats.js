/* Stats & Records tab: wire-report headlines, the record book,
   per-team group runway and goals-by-matchday bars — all derived
   from the latest Hub ctx. Pure display: no listeners, the host is
   fully rebuilt on every render so repeated calls are safe. */

(function () {
  "use strict";

  var WAIT = "waiting for kickoff";

  /* ---------------- small utils ---------------- */

  function plural(n, one, many) { return n === 1 ? one : many; }

  function isFinished(fx) { return !!Live.FINISHED[fx.status]; }
  function isInPlay(fx) { return !!Live.INPLAY[fx.status]; }
  function isCounted(fx) { return isFinished(fx) || isInPlay(fx); }
  function hasScore(fx) { return fx.homeGoals != null && fx.awayGoals != null; }

  /* A group's six fixtures, in kickoff order. */
  function groupFixtures(ctx, letter) {
    return ctx.fixtures
      .filter(function (fx) { return fx.group === letter; })
      .slice()
      .sort(function (a, b) { return ctx.helpers.fxDate(a) - ctx.helpers.fxDate(b); });
  }

  function sortedByKickoff(ctx) {
    return ctx.fixtures.slice().sort(function (a, b) {
      return ctx.helpers.fxDate(a) - ctx.helpers.fxDate(b);
    });
  }

  function findMineRow(ctx) {
    var mine = null;
    ctx.standings.forEach(function (r) { if (r.team.isMine) mine = r; });
    return mine;
  }

  /* ---------------- headlines (in-tournament) ---------------- */

  function leaderLine(ctx) {
    var esc = ctx.helpers.esc;
    var top = ctx.standings[0];
    var second = ctx.standings[1];
    if (!top) return null;
    var topName = "<b>" + esc(top.team.name) + "</b>";

    if (second && second.goals === top.goals && second.cardPoints === top.cardPoints) {
      return topName + " and <b>" + esc(second.team.name) + "</b> are deadlocked at the top on " +
        top.goals + " " + plural(top.goals, "goal", "goals") +
        " — somebody's group needs to start scoring (or fouling).";
    }
    if (second && second.goals === top.goals) {
      return topName + " holds the No. 1 pick on cards alone — level with <b>" +
        esc(second.team.name) + "</b> at " + top.goals + " " + plural(top.goals, "goal", "goals") + ".";
    }
    if (second) {
      var gap = top.goals - second.goals;
      return topName + " holds the No. 1 pick with " + top.goals + " " + plural(top.goals, "goal", "goals") +
        " — " + (gap >= 3
          ? "daylight to 2nd."
          : "just " + gap + " " + plural(gap, "goal", "goals") + " clear of <b>" + esc(second.team.name) + "</b>.");
    }
    return topName + " holds the No. 1 pick with " + top.goals + " " + plural(top.goals, "goal", "goals") + ".";
  }

  function tightestGapLine(ctx) {
    var esc = ctx.helpers.esc;
    var s = ctx.standings;
    var best = null;
    for (var i = 1; i < 4 && i + 1 < s.length; i++) {
      var g = s[i].goals - s[i + 1].goals;
      if (best === null || g < best.gap) best = { gap: g, hi: s[i], lo: s[i + 1] };
    }
    if (!best) return null;
    if (best.gap === 0) {
      return "<b>" + esc(best.hi.team.name) + "</b> and <b>" + esc(best.lo.team.name) +
        "</b> are dead level at " + best.hi.goals + " — that's exactly what the card tiebreaker is for.";
    }
    return "Tightest squeeze in the top half: " + best.gap + " " + plural(best.gap, "goal", "goals") +
      " between <b>" + esc(best.hi.team.name) + "</b> (" + best.hi.rank + ctx.helpers.ordinal(best.hi.rank) +
      ") and <b>" + esc(best.lo.team.name) + "</b>.";
  }

  function dirtiestLine(ctx) {
    var esc = ctx.helpers.esc;
    var dirty = null;
    Object.keys(ctx.groups).forEach(function (letter) {
      var pts = ctx.helpers.groupCardPoints(ctx.groups[letter]);
      if (pts > 0 && (!dirty || pts > dirty.pts)) {
        dirty = {
          letter: letter, pts: pts,
          cards: ctx.helpers.groupCards(ctx.groups[letter]),
          fouls: ctx.helpers.groupFouls(ctx.groups[letter])
        };
      }
    });
    if (!dirty) return null;
    var owner = ctx.helpers.ownerByGroup()[dirty.letter];
    var foulTail = dirty.fouls > 0
      ? " off " + dirty.fouls + " " + plural(dirty.fouls, "foul", "fouls")
      : "";
    return "Group " + dirty.letter + (owner ? " (<b>" + esc(owner.name) + "</b>)" : " (unclaimed)") +
      " has racked up " + dirty.pts + " card " + plural(dirty.pts, "point", "points") +
      " — 🟨 " + dirty.cards.y + " · 🟥 " + dirty.cards.r + foulTail +
      ". The tiebreaker nobody wants to need.";
  }

  function unclaimedLine(ctx) {
    // Spotlight whichever unclaimed group (A or I) is out-scoring the most
    // drafted teams — both went undrafted, both still count.
    var owners = ctx.helpers.ownerByGroup();
    var best = null;
    Object.keys(ctx.groups).forEach(function (L) {
      if (owners[L]) return;
      var goals = ctx.helpers.groupGoals(ctx.groups[L]);
      if (!best || goals > best.goals) best = { letter: L, goals: goals };
    });
    if (!best || best.goals <= 0) return null;
    var beaten = ctx.standings.filter(function (r) { return r.goals < best.goals; }).length;
    if (beaten <= 0) return null;
    return "Unclaimed Group " + best.letter + " has " + best.goals + " " + plural(best.goals, "goal", "goals") +
      " — more than " + beaten + " drafted " + plural(beaten, "team", "teams") + " 💀";
  }

  function mineLine(ctx) {
    var esc = ctx.helpers.esc;
    var row = findMineRow(ctx);
    if (!row) return null;
    var name = "<b>" + esc(row.team.name) + "</b>";
    var left = groupFixtures(ctx, row.group.letter).filter(function (fx) { return !isFinished(fx); }).length;
    if (left === 0) {
      return "⭐ " + name + " finishes " + row.rank + ctx.helpers.ordinal(row.rank) +
        " with " + row.goals + " " + plural(row.goals, "goal", "goals") + " — Group " +
        row.group.letter + " has done all it can.";
    }
    if (row.rank === 1) {
      return "⭐ That No. 1 pick is " + name + "'s to lose — " + left + " group " +
        plural(left, "game", "games") + " left to protect it.";
    }
    return "⭐ " + name + " sits " + row.rank + ctx.helpers.ordinal(row.rank) + " with " +
      row.goals + " " + plural(row.goals, "goal", "goals") + " — " + left + " group " +
      plural(left, "game", "games") + " left to climb.";
  }

  function liveLines(ctx) {
    var lines = [];
    [leaderLine, tightestGapLine, dirtiestLine, unclaimedLine, mineLine].forEach(function (fn) {
      var line = fn(ctx);
      if (line) lines.push(line);
    });
    return lines;
  }

  /* ---------------- headlines (pre-season) ---------------- */

  function preseasonLines(ctx) {
    var esc = ctx.helpers.esc;
    var lines = [];
    var ordered = sortedByKickoff(ctx);
    var first = ordered[0];
    var now = new Date();

    if (first) {
      var firstDate = ctx.helpers.fxDate(first);
      var days = Math.max(Math.ceil((firstDate - now) / 86400000), 0);
      if (ctx.helpers.dayKey(firstDate) === ctx.helpers.dayKey(now) || days === 0) {
        lines.push("<b>It's kickoff day.</b> First goals land today and this board finally starts moving.");
      } else if (days === 1) {
        lines.push("Kickoff is <b>tomorrow</b>. Sleep is for teams that already have the No. 1 pick.");
      } else {
        lines.push("<b>" + days + " days</b> until the group stage kicks off. The trash-talk window is officially open.");
      }
    }

    lines.push("All " + ctx.teams.length + " teams sit level at <b>zero</b> — " +
      ctx.fixtures.length + " matches to decide who picks first.");

    if (first) {
      var firstKey = ctx.helpers.dayKey(ctx.helpers.fxDate(first));
      var letters = [];
      ordered.forEach(function (fx) {
        if (ctx.helpers.dayKey(ctx.helpers.fxDate(fx)) === firstKey && letters.indexOf(fx.group) < 0) {
          letters.push(fx.group);
        }
      });
      var owners = ctx.helpers.ownerByGroup();
      var names = letters.map(function (L) {
        return owners[L] ? "<b>" + esc(owners[L].name) + "</b>" : "absolutely nobody (Group " + L + ")";
      });
      lines.push(plural(letters.length, "Group ", "Groups ") + letters.join(" & ") +
        " open day one — " + names.join(" and ") + " on the clock first.");
    }

    var mine = null;
    ctx.teams.forEach(function (t) { if (t.isMine) mine = t; });
    if (mine && ctx.groups[mine.group]) {
      var mfx = ordered.filter(function (fx) { return fx.group === mine.group; })[0];
      var flags = ctx.groups[mine.group].countries.map(function (c) { return c.flag; }).join(" ");
      var when = mfx ? ctx.helpers.fmtDay(ctx.helpers.fxDate(mfx)) : "soon";
      lines.push("⭐ <b>" + esc(mine.name) + "</b> watch: Group " + esc(mine.group) +
        " (" + flags + ") opens " + when + ".");
    }

    var gOwners = ctx.helpers.ownerByGroup();
    Object.keys(ctx.groups).forEach(function (L) {
      if (gOwners[L]) return; // drafted — has an owner
      var names = ctx.groups[L].countries.slice(0, 2).map(function (c) { return esc(c.name); }).join(" and ");
      lines.push("Group " + L + " went undrafted — " + names + " will be banging in goals for absolutely nobody.");
    });

    return lines;
  }

  function headlinesHtml(ctx) {
    var lines = (ctx.started ? liveLines(ctx) : preseasonLines(ctx)).slice(0, 5);
    var items = lines.map(function (line) { return '<li class="st-line">' + line + "</li>"; }).join("");
    return '<section class="st-block">' +
      '<div class="st-head">📡 Wire Report</div>' +
      '<div class="st-headlines"><ul class="st-lines">' + items + "</ul></div>" +
      "</section>";
  }

  /* ---------------- record book ---------------- */

  function cardHtml(label, value, detail, dim) {
    return '<div class="st-card">' +
      '<div class="st-card-label">' + label + "</div>" +
      '<div class="st-card-value' + (dim ? " dim" : "") + '">' + value + "</div>" +
      '<div class="st-card-detail">' + detail + "</div>" +
      "</div>";
  }

  function topGroupCard(ctx) {
    var esc = ctx.helpers.esc;
    var best = null;
    Object.keys(ctx.groups).forEach(function (L) {
      var goals = ctx.helpers.groupGoals(ctx.groups[L]);
      if (!best || goals > best.goals) best = { letter: L, goals: goals };
    });
    if (!best || best.goals === 0) return cardHtml("Top group", "&mdash;", WAIT, true);
    var owner = ctx.helpers.ownerByGroup()[best.letter];
    return cardHtml("Top group", best.goals,
      "Group " + best.letter + " · " + (owner ? esc(owner.name) : "Unclaimed"));
  }

  function topCountryCard(ctx) {
    var esc = ctx.helpers.esc;
    var best = null;
    Object.keys(ctx.groups).forEach(function (L) {
      ctx.groups[L].countries.forEach(function (c) {
        if (!best || c.goals > best.goals) best = { country: c, letter: L, goals: c.goals };
      });
    });
    if (!best || best.goals === 0) return cardHtml("Top scorer", "&mdash;", WAIT, true);
    return cardHtml("Top scorer", best.goals,
      best.country.flag + " " + esc(best.country.name) + " · Group " + best.letter);
  }

  function dirtiestCard(ctx) {
    var best = null;
    Object.keys(ctx.groups).forEach(function (L) {
      var pts = ctx.helpers.groupCardPoints(ctx.groups[L]);
      if (!best || pts > best.pts) best = { letter: L, pts: pts, cards: ctx.helpers.groupCards(ctx.groups[L]) };
    });
    if (!best || best.pts === 0) {
      return cardHtml("Dirtiest group", "&mdash;", ctx.started ? "all clean so far" : WAIT, true);
    }
    return cardHtml("Dirtiest group", best.pts,
      "Group " + best.letter + " · 🟨 " + best.cards.y + " · 🟥 " + best.cards.r);
  }

  function mostFoulsCard(ctx) {
    var esc = ctx.helpers.esc;
    var best = null;
    Object.keys(ctx.groups).forEach(function (L) {
      var fouls = ctx.helpers.groupFouls(ctx.groups[L]);
      if (!best || fouls > best.fouls) best = { letter: L, fouls: fouls };
    });
    if (!best || best.fouls === 0) {
      return cardHtml("Most fouls", "&mdash;", ctx.started ? "clean game so far" : WAIT, true);
    }
    var owner = ctx.helpers.ownerByGroup()[best.letter];
    return cardHtml("Most fouls", best.fouls,
      "Group " + best.letter + " · " + (owner ? esc(owner.name) : "Unclaimed"));
  }

  function biggestMatchCard(ctx) {
    var esc = ctx.helpers.esc;
    var best = null;
    ctx.fixtures.forEach(function (fx) {
      if (!isCounted(fx) || !hasScore(fx)) return;
      var total = fx.homeGoals + fx.awayGoals;
      if (!best || total > best.total) best = { fx: fx, total: total };
    });
    if (!best) return cardHtml("Highest-scoring match", "&mdash;", WAIT, true);
    var fx = best.fx;
    return cardHtml("Highest-scoring match", best.total,
      fx.home.flag + " " + esc(fx.home.name) + " " + fx.homeGoals + "–" + fx.awayGoals +
      " " + esc(fx.away.name) + " " + fx.away.flag);
  }

  function totalGoalsCard(ctx) {
    var total = Object.keys(ctx.groups).reduce(function (sum, L) {
      return sum + ctx.helpers.groupGoals(ctx.groups[L]);
    }, 0);
    var played = ctx.fixtures.filter(isFinished).length;
    return cardHtml("Total goals", total,
      played + " of " + ctx.fixtures.length + " matches played", total === 0);
  }

  function goalsPerMatchCard(ctx) {
    var count = 0;
    var sum = 0;
    ctx.fixtures.forEach(function (fx) {
      if (!isCounted(fx) || !hasScore(fx)) return;
      count += 1;
      sum += fx.homeGoals + fx.awayGoals;
    });
    if (count === 0) return cardHtml("Goals per match", "&mdash;", WAIT, true);
    return cardHtml("Goals per match", (sum / count).toFixed(1),
      "across " + count + " " + plural(count, "match", "matches") + " with a result");
  }

  function recordsHtml(ctx) {
    var cards = [
      topGroupCard(ctx),
      topCountryCard(ctx),
      dirtiestCard(ctx),
      mostFoulsCard(ctx),
      biggestMatchCard(ctx),
      totalGoalsCard(ctx),
      goalsPerMatchCard(ctx)
    ].join("");
    return '<section class="st-block">' +
      '<div class="st-head">📜 Record Book</div>' +
      '<div class="st-cards">' + cards + "</div>" +
      "</section>";
  }

  /* ---------------- group runway ---------------- */

  function runwayRow(ctx, row) {
    var esc = ctx.helpers.esc;
    var segs = groupFixtures(ctx, row.group.letter).map(function (fx) {
      var cls = isFinished(fx) ? " done" : isInPlay(fx) ? " live" : "";
      return '<span class="st-seg' + cls + '"></span>';
    }).join("");
    var accent = esc(row.team.accent || "#c89638");
    return '<div class="st-run' + (row.team.isMine ? " mine" : "") + '" style="--st-ac:' + accent + '">' +
      '<span class="st-run-name">' + esc(row.team.name) + (row.team.isMine ? " ⭐" : "") + "</span>" +
      '<span class="st-chip">Grp ' + esc(row.group.letter) + "</span>" +
      '<span class="st-segs">' + segs + "</span>" +
      '<span class="st-run-goals">' + row.goals + " " + plural(row.goals, "goal", "goals") + "</span>" +
      "</div>";
  }

  function runwayHtml(ctx) {
    var rows = ctx.standings.map(function (row) { return runwayRow(ctx, row); }).join("");
    return '<section class="st-block">' +
      '<div class="st-head">🛫 Group Runway</div>' +
      '<div class="st-runway">' + rows +
        '<p class="st-foot">Six group games per team — filled segments are in the books.</p>' +
      "</div></section>";
  }

  /* ---------------- goals by matchday ---------------- */

  function matchdayHtml(ctx) {
    var totals = [1, 2, 3].map(function (md) {
      return ctx.fixtures.reduce(function (sum, fx) {
        if (fx.matchday !== md || !isCounted(fx) || !hasScore(fx)) return sum;
        return sum + fx.homeGoals + fx.awayGoals;
      }, 0);
    });
    var max = Math.max(totals[0], totals[1], totals[2]);
    var rows = totals.map(function (t, i) {
      var pct = max > 0 ? Math.max(Math.round((t / max) * 100), 3) : 3;
      return '<div class="st-md-row">' +
        '<span class="st-md-label">MD' + (i + 1) + "</span>" +
        '<div class="st-md-track"><div class="st-md-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="st-md-count">' + t + "</span>" +
        "</div>";
    }).join("");
    return '<section class="st-block">' +
      '<div class="st-head">⚽ Goals by Matchday</div>' +
      '<div class="st-md">' + rows +
        '<p class="st-foot">League-wide goals across all 12 groups, by group-stage matchday.</p>' +
      "</div></section>";
  }

  /* ---------------- render ---------------- */

  function render(ctx) {
    var host = document.getElementById("stats-host");
    if (!host) return;
    host.innerHTML = '<div class="st-wrap">' +
      headlinesHtml(ctx) +
      recordsHtml(ctx) +
      runwayHtml(ctx) +
      matchdayHtml(ctx) +
      "</div>";
  }

  if (window.Hub) Hub.onRender(render);
})();
