/* ============================================================
   ROAD TO THE ROUND OF 32 — folded into the Draw cards.

   Instead of a separate standings table, this module ENHANCES the
   existing "Groups A–L" cards (js/app.js renderGroups): it reorders
   each card's colour bars into live group-table order, tags every
   team with its advance odds, drops an "auto-qualify line" after 2nd,
   and expands a detail panel (record, status, odds, remaining games,
   fantasy-goal tie-in) when a team is tapped. The one genuinely
   cross-group piece — the best-3rd-place race — renders below.

   WC26 rule: top 2 of every group + the 8 best 3rd-placed teams
   advance (32 of 48).
   - Standings: FINISHED results only (the official table).
   - Advance odds: Monte-Carlo of every unfinished match (in-play games
     resume from the current score), team strength reused from PickOdds.
   - Status badge: sound clinch/elimination math (never overclaims);
     the % carries the live nuance. ✅ clinched · 🟡 alive · ❌ out.
   ============================================================ */
(function () {
  "use strict";

  var SIMS = 5000;
  var TIME_BUDGET_MS = 260;
  var THIRDS_THROUGH = 8;

  var FIN = (window.Live && Live.FINISHED) || { FINISHED: 1, AWARDED: 1 };
  var INPLAY = (window.Live && Live.INPLAY) ||
    { IN_PLAY: 1, LIVE: 1, PAUSED: 1, HALFTIME: 1 };

  var cache = null;       // { fp, data }
  var expanded = {};      // "L:Team" → true (survives re-renders)

  function lambdas(home, away) {
    if (window.PickOdds && PickOdds.teamLambdas) return PickOdds.teamLambdas(home, away);
    return { home: 1.25, away: 1.25 };
  }
  function remFrac(fx) {
    if (!INPLAY[fx.status]) return 1;
    var min = window.PickOdds ? PickOdds.parseMinute(fx.minute, fx.status) : 50;
    return Math.max(0.04, Math.min(1, (95 - min) / 95));
  }
  function pois(lambda) {
    if (lambda <= 0) return 0;
    var L = Math.exp(-lambda), k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }
  function tier(p) { return p >= 0.85 ? "hi" : p <= 0.15 ? "lo" : "mid"; }
  function pctText(p, status) {
    // A team that is not mathematically settled must never read a flat 100%/0%
    // next to an "In contention" badge — clamp the extremes for "maybe".
    if (status === "maybe") {
      if (p >= 0.995) return ">99%";
      if (p <= 0.005) return "<1%";
    }
    return p >= 0.999 ? "100%" : p <= 0.0005 ? "0%" :
      p < 0.1 ? (p * 100).toFixed(1) + "%" : Math.round(p * 100) + "%";
  }
  function fingerprint(fixtures) {
    return fixtures.map(function (fx) {
      return fx.id + ":" + fx.status + ":" + fx.homeGoals + "-" + fx.awayGoals + ":" + (fx.minute || "");
    }).join("|");
  }

  /* ---------------- model ---------------- */

  function compute(ctx) {
    var groups = ctx.groups, letters = Object.keys(groups).sort();

    var names = [], flag = {}, grpOf = {}, idx = {};
    letters.forEach(function (L) {
      groups[L].countries.forEach(function (c) {
        idx[c.name] = names.length; names.push(c.name);
        flag[c.name] = c.flag; grpOf[c.name] = L;
      });
    });
    var n = names.length;

    var Pts = new Array(n).fill(0), GFa = new Array(n).fill(0), GAa = new Array(n).fill(0);
    var W = new Array(n).fill(0), D = new Array(n).fill(0), Lz = new Array(n).fill(0), Pl = new Array(n).fill(0);
    var rem = [], liveGroups = {};

    ctx.fixtures.forEach(function (fx) {
      var hi = idx[fx.home.name], ai = idx[fx.away.name];
      if (hi == null || ai == null) return;
      var hasScore = fx.homeGoals != null && fx.awayGoals != null;
      if (FIN[fx.status] && hasScore) {
        var hg = fx.homeGoals, ag = fx.awayGoals;
        Pl[hi]++; Pl[ai]++; GFa[hi] += hg; GAa[hi] += ag; GFa[ai] += ag; GAa[ai] += hg;
        if (hg > ag) { W[hi]++; Lz[ai]++; Pts[hi] += 3; }
        else if (ag > hg) { W[ai]++; Lz[hi]++; Pts[ai] += 3; }
        else { D[hi]++; D[ai]++; Pts[hi]++; Pts[ai]++; }
        return;
      }
      var lam = lambdas(fx.home.name, fx.away.name), f = remFrac(fx), live = INPLAY[fx.status];
      if (live) liveGroups[fx.group] = true;
      rem.push({
        h: hi, a: ai, elh: lam.home * f, ela: lam.away * f,
        bh: live && hasScore ? fx.homeGoals : 0, ba: live && hasScore ? fx.awayGoals : 0
      });
    });

    var GD0 = new Array(n);
    for (var i = 0; i < n; i++) GD0[i] = GFa[i] - GAa[i];

    var groupTeams = {};
    letters.forEach(function (L) {
      groupTeams[L] = groups[L].countries.map(function (c) { return idx[c.name]; });
    });

    function rankIdx(indices, P, GD, GF) {
      return indices.slice().sort(function (x, y) {
        return (P[y] - P[x]) || (GD[y] - GD[x]) || (GF[y] - GF[x]) || (names[x] < names[y] ? -1 : 1);
      });
    }

    // Monte-Carlo
    var adv = new Array(n).fill(0), runs = 0, start = Date.now();
    while (runs < SIMS) {
      var P = Pts.slice(), GD = GD0.slice(), GF = GFa.slice();
      for (var r = 0; r < rem.length; r++) {
        var m = rem[r];
        var hg2 = m.bh + pois(m.elh), ag2 = m.ba + pois(m.ela);
        GF[m.h] += hg2; GF[m.a] += ag2; GD[m.h] += hg2 - ag2; GD[m.a] += ag2 - hg2;
        if (hg2 > ag2) P[m.h] += 3; else if (ag2 > hg2) P[m.a] += 3; else { P[m.h]++; P[m.a]++; }
      }
      var thirds = [];
      for (var g = 0; g < letters.length; g++) {
        var ord = rankIdx(groupTeams[letters[g]], P, GD, GF);
        adv[ord[0]]++; adv[ord[1]]++; thirds.push(ord[2]);
      }
      var to = rankIdx(thirds, P, GD, GF);
      for (var t = 0; t < THIRDS_THROUGH && t < to.length; t++) adv[to[t]]++;
      runs++;
      if ((runs & 255) === 0 && Date.now() - start > TIME_BUDGET_MS) break;
    }

    // Deterministic clinch / elimination (sound & conservative).
    var statusByName = {};
    letters.forEach(function (L) {
      var gi = groupTeams[L];
      gi.forEach(function (i) {
        var maxI = Pts[i] + 3 * (3 - Pl[i]), reach = 0, dom = 0;
        gi.forEach(function (j) {
          if (j === i) return;
          if (Pts[j] + 3 * (3 - Pl[j]) >= Pts[i]) reach++;
          if (Pts[j] > maxI) dom++;
        });
        statusByName[names[i]] = reach <= 1 ? "secured" : dom >= 3 ? "out" : "maybe";
      });
    });

    var rows = {};
    for (var k = 0; k < n; k++) {
      rows[names[k]] = {
        name: names[k], flag: flag[names[k]], group: grpOf[names[k]],
        P: Pl[k], W: W[k], D: D[k], L: Lz[k], GF: GFa[k], GA: GAa[k],
        GD: GD0[k], Pts: Pts[k], adv: runs ? adv[k] / runs : 0, status: statusByName[names[k]]
      };
    }

    var byGroup = {};
    letters.forEach(function (L) {
      byGroup[L] = rankIdx(groupTeams[L], Pts, GD0, GFa).map(function (i, pos) {
        rows[names[i]].rank = pos + 1; return rows[names[i]];
      });
    });

    // Once a group is fully played the final order (incl. GD/GF tiebreaks) is
    // locked, so derive status from final rank: 1st–2nd through, 3rd still alive
    // via the best-3rd race, 4th out. (The points-only clinch math above stays
    // deliberately conservative while a group still has games to play.)
    letters.forEach(function (L) {
      if (!groupTeams[L].every(function (i) { return Pl[i] === 3; })) return;
      byGroup[L].forEach(function (row, pos) {
        row.status = pos <= 1 ? "secured" : pos === 2 ? "maybe" : "out";
      });
    });

    // Rank the best-3rd race by simulated advance odds (not the finished-only
    // snapshot) so the top-8 cut line and the % column never contradict.
    var thirdsNow = letters.map(function (L) { return byGroup[L][2]; })
      .sort(function (a, b) { return b.adv - a.adv || b.Pts - a.Pts || b.GD - a.GD; });

    return { byGroup: byGroup, letters: letters, thirdsNow: thirdsNow, runs: runs, liveGroups: liveGroups };
  }

  /* ---------------- shared bits ---------------- */

  function advCell(p, status) {
    var w = Math.max(2, Math.round(p * 100));
    return '<span class="ko-adv ' + tier(p) + '"><span class="ko-adv-bar"><i style="width:' + w + '%"></i></span>' +
      '<span class="ko-adv-num">' + pctText(p, status) + "</span></span>";
  }

  /* ---------------- enhance the Draw cards ---------------- */

  function nameOf(bar) {
    var el = bar.querySelector(".cname");
    return el ? el.textContent.trim() : "";
  }

  function detailHTML(row, ctx, owner, esc, country) {
    var h = ctx.helpers;
    var rec = row.W + "–" + row.D + "–" + row.L;
    var gd = (row.GD > 0 ? "+" : "") + row.GD;
    var pos = row.rank + (h.ordinal ? h.ordinal(row.rank) : "") + " in Group " + row.group;
    var word = row.status === "secured" ? "✅ Clinched a top-2 spot"
      : row.status === "out" ? "❌ Eliminated" : "🟡 Still in contention";

    var rem = ctx.fixtures.filter(function (f) {
      return f.group === row.group && (f.home.name === row.name || f.away.name === row.name) && !FIN[f.status];
    }).map(function (f) {
      var opp = f.home.name === row.name ? f.away : f.home;
      var live = INPLAY[f.status];
      var when = live ? "live now" : h.fmtDay(h.fxDate(f)) + (h.fmtTime(f) ? " · " + h.fmtTime(f) : "");
      return opp.flag + " " + esc(opp.name) + " <small>" + when + "</small>";
    });

    function st(v, l) { return '<div><b>' + v + "</b><small>" + l + "</small></div>"; }

    return '<div class="cq-detail" hidden>' +
      '<div class="cq-top"><span class="cq-rank">' + pos + "</span>" +
        '<span class="cq-badge s-' + row.status + '">' + word + "</span></div>" +
      '<div class="cq-stats">' + st(row.Pts, "Pts") + st(row.P, "Played") + st(rec, "W–D–L") +
        st(row.GF + ":" + row.GA, "GF:GA") + st(gd, "GD") + "</div>" +
      '<div class="cq-odds"><span class="cq-odds-l">Reach Round of 32</span>' + advCell(row.adv, row.status) + "</div>" +
      (rem.length
        ? '<div class="cq-rem"><b>Still to play:</b> ' + rem.join(" &nbsp;·&nbsp; ") + "</div>"
        : '<div class="cq-rem">Group games complete.</div>') +
      (owner
        ? '<div class="cq-note">' + (country ? country.goals : 0) + " goal" + ((country && country.goals) === 1 ? "" : "s") +
          " counting toward <b>" + esc(owner.name) + "</b>’s draft total.</div>"
        : '<div class="cq-note">Group ' + row.group + " is unclaimed in the league.</div>") +
      "</div>";
  }

  function enhanceGroups(grid, data, ctx, esc, owners) {
    grid.querySelectorAll(".gcard").forEach(function (card) {
      var letterEl = card.querySelector(".gletter");
      if (!letterEl) return;
      var L = letterEl.textContent.trim();
      var rowsByName = {};
      (data.byGroup[L] || []).forEach(function (r) { rowsByName[r.name] = r; });
      var gtotal = card.querySelector(".gtotal");
      var bars = Array.prototype.slice.call(card.querySelectorAll(".cbar"));
      if (!bars.length || !gtotal) return;

      // Live-table order (1 → 4).
      bars.sort(function (a, b) {
        var ra = rowsByName[nameOf(a)], rb = rowsByName[nameOf(b)];
        return ((ra && ra.rank) || 9) - ((rb && rb.rank) || 9);
      });

      var placed = 0;
      bars.forEach(function (bar) {
        var row = rowsByName[nameOf(bar)];
        if (!row) { card.insertBefore(bar, gtotal); return; }
        var key = L + ":" + row.name;
        var detId = "kod-" + L + "-" + row.rank;
        bar.classList.add("cbar-x", "s-" + row.status);
        bar.setAttribute("role", "button");
        bar.setAttribute("tabindex", "0");
        bar.setAttribute("aria-expanded", expanded[key] ? "true" : "false");
        bar.setAttribute("aria-controls", detId);
        bar.setAttribute("aria-label",
          row.name + " — " + pctText(row.adv, row.status) + " to reach the Round of 32; activate for detail");
        if (expanded[key]) bar.classList.add("open");
        bar.dataset.key = key;
        // Heading into the knockouts the bar shows group POINTS (the standings
        // driver), not goals — the group's goal total stays in the card footer.
        var goalsEl = bar.querySelector(".cgoals");
        if (goalsEl) {
          goalsEl.textContent = row.Pts + (row.Pts === 1 ? " pt" : " pts");
          goalsEl.classList.add("cpts");
        }
        bar.insertAdjacentHTML("beforeend",
          '<span class="cq-pct ' + tier(row.adv) + '">' + pctText(row.adv, row.status) + "</span>" +
          '<span class="cchev" aria-hidden="true">▾</span>');
        card.insertBefore(bar, gtotal);

        var country = (ctx.groups[L].countries || []).filter(function (c) { return c.name === row.name; })[0];
        var det = document.createElement("div");
        det.innerHTML = detailHTML(row, ctx, owners[L], esc, country);
        det = det.firstChild;
        det.id = detId;
        det.hidden = !expanded[key];
        card.insertBefore(det, gtotal);

        // Auto-qualify line after the 2nd PLACED team (counter, not loop index,
        // so a row-less bar can never drop the divider).
        if (++placed === 2) {
          var line = document.createElement("div");
          line.className = "cq-line";
          line.innerHTML = "<span>auto-qualify line</span>";
          card.insertBefore(line, gtotal);
        }
      });
    });

    if (!grid.dataset.koWired) {
      grid.dataset.koWired = "1";
      grid.addEventListener("click", function (e) {
        var bar = e.target.closest(".cbar-x");
        if (!bar || !grid.contains(bar)) return;
        var det = bar.nextElementSibling;
        if (!det || !det.classList.contains("cq-detail")) return;
        var opening = det.hidden;
        det.hidden = !opening;
        expanded[bar.dataset.key] = opening;
        bar.classList.toggle("open", opening);
        bar.setAttribute("aria-expanded", opening ? "true" : "false");
      });
      grid.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        var bar = e.target.closest(".cbar-x");
        if (!bar) return;
        e.preventDefault();
        bar.click();
      });
    }
  }

  /* ---------------- best 3rd-place race (cross-group) ---------------- */

  function thirdsRace(thirds, esc) {
    var rows = thirds.map(function (t, i) {
      var rk = i + 1, cls = rk <= THIRDS_THROUGH ? "in" : "out";
      var gd = (t.GD > 0 ? "+" : "") + t.GD;
      return '<div class="ko-th-row ' + cls + '">' +
        '<span class="ko-th-rk">' + rk + "</span>" +
        '<span class="ko-th-team"><span class="ko-flag">' + t.flag + "</span>" + esc(t.name) +
        '<span class="ko-th-grp">Grp ' + t.group + "</span></span>" +
        '<span class="ko-th-pts">' + t.Pts + " pts</span>" +
        '<span class="ko-th-gd">' + gd + "</span>" +
        '<span class="ko-th-adv">' + advCell(t.adv) + "</span></div>" +
        (rk === THIRDS_THROUGH ? '<div class="ko-th-cut"><span>✂ top 8 advance — below the line, outside on current odds</span></div>' : "");
    }).join("");
    return '<div class="ko-thirds"><div class="ko-th-head">Best 3rd-place race ' +
      "<small>top " + THIRDS_THROUGH + " of 12 third-placed teams go through</small></div>" +
      '<div class="ko-th-list">' + rows + "</div></div>";
  }

  function hostHTML(data, esc) {
    return '<div class="ko-wrap">' +
      '<h2 class="section-title ko-title"><span>Road to the Round of 32</span></h2>' +
      '<p class="ko-sub">Top <b>2</b> of every group advance, plus the <b>8 best 3rd-placed</b> teams — 32 of 48. ' +
        'Tap any team above for its record, status and odds. <b>Advance %</b> is its simulated chance to reach the ' +
        'Round of 32 (' + (data.runs ? data.runs.toLocaleString() : "thousands of") + ' runs); the badge shows what’s ' +
        "mathematically settled.</p>" +
      '<div class="ko-legend">' +
        '<span><span class="dot in"></span> ✅ Clinched</span>' +
        '<span><span class="dot maybe"></span> 🟡 In contention</span>' +
        '<span><span class="dot out"></span> ❌ Eliminated</span>' +
      "</div>" +
      thirdsRace(data.thirdsNow, esc) + "</div>";
  }

  /* ---------------- entry ---------------- */

  function render(ctx) {
    if (!ctx || !ctx.groups) return;
    var grid = document.getElementById("groups-grid");
    var host = document.getElementById("knockout-host");
    var esc = ctx.helpers.esc, owners = ctx.helpers.ownerByGroup();

    var fp = fingerprint(ctx.fixtures);
    if (!cache || cache.fp !== fp) cache = { fp: fp, data: compute(ctx) };
    var data = cache.data;

    if (grid) enhanceGroups(grid, data, ctx, esc, owners);
    if (host) host.innerHTML = hostHTML(data, esc);
  }

  if (window.Hub && typeof Hub.onRender === "function") Hub.onRender(render);
})();
