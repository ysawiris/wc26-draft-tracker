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
   localStorage for movement chips and sparklines. Renders into
   #odds-host; one delegated click/keydown listener on the host drives
   the Projected Group Goals match-by-match drilldown. Also decorates
   the Groups tab cards with a per-group projection badge. */

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

  /* Expected goals for EACH side of a match (the two halves of matchLambda):
     a side's attack scaled by the opponent's defence vs the league average. */
  function teamLambdas(homeName, awayName) {
    var h = strengthOf(homeName);
    var a = strengthOf(awayName);
    return { home: h[0] * (a[1] / AVG_DEF), away: a[0] * (h[1] / AVG_DEF) };
  }

  /* Expected TOTAL goals in one match between two named countries. */
  function matchLambda(homeName, awayName) {
    var t = teamLambdas(homeName, awayName);
    return t.home + t.away;
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
     A bookmaker total, when one exists, beats the Elo estimate —
     unless noMarket is set, which forces the Elo path for every
     fixture (the simulator's heal check replays the pre-market model). */
  function classify(fx, ctx, noMarket) {
    var fin = !!FIN[fx.status];
    var live = !fin && !!LIVE_ST[fx.status];
    if (!fin && !live && kickedOffLongAgo(fx, ctx)) fin = true; /* manual mode */
    var remFrac = 1;
    if (fin) remFrac = 0;
    else if (live) {
      remFrac = Math.max(0, (FULL_MIN - parseMinute(fx.minute, fx.status)) / FULL_MIN);
    }
    var mk = noMarket ? null : marketLine(fx.home.name, fx.away.name);
    return {
      letter: fx.group,
      lambda: mk ? mk.impliedTotal : matchLambda(fx.home.name, fx.away.name),
      market: !!mk,
      mkLine: mk ? mk.line : null, /* posted O/U, for the drilldown rows */
      fin: fin,
      live: live,
      remFrac: remFrac,
      fx: fx /* carried so groupDetail can show the receipts per fixture */
    };
  }

  /* Per-group pace factor + remaining goal/card-point rates. */
  function buildModel(ctx, noMarket) {
    var entries = ctx.fixtures.map(function (fx) { return classify(fx, ctx, noMarket); });

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
    var remMatches = {};
    var mkUsed = 0;
    var remain = 0;
    entries.forEach(function (en) {
      if (en.fin) { en.expRem = 0; return; }
      remain += 1;
      if (en.market) mkUsed += 1;
      var f = en.market ? 1 : pace[en.letter] || 1;
      /* The exact per-fixture remaining expectation the sim sums — the
         drilldown shows these same numbers, never a recomputation. */
      en.expRem = en.lambda * f * en.remFrac;
      remGoals[en.letter] = (remGoals[en.letter] || 0) + en.expRem;
      remCards[en.letter] = (remCards[en.letter] || 0) + CARD_PPM * en.remFrac;
      remMatches[en.letter] = (remMatches[en.letter] || 0) + 1;
    });

    var started = entries.some(function (en) { return en.fin || en.live; });
    return {
      remGoals: remGoals, remCards: remCards, remMatches: remMatches,
      started: started, mkUsed: mkUsed, remain: remain, entries: entries
    };
  }

  /* ---------------- monte carlo ---------------- */

  function runSims(ctx, noMarket) {
    var standings = ctx.standings;
    var n = standings.length;
    if (!n) return null;

    var model = buildModel(ctx, noMarket);

    /* Per-group projection for the Projected Group Goals section: goals
       already banked vs the model's expected remaining goals, plus how
       many matches those arrive in. Same rates the sim draws from. */
    var groupProj = {};
    Object.keys(ctx.groups).forEach(function (letter) {
      groupProj[letter] = {
        banked: ctx.helpers.groupGoals(ctx.groups[letter]),
        remain: model.remGoals[letter] || 0,
        matches: model.remMatches[letter] || 0
      };
    });

    /* Per-fixture receipts for the drilldown: a plain-value snapshot of
       each classify entry plus its exact expRem (the same per-fixture
       numbers remGoals sums), kickoff-ordered within each group. */
    var groupDetail = {};
    model.entries.forEach(function (en) {
      var fx = en.fx;
      var list = groupDetail[en.letter] || (groupDetail[en.letter] = []);
      list.push({
        time: ctx.helpers.fxDate(fx).getTime(),
        home: fx.home.name, homeFlag: fx.home.flag,
        away: fx.away.name, awayFlag: fx.away.flag,
        homeGoals: fx.homeGoals, awayGoals: fx.awayGoals,
        min: en.live ? parseMinute(fx.minute, fx.status) : null,
        fin: en.fin, live: en.live,
        market: en.market, line: en.mkLine,
        expRem: en.expRem || 0
      });
    });
    Object.keys(groupDetail).forEach(function (letter) {
      groupDetail[letter].sort(function (a, b) { return a.time - b.time; });
    });

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

    /* marketCount = remaining fixtures priced from a real bookmaker line
       (0 until data/odds.json lands). Consumers — the What-If auto-prefill
       in js/simulator.js — gate on it to tell a market-backed forecast
       from the Elo STRENGTH fallback. */
    return {
      sims: done, pre: !model.started, rows: rows, groupProj: groupProj,
      groupDetail: groupDetail,
      market: noMarket ? false : !!market,
      mkUsed: model.mkUsed, mkRemain: model.remain,
      marketCount: model.mkUsed
    };
  }

  /* Cache invalidation when lines land: fingerprint() folds in
     market.fetchedAt + count, and applyMarket() re-renders lastCtx on a
     new snapshot — so the first market-backed getForecast call always
     recomputes instead of serving the cached Elo-only result. */
  function getForecast(ctx) {
    var fp = fingerprint(ctx);
    if (cache && cache.fp === fp) return cache.res;
    var res = runSims(ctx);
    if (res) cache = { fp: fp, res: res };
    return res;
  }

  /* Market-blind forecast: the same model with every bookmaker line
     ignored — exactly what getForecast computed before odds.json loaded.
     Deliberately uncached (rare calls, must never pollute the market
     cache); the simulator uses it to recognize stale Elo-based fills. */
  function getNoMarketForecast(ctx) {
    return runSims(ctx, true);
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
    var p = fav.probs[0];
    /* Plain-English odds — "+480" lands better as "about a 1-in-6 shot". */
    var oneIn = p > 0 ? " · about a 1-in-" + Math.round(1 / p) + " shot" : "";
    return cardHtml("No. 1 pick favorite", fmtPct(p),
      ctx.helpers.esc(fav.name) + " · " + moneyline(p) + oneIn);
  }

  /* Smallest pick whose cumulative probability reaches q (a percentile
     of the pick distribution); the tiny epsilon absorbs float drift. */
  function pickPercentile(probs, q) {
    var cum = 0;
    for (var i = 0; i < probs.length; i++) {
      cum += probs[i];
      if (cum >= q - 1e-9) return i + 1;
    }
    return probs.length;
  }

  function mineCard(ctx, mine) {
    var ord = ctx.helpers.ordinal;
    var best = 0;
    mine.probs.forEach(function (p, i) { if (p > mine.probs[best]) best = i; });
    var pick = best + 1;                          /* most likely final pick */
    var lo = pickPercentile(mine.probs, 0.10);    /* central ~80% range */
    var hi = pickPercentile(mine.probs, 0.90);
    var range = lo === hi ? "usually lands " + lo + ord(lo)
      : "usually lands " + lo + ord(lo) + "–" + hi + ord(hi);
    return cardHtml("Your forecast", "Pick " + pick + ord(pick),
      range + " · No.1 pick: " + fmtPct(mine.probs[0]));
  }

  function hottestCard(ctx, res) {
    var owners = ctx.helpers.ownerByGroup();
    var best = null;
    Object.keys(res.groupProj).forEach(function (letter) {
      var gp = res.groupProj[letter];
      if (gp.matches < 1) return; /* finished groups can't be hot */
      var rate = gp.remain / gp.matches;
      if (!best || rate > best.rate) best = { letter: letter, rate: rate };
    });
    if (!best) return cardHtml("🔥 Hottest group", "&mdash;", "no matches left to play", true);
    var owner = owners[best.letter];
    return cardHtml("🔥 Hottest group", best.rate.toFixed(1) + "/match",
      "Group " + ctx.helpers.esc(best.letter) + " (" +
      (owner ? ctx.helpers.esc(owner.name) : "unclaimed") +
      ") — the books expect goals");
  }

  function heroHtml(ctx, res, board, mine) {
    var cards = favoriteCard(ctx, board) +
      (mine ? mineCard(ctx, mine) : "") +
      hottestCard(ctx, res);
    return '<section class="od-block">' +
      '<div class="od-cards' + (mine ? "" : " two") + '">' + cards + "</div></section>";
  }

  /* ---------------- projected group goals: drilldown ---------------- */

  /* Open/closed state per group letter (object-as-set) — module level so
     it survives the 2-minute re-renders. The viewer's own group opens on
     the first render; everything after that is whatever the user did. */
  var openGroups = {};
  var openInit = false;
  var wired = false; /* delegated listener on #odds-host bound once */

  /* "Sun Jun 14" for upcoming detail rows (helpers.fmtDay adds a dot). */
  var DET_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DET_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function detDay(ms) {
    var d = new Date(ms);
    return DET_DOW[d.getDay()] + " " + DET_MON[d.getMonth()] + " " + d.getDate();
  }

  /* Flip one group's drilldown in place — no re-render, no sim re-run. */
  function togglePg(host, row) {
    var letter = row.getAttribute("data-pg");
    if (!letter) return;
    var open = !openGroups[letter];
    if (open) openGroups[letter] = true;
    else delete openGroups[letter];
    var det = host.querySelector('.od-pg-det[data-det="' + letter + '"]');
    if (det) det.hidden = !open;
    row.setAttribute("aria-expanded", open ? "true" : "false");
    var caret = row.querySelector(".od-pg-caret");
    if (caret) caret.textContent = open ? "▾" : "▸";
  }

  /* One delegated click + keydown listener on the host (which outlives
     every innerHTML rebuild). Enter/Space mirror the click for the
     role="button" rows. */
  function wire(host) {
    if (wired) return;
    wired = true;
    host.addEventListener("click", function (e) {
      var row = e.target && e.target.closest ? e.target.closest(".od-pg-row[data-pg]") : null;
      if (row) togglePg(host, row);
    });
    host.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      var row = e.target && e.target.closest ? e.target.closest(".od-pg-row[data-pg]") : null;
      if (!row) return;
      e.preventDefault();
      togglePg(host, row);
    });
  }

  /* One compact receipt row per fixture. The numbers are res.groupDetail's
     expRem — the exact per-fixture values the sim sums — at one decimal. */
  function pgFxHtml(ctx, d) {
    var esc = ctx.helpers.esc;
    var left;
    var right;
    var cls;
    if (d.fin || d.live) {
      var hasScore = d.homeGoals != null && d.awayGoals != null;
      var score = hasScore ? d.homeGoals + "–" + d.awayGoals : "–";
      left = esc(d.homeFlag) + " " + esc(d.home) + " " + score + " " +
        esc(d.away) + " " + esc(d.awayFlag);
      if (d.live) left += " · " + d.min + "'";
      var banked = hasScore ? d.homeGoals + d.awayGoals : null;
      if (d.fin) {
        cls = "fin";
        right = (banked == null ? "banked" : banked + " banked") + " ✓";
      } else {
        cls = "live";
        right = (banked == null ? 0 : banked) + " banked + ~" +
          d.expRem.toFixed(1) + " to come";
      }
    } else {
      cls = "up";
      left = esc(d.homeFlag) + " " + esc(teamAbbr(d.home)) + "–" +
        esc(teamAbbr(d.away)) + " " + esc(d.awayFlag) + " · " + detDay(d.time);
      var ou = d.market && d.line != null ? "O/U " + esc(String(d.line)) + " → " : "";
      var src = d.market ? "DraftKings" : "strength estimate";
      right = ou + "~" + d.expRem.toFixed(1) + " expected" +
        ' <span class="od-pg-src">(' + src + ")</span>";
    }
    return '<div class="od-pg-fx ' + cls + '">' +
      '<span class="od-pg-fx-t">' + left + "</span>" +
      '<span class="od-pg-fx-n">' + right + "</span></div>";
  }

  /* The six fixture rows + the reconciliation footer for one group. */
  function pgDetailHtml(ctx, res, letter) {
    var list = (res.groupDetail && res.groupDetail[letter]) || [];
    var gp = res.groupProj[letter] || { banked: 0, remain: 0 };
    var rows = list.map(function (d) { return pgFxHtml(ctx, d); }).join("");
    return rows + '<div class="od-pg-det-foot">banked ' + gp.banked +
      " + expected ~" + gp.remain.toFixed(1) + " ≈ " +
      Math.round(gp.banked + gp.remain) +
      " — the number on the bar above.</div>";
  }

  /* ---------------- projected group goals ---------------- */

  /* The league's actual currency: most group goals wins the No. 1 pick.
     One stacked bar per group — solid gold for goals already banked,
     striped for what the model still expects — sorted by projected total.
     Each row expands (click/Enter/Space) into its match-by-match receipts. */
  function projHtml(ctx, res) {
    var esc = ctx.helpers.esc;
    var owners = ctx.helpers.ownerByGroup();

    var rows = Object.keys(res.groupProj).map(function (letter) {
      var gp = res.groupProj[letter];
      return {
        letter: letter, banked: gp.banked, remain: gp.remain,
        total: gp.banked + gp.remain, owner: owners[letter] || null
      };
    });
    rows.sort(function (a, b) {
      return (b.total - a.total) ||
        (a.letter < b.letter ? -1 : a.letter > b.letter ? 1 : 0);
    });

    var maxTotal = 0.001;
    rows.forEach(function (r) { if (r.total > maxTotal) maxTotal = r.total; });

    var html = rows.map(function (r) {
      var mine = !!(r.owner && r.owner.isMine);
      var name = r.owner
        ? esc(r.owner.name) + (mine ? " ⭐" : "")
        : "Group " + esc(r.letter) + " — unclaimed";
      var flags = ctx.groups[r.letter].countries.map(function (c) {
        return "<span>" + esc(c.flag) + "</span>";
      }).join(" ");
      var bankedW = (r.banked / maxTotal) * 100;
      var remainW = (r.remain / maxTotal) * 100;
      var open = !!openGroups[r.letter];
      var detId = "od-pg-det-" + esc(r.letter);
      return '<div class="od-pg-grp">' +
        '<div class="od-pg-row' + (mine ? " mine" : "") +
        (r.owner ? "" : " unclaimed") +
        '" role="button" tabindex="0" data-pg="' + esc(r.letter) +
        '" aria-expanded="' + (open ? "true" : "false") +
        '" aria-controls="' + detId +
        '" style="--od-ac:' + esc((r.owner && r.owner.accent) || FALLBACK_AC) + '">' +
        '<span class="od-pg-caret" aria-hidden="true">' + (open ? "▾" : "▸") + "</span>" +
        '<span class="od-pg-name">' + name + "</span>" +
        '<span class="od-pg-letter">' + esc(r.letter) + "</span>" +
        '<span class="od-pg-flags">' + flags + "</span>" +
        '<span class="od-pg-bar">' +
          '<span class="od-pg-banked" style="width:' + bankedW.toFixed(1) + '%"></span>' +
          '<span class="od-pg-remain" style="width:' + remainW.toFixed(1) + '%"></span>' +
        "</span>" +
        '<span class="od-pg-num">' + r.banked + " + ~" + Math.round(r.remain) +
          " ≈ " + Math.round(r.total) + "</span>" +
        "</div>" +
        '<div class="od-pg-det" id="' + detId + '" data-det="' + esc(r.letter) + '"' +
          (open ? "" : " hidden") + ">" +
          pgDetailHtml(ctx, res, r.letter) +
        "</div></div>";
    }).join("");

    return '<section class="od-block">' +
      '<div class="od-head">⚽ Projected Group Goals ' +
        '<span class="od-head-sub">· the number that decides the draft</span></div>' +
      '<div class="od-pg">' + html + "</div></section>";
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
      '<th class="od-pick" scope="col">avg</th>';
    for (var k = 1; k <= n; k++) {
      head += '<th class="od-pick" scope="col">' + k + "</th>";
    }
    head += "</tr>";

    var body = res.rows.map(function (r) {
      var mine = r.abbr === mineAbbr;
      var cells = r.probs.map(matrixCell).join("");
      return '<tr class="od-row' + (mine ? " mine" : "") + '" style="--od-ac:' + esc(r.accent) + '">' +
        '<th class="od-team" scope="row">' +
        '<span class="od-tn-full">' + esc(r.name) + "</span>" +
        '<span class="od-tn-abbr">' + esc(r.abbr) + "</span>" + (mine ? " ⭐" : "") +
        ' <span class="od-grp">' + esc(r.letter) + "</span></th>" +
        '<td class="od-exp">' + r.expPick.toFixed(1) + "</td>" +
        cells + "</tr>";
    }).join("");

    return '<section class="od-block">' +
      '<div class="od-head">🎲 Pick Probability Matrix ' +
        '<span class="od-head-sub od-swipe-hint">· swipe for picks →</span></div>' +
      '<div class="od-matrix"><table class="od-table">' +
        "<thead>" + head + "</thead><tbody>" + body + "</tbody>" +
      "</table></div>" +
      '<p class="od-foot">Each cell: how often that team landed that pick ' +
        "across the sims. avg = their average pick.</p>" +
      "</section>";
  }

  /* ---------------- how this works ---------------- */

  /* Plain-English explainer for the group chat — static numbered steps,
     with the live sim count and line coverage woven in. The one-line
     methodology footer lives here too, as the panel's last line. */
  function howHtml(res) {
    var lineNote = res.market
      ? " Right now " + res.mkUsed + " of " + res.mkRemain +
        " remaining matches have a posted line."
      : "";
    var steps = [
      "The stage: 48 teams, 12 groups A–L, 6 matches per group. Only the " +
        "72 group-stage matches (June 11–27) count for the draft — this " +
        "forecast covers exactly those and nothing else.",
      "Your draft slot = total goals scored by the four countries in your " +
        "World Cup group. Cards break ties (yellow +1, red +2).",
      "Every match has a Vegas over/under for total goals. We pull " +
        "DraftKings' lines every few hours and turn each one into expected " +
        "goals — O/U 2.5 with the over at +120 works out to about 2.4." + lineNote,
      "A computer then plays out the rest of the group stage " +
        fmtSims(res.sims) + " times at those scoring rates. How often your " +
        "team finishes with the most goals = your No.1-pick odds. Matches " +
        "with no posted line yet use a team-strength estimate instead.",
      "Betting-odds format: +480 means a $100 bet would profit $480 — " +
        "roughly a 1-in-6 shot. Bigger plus number = longer shot.",
      "▲/▼ chips show how a team's No.1-pick chance moved since yesterday " +
        "(on this device)."
    ];
    var method = res.market
      ? fmtSims(res.sims) + " sims · DraftKings totals on " +
        res.mkUsed + " of " + res.mkRemain + " remaining · " +
        "Elo strength fills the gaps · in-play from the current minute · cards tiebreak"
      : fmtSims(res.sims) +
        " sims · Elo-informed team strength + live pace · " +
        "in-play simulated from the current minute · cards tiebreak";
    return '<section class="od-block">' +
      '<div class="od-head">📖 How this works</div>' +
      '<div class="od-how"><ol>' +
      steps.map(function (s) { return "<li>" + s + "</li>"; }).join("") +
      '</ol><p class="od-method">' + method + "</p></div></section>";
  }

  /* ---------------- groups-tab projection badge ---------------- */

  /* Append "⚽ 0 banked + ~17 expected ≈ 17 projected" to every .gcard on
     the Groups tab, matched to its letter via the .gletter text. The grid
     is rebuilt before onRender callbacks each full render, but odds.js
     also re-renders off lastCtx after a market refresh — so remove any
     stale badge first (idempotent). A Groups-tab quirk must never break
     the Odds tab, hence the blanket try/catch. */
  function decorateGroups(ctx, res) {
    try {
      var grid = document.getElementById("groups-grid");
      if (!grid || !res || !res.groupProj) return;
      var esc = ctx.helpers.esc;
      var cards = grid.querySelectorAll(".gcard");
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var letterNode = card.querySelector(".gletter");
        if (!letterNode) continue;
        var letter = String(letterNode.textContent || "").replace(/\s+/g, "");
        var gp = res.groupProj[letter];
        if (!gp) continue;
        var stale = card.querySelector(".gxg");
        if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
        var badge = document.createElement("div");
        badge.className = "gxg";
        badge.innerHTML = "⚽ " + esc(String(gp.banked)) + " banked + ~" +
          esc(String(Math.round(gp.remain))) + " expected ≈ " +
          esc(String(Math.round(gp.banked + gp.remain))) + " projected";
        card.appendChild(badge);
      }
    } catch (_) { /* never let the Groups tab take down the Odds tab */ }
  }

  /* ---------------- render ---------------- */

  function render(ctx) {
    var host = document.getElementById("odds-host");
    if (!host) return;
    try {
      wire(host); /* delegated drilldown listener — bound once, host persists */
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

      /* The viewer's group starts expanded — first render only; after
         that the open/closed set is whatever the user left behind. */
      if (!openInit) {
        openInit = true;
        var mineLetter = findMineLetter(ctx);
        if (mineLetter) openGroups[mineLetter] = true;
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

      host.innerHTML = '<div class="od-wrap">' +
        (res.pre ? '<div class="od-banner">Strength-based forecast — sharpens with every final whistle.</div>' : "") +
        heroHtml(ctx, res, board, mine) +
        projHtml(ctx, res) +
        marketHtml(ctx) +
        (mine ? pathHtml(ctx, res, board, mine) : "") +
        matrixHtml(ctx, res, mineAbbr) +
        howHtml(res) +
        "</div>";

      scroller = host.querySelector(".od-matrix");
      if (scroller && scrollX) scroller.scrollLeft = scrollX;

      decorateGroups(ctx, res); /* Groups-tab badge, self-contained try/catch */
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
    teamLambdas: teamLambdas,
    forecast: getForecast,
    forecastNoMarket: getNoMarketForecast,
    canonPair: canonPair,
    marketLine: marketLine
  };
})();
