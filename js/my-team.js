/* Per-viewer team identity. One hub serves the whole league, so "your
   team" is a viewer-side choice: picked from an overlay on first visit,
   stored in localStorage, or pre-set via a ?team=ABBR share link.
   Loaded right after data.js so the isMine flags are applied before the
   first render; the picker UI itself wires up on DOMContentLoaded
   (after app.js has created window.Hub). */

(function () {
  "use strict";

  var TEAM_KEY = "wc26.myTeam";
  var SKIP_KEY = "wc26.pickerSkipped";

  function store(key, val) {
    try {
      if (val == null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
    } catch (_) {} // private mode etc. — selection just won't persist
  }
  function read(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function teamByAbbr(abbr) {
    return TEAMS.find(function (t) { return t.abbr === abbr; }) || null;
  }
  function current() {
    return teamByAbbr(read(TEAM_KEY) || "");
  }

  /* Flag the chosen team on the shared TEAMS seed; every module reads
     t.isMine from there at render time. */
  function applyFlags() {
    var mine = current();
    TEAMS.forEach(function (t) { t.isMine = !!mine && t.abbr === mine.abbr; });
  }

  /* Keep the schedule's "my group" chip in sync with the selection. */
  function syncChip() {
    var chip = document.querySelector('#schedule-filters .chip[data-filter="mine"]');
    if (!chip) return;
    var mine = current();
    chip.hidden = !mine;
    if (mine) chip.textContent = "⭐ My group (" + mine.group + ")";
  }

  function setTeam(abbr) {
    store(TEAM_KEY, abbr);
    if (abbr) store(SKIP_KEY, null);
    applyFlags();
    syncChip();
    renderPill();
    closePicker();
    if (window.Hub) Hub.refresh();
  }

  /* ---------------- hero pill ---------------- */

  function renderPill() {
    var host = document.getElementById("hero-meta");
    if (!host) return;
    var pill = host.querySelector(".tp-pill");
    if (!pill) {
      pill = document.createElement("button");
      pill.className = "hero-pill tp-pill";
      pill.type = "button";
      pill.addEventListener("click", openPicker);
      host.appendChild(pill);
    }
    var mine = current();
    pill.textContent = mine ? "🏷 You: " + mine.name : "🏷 Pick your team";
    pill.title = "The hub highlights your group, matches and pick";
  }

  /* ---------------- picker overlay ---------------- */

  var overlay = null;

  function buildPicker() {
    overlay = document.createElement("div");
    overlay.className = "tp-overlay";
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) skipPicker();
    });

    var panel = document.createElement("div");
    panel.className = "tp-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Pick your team");

    var h = document.createElement("h3");
    h.className = "tp-title";
    h.textContent = "Whose board is this?";
    panel.appendChild(h);

    var p = document.createElement("p");
    p.className = "tp-sub";
    p.textContent = "Pick your team and the hub highlights your group, your matches and your draft position. Saved on this device — change it anytime from the 🏷 pill up top.";
    panel.appendChild(p);

    var grid = document.createElement("div");
    grid.className = "tp-grid";
    var mine = current();

    TEAMS.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tp-team" + (mine && mine.abbr === t.abbr ? " current" : "");

      var crest = document.createElement("span");
      crest.className = "tp-crest";
      crest.textContent = t.abbr;
      if (t.accent) crest.style.background =
        "radial-gradient(circle at 32% 28%, " + t.accent + ", #140d05)";
      btn.appendChild(crest);

      var label = document.createElement("span");
      label.className = "tp-name";
      label.textContent = t.name;
      var grp = document.createElement("span");
      grp.className = "tp-grp";
      grp.textContent = "Group " + t.group + " · " + t.managers.join(" & ");
      label.appendChild(grp);
      btn.appendChild(label);

      btn.addEventListener("click", function () { setTeam(t.abbr); });
      grid.appendChild(btn);
    });
    panel.appendChild(grid);

    var skip = document.createElement("button");
    skip.type = "button";
    skip.className = "tp-skip";
    skip.textContent = "Just browsing";
    skip.addEventListener("click", skipPicker);
    panel.appendChild(skip);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay && !overlay.hidden) skipPicker();
    });
  }

  function openPicker() {
    if (!overlay) buildPicker();
    else {
      var mine = current();
      overlay.querySelectorAll(".tp-team").forEach(function (b, i) {
        b.classList.toggle("current", !!mine && TEAMS[i].abbr === mine.abbr);
      });
    }
    overlay.hidden = false;
    document.body.classList.add("tp-open");
  }

  function closePicker() {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove("tp-open");
  }

  function skipPicker() {
    store(SKIP_KEY, "1");
    closePicker();
  }

  /* ---------------- boot ---------------- */

  // ?team=ABBR share links assign and persist the team, then clean the URL.
  var fromUrl = new URLSearchParams(location.search).get("team");
  if (fromUrl && teamByAbbr(fromUrl.toUpperCase())) {
    store(TEAM_KEY, fromUrl.toUpperCase());
    store(SKIP_KEY, null);
    history.replaceState(null, "", location.pathname + location.hash);
  }

  applyFlags();

  var autoOpened = false;
  document.addEventListener("DOMContentLoaded", function () {
    syncChip();
    if (!window.Hub) return;
    Hub.onRender(function () {
      renderPill();
      if (!autoOpened && !current() && !read(SKIP_KEY)) {
        autoOpened = true;
        openPicker();
      }
    });
  });

  window.MyTeam = { current: current, set: setTeam, open: openPicker };
})();
