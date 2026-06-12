/* Pick Odds tab v3: a market-aware Monte Carlo forecast of the
   final draft order. Fixtures with a bookmaker total (data/odds.json,
   DraftKings via the fetcher) use the market-implied expected goals
   directly; every other remaining fixture gets an Elo-informed goal
   rate (per-country att/def ratings) scaled by its group's observed
   scoring pace. In-play matches simulate only the minutes left on
   the clock. Per sim the 10 teams are ranked with the real board
   comparator (goals desc, card points desc, coin-flip ties).
   Results are cached on a fingerprint of the observed totals, the
   live minutes and the market snapshot, so the forecast ticks over
   during matches and on line refreshes while idle 2-minute
   re-renders reuse the cache. Daily No. 1 snapshots persist in
   localStorage for movement chips and sparklines. Pure display, no
   listeners; renders into #odds-host. */

(function () {
  "use strict";

  /* ---------------- tuning constants ---------------- */

  var MAX_SIMS = 5000;       // target simulation count
  var CHUNK = 500;           // sims between wall-clock checks (also the floor)
  var TIME_BUDGET_MS = 80;   // stop adding chunks once we've spent this long
  var AVG_DEF = 1.25;        // league-average def rating (lambda normalizer)
  var FALLBACK_ATT = 1.1;    // strength fallback for unknown countries
  var FALLBACK_DEF = 1.25;
  var CARD_PPM = 4.4;        // card points (y + 2r) per match
  var PACE_PRIOR = 4;        // pseudo-goals anchoring the group pace factor
  var PACE_MIN = 0.55;       // pace factor clamp
  var PACE_MAX = 1.8;
  var FULL_MIN = 95;         // minutes in a "full" match incl. stoppage
  var SHOW_PCT = 0.10;       // matrix cells print the % at or above this
  var SPREAD_MIN = 0.05;     // a pick counts as "in play" at or above this
  var HIST_KEY = "wc26.oddsHist";
  var HIST_DAYS = 40;        // newest N daily snapshots kept
  var SPARK_DAYS = 10;       // sparkline window, in days
  var FALLBACK_AC = "#c89638";

  /* Defensive copies of the status maps in case script order shifts. */
  var FIN = (window.Live && Live.FINISHED) || { FINISHED: 1, AWARDED: 1 };
  var LIVE_ST = (window.Live && Live.INPLAY) ||
    { IN_PLAY: 1, PAUSED: 1, LIVE: 1, HALFTIME: 1 };

  /* ---------------- team strength (Elo-informed) ---------------- */

  /* [att, def] = expected goals scored / conceded per match against an
     average opponent. Keys match the seed country names exactly. */
  var STRENGTH = {
    /* B */ "Canada": [1.4, 1.1], "Bosnia & Herzegovina": [1.1, 1.3],
            "Qatar": [0.8, 1.7], "Switzerland": [1.4, 1.0],
    /* C */ "Brazil": [2.0, 0.8], "Morocco": [1.6, 0.8],
            "Haiti": [0.6, 2.0], "Scotland": [1.1, 1.3],
    /* D */ "United States": [1.5, 1.0], "Paraguay": [1.1, 1.0],
            "Australia": [1.2, 1.2], "Türkiye": [1.5, 1.3],
    /* E */ "Germany": [1.9, 1.0], "Curaçao": [0.7, 1.8],
            "Ivory Coast": [1.3, 1.1], "Ecuador": [1.3, 0.9],
    /* F */ "Netherlands": [1.9, 0.9], "Japan": [1.6, 0.9],
            "Sweden": [1.2, 1.2], "Tunisia": [0.9, 1.2],
    /* G */ "Belgium": [1.7, 1.1], "Egypt": [1.1, 1.0],
            "Iran": [1.2, 1.1], "New Zealand": [0.7, 1.8],
    /* H */ "Spain": [2.1, 0.7], "Cape Verde": [0.8, 1.5],
            "Saudi Arabia": [0.9, 1.5], "Uruguay": [1.5, 0.9],
    /* I */ "France": [2.0, 0.8], "Senegal": [1.4, 1.0],
            "Iraq": [0.7, 1.7], "Norway": [1.6, 1.1],
    /* J */ "Argentina": [2.1, 0.7], "Algeria": [1.2, 1.1],
            "Austria": [1.4, 1.1], "Jordan": [0.7, 1.7],
    /* K */ "Portugal": [2.0, 0.8], "DR Congo": [0.9, 1.4],
            "Uzbekistan": [0.8, 1.5], "Colombia": [1.5, 0.9],
    /* L */ "England": [1.9, 0.8], "Croatia": [1.5, 1.0],
            "Ghana": [1.1, 1.4], "Panama": [0.9, 1.5]
  };

  function strengthOf(name) {
    return STRENGTH[name] || [FALLBACK_ATT, FALLBACK_DEF];
  }

  /* Expected TOTAL goals in one match between two named countries. */
  function matchLambda(homeName, awayName) {
    var h = strengthOf(homeName);
    var a = strengthOf(awayName);
    return h[0] * (a[1] / AVG_DEF) + a[0] * (h[1] / AVG_DEF);
  }

  /* "63'" -> 63 · "45+2'" -> 47 · null at the break -> 45 · junk -> 47 */
  function parseMinute(minute, status) {
    var atBreak = status === "PAUSED" || status === "HALFTIME";
    if (minute == null || minute === "") return atBreak ? 45 : 47;
    var m = /^(\d+)(?:\+(\d+))?/.exec(String(minute));
    if (!m) return 47;
    return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0);
  }

  /* ---------------- module state ---------------- */

  var cache = null;    // { fp: string, res: forecast } — survives re-renders
  var lastCtx = null;  // latest rendered ctx, for market-driven re-renders

  /* ---------------- market lines (data/odds.json) ---------------- */

  /* The fetcher writes bookmaker over/under totals for upcoming matches;
     when a fixture has one, its market-implied expected goals replace the
     Elo lambda (the book already prices form, so no pace scaling either).
     The file may not exist yet — every failure resolves to "no market". */

  var MARKET_TTL_MS = 30 * 60000;        // refetch when older than this
  var MARKET_WINDOW_MS = 48 * 3600000;   // chip-row horizon
  var IMPLIED_MIN = 1.6;                 // sanity clamp, mirrors the fetcher
  var IMPLIED_MAX = 4.6;

  var market = null;        // { fetchedAt, count, byPair } or null
  var marketLastTry = 0;    // wall clock of the last fetch attempt
  var marketLoading = false;

  /* Both sides of the fixture/odds match must normalize identically:
     lowercase, strip diacritics, strip non-letters, then alias. Local on
     purpose — the data contract pins this exact scheme, shared with the
     fetcher, independent of Live's fuzzier matcher. */
  var MK_ALIAS = {
    bosniaandherzegovina: "bosniaherzegovina",
    cotedivoire: "ivorycoast",
    turkey: "turkiye",
    usa: "unitedstates",
    unitedstatesofamerica: "unitedstates",
    korearepublic: "southkorea",
    czechia: "czechrepublic",
    capeverdeislands: "capeverde",
    caboverde: "capeverde",
    congodr: "drcongo",
    democraticrepublicofthecongo: "drcongo"
  };

  function mkCanon(name) {
    var s = String(name).toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip diacritics
      .replace(/[^a-z]/g, "");                          // strip non-letters
    return MK_ALIAS[s] || s;
  }

  /* Unordered pair key — "Canada" vs "Bosnia-Herzegovina" finds the same
     line as "Bosnia & Herzegovina" vs "Canada". */
  function canonPair(a, b) {
    var ca = mkCanon(a);
    var cb = mkCanon(b);
    return ca < cb ? ca + "|" + cb : cb + "|" + ca;
  }

  /* Validate + index a fetched odds payload; never throws. Re-renders the
     stored ctx when the snapshot actually changed (new fetchedAt). */
  function applyMarket(data) {
    try {
      if (!data || !data.lines || !data.lines.length) return;
      var byPair = {};
      var count = 0;
      data.lines.forEach(function (ln) {
        if (!ln || !ln.home || !ln.away) return;
        var t = Number(ln.impliedTotal);
        if (!isFinite(t)) return;
        byPair[canonPair(ln.home, ln.away)] = {
          impliedTotal: Math.min(Math.max(t, IMPLIED_MIN), IMPLIED_MAX),
          line: ln.line,
          overUS: ln.overUS,
          underUS: ln.underUS,
          date: ln.date
        };
        count += 1;
      });
      if (!count) return;
      var prevAt = market ? market.fetchedAt : null;
      market = {
        fetchedAt: String(data.fetchedAt || ""),
        count: count,
        byPair: byPair
      };
      if (market.fetchedAt !== prevAt && lastCtx) render(lastCtx);
    } catch (_) { /* malformed payload — behave as if absent */ }
  }

  function loadMarket() {
    if (marketLoading) return;
    marketLoading = true;
    marketLastTry = Date.now();
    /* Same cache-buster pattern as js/live.js — GitHub Pages' CDN copy
       can be up to 10 minutes stale without it. */
    fetch("data/odds.json?v=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        marketLoading = false;
        if (data) applyMarket(data);
      });
  }

  function marketLine(homeName, awayName) {
    return (market && market.byPair[canonPair(homeName, awayName)]) || null;
  }

  /* ---------------- poisson sampler (Knuth) ---------------- */

  /* expNegLambda = Math.exp(-lambda), precomputed once per rate. */
  function poisson(expNegLambda) {
    var k = 0;
    var p = 1;
    do {
      k += 1;
      p *= Math.random();
    } while (p > expNegLambda);
    return k - 1;
  }

  /* ---------------- fingerprint + cache ---------------- */

  function fingerprint(ctx) {
    var goals = 0;
    var cardPts = 0;
    ctx.standings.forEach(function (row) {
      goals += row.goals;
      cardPts += row.cardPoints;
    });
    var fin = 0;
    var live = 0;
    var minutes = 0;
    var pastManual = 0;
    ctx.fixtures.forEach(function (fx) {
      if (FIN[fx.status]) fin += 1;
      else if (LIVE_ST[fx.status]) {
        live += 1;
        minutes += parseMinute(fx.minute, fx.status);
      } else if (kickedOffLongAgo(fx, ctx)) {
        pastManual += 1; /* cache must roll over as manual-mode days pass */
      }
    });
    /* Market snapshot folds in so a lines refresh re-runs the sim. */
    return [goals, cardPts, fin, live, minutes, pastManual, ctx.standings.length,
      market ? market.fetchedAt : 0, market ? market.count : 0].join("|");
  }

  /* ---------------- model ---------------- */

  /* A fixture stuck on SCHEDULED hours after kickoff means the live feed is
     down and scores were hand-entered in data.js (the documented fallback) —
     its goals are already banked, so it must not be re-simulated too. */
  var PAST_KICKOFF_MS = 3 * 3600000;

  function kickedOffLongAgo(fx, ctx) {
    try {
      return ctx.helpers.fxDate(fx).getTime() < Date.now() - PAST_KICKOFF_MS;
    } catch (_) {
      return false;
    }
  }

  /* Classify one fixture: its prior goal rate and how much of it is
     still unplayed (1 = untouched, 0 = finished, fraction = in play).
     A bookmaker total, when one exists, beats the Elo estimate. */
  function classify(fx, ctx) {
    var fin = !!FIN[fx.status];
    var live = !fin && !!LIVE_ST[fx.status];
    if (!fin && !live && kickedOffLongAgo(fx, ctx)) fin = true; /* manual mode */
    var remFrac = 1;
    if (fin) remFrac = 0;
    else if (live) {
      remFrac = Math.max(0, (FULL_MIN - parseMinute(fx.minute, fx.status)) / FULL_MIN);
    }
    var mk = marketLine(fx.home.name, fx.away.name);
    return {
      letter: fx.group,
      lambda: mk ? mk.impliedTotal : matchLambda(fx.home.name, fx.away.name),
      market: !!mk,
      fin: fin,
      live: live,
      remFrac: remFrac
    };
  }

  /* Per-group pace factor + remaining goal/card-point rates. */
  function buildModel(ctx) {
    var entries = ctx.fixtures.map(function (fx) { return classify(fx, ctx); });

    /* Expected goals already played per group (full lambda for finished,
       elapsed share for in-play) — the denominator of the pace factor. */
    var expSoFar = {};
    entries.forEach(function (en) {
      var played = en.fin ? 1 : en.live ? 1 - en.remFrac : 0;
      expSoFar[en.letter] = (expSoFar[en.letter] || 0) + en.lambda * played;
    });

    /* Observed vs expected, anchored by a pseudo-goal prior so early
       blowouts don't whipsaw the forecast. Pre-tournament: exactly 1. */
    var pace = {};
    Object.keys(ctx.groups).forEach(function (letter) {
      var observed = ctx.helpers.groupGoals(ctx.groups[letter]);
      var f = (observed + PACE_PRIOR) / ((expSoFar[letter] || 0) + PACE_PRIOR);
      pace[letter] = Math.min(Math.max(f, PACE_MIN), PACE_MAX);
    });

    /* Remaining Poisson rates per group. Market totals pass through as-is
       (the book already prices form); Elo lambdas get strength × pace.
       Card points use the flat prior. Live fixtures only count the time
       left. mkUsed/remain feed the methodology line. */
    var remGoals = {};
    var remCards = {};
    var mkUsed = 0;
    var remain = 0;
    entries.forEach(function (en) {
      if (en.fin) return;
      remain += 1;
      if (en.market) mkUsed += 1;
      var f = en.market ? 1 : pace[en.letter] || 1;
      remGoals[en.letter] = (remGoals[en.letter] || 0) + en.lambda * f * en.remFrac;
      remCards[en.letter] = (remCards[en.letter] || 0) + CARD_PPM * en.remFrac;
    });

    var started = entries.some(function (en) { return en.fin || en.live; });
    return {
      remGoals: remGoals, remCards: remCards, started: started,
      mkUsed: mkUsed, remain: remain
    };
  }

  /* ---------------- monte carlo ---------------- */

  function runSims(ctx) {
    var standings = ctx.standings;
    var n = standings.length;
    if (!n) return null;

    var model = buildModel(ctx);

    /* Per-team simulation inputs, indexed like standings. Summing the
       per-fixture Poisson rates per group is distribution-identical to
       sampling each fixture separately (Poissons add), and 3× faster. */
    var baseG = [];
    var baseC = [];
    var expNegG = [];
    var expNegC = [];
    var expRem = [];
    standings.forEach(function (row, i) {
      var letter = row.group.letter;
      var lamG = model.remGoals[letter] || 0;
      var lamC = model.remCards[letter] || 0;
      baseG[i] = row.goals;
      baseC[i] = row.cardPoints;
      expRem[i] = lamG;
      expNegG[i] = Math.exp(-lamG);
      expNegC[i] = Math.exp(-lamC);
    });

    var counts = [];
    var i;
    var k;
    for (i = 0; i < n; i++) {
      counts[i] = [];
      for (k = 0; k < n; k++) counts[i][k] = 0;
    }

    /* Scratch arrays reused every sim to avoid allocation churn. */
    var simG = new Array(n);
    var simC = new Array(n);
    var rnd = new Array(n);
    var idx = new Array(n);

    /* The real board comparator (goals desc, card points desc) with a
       per-sim random key as the final coin-flip tiebreak. */
    function cmp(a, b) {
      return (simG[b] - simG[a]) || (simC[b] - simC[a]) || (rnd[a] - rnd[b]);
    }

    var t0 = Date.now();
    var done = 0;
    while (done < MAX_SIMS) {
      for (var s = 0; s < CHUNK; s++) {
        for (i = 0; i < n; i++) {
          simG[i] = baseG[i] + poisson(expNegG[i]);
          simC[i] = baseC[i] + poisson(expNegC[i]);
          rnd[i] = Math.random();
          idx[i] = i;
        }
        idx.sort(cmp);
        for (k = 0; k < n; k++) counts[idx[k]][k] += 1;
      }
      done += CHUNK;
      if (Date.now() - t0 > TIME_BUDGET_MS) break;
    }

    var rows = standings.map(function (row, j) {
      var probs = counts[j].map(function (cnt) { return cnt / done; });
      var expPick = 0;
      var entropy = 0;
      var lo = 0;
      var hi = 0;
      probs.forEach(function (p, pick) {
        expPick += (pick + 1) * p;
        if (p > 0) entropy -= p * Math.log(p);
        if (p >= SPREAD_MIN) {
          if (!lo) lo = pick + 1;
          hi = pick + 1;
        }
      });
      return {
        abbr: row.team.abbr,
        name: row.team.name,
        accent: row.team.accent || FALLBACK_AC,
        letter: row.group.letter,
        rank: row.rank,
        goalsNow: row.goals,
        expRemain: expRem[j],
        probs: probs,
        expPick: expPick,
        entropy: entropy,
        lock: probs[row.rank - 1] || 0,
        lo: lo || 1,
        hi: hi || n
      };
    });

    /* Deterministic order for identical sim results: expected pick,
       then current rank, then abbr. */
    rows.sort(function (a, b) {
      return (a.expPick - b.expPick) || (a.rank - b.rank) ||
        (a.abbr < b.abbr ? -1 : a.abbr > b.abbr ? 1 : 0);
    });

    return {
      sims: done, pre: !model.started, rows: rows,
      market: !!market, mkUsed: model.mkUsed, mkRemain: model.remain
    };
  }

  function getForecast(ctx) {
    var fp = fingerprint(ctx);
    if (cache && cache.fp === fp) return cache.res;
    var res = runSims(ctx);
    if (res) cache = { fp: fp, res: res };
    return res;
  }

  /* ---------------- odds history (localStorage) ---------------- */

  function readHist() {
    try {
      var raw = localStorage.getItem(HIST_KEY);
      var h = raw ? JSON.parse(raw) : null;
      return h && typeof h === "object" ? h : {};
    } catch (_) { return {}; } // private mode / quota — history just sits out
  }

  /* "2026-6-11" -> sortable timestamp (helpers.dayKey format). */
  function keyTime(k) {
    var p = String(k).split("-");
    var t = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime();
    return isFinite(t) ? t : 0;
  }

  function histP(hist, key, abbr) {
    var day = hist[key];
    var p = day ? day[abbr] : null;
    return typeof p === "number" && isFinite(p) ? p : null;
  }

  /* Overwrite today's snapshot of P(No. 1), prune to the newest
     HIST_DAYS days, persist best-effort. Returns the pruned history. */
  function updateHist(res, todayKey) {
    var snap = {};
    res.rows.forEach(function (r) {
      snap[r.abbr] = Math.round(r.probs[0] * 1000) / 1000;
    });
    var merged = {};
    var prev = readHist();
    Object.keys(prev).forEach(function (k) { merged[k] = prev[k]; });

    /* Keep today's first snapshot unless the forecast materially moved —
       re-rolls on a no-news day would otherwise wiggle the stored number. */
    var today = prev[todayKey];
    if (today) {
      var materially = false;
      Object.keys(snap).forEach(function (abbr) {
        var old = today[abbr];
        if (typeof old !== "number" || Math.abs(snap[abbr] - old) >= 0.02) materially = true;
      });
      if (!materially) return prev;
    }
    merged[todayKey] = snap;

    var next = {};
    Object.keys(merged)
      .sort(function (a, b) { return keyTime(b) - keyTime(a); })
      .slice(0, HIST_DAYS)
      .forEach(function (k) { next[k] = merged[k]; });
    try { localStorage.setItem(HIST_KEY, JSON.stringify(next)); } catch (_) {}
    return next;
  }

  /* P(No. 1) on the most recent stored day BEFORE today (or null). */
  function prevDayP(hist, abbr, todayKey) {
    var keys = Object.keys(hist)
      .filter(function (k) { return keyTime(k) < keyTime(todayKey); })
      .sort(function (a, b) { return keyTime(b) - keyTime(a); });
    for (var i = 0; i < keys.length; i++) {
      var p = histP(hist, keys[i], abbr);
      if (p != null) return p;
    }
    return null;
  }

  /* Last SPARK_DAYS days of P(No. 1) for one team, oldest first. */
  function histSeries(hist, abbr, todayKey) {
    var series = [];
    Object.keys(hist)
      .filter(function (k) { return keyTime(k) <= keyTime(todayKey); })
      .sort(function (a, b) { return keyTime(a) - keyTime(b); })
      .forEach(function (k) {
        var p = histP(hist, k, abbr);
        if (p != null) series.push(p);
      });
    return series.slice(-SPARK_DAYS);
  }

  /* ---------------- formatting ---------------- */

  function fmtPct(p) {
    if (p <= 0) return "0%";
    if (p < 0.005) return "&lt;1%";
    return Math.round(p * 100) + "%";
  }

  function fmtSims(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* American moneyline from a probability, rounded to the nearest 5
     and capped at ±9900 so the board never prints silly numbers. */
  function moneyline(p) {
    if (p <= 0) return "+9900";
    if (p >= 1) return "-9900";
    var v = p >= 0.5 ? (100 * p) / (1 - p) : (100 * (1 - p)) / p;
    v = Math.round(v / 5) * 5;
    if (v > 9900) v = 9900;
    if (v < 100) v = 100;
    return (p >= 0.5 ? "-" : "+") + v;
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  function findMineAbbr(ctx) {
    var abbr = null;
    ctx.standings.forEach(function (row) {
      if (row.team.isMine) abbr = row.team.abbr;
    });
    return abbr;
  }

  /* ---------------- hero cards ---------------- */

  function cardHtml(label, value, detail, dim) {
    return '<div class="od-card">' +
      '<div class="od-card-label">' + label + "</div>" +
      '<div class="od-card-value' + (dim ? " dim" : "") + '">' + value + "</div>" +
      '<div class="od-card-detail">' + detail + "</div>" +
      "</div>";
  }

  function favoriteCard(ctx, board) {
    var fav = board[0];
    if (!fav) return cardHtml("No. 1 pick favorite", "&mdash;", "waiting for data", true);
    return cardHtml("No. 1 pick favorite", fmtPct(fav.probs[0]),
      ctx.helpers.esc(fav.name) + " · " + moneyline(fav.probs[0]));
  }

  function mineCard(ctx, mine) {
    var last = mine.probs[mine.probs.length - 1] || 0;
    return cardHtml("Your forecast", "Pick " + mine.expPick.toFixed(1),
      "⭐ " + ctx.helpers.esc(mine.name) +
      " · No. 1: " + fmtPct(mine.probs[0]) + " · last: " + fmtPct(last));
  }

  function volatileCard(ctx, res) {
    var wild = null;
    res.rows.forEach(function (r) {
      if (!wild || r.entropy > wild.entropy) wild = r;
    });
    if (!wild) return cardHtml("Most volatile", "&mdash;", "waiting for data", true);
    var inPlay = wild.probs.filter(function (p) { return p >= SPREAD_MIN; }).length;
    var ord = ctx.helpers.ordinal;
    return cardHtml("Most volatile", wild.lo + ord(wild.lo) + "–" + wild.hi + ord(wild.hi),
      ctx.helpers.esc(wild.name) + " · " + inPlay + " picks in play (≥5%)");
  }

  function heroHtml(ctx, res, board, mine) {
    var cards = favoriteCard(ctx, board) +
      (mine ? mineCard(ctx, mine) : "") +
      volatileCard(ctx, res);
    return '<section class="od-block">' +
      '<div class="od-cards' + (mine ? "" : " two") + '">' + cards + "</div></section>";
  }

  /* ---------------- the board ---------------- */

  function moveChipHtml(p, prev) {
    if (prev == null) return "";
    var d = Math.round(p * 100) - Math.round(prev * 100);
    /* Sub-2pp moves are within Monte Carlo re-roll noise (SE ~0.6pp at 5k
       sims, ~2pp at the 500-sim floor) — only real news gets a chip. */
    if (Math.abs(d) < 2) return "";
    var up = d > 0;
    return '<span class="od-chip ' + (up ? "up" : "down") +
      '" title="percentage points vs the last stored day">' +
      (up ? "▲ " : "▼ ") + Math.abs(d) + "</span>";
  }

  function sparkHtml(series) {
    if (series.length < 2) return "";
    var max = Math.max(0.01, Math.max.apply(null, series));
    var step = 60 / (series.length - 1);
    var pts = series.map(function (p, i) {
      return (i * step).toFixed(1) + "," + (17 - (p / max) * 16).toFixed(1);
    }).join(" ");
    return '<svg class="od-spark" viewBox="0 0 60 18" preserveAspectRatio="none" ' +
      'aria-hidden="true"><polyline points="' + pts + '"></polyline></svg>';
  }

  function boardHtml(ctx, board, hist, todayKey, mineAbbr) {
    var esc = ctx.helpers.esc;
    var maxP = board.length ? Math.max(board[0].probs[0], 0.001) : 0.001;

    var rows = board.map(function (r, i) {
      var p = r.probs[0];
      var width = Math.max((p / maxP) * 100, 1.5);
      var mine = r.abbr === mineAbbr;
      return '<div class="od-bd-row' + (mine ? " mine" : "") +
        '" style="--od-ac:' + esc(r.accent) + '">' +
        '<span class="od-bd-dot">' + (i + 1) + "</span>" +
        '<span class="od-bd-name">' + esc(r.name) + (mine ? " ⭐" : "") + "</span>" +
        '<span class="od-bd-bar"><span class="od-bd-fill" style="width:' +
          width.toFixed(1) + '%"></span></span>' +
        '<span class="od-bd-pct">' + fmtPct(p) + "</span>" +
        '<span class="od-bd-ml">' + moneyline(p) + "</span>" +
        '<span class="od-bd-move">' + moveChipHtml(p, prevDayP(hist, r.abbr, todayKey)) + "</span>" +
        '<span class="od-bd-graph">' + sparkHtml(histSeries(hist, r.abbr, todayKey)) + "</span>" +
        "</div>";
    }).join("");

    return '<section class="od-block">' +
      '<div class="od-head">🎯 The Board <span class="od-head-sub">· odds to land the No. 1 pick</span></div>' +
      '<div class="od-board">' + rows + "</div></section>";
  }

  /* ---------------- market lines chip row ---------------- */

  /* FIFA-style country codes for the chips. Keys match the seed names
     exactly (same convention as STRENGTH); unknowns fall back to the
     first three canon letters. */
  var MK_ABBR = {
    /* B */ "Canada": "CAN", "Bosnia & Herzegovina": "BIH",
            "Qatar": "QAT", "Switzerland": "SUI",
    /* C */ "Brazil": "BRA", "Morocco": "MAR", "Haiti": "HAI", "Scotland": "SCO",
    /* D */ "United States": "USA", "Paraguay": "PAR",
            "Australia": "AUS", "Türkiye": "TUR",
    /* E */ "Germany": "GER", "Curaçao": "CUW",
            "Ivory Coast": "CIV", "Ecuador": "ECU",
    /* F */ "Netherlands": "NED", "Japan": "JPN", "Sweden": "SWE", "Tunisia": "TUN",
    /* G */ "Belgium": "BEL", "Egypt": "EGY", "Iran": "IRN", "New Zealand": "NZL",
    /* H */ "Spain": "ESP", "Cape Verde": "CPV",
            "Saudi Arabia": "KSA", "Uruguay": "URU",
    /* I */ "France": "FRA", "Senegal": "SEN", "Iraq": "IRQ", "Norway": "NOR",
    /* J */ "Argentina": "ARG", "Algeria": "ALG", "Austria": "AUT", "Jordan": "JOR",
    /* K */ "Portugal": "POR", "DR Congo": "COD",
            "Uzbekistan": "UZB", "Colombia": "COL",
    /* L */ "England": "ENG", "Croatia": "CRO", "Ghana": "GHA", "Panama": "PAN"
  };

  function teamAbbr(name) {
    return MK_ABBR[name] || mkCanon(name).slice(0, 3).toUpperCase();
  }

  /* Find the viewer's group letter (null when no team is picked). */
  function findMineLetter(ctx) {
    var letter = null;
    ctx.standings.forEach(function (row) {
      if (row.team.isMine) letter = row.group.letter;
    });
    return letter;
  }

  /* One scrollable row of "CAN-BIH · O/U 2.5 · o+120" chips for league
     fixtures kicking off inside the next 48h that carry a bookmaker
     total. Hidden entirely when nothing matches. */
  function marketHtml(ctx) {
    if (!market) return "";
    var esc = ctx.helpers.esc;
    var now = Date.now();
    var mineLetter = findMineLetter(ctx);

    var chips = [];
    ctx.fixtures.slice()
      .sort(function (a, b) { return ctx.helpers.fxDate(a) - ctx.helpers.fxDate(b); })
      .forEach(function (fx) {
        if (FIN[fx.status] || LIVE_ST[fx.status]) return;
        var t = ctx.helpers.fxDate(fx).getTime();
        if (t < now || t > now + MARKET_WINDOW_MS) return;
        var mk = marketLine(fx.home.name, fx.away.name);
        if (!mk || mk.line == null) return;
        var price = mk.overUS ? " · o" + esc(String(mk.overUS)) : "";
        chips.push('<div class="od-mk-chip' +
          (fx.group === mineLetter ? " mine" : "") + '">' +
          '<span class="od-mk-flags">' + esc(fx.home.flag) + " " + esc(fx.away.flag) + "</span>" +
          '<span class="od-mk-txt">' + esc(teamAbbr(fx.home.name)) + "-" + esc(teamAbbr(fx.away.name)) +
          " · O/U " + esc(String(mk.line)) + price + "</span></div>");
      });
    if (!chips.length) return "";

    return '<section class="od-block">' +
      '<div class="od-head">💰 Market Lines <span class="od-head-sub">· DraftKings totals, next 48h</span></div>' +
      '<div class="od-mk-row">' + chips.join("") + "</div></section>";
  }

  /* ---------------- path to No. 1 ---------------- */

  function pathHtml(ctx, res, board, mine) {
    var esc = ctx.helpers.esc;
    var text;

    if (board[0] && board[0].abbr === mine.abbr) {
      var chall = board[1];
      if (!chall) return "";
      var back = mine.goalsNow - chall.goalsNow; /* signed — chall can lead */
      var slate = chall.expRemain > mine.expRemain + 0.05 ? "hotter"
        : chall.expRemain < mine.expRemain - 0.05 ? "cooler" : "similar";
      var standing = back > 0 ? "is " + plural(back, "goal") + " back"
        : back === 0 ? "is level on goals"
        : "actually leads by " + plural(-back, "goal");
      text = "👑 Favorites — defend it: " + esc(chall.abbr) + " " + standing +
        " with a " + slate + " remaining slate" +
        (back < 0 ? " — your slate keeps you on top" : "") + ".";
    } else {
      var rival = board[0]; /* the model favorite is the team to beat */
      if (!rival) return "";
      var gap = rival.goalsNow - mine.goalsNow; /* signed — you can lead */
      var p = mine.probs[0];
      var tier = p >= 0.4 ? "strong shot" : p >= 0.2 ? "live shot"
        : p >= 0.08 ? "outside shot" : "long shot";
      var opener = gap > 0 ? "You trail " + esc(rival.name) + " by " + plural(gap, "goal")
        : gap === 0 ? "You're level on goals with " + esc(rival.name)
        : "You lead " + esc(rival.name) + " by " + plural(-gap, "goal") +
          ", but their slate makes them the favorite";
      text = opener +
        "; your remaining slate projects <b>+" + mine.expRemain.toFixed(1) +
        "</b> vs theirs <b>+" + rival.expRemain.toFixed(1) + "</b> — " +
        tier + " (" + fmtPct(p) + ").";
    }

    return '<section class="od-block">' +
      '<div class="od-head">🧭 Path to No. 1</div>' +
      '<div class="od-path">' + text + "</div></section>";
  }

  /* ---------------- odds matrix ---------------- */

  function matrixCell(p) {
    var cls = "od-cell";
    var txt = "";
    if (p >= SHOW_PCT) {
      txt = Math.round(p * 100) + "%";
      if (p >= 0.55) cls += " hot";
    } else if (p > 0) {
      txt = "·";
      cls += " dot";
    }
    /* Shade intensity tracks probability; floor keeps tiny odds visible. */
    var alpha = p > 0 ? Math.min(0.06 + p * 0.86, 0.92) : 0;
    return '<td class="' + cls + '" style="--od-a:' + alpha.toFixed(2) + '">' + txt + "</td>";
  }

  function matrixHtml(ctx, res, mineAbbr) {
    var esc = ctx.helpers.esc;
    var n = res.rows.length;
    var head = '<tr><th class="od-team-h" scope="col">Team</th>' +
      '<th class="od-pick" scope="col">exp.</th>';
    for (var k = 1; k <= n; k++) {
      head += '<th class="od-pick" scope="col">' + k + "</th>";
    }
    head += '<th class="od-pick" scope="col">lock</th></tr>';

    var body = res.rows.map(function (r) {
      var mine = r.abbr === mineAbbr;
      var cells = r.probs.map(matrixCell).join("");
      return '<tr class="od-row' + (mine ? " mine" : "") + '" style="--od-ac:' + esc(r.accent) + '">' +
        '<th class="od-team" scope="row">' +
        '<span class="od-tn-full">' + esc(r.name) + "</span>" +
        '<span class="od-tn-abbr">' + esc(r.abbr) + "</span>" + (mine ? " ⭐" : "") +
        ' <span class="od-grp">' + esc(r.letter) + "</span></th>" +
        '<td class="od-exp">' + r.expPick.toFixed(1) + "</td>" +
        cells +
        '<td class="od-lockp">' + fmtPct(r.lock) + "</td></tr>";
    }).join("");

    return '<section class="od-block">' +
      '<div class="od-head">🎲 Pick Probability Matrix ' +
        '<span class="od-head-sub od-swipe-hint">· swipe for picks →</span></div>' +
      '<div class="od-matrix"><table class="od-table">' +
        "<thead>" + head + "</thead><tbody>" + body + "</tbody>" +
      "</table></div>" +
      '<p class="od-foot">Each cell: chance of landing that final draft pick · ' +
        "exp. = average pick · lock = chance of staying exactly where they sit now.</p>" +
      "</section>";
  }

  /* ---------------- render ---------------- */

  function render(ctx) {
    var host = document.getElementById("odds-host");
    if (!host) return;
    try {
      if (!ctx || !ctx.standings || !ctx.standings.length) {
        host.innerHTML = '<p class="od-empty">Waiting for draft data…</p>';
        return;
      }
      lastCtx = ctx; /* market loads re-render with the latest ctx */
      if (Date.now() - marketLastTry > MARKET_TTL_MS) loadMarket();
      var res = getForecast(ctx);
      if (!res) {
        host.innerHTML = '<p class="od-empty">Waiting for draft data…</p>';
        return;
      }

      var todayKey = ctx.helpers.dayKey(new Date());
      var hist = updateHist(res, todayKey); // once per render, overwrite today

      var mineAbbr = findMineAbbr(ctx);
      var mine = null;
      res.rows.forEach(function (r) { if (r.abbr === mineAbbr) mine = r; });

      var board = res.rows.slice().sort(function (a, b) {
        return (b.probs[0] - a.probs[0]) || (a.expPick - b.expPick) ||
          (a.abbr < b.abbr ? -1 : a.abbr > b.abbr ? 1 : 0);
      });

      /* The matrix scrolls sideways on phones; an innerHTML rebuild
         resets that, so stash and restore its scroll position. */
      var scroller = host.querySelector(".od-matrix");
      var scrollX = scroller ? scroller.scrollLeft : 0;

      var method = res.market
        ? fmtSims(res.sims) + " sims · DraftKings totals on " +
          res.mkUsed + " of " + res.mkRemain + " remaining · " +
          "Elo strength fills the gaps · in-play from the current minute · cards tiebreak"
        : fmtSims(res.sims) +
          " sims · Elo-informed team strength + live pace · " +
          "in-play simulated from the current minute · cards tiebreak";

      host.innerHTML = '<div class="od-wrap">' +
        (res.pre ? '<div class="od-banner">Strength-based forecast — sharpens with every final whistle.</div>' : "") +
        heroHtml(ctx, res, board, mine) +
        boardHtml(ctx, board, hist, todayKey, mineAbbr) +
        marketHtml(ctx) +
        (mine ? pathHtml(ctx, res, board, mine) : "") +
        matrixHtml(ctx, res, mineAbbr) +
        '<p class="od-method">' + method + "</p>" +
        "</div>";

      scroller = host.querySelector(".od-matrix");
      if (scroller && scrollX) scroller.scrollLeft = scrollX;
    } catch (err) {
      console.error("Pick Odds render failed:", err);
    }
  }

  if (window.Hub && typeof window.Hub.onRender === "function") Hub.onRender(render);

  loadMarket(); /* first market fetch at module init; render() keeps it fresh */

  /* Debug/console surface — pure helpers plus a read-only market probe. */
  window.PickOdds = {
    parseMinute: parseMinute,
    moneyline: moneyline,
    matchLambda: matchLambda,
    forecast: getForecast,
    canonPair: canonPair,
    marketLine: marketLine
  };
})();
