#!/usr/bin/env node
/* ============================================================
   Fetches 2026 World Cup matches from football-data.org and
   writes a compact data/live.json the site reads.

   Runs in GitHub Actions on a cron. Needs env FOOTBALL_DATA_TOKEN
   (a free token from https://www.football-data.org/client/register).
   If the token is missing it exits 0 without writing — so the
   Action never hard-fails before the secret is configured.
   ============================================================ */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = `${ROOT}/data/live.json`;

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const BASE = "https://api.football-data.org/v4";
const COMPETITION = "WC"; // FIFA World Cup

function normGroup(m) {
  // football-data exposes group as "GROUP_F" (or null for knockouts).
  const g = m.group || m.stage || "";
  const match = String(g).match(/([A-L])\b/i) || String(g).match(/GROUP[_\s]?([A-L])/i);
  return match ? match[1].toUpperCase() : null;
}

async function main() {
  if (!TOKEN) {
    console.log("FOOTBALL_DATA_TOKEN not set — skipping live fetch (site falls back to seed data).");
    return;
  }

  let res;
  try {
    res = await fetch(`${BASE}/competitions/${COMPETITION}/matches`, {
      headers: { "X-Auth-Token": TOKEN }
    });
  } catch (err) {
    console.error("Network error fetching matches:", err.message);
    process.exitCode = 0; // don't fail the Action on a transient network blip
    return;
  }

  if (!res.ok) {
    console.error(`API responded ${res.status} ${res.statusText}. Leaving existing live.json untouched.`);
    process.exitCode = 0;
    return;
  }

  const data = await res.json();
  const raw = Array.isArray(data.matches) ? data.matches : [];

  const matches = raw
    .map(function (m) {
      const group = normGroup(m);
      if (!group) return null; // group stage only (B–L handled client-side)
      const ft = (m.score && m.score.fullTime) || {};
      return {
        group: group,
        matchday: m.matchday || null,
        utcDate: m.utcDate || null,
        status: m.status || "SCHEDULED",
        home: m.homeTeam ? (m.homeTeam.name || m.homeTeam.shortName || "TBD") : "TBD",
        away: m.awayTeam ? (m.awayTeam.name || m.awayTeam.shortName || "TBD") : "TBD",
        homeGoals: ft.home == null ? null : ft.home,
        awayGoals: ft.away == null ? null : ft.away,
        venue: m.venue || null
      };
    })
    .filter(Boolean)
    .filter(function (m) { return m.group !== "A"; }); // Group A excluded from the league

  const payload = {
    source: "football-data.org",
    competition: COMPETITION,
    fetchedAt: new Date().toISOString(),
    matchCount: matches.length,
    matches: matches
  };

  // Skip writing if nothing changed (keeps git history clean).
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch (_) {}
  if (prev && JSON.stringify(prev.matches) === JSON.stringify(matches)) {
    console.log(`No score changes (${matches.length} matches). Nothing to write.`);
    return;
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Wrote ${matches.length} matches to data/live.json`);
}

main().catch(function (err) {
  console.error("Unexpected error:", err);
  process.exitCode = 0; // never break the cron on a bad run
});
