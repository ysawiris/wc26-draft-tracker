/* ============================================================
   LEAGUE DATA — single source of truth.

   After each matchday: update each country's `goals`, `yellows`,
   `reds` (running totals across that country's group-stage games),
   bump LEAGUE.lastUpdated, commit + push. GitHub Pages redeploys
   automatically (~1 min). You can edit this file straight from
   github.com with the pencil icon — no laptop needed.
   ============================================================ */

var LEAGUE = {
  name: "The League",
  season: "2026 FIFA World Cup",
  lastUpdated: "June 11, 2026",
  drawNote:
    "Groups assigned by Meta AI in the league chat (June 11, 2026). " +
    "Group A is excluded — they kicked off first. 10 teams, 11 groups, so Group I went unclaimed."
};

/* The 10 fantasy teams, in league order (ESPN).
   `group` is the random draw result. `accent` colors the crest.
   `photo` (optional) overrides the monogram crest. `isMine` flags your team. */
var TEAMS = [
  { abbr: "CMC",  name: "Commissioner's Infirmary 2.0", division: "East", managers: ["Christopher Malek"],            group: "G", accent: "#c0392b" },
  { abbr: "CDL",  name: "Nicolodeons!",                  division: "East", managers: ["John Ghali"],                  group: "E", accent: "#2e7d32" },
  { abbr: "BBWC", name: "Big Blue Wrecking Crew",        division: "East", managers: ["George Hanna", "Hanni Fakhoury"], group: "H", accent: "#1f4e9c" },
  { abbr: "TACO", name: "Taco Corp",                     division: "West", managers: ["Shaan Hurley", "Youssef Sawiris"], group: "F", accent: "#e07b16", photo: "assets/taco-corp.jpg", isMine: true },
  { abbr: "GRS",  name: "Gallactic Rebel Scum",          division: "West", managers: ["Joe Hanna"],                   group: "D", accent: "#5b3fa0" },
  { abbr: "FF",   name: "Fiko Fins",                     division: "West", managers: ["Rafik Zarifa"],                group: "L", accent: "#0e8aa0" },
  { abbr: "RBLD", name: "Another Rebuilding Year",       division: "East", managers: ["Zack Girgis", "Andrew Ishak"], group: "J", accent: "#b07d2b" },
  { abbr: "TMM",  name: "The Metcalf Matrix",            division: "West", managers: ["David Masoud"],                group: "K", accent: "#2c3e50" },
  { abbr: "AM",   name: "Purdy Pitches",                 division: "West", managers: ["Alex Mikhail", "Michael Shanoudi"], group: "B", accent: "#c0392b" },
  { abbr: "R",    name: "Ms. Jackson ouuuuuuuuuuuu",     division: "East", managers: ["Mario Rofael"],                group: "C", accent: "#7d8c2b" }
];

/* Groups B–L of the 2026 World Cup (Group A excluded — already started).
   c1/c2 are the gradient colors of each country's bar. */
