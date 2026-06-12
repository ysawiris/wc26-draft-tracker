/* Board extras — decorates the Draft Board tab with a copy/share toolbar,
   rank-movement arrows (persisted in localStorage), a per-team progress
   line, and small flourishes for the first and last pick. Pure decoration:
   reads ctx from Hub after every render, never mutates league data. */

(function () {
  "use strict";

  var SITE_URL = "https://ysawiris.github.io/wc26-draft-tracker/";
  var STORE_KEY = "wc26.rankSnapshots";
  var COPY_RESTORE_MS = 1600;
  var GROUP_MATCHES = 6;

  /* ---------------- rank snapshots (localStorage, fail-soft) ---------------- */

  function readSnapshots() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.current) return null;
      return { current: parsed.current, previous: parsed.previous || null };
    } catch (err) {
      return null;
    }
  }

  function writeSnapshots(snap) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(snap));
    } catch (err) {
      /* Private mode / quota exceeded — movement arrows just stay off. */
    }
  }

  function ranksFromStandings(standings) {
    var ranks = {};
    standings.forEach(function (row) { ranks[row.team.abbr] = row.rank; });
    return ranks;
  }

  function sameRanks(a, b) {
    if (!a || !b) return false;
    var ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every(function (k) { return a[k] === b[k]; });
  }

  /* Rotate stored current→previous when the order changes.
     Returns the rank map to diff against (or null if none yet). */
  function updateSnapshots(standings) {
    var current = ranksFromStandings(standings);
    var stored = readSnapshots();
    if (!stored) {
      writeSnapshots({ current: current, previous: null });
      return null;
    }
    if (!sameRanks(stored.current, current)) {
      writeSnapshots({ current: current, previous: stored.current });
      return stored.current;
    }
    return stored.previous;
  }

  /* ---------------- copy / share ---------------- */

  function buildOrderText(ctx) {
    var title = ctx.started ? "Draft Order" : "Provisional Order";
    var stamp = (ctx.league && ctx.league.lastUpdated) || "live";
    var lines = ["🏆 WC26 " + title + " — " + stamp];
    ctx.standings.forEach(function (row) {
      lines.push(row.rank + ". " + row.team.name + " — Grp " + row.group.letter +
        " · " + row.goals + (row.goals === 1 ? " goal" : " goals"));
    });
    lines.push("Tiebreak: cards (🟨+1 🟥+2)");
    lines.push(SITE_URL);
    return lines.join("\n");
  }

  function copyTextFallback(text) {
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

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return copyTextFallback(text);
      });
    }
    return copyTextFallback(text);
  }

  function flashCopied(btn) {
    if (btn.getAttribute("data-bx-flashing")) return;
    btn.setAttribute("data-bx-flashing", "1");
    var original = btn.textContent;
    btn.textContent = "Copied ✓";
    btn.classList.add("is-copied");
    window.setTimeout(function () {
      btn.textContent = original;
      btn.classList.remove("is-copied");
      btn.removeAttribute("data-bx-flashing");
    }, COPY_RESTORE_MS);
  }

  function onToolbarClick(e) {
    var btn = e.target.closest("[data-bx-action]");
    if (!btn || !window.Hub) return;
    var ctx = window.Hub.ctx();
    if (!ctx) return;
    var text = buildOrderText(ctx);

    if (btn.getAttribute("data-bx-action") === "copy") {
      copyText(text).then(function () { flashCopied(btn); }).catch(function () {});
      return;
    }
    if (btn.getAttribute("data-bx-action") === "share" && navigator.share) {
      var title = "WC26 " + (ctx.started ? "Draft Order" : "Provisional Order");
      try {
        navigator.share({ title: title, text: text }).catch(function () {});
      } catch (err) {
        /* User cancelled or payload unsupported — nothing to do. */
      }
    }
  }

  /* ---------------- toolbar (inserted once, guarded by id) ---------------- */

  function ensureToolbar() {
    if (document.getElementById("bx-toolbar")) return;
    var hint = document.getElementById("board-hint");
    var list = document.getElementById("board-list");
    if (!hint || !list || !hint.parentNode) return;

    var bar = document.createElement("div");
    bar.id = "bx-toolbar";
    bar.className = "bx-toolbar";
    var html =
      '<button type="button" class="bx-btn" data-bx-action="copy" ' +
        'aria-label="Copy the draft order to your clipboard">📋 Copy draft order</button>';
    if (navigator.share) {
      html +=
        '<button type="button" class="bx-btn" data-bx-action="share" ' +
          'aria-label="Share the draft order">📤 Share</button>';
    }
    bar.innerHTML = html;
    bar.addEventListener("click", onToolbarClick);
    hint.parentNode.insertBefore(bar, list);
  }

  /* ---------------- per-row decoration ---------------- */

  function cleanRow(li) {
    Array.prototype.forEach.call(
      li.querySelectorAll(".bx-move, .bx-extras, .bx-crown, .bx-lastpick"),
      function (n) { n.parentNode.removeChild(n); }
    );
  }

  function injectMovement(ctx, li, row, prevRanks) {
    if (!ctx.started || !prevRanks) return;
    var prev = prevRanks[row.team.abbr];
    if (typeof prev !== "number") return;
    var top = li.querySelector(".team-top");
    if (!top) return;

    var delta = prev - row.rank;
    var badge = document.createElement("span");
    if (delta > 0) {
      badge.className = "bx-move bx-up";
      badge.textContent = "▲" + delta;
      badge.title = "Up " + delta + (delta === 1 ? " place" : " places") + " since the order last changed";
    } else if (delta < 0) {
      badge.className = "bx-move bx-down";
      badge.textContent = "▼" + (-delta);
      badge.title = "Down " + (-delta) + (delta === -1 ? " place" : " places") + " since the order last changed";
    } else {
      badge.className = "bx-move bx-flat";
      badge.textContent = "·";
      badge.title = "No movement since the order last changed";
    }
    badge.setAttribute("aria-label", badge.title);
    top.appendChild(badge);
  }

  /* "▸ X/6 played · pace Y" once underway; "▸ First match <day>" pre-season.
     Returns the injected node so the last-pick pill can ride on it. */
  function injectExtras(ctx, li, row) {
    var teamCell = li.querySelector(".team");
    if (!teamCell) return null;
    var h = ctx.helpers;
    var letter = row.group.letter;
    var groupFx = ctx.fixtures.filter(function (fx) { return fx.group === letter; });
    var played = groupFx.filter(function (fx) { return Live.FINISHED[fx.status]; }).length;

    var line;
    if (!ctx.started) {
      var first = groupFx.slice().sort(function (a, b) { return h.fxDate(a) - h.fxDate(b); })[0];
      line = first
        ? "▸ First match " + h.fmtDay(h.fxDate(first))
        : "▸ " + GROUP_MATCHES + " group-stage matches";
    } else {
      line = "▸ " + played + "/" + GROUP_MATCHES + " played";
      if (played >= 1) {
        var pace = (row.goals / Math.max(played, 1) * GROUP_MATCHES).toFixed(1);
        line += " · pace " + pace;
      }
    }

    var extras = h.el("div", "bx-extras", h.esc(line));
    teamCell.appendChild(extras);
    return extras;
  }

  function injectFlourishes(ctx, li, row, extras) {
    if (!ctx.started) return;

    if (row.rank === 1) {
      var name = li.querySelector(".team-name");
      if (name && name.insertAdjacentElement) {
        var crown = document.createElement("span");
        crown.className = "bx-crown";
        crown.textContent = "👑";
        crown.title = "Holding the No. 1 pick";
        crown.setAttribute("aria-label", crown.title);
        name.insertAdjacentElement("afterend", crown);
      }
    }

    if (row.rank === ctx.standings.length && extras) {
      var pill = document.createElement("span");
      pill.className = "bx-lastpick";
      pill.textContent = "last pick 😬";
      pill.title = "Currently holding the last pick";
      extras.appendChild(pill);
    }
  }

  function decorateRows(ctx, prevRanks) {
    var list = document.getElementById("board-list");
    if (!list) return;
    var byAbbr = {};
    ctx.standings.forEach(function (row) { byAbbr[row.team.abbr] = row; });

    Array.prototype.forEach.call(list.querySelectorAll("li.row[data-abbr]"), function (li) {
      var row = byAbbr[li.dataset.abbr];
      if (!row) return;
      cleanRow(li);
      injectMovement(ctx, li, row, prevRanks);
      var extras = injectExtras(ctx, li, row);
      injectFlourishes(ctx, li, row, extras);
    });
  }

  /* ---------------- entry point ---------------- */

  function render(ctx) {
    if (!ctx || !ctx.standings || !ctx.standings.length) return;
    ensureToolbar();
    var prevRanks = updateSnapshots(ctx.standings);
    decorateRows(ctx, prevRanks);
  }

  if (window.Hub && typeof window.Hub.onRender === "function") {
    window.Hub.onRender(render);
  }
})();
