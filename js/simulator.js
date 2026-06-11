/* What-If Machine — hypothetical goals & cards sandbox for the draft order.
   Layers pure client-side deltas over the real standings and re-ranks with
   the same comparator as the live board. Never mutates GROUPS/TEAMS or any
   shared state. Deltas live in module scope so they survive tab switches
   and auto-refresh re-renders. */

(function () {
  "use strict";

  var COPY_LABEL = "📋 Copy scenario";

  var BUMPS = {
    "inc-goals": { field: "goals", dir: 1 },
    "dec-goals": { field: "goals", dir: -1 },
    "inc-y": { field: "yellows", dir: 1 },
    "dec-y": { field: "yellows", dir: -1 },
    "inc-r": { field: "reds", dir: 1 },
    "dec-r": { field: "reds", dir: -1 }
  };

  var host = document.getElementById("sim-host");
  var lastCtx = null;
  var deltas = {}; // abbr -> { goals, yellows, reds } — survives re-renders
  var copyTimer = null;

  /* ---------------- deltas ---------------- */

  function getDelta(abbr) {
    return deltas[abbr] || { goals: 0, yellows: 0, reds: 0 };
  }

  /* Replace the deltas map (never mutate in place); drop all-zero entries. */
  function setDelta(abbr, d) {
    var next = {};
    Object.keys(deltas).forEach(function (k) { if (k !== abbr) next[k] = deltas[k]; });
    if (d.goals !== 0 || d.yellows !== 0 || d.reds !== 0) next[abbr] = d;
    deltas = next;
  }

  function deltaTb(d) { return d.yellows + d.reds * 2; }

  function tweakCount() {
    return Object.keys(deltas).reduce(function (s, k) {
      var d = deltas[k];
      return s + Math.abs(d.goals) + Math.abs(d.yellows) + Math.abs(d.reds);
    }, 0);
  }

  /* ---------------- simulated standings ---------------- */

  /* Same comparator as the real board (goals desc, then card points desc),
     made explicitly stable by falling back to the real-order index. */
  function buildSimRows() {
    var rows = lastCtx.standings.map(function (row, i) {
      var d = getDelta(row.team.abbr);
      return {
        base: row,
        realIndex: i,
        delta: d,
        simGoals: Math.max(0, row.goals + d.goals),
        simTb: Math.max(0, row.cardPoints + deltaTb(d))
      };
    });
    var sorted = rows.slice().sort(function (a, b) {
      if (b.simGoals !== a.simGoals) return b.simGoals - a.simGoals;
      if (b.simTb !== a.simTb) return b.simTb - a.simTb;
      return a.realIndex - b.realIndex;
    });
    return sorted.map(function (row, i) {
      var same = function (o) { return o && o.simGoals === row.simGoals && o.simTb === row.simTb; };
      return Object.assign({}, row, { tied: same(sorted[i - 1]) || same(sorted[i + 1]) });
    });
  }

  /* ---------------- render ---------------- */

  function signedChip(n) {
    if (!n) return "";
    return '<span class="sim-delta">' + (n > 0 ? "+" : "−") + Math.abs(n) + "</span>";
  }

  function stepHtml(t, esc, kind, icon, incAct, decAct, addLabel, removeLabel, decDisabled) {
    var who = "Group " + t.group + " (" + t.name + ")";
    return '<span class="sim-step sim-step-' + kind + '">' +
      '<button type="button" class="sim-sbtn" data-act="' + decAct + '" data-abbr="' + esc(t.abbr) + '"' +
        ' aria-label="' + esc(removeLabel + " " + who) + '"' + (decDisabled ? " disabled" : "") + ">−</button>" +
      '<span class="sim-sicon" aria-hidden="true">' + icon + "</span>" +
      '<button type="button" class="sim-sbtn" data-act="' + incAct + '" data-abbr="' + esc(t.abbr) + '"' +
        ' aria-label="' + esc(addLabel + " " + who) + '">+</button>' +
      "</span>";
  }

  function rowHtml(sim, simIndex, showTies) {
    var esc = lastCtx.helpers.esc;
    var t = sim.base.team;
    var d = sim.delta;
    var touched = d.goals !== 0 || d.yellows !== 0 || d.reds !== 0;
    var move = sim.realIndex - simIndex;

    var moveHtml = move > 0
      ? '<span class="sim-move up" title="Up ' + move + ' from the real order">▲' + move + "</span>"
      : move < 0
        ? '<span class="sim-move down" title="Down ' + (-move) + ' from the real order">▼' + (-move) + "</span>"
        : '<span class="sim-move flat" title="Same as the real order">·</span>';

    var you = t.isMine ? '<span class="sim-you">You</span>' : "";
    var tied = showTies && sim.tied ? '<span class="sim-tied">Tied</span>' : "";
    var accent = t.accent ? ' style="--ac:' + esc(t.accent) + '"' : "";

    return '<li class="sim-row' + (t.isMine ? " sim-mine" : "") + (touched ? " sim-touched" : "") + '"' + accent + ">" +
      '<div class="sim-rankcol"><span class="sim-rank">' + (simIndex + 1) + "</span>" + moveHtml + "</div>" +
      '<div class="sim-main">' +
        '<div class="sim-top">' +
          '<span class="sim-name">' + esc(t.name) + "</span>" + you + tied +
          '<span class="sim-grp">Grp ' + esc(t.group) + "</span>" +
        "</div>" +
        '<div class="sim-nums">' +
          '<span class="sim-num"><small>G</small><b>' + sim.simGoals + "</b>" + signedChip(d.goals) + "</span>" +
          '<span class="sim-num"><small>TB</small><b>' + sim.simTb + "</b>" + signedChip(deltaTb(d)) + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="sim-steppers">' +
        stepHtml(t, esc, "goals", "⚽", "inc-goals", "dec-goals", "Add a goal to", "Remove a goal from", sim.simGoals < 1) +
        stepHtml(t, esc, "card", "🟨", "inc-y", "dec-y", "Add a yellow card to", "Remove a yellow card from", sim.simTb < 1) +
        stepHtml(t, esc, "card", "🟥", "inc-r", "dec-r", "Add a red card to", "Remove a red card from", sim.simTb < 2) +
      "</div>" +
      "</li>";
  }

  function renderSim() {
    if (!host || !lastCtx) return;

    var sims = buildSimRows();
    var count = tweakCount();
    var teamsTouched = Object.keys(deltas).length;
    /* Pre-tournament everyone sits on 0–0; don't spam "Tied" on every row
       until either real play starts or the user starts fiddling. */
    var showTies = lastCtx.started || count > 0;

    var note = count
      ? count + " tweak" + (count === 1 ? "" : "s") + " on " + teamsTouched +
        " team" + (teamsTouched === 1 ? "" : "s") + " — order below is hypothetical."
      : "No tweaks yet — this mirrors the real board.";

    host.innerHTML =
      '<div class="sim-bar">' +
        '<button type="button" class="sim-btn sim-reset" data-act="reset"' + (count ? "" : " disabled") + ">↺ Reset</button>" +
        '<button type="button" class="sim-btn sim-copy" data-act="copy">' + COPY_LABEL + "</button>" +
        '<span class="sim-note">' + note + "</span>" +
      "</div>" +
      '<ol class="sim-board">' +
        sims.map(function (sim, i) { return rowHtml(sim, i, showTies); }).join("") +
      "</ol>" +
      '<p class="sim-foot">Tiebreak: cards — 🟨 +1, 🟥 +2. Scenarios live only in your browser.</p>';
  }

  /* ---------------- copy scenario ---------------- */

  function signedWords(n, word) {
    var abs = Math.abs(n);
    return (n > 0 ? "+" : "−") + abs + " " + word + (abs === 1 ? "" : "s");
  }

  function scenarioSummary() {
    var parts = [];
    lastCtx.standings.forEach(function (row) {
      var d = deltas[row.team.abbr];
      if (!d) return;
      var bits = [];
      if (d.goals) bits.push(signedWords(d.goals, "goal"));
      if (d.yellows) bits.push(signedWords(d.yellows, "yellow"));
      if (d.reds) bits.push(signedWords(d.reds, "red"));
      parts.push(row.team.abbr + " " + bits.join(" "));
    });
    return parts.length
      ? "Scenario: " + parts.join(", ")
      : "Scenario: no tweaks — same as the real board.";
  }

  function scenarioText() {
    var sims = buildSimRows();
    var lines = ["🔮 What-If draft order — " + LEAGUE.name];
    sims.forEach(function (sim, i) {
      var move = sim.realIndex - i;
      var arrow = move > 0 ? " ▲" + move : move < 0 ? " ▼" + (-move) : "";
      lines.push((i + 1) + ". " + sim.base.team.name + " — " + sim.simGoals + " goals · TB " + sim.simTb + arrow);
    });
    lines.push("");
    lines.push(scenarioSummary());
    lines.push("(Hypothetical — the real board is untouched.)");
    return lines.join("\n");
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve();
      else reject(new Error("copy failed"));
    });
  }

  function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function handleCopy(btn) {
    writeClipboard(scenarioText()).then(function () {
      if (copyTimer) clearTimeout(copyTimer);
      btn.textContent = "Copied ✓";
      btn.classList.add("is-copied");
      copyTimer = setTimeout(function () {
        btn.textContent = COPY_LABEL;
        btn.classList.remove("is-copied");
        copyTimer = null;
      }, 1600);
    }).catch(function () {
      btn.textContent = "Copy failed";
      setTimeout(function () { btn.textContent = COPY_LABEL; }, 1600);
    });
  }

  /* ---------------- interactions ---------------- */

  function applyBump(abbr, act) {
    var bump = BUMPS[act];
    if (!bump || !abbr) return;
    var row = null;
    lastCtx.standings.forEach(function (r) { if (r.team.abbr === abbr) row = r; });
    if (!row) return;

    var d = getDelta(abbr);
    var next = { goals: d.goals, yellows: d.yellows, reds: d.reds };
    next[bump.field] = next[bump.field] + bump.dir;

    /* Clamp: simulated totals never drop below zero. */
    if (row.goals + next.goals < 0) return;
    if (row.cardPoints + deltaTb(next) < 0) return;

    setDelta(abbr, next);
    renderSim();
  }

  /* Re-render rebuilds the DOM, which drops keyboard focus — put it back on
     the equivalent button so steppers stay usable without a mouse. */
  function refocus(act, abbr) {
    var btns = host.querySelectorAll('[data-act="' + act + '"]');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute("data-abbr") === abbr && !btns[i].disabled) {
        btns[i].focus();
        return;
      }
    }
  }

  /* ONE delegated listener, attached once at module load; renderSim() only
     ever swaps innerHTML, so no listeners stack across re-renders. */
  if (host) {
    host.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!btn || btn.disabled || !lastCtx) return;
      var act = btn.getAttribute("data-act");
      if (act === "reset") {
        deltas = {};
        renderSim();
      } else if (act === "copy") {
        handleCopy(btn);
      } else {
        var abbr = btn.getAttribute("data-abbr");
        applyBump(abbr, act);
        refocus(act, abbr);
      }
    });
  }

  if (window.Hub) {
    Hub.onRender(function (ctx) {
      lastCtx = ctx;
      renderSim();
    });
  }
})();