var GROUPS = {
  B: {
    letter: "B",
    countries: [
      { name: "Canada",               flag: "🇨🇦", c1: "#c8102e", c2: "#8f0b21", goals: 0, yellows: 0, reds: 0 },
      { name: "Bosnia & Herzegovina", flag: "🇧🇦", c1: "#002f87", c2: "#0a4fc9", goals: 0, yellows: 0, reds: 0 },
      { name: "Qatar",                flag: "🇶🇦", c1: "#8a1538", c2: "#5e0e26", goals: 0, yellows: 0, reds: 0 },
      { name: "Switzerland",          flag: "🇨🇭", c1: "#da291c", c2: "#9e1c12", goals: 0, yellows: 0, reds: 0 }
    ]
  },
  C: {
    letter: "C",
    countries: [
      { name: "Brazil",   flag: "🇧🇷", c1: "#009739", c2: "#006227", goals: 0, yellows: 0, reds: 0 },
      { name: "Morocco",  flag: "🇲🇦", c1: "#c1272d", c2: "#7a1419", goals: 0, yellows: 0, reds: 0 },
      { name: "Haiti",    flag: "🇭🇹", c1: "#00209f", c2: "#001a70", goals: 0, yellows: 0, reds: 0 },
      { name: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", c1: "#003078", c2: "#001f4d", goals: 0, yellows: 0, reds: 0 }
    ]
  },
  D: {
    letter: "D",
    countries: [
      { name: "United States", flag: "🇺🇸", c1: "#2b4ea0", c2: "#b22234", goals: 0, yellows: 0, reds: 0 },
      { name: "Paraguay",      flag: "🇵🇾", c1: "#d52b1e", c2: "#0038a8", goals: 0, yellows: 0, reds: 0 },
      { name: "Australia",     flag: "🇦🇺", c1: "#cf9400", c2: "#00843d", goals: 0, yellows: 0, reds: 0 },
      { name: "Türkiye",       flag: "🇹🇷", c1: "#e30a17", c2: "#9e0710", goals: 0, yellows: 0, reds: 0 }
    ]
  },
  E: {
    letter: "E",
    countries: [
      { name: "Germany",     flag: "🇩🇪", c1: "#3a3a3a", c2: "#111111", goals: 0, yellows: 0, reds: 0 },
      { name: "Curaçao",     flag: "🇨🇼", c1: "#002b7f", c2: "#00204f", goals: 0, yellows: 0, reds: 0 },
      { name: "Ivory Coast", flag: "🇨🇮", c1: "#f77f00", c2: "#c95e00", goals: 0, yellows: 0, reds: 0 },
      { name: "Ecuador",     flag: "🇪🇨", c1: "#d4a017", c2: "#8c6900", goals: 0, yellows: 0, reds: 0 }
    ]
  },
  F: {
    letter: "F",
    countries: [
      { name: "Netherlands", flag: "🇳🇱", c1: "#f36c21", c2: "#b84a0d", goals: 0, yellows: 0, reds: 0 },
      { name: "Japan",       flag: "🇯🇵", c1: "#bc002d", c2: "#7a001e", goals: 0, yellows: 0, reds: 0 },
      { name: "Sweden",      flag: "🇸🇪", c1: "#006aa7", c2: "#004b76", goals: 0, yellows: 0, reds: 0 },
      { name: "Tunisia",     flag: "🇹🇳", c1: "#e70013", c2: "#9c000d", goals: 0, yellows: 0, reds: 0 }
    ]
  },
  G: {
    letter: "G",
    countries: [
      { name: "Belgium",     flag: "🇧🇪", c1: "#5b5651", c2: "#2a2724", goals: 0, yellows: 0, reds: 0 },
      { name: "Egypt",       flag: "🇪🇬", c1: "#ce1126", c2: "#8c0b1a", goals: 0, yellows: 0, reds: 0 },
      { name: "Iran",        flag: "🇮🇷", c1: "#239f40", c2: "#136127", goals: 0, yellows: 0, reds: 0 },
      { name: "New Zealand", flag: "🇳🇿", c1: "#00247d", c2: "#001647", goals: 0, yellows: 0, reds: 0 }
    ]
  },
  H: {
    letter: "H",
    countries: [
      { name: "Spain",        flag: "🇪🇸", c1: "#c60b1e", c2: "#9a0816", goals: 0, yellows: 0, reds: 0 },
      { name: "Cape Verde",   flag: "🇨🇻", c1: "#003893", c2: "#5b92e5", goals: 0, yellows: 0, reds: 0 },
      { name: "Saudi Arabia", flag: "🇸🇦", c1: "#006c35", c2: "#004d24", goals: 0, yellows: 0, reds: 0 },
      { name: "Uruguay",      flag: "🇺🇾", c1: "#3f87bd", c2: "#28628f", goals: 0, yellows: 0, reds: 0 }
    ]
  },
  I: {
    letter: "I",
    countries: [
      { name: "France",  flag: "🇫🇷", c1: "#1f3c9e", c2: "#0c1f63", goals: 0, yellows: 0, reds: 0 },
      { name: "Senegal", flag: "🇸🇳", c1: "#00853f", c2: "#005226", goals: 0, yellows: 0, reds: 0 },
      { name: "Iraq",    flag: "🇮🇶", c1: "#a31621", c2: "#4d0a10", goals: 0, yellows: 0, reds: 0 },
      { name: "Norway",  flag: "🇳🇴", c1: "#ba0c2f", c2: "#00205b", goals: 0, yellows: 0, reds: 0 }
    ]
  },
  J: {
    letter: "J",
    countries: [
      { name: "Argentina", flag: "🇦🇷", c1: "#4a92d0", c2: "#2f6ea3", goals: 0, yellows: 0, reds: 0 },
      { name: "Algeria",   flag: "🇩🇿", c1: "#006233", c2: "#003d1f", goals: 0, yellows: 0, reds: 0 },
      { name: "Austria",   flag: "🇦🇹", c1: "#ed2939", c2: "#a31621", goals: 0, yellows: 0, reds: 0 },
      { name: "Jordan",    flag: "🇯🇴", c1: "#007a3d", c2: "#00471f", goals: 0, yellows: 0, reds: 0 }
    ]
  },
  K: {
    letter: "K",
    countries: [
      { name: "Portugal",   flag: "🇵🇹", c1: "#a3122a", c2: "#046a38", goals: 0, yellows: 0, reds: 0 },
      { name: "DR Congo",   flag: "🇨🇩", c1: "#007fff", c2: "#0050a0", goals: 0, yellows: 0, reds: 0 },
      { name: "Uzbekistan", flag: "🇺🇿", c1: "#0099b5", c2: "#006478", goals: 0, yellows: 0, reds: 0 },
      { name: "Colombia",   flag: "🇨🇴", c1: "#caa10a", c2: "#946f00", goals: 0, yellows: 0, reds: 0 }
    ]
  },
  L: {
    letter: "L",
    countries: [
      { name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", c1: "#c8102e", c2: "#8a0b1f", goals: 0, yellows: 0, reds: 0 },
      { name: "Croatia", flag: "🇭🇷", c1: "#d12127", c2: "#16387f", goals: 0, yellows: 0, reds: 0 },
      { name: "Ghana",   flag: "🇬🇭", c1: "#006b3f", c2: "#003d23", goals: 0, yellows: 0, reds: 0 },
      { name: "Panama",  flag: "🇵🇦", c1: "#005293", c2: "#d21034", goals: 0, yellows: 0, reds: 0 }
    ]
  }
};
