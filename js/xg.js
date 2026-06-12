/* Expected Goals (xG) tab: a strength-based projection of the final
   draft order. Every remaining group-stage match gets an xG forecast
   from per-country Elo ratings — goal share follows Elo win expectancy,
   lopsided pairings inflate the total — then each group's remaining xG
   is scaled by a clamped form multiplier (actual goals vs the model's
   expectation on matches already played) and added to the goals banked.
   Cards are projected at blended pace purely as the tiebreak.

   Also exposes window.XG.remainingPace(ctx, letter) so the Pick Odds
   Monte Carlo can swap its flat tournament-average prior for a
   strength-aware one. Pure display plus one delegated click (team
   picker); renders into #xg-host. */

(function () {
  "use strict";

  /* ---------------- tuning constants ---------------- */

  var MATCH_GOALS = 2.6;     // expected total goals, evenly matched game
  var MISMATCH_BOOST = 0.8;  // extra total goals at maximum Elo mismatch
  var LAMBDA_MIN = 0.2;      // floor on one side's xG (nobody is hopeless)
  var LAMBDA_MAX = 3.6;      // cap on one side's xG (group stage, not FIFA 95)
  var FORM_PRIOR = 5.2;      // pseudo-goals anchoring the form multiplier (~2 matches)
  var FORM_MIN = 0.65;       // form multiplier clamp — cold group
  var FORM_MAX = 1.5;        // form multiplier clamp — hot group
  var INPLAY_W = 0.45;       // share of a live match's xG still to come
  var CARD_PRIOR_CPM = 4.4;  // prior card points (y + 2r) per group match
  var CARD_PRIOR_W = 3;      // card prior weight, in pseudo-matches
  var MINES_MAX = 5;         // remaining fixtures shown in Goal Mines
  var FALLBACK_AC = "#c89638";

  /* World Football Elo ratings (eloratings.net), spring 2026 snapshot.
     These are the model's only opinion about team strength — tweak any
     number, commit, and every projection re-derives itself. Keys must
     match the country names in js/data.js exactly. */
  var RATINGS = {
    /* B */ "Canada": 1790, "Bosnia & Herzegovina": 1610, "Qatar": 1570, "Switzerland": 1850,
    /* C */ "Brazil": 2030, "Morocco": 1940, "Haiti": 1465, "Scotland": 1740,
    /* D */ "United States": 1790, "Paraguay": 1810, "Australia": 1730, "Türkiye": 1850,
    /* E */ "Germany": 1940, "Curaçao": 1560, "Ivory Coast": 1700, "Ecuador": 1900,
    /* F */ "Netherlands": 1970, "Japan": 1880, "Sweden": 1730, "Tunisia": 1680,
    /* G */ "Belgium": 1920, "Egypt": 1760, "Iran": 1790, "New Zealand": 1600,
    /* H */ "Spain": 2180, "Cape Verde": 1620, "Saudi Arabia": 1640, "Uruguay": 1880,
    /* I */ "France": 2060, "Senegal": 1850, "Iraq": 1600, "Norway": 1950,
    /* J */ "Argentina": 2120, "Algeria": 1750, "Austria": 1860, "Jordan": 1640,
    /* K */ "Portugal": 2010, "DR Congo": 1690, "Uzbekistan": 1700, "Colombia": 1950,
    /* L */ "England": 2080, "Croatia": 1880, "Ghana": 1650, "Panama": 1690
  };

  var bound = false; // delegated listener attached once

  /* ---------------- the xG model ---------------- */

  function clampLambda(x) {
    return Math.min(Math.max(x, LAMBDA_MIN), LAMBDA_MAX);
  }

  /* xG for one fixture: win expectancy from the Elo gap sets each side's
     share of the goals; mismatches push the expected total up. */
  function fixtureXg(homeName, awayName) {
    var rh = RATINGS[homeName];
    var ra = RATINGS[awayName];
    if (rh == null || ra == null) {
      return { home: MATCH_GOALS / 2, away: MATCH_GOALS / 2, total: MATCH_GOALS };
    }
    var w = 1 / (1 + Math.pow(10, (ra - rh) / 400));
    var total = MATCH_GOALS + MISMATCH_BOOST * Math.abs(w - 0.5) * 2;
    var h = clampLambda(total * w);
    var a = clampLambda(total * (1 - w));
    return { home: h, away: a, total: h + a };
  }

  /* One group's model state: xG already resolved (finished matches plus
     the played share of live ones), xG still to come, and the remaining
     fixtures themselves. */
  function groupOutlook(ctx, letter) {
    var FIN = (window.Live && Live.FINISHED) || {};
    var INPLAY = (window.Live && Live.INPLAY) || {};
    var out = { playedXg: 0, played: 0, remainXg: 0, remainW: 0, remaining: [] };
    ctx.fixtures.forEach(function (fx) {
      if (fx.group !== letter) return;
      var xg = fixtureXg(fx.home.name, fx.away.name);
      if (FIN[fx.status]) {
        out.playedXg += xg.total;
        out.played += 1;
        return;
      }
      var w = INPLAY[fx.status] ? INPLAY_W : 1;
      out.playedXg += xg.total * (1 - w);
      out.remainXg += xg.total * w;
      out.remainW += w;
      out.remaining.push({ fx: fx, xg: xg, live: !!INPLAY[fx.status] });
    });
    return out;
  }

  /* Hot/cold adjustment: how a group's real goals compare with what the
     model expected from the matches already resolved, anchored by a
     prior and clamped so one wild day can't run away with it. */
  function formFactor(goals, playedXg) {
    var f = (goals + FORM_PRIOR) / (playedXg + FORM_PRIOR);
    return Math.min(Math.max(f, FORM_MIN), FORM_MAX);
  }

  /* Strength-aware prior for the Monte Carlo: the model's expected total
     goals per remaining match in this group (un-adjusted for form — the
     caller already blends in observed pace). */
  function remainingPace(ctx, letter) {
    var o = groupOutlook(ctx, letter);
    if (!o.remainW) return MATCH_GOALS;
    return o.remainXg / o.remainW;
  }

  /* ---------------- projection ---------------- */

  function buildProjection(ctx) {
    var rows = ctx.standings.map(function (row) {
      var o = groupOutlook(ctx, row.group.letter);
      var factor = formFactor(row.goals, o.playedXg);
      var adjRemain = o.remainXg * factor;
      var cardRate = (row.cardPoints + CARD_PRIOR_CPM * CARD_PRIOR_W) / (o.played + CARD_PRIOR_W);
      return {
        team: row.team,
        letter: row.group.letter,
        nowRank: row.rank,
        goals: row.goals,
        remainXg: adjRemain,
        proj: row.goals + adjRemain,
        projCards: row.cardPoints + cardRate * o.remainW,
        factor: factor,
        remaining: o.remaining
      };
    });

    var sorted = rows.slice().sort(function (a, b) {
      return (b.proj - a.proj) || (b.projCards - a.projCards) || (a.nowRank - b.nowRank);
    });
    return sorted.map(function (r, i) {
      return Object.assign({}, r, { projRank: i + 1, delta: r.nowRank - (i + 1) });
    });
  }

  /* Remaining fixtures across all claimed groups, biggest expected
     goal-hauls first — the matches that swing the draft. */
  function goalMines(rows) {
    var mines = [];
    rows.forEach(function (r) {
      r.remaining.forEach(function (rem) {
        mines.push({ team: r.team, fx: rem.fx, xg: rem.xg, live: rem.live });
      });
    });
    return mines.sort(function (a, b) { return b.xg.total - a.xg.total; }).slice(0, MINES_MAX);
  }

  /* ---------------- formatting ---------------- */

  function fmt1(x) { return x.toFixed(1); }

  function moveHtml(delta, ord) {
    if (delta > 0) return '<span class="xg-move up">▲' + delta + "</span>";
    if (delta < 0) return '<span class="xg-move down">▼' + (-delta) + "</span>";
    return '<span class="xg-move flat">—</span>';
  }

  function findMine(rows) {
    var mine = null;
    rows.forEach(function (r) { if (r.team.isMine) mine = r; });
    return mine;
  }

  /* ---------------- hero cards ---------------- */

  function cardHtml(label, value, detail, cls) {
    return '<div class="xg-card">' +
      '<div class="xg-card-label">' + label + "</div>" +
      '<div class="xg-card-value' + (cls ? " " + cls : "") + '">' + value + "</div>" +
      '<div class="xg-card-detail">' + detail + "</div>" +
      "</div>";
  }

  function heroHtml(ctx, rows) {
    var esc = ctx.helpers.esc;
    var ord = ctx.helpers.ordinal;
    var top = rows[0];
    var cards = cardHtml("Projected No. 1 pick", esc(top.team.name), "name") === "" ? "" : "";

    var first = cardHtml("Projected No. 1 pick", esc(top.team.name),
      "proj " + fmt1(top.proj) + " goals · now " + top.nowRank + ord(top.nowRank), "name");

    var mine = findMine(rows);
    var second;
    if (mine) {
      var arrow = mine.delta > 0 ? " · ▲" + mine.delta : mine.delta < 0 ? " · ▼" + (-mine.delta) : " · steady";
      second = cardHtml("Your projected pick", mine.projRank + ord(mine.projRank),
        "⭐ " + esc(mine.team.name) + " · now " + mine.nowRank + ord(mine.nowRank) + arrow);
    } else {
      var hint = window.MyTeam
        ? '<button type="button" class="xg-link" data-xg-act="pick">Pick your team</button> to see your projection'
        : "no team selected";
      second = cardHtml("Your projected pick", "&mdash;", hint, "dim");
    }

    var mover = null;
    rows.forEach(function (r) {
      if (r.delta !== 0 && (!mover || Math.abs(r.delta) > Math.abs(mover.delta))) mover = r;
    });
    var third = mover
      ? cardHtml("Biggest projected mover",
          (mover.delta > 0 ? "▲" : "▼") + Math.abs(mover.delta),
          esc(mover.team.name) + " · " + mover.nowRank + ord(mover.nowRank) +
            " → " + mover.projRank + ord(mover.projRank),
          mover.delta > 0 ? "up" : "down")
      : cardHtml("Biggest projected mover", "&mdash;", "projection matches the live board", "dim");

    return '<section class="xg-block"><div class="xg-cards">' +
      first + second + third + "</div></section>";
  }

  /* ---------------- projected board ---------------- */

  function boardHtml(ctx, rows) {
    var esc = ctx.helpers.esc;
    var ord = ctx.helpers.ordinal;
    var maxProj = rows.reduce(function (m, r) { return Math.max(m, r.proj); }, 1);

    var body = rows.map(function (r) {
      var bankedPct = Math.min((r.goals / maxProj) * 100, 100);
      var expPct = Math.min((r.remainXg / maxProj) * 100, 100 - bankedPct);
      return '<div class="xg-row' + (r.team.isMine ? " mine" : "") +
          '" style="--xg-ac:' + esc(r.team.accent || FALLBACK_AC) + '">' +
        '<span class="xg-rank">' + r.projRank + "<small>" + ord(r.projRank) + "</small></span>" +
        moveHtml(r.delta, ord) +
        '<span class="xg-team"><span class="xg-name">' + esc(r.team.name) +
          (r.team.isMine ? " ⭐" : "") + "</span>" +
          '<span class="xg-sub"><span class="xg-grp">' + esc(r.letter) + "</span> now " +
          r.nowRank + ord(r.nowRank) + "</span></span>" +
        '<span class="xg-bar"><span class="xg-bar-banked" style="width:' + bankedPct.toFixed(1) +
          '%"></span><span class="xg-bar-exp" style="width:' + expPct.toFixed(1) + '%"></span></span>' +
        '<span class="xg-proj">' + fmt1(r.proj) +
          "<small>" + r.goals + " + " + fmt1(r.remainXg) + " xG</small></span>" +
        "</div>";
    }).join("");

    return '<section class="xg-block">' +
      '<div class="xg-head">📈 Projected Final Board</div>' +
      '<div class="xg-board">' + body + "</div>" +
      '<p class="xg-foot">Projected goals = goals banked (solid) + Elo-based xG for every remaining ' +
        "match, scaled by group form (striped). Arrows compare with the live board.</p>" +
      "</section>";
  }

  /* ---------------- goal mines ---------------- */

  function minesHtml(ctx, rows) {
    var esc = ctx.helpers.esc;
    var mines = goalMines(rows);
    if (!mines.length) return "";

    var body = mines.map(function (m) {
      var fx = m.fx;
      var when = m.live
        ? '<span class="xg-mine-live">● LIVE</span>'
        : esc(ctx.helpers.fmtDay(ctx.helpers.fxDate(fx)));
      return '<div class="xg-mine" style="--xg-ac:' + esc(m.team.accent || FALLBACK_AC) + '">' +
        '<span class="xg-mine-match">' + fx.home.flag + " " + esc(fx.home.name) +
          " <em>v</em> " + esc(fx.away.name) + " " + fx.away.flag + "</span>" +
        '<span class="xg-mine-xg">xG ' + fmt1(m.xg.home) + "–" + fmt1(m.xg.away) + "</span>" +
        '<span class="xg-mine-meta">' + when +
          ' <span class="xg-mine-owner">⚽ ' + esc(m.team.abbr) + "</span></span>" +
        "</div>";
    }).join("");

    return '<section class="xg-block">' +
      '<div class="xg-head">⛏️ Goal Mines · biggest matches left</div>' +
      '<div class="xg-mines">' + body + "</div>" +
      '<p class="xg-foot">The remaining fixtures with the most expected goals in them — these swing the draft.</p>' +
      "</section>";
  }

  /* ---------------- render ---------------- */

  function bannerHtml(ctx, rows) {
    var FIN = (window.Live && Live.FINISHED) || {};
    var finished = ctx.fixtures.filter(function (fx) { return FIN[fx.status]; }).length;
    if (finished === 0) {
      return '<div class="xg-banner">Pre-tournament projection — pure Elo xG, no goals banked yet.</div>';
    }
    var anyLeft = rows.some(function (r) { return r.remaining.length > 0; });
    if (!anyLeft) {
      return '<div class="xg-banner">Group stage complete — the projection IS the final board.</div>';
    }
    return "";
  }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest("[data-xg-act]") : null;
    if (!btn) return;
    if (btn.getAttribute("data-xg-act") === "pick" &&
        window.MyTeam && typeof MyTeam.open === "function") {
      MyTeam.open();
    }
  }

  function render(ctx) {
    var host = document.getElementById("xg-host");
    if (!host) return;
    try {
      if (!bound) {
        host.addEventListener("click", onClick);
        bound = true;
      }
      if (!ctx || !ctx.standings || !ctx.standings.length) {
        host.innerHTML = '<p class="xg-empty">Waiting for draft data…</p>';
        return;
      }
      var rows = buildProjection(ctx);
      host.innerHTML = '<div class="xg-wrap">' +
        bannerHtml(ctx, rows) +
        heroHtml(ctx, rows) +
        boardHtml(ctx, rows) +
        minesHtml(ctx, rows) +
        '<p class="xg-method">Elo-based xG · goal share follows win expectancy · lopsided games raise the ' +
          "total · group form multiplier ×" + FORM_MIN + "–" + FORM_MAX +
          " · ratings hand-tunable in js/xg.js</p>" +
        "</div>";
    } catch (err) {
      console.error("xG render failed:", err);
    }
  }

  window.XG = { fixtureXg: fixtureXg, remainingPace: remainingPace, RATINGS: RATINGS };

  if (window.Hub && typeof window.Hub.onRender === "function") Hub.onRender(render);
})();
