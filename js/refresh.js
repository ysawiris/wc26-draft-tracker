/* Auto-refresh + freshness pill. Re-fetches data/live.json every 2 minutes
   while the tab is visible, refreshes immediately when the tab comes back
   after 90s away, and appends a "Scores as of …" pill to the hero strip. */

(function () {
  "use strict";

  var REFRESH_MS = 120000; // full re-fetch cadence
  var STALE_MS = 90000;    // refresh on tab return if older than this
  var TICK_MS = 30000;     // pill relative-time update cadence

  var lastRefreshAt = Date.now();

  function refreshNow() {
    try {
      // Hub.refresh already swallows fetch errors and re-renders from seed.
      Hub.refresh().catch(function (err) { console.error("Auto-refresh failed:", err); });
    } catch (err) {
      console.error("Auto-refresh failed:", err);
    }
  }

  setInterval(function () {
    if (document.visibilityState === "visible") refreshNow();
  }, REFRESH_MS);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && Date.now() - lastRefreshAt > STALE_MS) {
      refreshNow();
    }
  });

  /* ---------------- freshness pill ---------------- */

  function relTime(iso) {
    var then = new Date(iso);
    if (isNaN(then)) return null;
    var mins = Math.floor((Date.now() - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    return Math.floor(mins / 60) + "h ago";
  }

  function pillText(ctx) {
    if (ctx.liveData && ctx.liveData.fetchedAt) {
      var rel = relTime(ctx.liveData.fetchedAt);
      if (rel) return "🛰 Scores as of " + rel;
    }
    return "✍️ Manual mode · updated " + ctx.league.lastUpdated;
  }

  /* Idempotent: #hero-meta is rebuilt each render, but guard anyway so a
     double callback never stacks two pills. textContent = XSS-safe. */
  function renderPill(ctx) {
    var host = document.getElementById("hero-meta");
    if (!host) return;
    var pill = host.querySelector(".xr-fresh");
    if (!pill) {
      pill = ctx.helpers.el("span", "hero-pill xr-fresh");
      host.appendChild(pill);
    }
    pill.textContent = pillText(ctx);
  }

  Hub.onRender(function (ctx) {
    lastRefreshAt = Date.now(); // every render follows a data load
    renderPill(ctx);
  });

  // Keep the relative time honest between renders (only if pill still exists).
  setInterval(function () {
    try {
      var ctx = Hub.ctx();
      if (!ctx) return;
      var pill = document.querySelector("#hero-meta .xr-fresh");
      if (pill) pill.textContent = pillText(ctx);
    } catch (err) {
      console.error("Freshness tick failed:", err);
    }
  }, TICK_MS);
})();
