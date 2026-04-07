#!/usr/bin/env node

const WTT_API_URL = "https://liveeventsapi.worldtabletennis.com/api/cms/GetOfficialResult";
const ITTF_RESULTS_BASE_URL = "https://results.ittf.com/ittf-web-results/html";
const ZENNIHON_BASE_URL = "https://www.japantabletennis.com/AJ";
const DEFAULT_TAKE = 800;
const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const DEFAULT_TRANSLATIONS_PATH = path.join(DEFAULT_DATA_DIR, "translations.ja.json");
const DEFAULT_RULES_PATH = path.join(DEFAULT_DATA_DIR, "rules.json");
const DEFAULT_CACHE_DIR = path.join(DEFAULT_DATA_DIR, ".cache");
const DEFAULT_ZENNIHON_ARCHIVE_DIR = path.join(DEFAULT_DATA_DIR, "zennihon-records");
const DEFAULT_WTT_ARCHIVE_DIR = path.join(DEFAULT_DATA_DIR, "wtt-records");
const DEFAULT_WTT_ARCHIVE_INDEX_PATH = path.join(DEFAULT_DATA_DIR, "wtt-archive-index.json");
const DEFAULT_WTT_DATE_INDEX_PATH = path.join(DEFAULT_DATA_DIR, "wtt-date-index.json");
const ZENNIHON_ARCHIVE_YEARS = new Set(
  Array.from({ length: 15 }, (_, index) => String(2011 + index)),
);

function parseArgs(argv) {
  const args = {
    source: "wtt",
    event: null,
    category: null,
    gender: null,
    discipline: null,
    round: null,
    contains: null,
    docCode: null,
    limit: null,
    take: DEFAULT_TAKE,
    json: false,
    list: false,
    pretty: true,
    ja: false,
    translations: DEFAULT_TRANSLATIONS_PATH,
    cacheDir: DEFAULT_CACHE_DIR,
    zennihonArchiveDir: DEFAULT_ZENNIHON_ARCHIVE_DIR,
    wttArchiveDir: DEFAULT_WTT_ARCHIVE_DIR,
    wttArchiveIndexPath: DEFAULT_WTT_ARCHIVE_INDEX_PATH,
    wttDateIndexPath: DEFAULT_WTT_DATE_INDEX_PATH,
    refreshCache: false,
    omitSetCounts: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case "--source":
      case "-s":
        args.source = next;
        i += 1;
        break;
      case "--event":
      case "-e":
        args.event = next;
        i += 1;
        break;
      case "--gender":
      case "-g":
        args.gender = next;
        i += 1;
        break;
      case "--category":
      case "--sub-event":
      case "--subevent":
      case "-c":
        args.category = next;
        i += 1;
        break;
      case "--discipline":
      case "--event-type":
        args.discipline = next;
        i += 1;
        break;
      case "--round":
      case "--stage":
      case "-r":
        args.round = next;
        i += 1;
        break;
      case "--contains":
      case "-q":
        args.contains = next;
        i += 1;
        break;
      case "--doc-code":
      case "-d":
        args.docCode = next;
        i += 1;
        break;
      case "--limit":
      case "-n":
        args.limit = Number(next);
        i += 1;
        break;
      case "--take":
        args.take = Number(next);
        i += 1;
        break;
      case "--json":
        args.json = true;
        break;
      case "--list":
        args.list = true;
        break;
      case "--compact":
        args.pretty = false;
        break;
      case "--ja":
        args.ja = true;
        break;
      case "--translations":
        args.translations = next;
        i += 1;
        break;
      case "--rules":
        args.rules = next;
        i += 1;
        break;
      case "--wtt-date-index":
        args.wttDateIndexPath = next;
        i += 1;
        break;
      case "--cache-dir":
        args.cacheDir = next;
        i += 1;
        break;
      case "--zennihon-archive-dir":
        args.zennihonArchiveDir = next;
        i += 1;
        break;
      case "--wtt-archive-dir":
        args.wttArchiveDir = next;
        i += 1;
        break;
      case "--wtt-archive-index":
        args.wttArchiveIndexPath = next;
        i += 1;
        break;
      case "--refresh-cache":
        args.refreshCache = true;
        break;
      case "--omit-set-counts":
        args.omitSetCounts = true;
        break;
      case "--help":
      case "-h":
        printHelp(0);
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  args.source = normalizeSource(args.source);
  if (!args.event) {
    throw new Error("--event is required");
  }

  return args;
}

function printHelp(exitCode = 0) {
  const lines = [
    "Usage:",
    "  node extract_individual_matches.js --event 2751 [options]",
    "",
    "Options:",
    "  --source, -s     wtt | zennihon",
    "  --category, -c   Exact category label, e.g. \"U19 Boys' Singles\"",
    "  --gender, -g     men | women",
    "  --discipline     singles | doubles | mixed",
    "  --round, -r      quarterfinal | semifinal | final | 'round of 16'",
    "  --contains, -q   Free-text filter across description and team names",
    "  --doc-code, -d   Exact match document code",
    "  --limit, -n      Limit output matches",
    "  --take           API page size to request, default 200",
    "  --json           Print normalized JSON",
    "  --list           Print one-line summaries only",
    "  --compact        Compact JSON output",
    "  --ja             Print Japanese-style formatted output",
    "  --translations   Path to Japanese name mapping JSON",
    "  --rules          Path to formatter rules JSON",
    "  --cache-dir      Directory for API response cache",
    "  --zennihon-archive-dir Directory for persisted zennihon JSON snapshots",
    "  --wtt-archive-dir Directory for persisted WTT JSON snapshots",
    "  --wtt-archive-index Path to WTT archive index JSON",
    "  --refresh-cache  Ignore cache and refetch from API",
    "  --omit-set-counts Print JA singles without 3(...)2 set counts",
    "",
    "Examples:",
    "  node extract_individual_matches.js --event 2751 --gender men --round quarterfinal",
    "  node extract_individual_matches.js --event 2751 --contains Lin --json",
  ];

  console.log(lines.join("\n"));
  process.exit(exitCode);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSource(value) {
  const text = normalizeText(value || "wtt");
  if (!text) {
    return "wtt";
  }
  if (["wtt", "world table tennis"].includes(text)) {
    return "wtt";
  }
  if (["zennihon", "all japan", "alljapan", "all japan championships", "jtta", "全日本"].includes(text)) {
    return "zennihon";
  }
  return text;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"");
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeZennihonName(rawName) {
  return String(rawName || "")
    .replace(/\s+/g, " ")
    .replace(/・/g, "・")
    .trim();
}

function normalizeZennihonCompetitorNames(rawHtml) {
  return decodeHtmlEntities(String(rawHtml || ""))
    .split(/<br\s*\/?>/i)
    .map((name) => normalizeZennihonName(stripHtml(name)))
    .filter(Boolean);
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function inferGender(value) {
  const text = normalizeText(value);
  if (text === "women" || text === "womens" || text === "female") {
    return "women";
  }
  if (text === "men" || text === "mens" || text === "male") {
    return "men";
  }
  if (text === "girls" || text === "girl") {
    return "women";
  }
  if (text === "boys" || text === "boy") {
    return "men";
  }
  if (text === "mixed" || text === "mix") {
    return "mixed";
  }
  if (
    text.includes("womens team") ||
    text.includes("womens teams") ||
    text.includes("women team") ||
    text.includes("womens single") ||
    text.includes("women single") ||
    text.includes("womens doubles") ||
    text.includes("women doubles") ||
    text.includes("womens mixed")
  ) {
    return "women";
  }
  if (
    text.includes("girls team") ||
    text.includes("girls teams") ||
    text.includes("girls single") ||
    text.includes("girls doubles")
  ) {
    return "women";
  }
  if (
    text.includes("mens team") ||
    text.includes("mens teams") ||
    text.includes("men team") ||
    text.includes("mens single") ||
    text.includes("men single") ||
    text.includes("mens doubles") ||
    text.includes("men doubles") ||
    text.includes("mens mixed")
  ) {
    return "men";
  }
  if (
    text.includes("boys team") ||
    text.includes("boys teams") ||
    text.includes("boys single") ||
    text.includes("boys doubles")
  ) {
    return "men";
  }
  if (
    text.includes("mixed doubles") ||
    text.includes("mixed double") ||
    text.includes("mixed")
  ) {
    return "mixed";
  }
  return null;
}

function normalizeRound(value) {
  const raw = String(value || "").trim();
  const text = normalizeText(value);
  const compactRaw = raw.replace(/\s+/g, "").toLowerCase();

  if (!raw && !text) {
    return null;
  }

  const stageMatch = text.match(/\bstage\s*1\s*([ab])\b/);
  const hasGroup = /\bgroup\b|\bpool\b/.test(text);
  if (stageMatch) {
    const stageKey = `stage_1${stageMatch[1]}`;
    return hasGroup ? `${stageKey}_group` : stageKey;
  }

  if (text.includes("preliminary round")) {
    return "preliminary_round";
  }

  if (text.includes("bronze medal match")) {
    return "bronze_medal_match";
  }

  if (text.includes("gold medal match") || text.includes("gold medal team match")) {
    return "final";
  }

  const qualifyingRoundMatch = text.match(/\bqualifying\s*round\s*(\d+)\b/);
  if (qualifyingRoundMatch) {
    return `qualifying_round_${qualifyingRoundMatch[1]}`;
  }

  const japaneseRoundNumberMatch = compactRaw.match(/^第?([0-9０-９]+)回戦$/);
  if (japaneseRoundNumberMatch) {
    const roundNumber = Number(japaneseRoundNumberMatch[1].replace(/[０-９]/g, (digit) =>
      String("０１２３４５６７８９".indexOf(digit))));
    return Number.isFinite(roundNumber) ? `knockout_round_${roundNumber}` : null;
  }

  const japaneseAliases = [
    ["quarterfinal", ["準々決勝", "準準決勝"]],
    ["semifinal", ["準決勝"]],
    ["final", ["決勝"]],
    ["qualifying_round_1", ["予選1回戦", "予選１回戦", "予選第1回戦", "予選第１回戦"]],
    ["qualifying_round_2", ["予選2回戦", "予選２回戦", "予選第2回戦", "予選第２回戦"]],
    ["qualifying_round_3", ["予選3回戦", "予選３回戦", "予選第3回戦", "予選第３回戦"]],
    ["round_of_128", ["ベスト128", "128強"]],
    ["round_of_64", ["ベスト64", "64強"]],
    ["round_of_32", ["ベスト32", "32強"]],
    ["round_of_16", ["ベスト16", "16強"]],
    ["qualifying", ["予選"]],
    ["group", ["グループ", "予選リーグ"]],
    ["preliminary_round", ["予備ラウンド"]],
  ];

  for (const [canonical, values] of japaneseAliases) {
    if (values.some((alias) => compactRaw === alias.toLowerCase() || compactRaw.includes(alias.toLowerCase()))) {
      return canonical;
    }
  }

  const aliases = [
    ["quarterfinal", ["quarterfinal", "quarterfinals", "quarter final", "quarter finals", "quarter-final", "quarter-finals", "qf"]],
    ["semifinal", ["semifinal", "semifinals", "semi final", "semi finals", "semi-final", "semi-finals", "sf"]],
    ["qualifying_round_1", ["qualifying round 1", "qr1"]],
    ["qualifying_round_2", ["qualifying round 2", "qr2"]],
    ["qualifying_round_3", ["qualifying round 3", "qr3"]],
    ["round_of_128", ["round of 128", "r128", "best 128"]],
    ["round_of_64", ["round of 64", "r64", "best 64"]],
    ["round_of_16", ["round of 16", "r16", "best 16"]],
    ["round_of_32", ["round of 32", "r32", "best 32"]],
    ["final", ["final", "finals", "f"]],
    ["group", ["group", "pool"]],
  ];

  for (const [canonical, values] of aliases) {
    if (values.some((alias) => text === alias)) {
      return canonical;
    }
  }

  return text || null;
}

function normalizeDiscipline(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  if (text === "team" || text === "teams" || text.includes("team")) {
    return "teams";
  }
  if (text === "mixed" || text === "mixed doubles" || text === "mixed double") {
    return "mixed";
  }
  if (text === "single" || text === "singles" || text.includes("single")) {
    return "singles";
  }
  if (text === "double" || text === "doubles" || text.includes("double")) {
    return "doubles";
  }

  return text;
}

function normalizeCategory(value) {
  const text = normalizeText(value);
  if (!text) {
    return { gender: null, discipline: null, categoryName: null, isExactCategory: false };
  }

  const genericCategories = new Set([
    "men teams",
    "mens teams",
    "women teams",
    "womens teams",
    "mixed teams",
    "mixed team",
    "men singles",
    "women singles",
    "men doubles",
    "women doubles",
    "mixed doubles",
    "mixed mixed",
  ]);

  if (!genericCategories.has(text)) {
    return {
      gender: null,
      discipline: null,
      categoryName: value,
      isExactCategory: true,
    };
  }

  if (text.includes("mixed")) {
    return { gender: "mixed", discipline: "mixed", categoryName: null, isExactCategory: false };
  }

  return {
    gender: inferGender(value),
    discipline: normalizeDiscipline(value),
    categoryName: null,
    isExactCategory: false,
  };
}

function normalizeCategoryLabel(value) {
  return normalizeText(value)
    .replace(/['’]/g, "")
    .replace(/\bmens\b/g, "men")
    .replace(/\bwomens\b/g, "women")
    .replace(/\bmixed mixed\b/g, "mixed doubles")
    .replace(/\s+/g, " ")
    .trim();
}

function toCanonicalCategoryName(value, gender = null, discipline = null) {
  const raw = String(value || "").trim();
  const normalized = normalizeCategoryLabel(raw);
  const canonicalMap = {
    "junior boys singles": "Junior Boys Singles",
    "junior girls singles": "Junior Girls Singles",
    "men teams": "Men Teams",
    "women teams": "Women Teams",
    "mixed teams": "Mixed Teams",
    "mixed team": "Mixed Teams",
    "men singles": "Men Singles",
    "women singles": "Women Singles",
    "men doubles": "Men Doubles",
    "women doubles": "Women Doubles",
    "mixed doubles": "Mixed Doubles",
    "mixed mixed": "Mixed Doubles",
  };

  if (canonicalMap[normalized]) {
    return canonicalMap[normalized];
  }

  const youthMatch = raw.match(/^U\s*(\d+)\s+(Boys|Girls|Mixed)\s*'?s?\s+(Singles|Doubles|Teams)$/i);
  if (youthMatch) {
    const [, age, division, eventType] = youthMatch;
    const divisionCanonical = /^boys$/i.test(division) ? "Boys" : /^girls$/i.test(division) ? "Girls" : "Mixed";
    const eventTypeCanonical = /^singles$/i.test(eventType)
      ? "Singles"
      : /^doubles$/i.test(eventType)
        ? "Doubles"
        : "Teams";
    return `U${age} ${divisionCanonical} ${eventTypeCanonical}`;
  }

  if (gender === "men") {
    if (discipline === "teams") {
      return "Men Teams";
    }
    if (discipline === "doubles") {
      return "Men Doubles";
    }
    return "Men Singles";
  }
  if (gender === "women") {
    if (discipline === "teams") {
      return "Women Teams";
    }
    if (discipline === "doubles") {
      return "Women Doubles";
    }
    return "Women Singles";
  }
  if (gender === "mixed") {
    if (discipline === "teams") {
      return "Mixed Teams";
    }
    return "Mixed Doubles";
  }

  return raw;
}

function extractCategoryNameFromDescription(description) {
  const text = String(description || "").trim();
  if (!text) {
    return null;
  }

  const youthMatch = text.match(/^(U\s*\d+\s+(?:Boys|Girls|Mixed)(?:\s*'?s?)?\s+(?:Singles|Doubles|Teams))/i);
  if (youthMatch) {
    return youthMatch[1].replace(/\s+/g, " ").trim();
  }

  return null;
}

function resolveCanonicalCategoryName(rawCategoryName, description, gender = null, discipline = null) {
  const describedCategory = extractCategoryNameFromDescription(description);
  if (describedCategory) {
    return toCanonicalCategoryName(describedCategory, gender, discipline);
  }
  return toCanonicalCategoryName(rawCategoryName, gender, discipline);
}

function extractRound(description) {
  const raw = String(description || "");
  const segments = raw
    .split(/\s+-\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const roundParts = segments.slice(1).filter((segment) => !/^Match\b/i.test(segment));
  let roundLabel = roundParts.length ? roundParts.join(" - ") : null;

  if (!roundLabel) {
    const directMatch = raw.match(
      /\b(Preliminary Round|Round of 16|Round of 32|Round of 64|Round of 128|Quarterfinals?|Semifinals?|Finals?|Gold Medal(?: Team)? Match|Bronze Medal(?: Team)? Match)\b/i,
    );
    if (directMatch) {
      roundLabel = directMatch[1];
    }
  }

  return {
    roundLabel,
    roundKey: normalizeRound(roundLabel),
  };
}

function matchesRoundFilter(matchRoundKey, wantedRound, context = null) {
  if (!matchRoundKey || !wantedRound) {
    return false;
  }

  if (matchRoundKey === wantedRound) {
    return true;
  }

  if (wantedRound === "group") {
    return (
      matchRoundKey === "group" ||
      matchRoundKey.startsWith("group ") ||
      matchRoundKey.endsWith("_group")
    );
  }

  if (wantedRound === "qualifying") {
    return (
      matchRoundKey === "preliminary_round" ||
      matchRoundKey.startsWith("qualifying_round_") ||
      matchRoundKey === "group" ||
      matchRoundKey.startsWith("group ") ||
      matchRoundKey.endsWith("_group")
    );
  }

  if (wantedRound === "stage_1a" || wantedRound === "stage_1b") {
    return matchRoundKey === wantedRound || matchRoundKey === `${wantedRound}_group`;
  }

  const knockoutRoundMatch = String(wantedRound).match(/^knockout_round_(\d+)$/);
  if (knockoutRoundMatch) {
    return context?.knockoutRoundNumbers?.[matchRoundKey] === `${knockoutRoundMatch[1]}回戦`;
  }

  return false;
}

function extractMatchNumber(description) {
  const match = String(description || "").match(/\bMatch\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function splitGameScores(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => entry !== "0-0");
}

function normalizePlayer(player) {
  if (!player) {
    return null;
  }

  return {
    id: player.playerId ?? null,
    name: player.playerName ?? null,
    org: player.playerOrgCode ?? null,
    orgCode: player.playerOrgCode ?? null,
    position: player.playerPosition ?? null,
  };
}

function normalizeCompetitor(competitor) {
  if (!competitor) {
    return null;
  }

  return {
    type: competitor.competitorType ?? competitor.competitor_type ?? null,
    id: competitor.competitiorId ?? competitor.competitior_id ?? null,
    name: competitor.competitiorName ?? competitor.competitior_name ?? null,
    org: competitor.competitiorOrg ?? competitor.competitior_org ?? null,
    orgCode: competitor.competitiorOrg ?? competitor.competitior_org ?? null,
    irm: competitor.irm ?? null,
    players: Array.isArray(competitor.players) ? competitor.players.map(normalizePlayer) : [],
  };
}

function readTranslations(filePath) {
  const parsed = readJsonFile(filePath, { teams: {}, players: {}, rounds: {}, headers: {} }, "translations");
  return {
    teams: parsed.teams || {},
    players: parsed.players || {},
    rounds: parsed.rounds || {},
    headers: parsed.headers || {},
  };
}

function readRules(filePath) {
  const parsed = readJsonFile(
    filePath,
    {
      labels: {
        knockoutPrefix: "決勝トーナメント",
        groupPrefix: "グループ",
        stageDisplay: {
          stage_1a: "Stage1A",
          stage_1a_group: "Stage1Aグループ",
          stage_1b: "Stage1B",
          stage_1b_group: "Stage1Bグループ",
        },
        preliminaryRound: "予備ラウンド",
      },
      roundFallbacks: {
        quarterfinal: "決勝トーナメント準々決勝",
        semifinal: "決勝トーナメント準決勝",
        final: "決勝トーナメント決勝",
        round_of_128: "決勝トーナメント1回戦",
        round_of_64: "決勝トーナメント2回戦",
        round_of_16: "決勝トーナメント1回戦",
        round_of_32: "決勝トーナメント2回戦",
      },
    },
    "rules",
  );

  return {
    labels: {
      knockoutPrefix: parsed.labels?.knockoutPrefix || "決勝トーナメント",
      groupPrefix: parsed.labels?.groupPrefix || "グループ",
      stageDisplay: parsed.labels?.stageDisplay || {},
      preliminaryRound: parsed.labels?.preliminaryRound || "予備ラウンド",
    },
    roundFallbacks: parsed.roundFallbacks || {},
  };
}

function readJsonFile(filePath, fallback, label) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }
}

function translate(value, dictionary) {
  return dictionary?.[value] || value;
}

function compactJapaneseName(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々ヶ]+ [\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々ヶ]+$/u.test(raw)) {
    return raw.replace(/ /g, "");
  }

  return raw;
}

function getNameTranslationCandidates(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  const collapsed = raw.replace(/\s+/g, " ");
  const candidates = [raw];

  if (collapsed !== raw) {
    candidates.push(collapsed);
  }

  const parts = collapsed.split(" ").filter(Boolean);
  if (parts.length === 2) {
    candidates.push(`${parts[1]} ${parts[0]}`);
    candidates.push(`${parts[1].toUpperCase()} ${parts[0]}`);
    candidates.push(`${parts[0]} ${parts[1].toUpperCase()}`);
  }

  if (parts.length >= 2) {
    const givenNames = parts.slice(0, -1).join(" ");
    const familyName = parts[parts.length - 1];
    candidates.push(`${familyName} ${givenNames}`);
    candidates.push(`${familyName.toUpperCase()} ${givenNames}`);
    candidates.push(`${givenNames} ${familyName.toUpperCase()}`);
  }

  return [...new Set(candidates)];
}

function translatePlayer(value, translations) {
  const candidates = getNameTranslationCandidates(value);

  for (const candidate of candidates) {
    if (translations.players?.[candidate]) {
      return compactJapaneseName(translations.players[candidate]);
    }
  }

  return compactJapaneseName(value);
}

function translateTeam(team, translations) {
  const rawName = team?.name || "";
  const normalizedName = rawName.replace(/\s+\d+$/, "");
  const candidates = [rawName, normalizedName, team?.orgCode, team?.org].filter(Boolean);

  for (const candidate of candidates) {
    if (translations.teams?.[candidate]) {
      return translations.teams[candidate];
    }
  }

  return rawName;
}

function translateOrg(value, translations, options = {}) {
  const raw = String(value || "").trim();
  const rawCode = String(options.orgCode || "").trim();
  if (rawCode && translations.teams?.[rawCode]) {
    return translations.teams[rawCode];
  }
  if (!raw) {
    return "";
  }

  if (translations.teams?.[raw]) {
    return translations.teams[raw];
  }

  if (raw.includes("/")) {
    return raw
      .split("/")
      .map((part) => translations.teams?.[part] || part)
      .join("/");
  }

  return raw;
}

function getSearchTermsForTeam(team, translations) {
  return [
    team?.name,
    team?.org,
    team?.orgCode,
    translateTeam(team, translations),
    translations.teams?.[team?.org || ""],
    translations.teams?.[team?.orgCode || ""],
  ].filter(Boolean);
}

function getSearchTermsForSingle(single, translations) {
  return (single?.competitors || []).flatMap((competitor) => {
    const names = [
      competitor?.name,
      competitor?.org,
      competitor?.orgCode,
      ...getNameTranslationCandidates(competitor?.name),
      translatePlayer(competitor?.name || "", translations),
      ...((competitor?.players || []).flatMap((player) => [
        player?.name,
        player?.orgCode,
        ...getNameTranslationCandidates(player?.name),
        translatePlayer(player?.name || "", translations),
      ])),
      translations.teams?.[competitor?.org || ""],
      translations.teams?.[competitor?.orgCode || ""],
    ];

    return names.filter(Boolean);
  });
}

function getSearchTermsForCompetitor(competitor, translations) {
  const names = [
    competitor?.name,
    competitor?.org,
    competitor?.orgCode,
    ...getNameTranslationCandidates(competitor?.name),
    translatePlayer(competitor?.name || "", translations),
    ...((competitor?.players || []).flatMap((player) => [
      player?.name,
      player?.orgCode,
      ...getNameTranslationCandidates(player?.name),
      translatePlayer(player?.name || "", translations),
    ])),
    translations.teams?.[competitor?.org || ""],
    translations.teams?.[competitor?.orgCode || ""],
  ];

  return names.filter(Boolean);
}

function buildMatchSearchText(match, translations) {
  return normalizeSearchText(
    [
      match.description,
      match.subEventType,
      match.roundLabel,
      match.roundKey,
      ...match.teams.flatMap((team) => getSearchTermsForTeam(team, translations)),
      ...match.singles.flatMap((single) => getSearchTermsForSingle(single, translations)),
      ...(match.competitors || []).flatMap((competitor) => getSearchTermsForCompetitor(competitor, translations)),
    ].join(" "),
  );
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getCachePath(cacheDir, source, eventId, take) {
  return path.join(cacheDir, `${source}_event_${eventId}_take_${take}.json`);
}

function getLegacyWttCachePath(cacheDir, eventId, take) {
  return path.join(cacheDir, `event_${eventId}_take_${take}.json`);
}

function readCache(cachePath) {
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(cachePath, "utf8"));
}

function writeCache(cachePath, payload) {
  ensureDir(path.dirname(cachePath));
  fs.writeFileSync(cachePath, JSON.stringify(payload), "utf8");
}

function getZennihonArchivePath(archiveDir, eventId) {
  return path.join(archiveDir, `${String(eventId || "").trim()}.json`);
}

function readZennihonArchive(archiveDir, eventId) {
  const archivePath = getZennihonArchivePath(archiveDir, eventId);
  if (!fs.existsSync(archivePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(archivePath, "utf8"));
}

function writeZennihonArchive(archiveDir, eventId, payload) {
  const archivePath = getZennihonArchivePath(archiveDir, eventId);
  ensureDir(path.dirname(archivePath));
  fs.writeFileSync(archivePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function shouldUseZennihonArchive(eventId) {
  return ZENNIHON_ARCHIVE_YEARS.has(String(eventId || "").trim());
}

function getWttArchivePath(archiveDir, eventId) {
  return path.join(archiveDir, `${String(eventId || "").trim()}.json`);
}

function readWttArchive(archiveDir, eventId) {
  const archivePath = getWttArchivePath(archiveDir, eventId);
  if (!fs.existsSync(archivePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(archivePath, "utf8"));
}

function writeWttArchive(archiveDir, eventId, payload) {
  const archivePath = getWttArchivePath(archiveDir, eventId);
  ensureDir(path.dirname(archivePath));
  fs.writeFileSync(archivePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function readWttArchiveIndex(indexPath) {
  if (!fs.existsSync(indexPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

function readWttDateIndex(indexPath) {
  if (!fs.existsSync(indexPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

function writeWttDateIndex(indexPath, payload) {
  ensureDir(path.dirname(indexPath));
  fs.writeFileSync(indexPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function writeWttArchiveIndex(indexPath, payload) {
  ensureDir(path.dirname(indexPath));
  fs.writeFileSync(indexPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function updateWttArchiveIndexEntry(indexPath, eventId, entry) {
  const index = readWttArchiveIndex(indexPath);
  index[String(eventId)] = {
    ...(index[String(eventId)] || {}),
    ...entry,
  };
  writeWttArchiveIndex(indexPath, index);
}

function getLocalDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shouldReuseCachedPayload(source, payload) {
  if (!payload) {
    return false;
  }

  if (Array.isArray(payload) && payload.length === 0) {
    return source !== "wtt" && source !== "zennihon";
  }

  return true;
}

function normalizeIndividualMatch(entry, index) {
  const result = entry?.match_result ?? entry?.matchResult ?? null;
  const competitors = Array.isArray(result?.competitiors)
    ? result.competitiors.map(normalizeCompetitor)
    : Array.isArray(result?.Competitiors)
      ? result.Competitiors.map(normalizeCompetitor)
      : [];

  return {
    order: index + 1,
    documentCode: result?.documentCode ?? entry?.value ?? null,
    description: result?.subEventDescription ?? null,
    overallScore: result?.overallScores ?? null,
    resultStatus: result?.resultStatus ?? null,
    gameScores: splitGameScores(result?.gameScores ?? result?.resultsGameScores),
    competitors,
    winnerOrg: inferWinnerOrg(result),
  };
}

function inferWinnerOrg(result) {
  const score = String(result?.overallScores || "");
  const values = score
    .replace(/[^\d-]/g, "")
    .split("-")
    .map((part) => Number(part));

  if (values.length !== 2 || values.some(Number.isNaN)) {
    return null;
  }

  const competitors = Array.isArray(result?.competitiors)
    ? result.competitiors
    : Array.isArray(result?.Competitiors)
      ? result.Competitiors
      : [];

  if (competitors.length < 2) {
    return null;
  }

  if (values[0] > values[1]) {
    return competitors[0]?.competitiorOrg ?? null;
  }
  if (values[1] > values[0]) {
    return competitors[1]?.competitiorOrg ?? null;
  }
  return null;
}

function normalizeTeamMatch(item) {
  const card = item?.match_card;
  if (!card?.teamParentData) {
    return null;
  }

  const competitors = Array.isArray(card.competitiors) ? card.competitiors.map(normalizeCompetitor) : [];
  const rawCategoryName = item.subEventType ?? card.subEventName ?? null;
  const discipline = normalizeDiscipline(rawCategoryName);
  const gender = inferGender(rawCategoryName);
  const categoryName = resolveCanonicalCategoryName(rawCategoryName, card.subEventDescription, gender, discipline);
  if (!/\bTeams$/i.test(String(categoryName || "").trim())) {
    return null;
  }
  const teams = competitors.map((competitor) => ({
    name: competitor?.name ?? null,
    org: competitor?.org ?? null,
  }));
  const round = extractRound(card.subEventDescription);
  const nested = card?.teamParentData?.extended_info?.matches;

  return {
    matchType: "team",
    id: item.id ?? null,
    eventId: item.eventId ?? card.eventId ?? null,
    documentCode: item.documentCode ?? card.documentCode ?? null,
    subEventType: rawCategoryName,
    categoryName,
    discipline,
    gender,
    roundLabel: round.roundLabel,
    roundKey: round.roundKey,
    matchNumber: extractMatchNumber(card.subEventDescription),
    description: card.subEventDescription ?? null,
    venue: card.venueName ?? null,
    table: card.tableName ?? card.tableNumber ?? null,
    overallScore: card.overallScores ?? null,
    resultStatus: card.resultStatus ?? item.fullResults ?? null,
    teams,
    singles: Array.isArray(nested) ? nested.map(normalizeIndividualMatch) : [],
    competitors: [],
    gameScores: [],
  };
}

function normalizeStandaloneMatch(item) {
  const card = item?.match_card;
  if (!card || card?.teamParentData) {
    return null;
  }

  const competitors = Array.isArray(card.competitiors) ? card.competitiors.map(normalizeCompetitor) : [];
  const rawCategoryName = item.subEventType ?? card.subEventName ?? null;
  const discipline = normalizeDiscipline(rawCategoryName);
  const gender = inferGender(rawCategoryName);
  const round = extractRound(card.subEventDescription);

  return {
    matchType: "individual",
    id: item.id ?? null,
    eventId: item.eventId ?? card.eventId ?? null,
    documentCode: item.documentCode ?? card.documentCode ?? null,
    subEventType: rawCategoryName,
    categoryName: resolveCanonicalCategoryName(rawCategoryName, card.subEventDescription, gender, discipline),
    discipline,
    gender,
    roundLabel: round.roundLabel,
    roundKey: round.roundKey,
    matchNumber: extractMatchNumber(card.subEventDescription),
    description: card.subEventDescription ?? null,
    venue: card.venueName ?? null,
    table: card.tableName ?? card.tableNumber ?? null,
    overallScore: card.overallScores ?? null,
    resultStatus: card.resultStatus ?? item.fullResults ?? null,
    isParaClass: /\bclass\s*\d+\b/i.test(String(card.subEventName || "")) || /\bclass\s*\d+\b/i.test(String(card.subEventDescription || "")),
    teams: [],
    singles: [],
    competitors,
    gameScores: splitGameScores(card.gameScores ?? card.resultsGameScores),
  };
}

function normalizeOfficialResultItem(item) {
  return normalizeTeamMatch(item) || normalizeStandaloneMatch(item);
}

function isPreNormalizedMatch(item) {
  return Boolean(
    item &&
    typeof item === "object" &&
    typeof item.matchType === "string" &&
    Array.isArray(item.competitors) &&
    typeof item.categoryName === "string",
  );
}

function getZennihonResultBaseUrl(eventId) {
  return `${ZENNIHON_BASE_URL}/result${String(eventId || "").trim()}/`;
}

async function fetchText(url, encoding = "utf-8") {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 (compatible; Codex/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new TextDecoder(encoding).decode(arrayBuffer);
}

async function fetchJson(url, { allowNotFound = false } = {}) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "user-agent": "Mozilla/5.0 (compatible; Codex/1.0)",
    },
  });

  if (allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function parseZennihonShowQueriesFromTimetable(html) {
  const source = String(html || "");
  const linkedTokens = [...source.matchAll(/show\.cgi\?([A-Z]{2}\d{3,4}(?:-[A-Z]{2}\d{3,4})?)/g)]
    .map((match) => match[1]);
  const stagedRangeTokens = [...source.matchAll(
    /(?:MS|WS|MD|WD|XD|JB|JG)(?:準々決勝|準決勝|決勝)<br>\s*※?\s*((MS|WS|MD|WD|XD|JB|JG)-(\d{3,4}))/g,
  )].flatMap((match) => {
    const [, , kind, startRaw] = match;
    const stageLabel = match[0];
    const start = Number(startRaw);
    if (!Number.isFinite(start)) {
      return [];
    }

    if (stageLabel.includes("準々決勝")) {
      return [`${kind}${start}-${kind}${start + 3}`];
    }
    if (stageLabel.includes("準決勝")) {
      return [`${kind}${start}-${kind}${start + 1}`];
    }
    return [`${kind}${start}`];
  });
  const plainTokens = [...source.matchAll(/\b(MS|WS|MD|WD|XD|JB|JG)-(\d{3,4})\b/g)]
    .map((match) => `${match[1]}${match[2]}`);

  return [...new Set([...linkedTokens, ...stagedRangeTokens, ...plainTokens])];
}

function extractZennihonTimetablePaths(indexHtml) {
  const matches = [...String(indexHtml || "").matchAll(/href="(timetable[0-9A-Z]+\.shtml)"/gi)];
  return [...new Set(matches.map((match) => match[1]))];
}

function parseZennihonQueryToken(token) {
  const match = String(token || "").match(/^([A-Z]{2})(\d{3,4})$/);
  if (!match) {
    return null;
  }

  return {
    kind: match[1],
    number: Number(match[2]),
  };
}

function isZennihonQueryCoveredByRanges(singleToken, rangeTokens) {
  const single = parseZennihonQueryToken(singleToken);
  if (!single) {
    return false;
  }

  return rangeTokens.some((rangeToken) => {
    const rangeMatch = String(rangeToken).match(/^([A-Z]{2})(\d{3,4})-\1(\d{3,4})$/);
    if (!rangeMatch) {
      return false;
    }
    const [, kind, startRaw, endRaw] = rangeMatch;
    const start = Number(startRaw);
    const end = Number(endRaw);
    return single.kind === kind && single.number >= start && single.number <= end;
  });
}

async function collectZennihonShowQueries(eventId) {
  const baseUrl = getZennihonResultBaseUrl(eventId);
  const indexHtml = await fetchText(baseUrl, "euc-jp");
  const timetablePaths = extractZennihonTimetablePaths(indexHtml);
  if (timetablePaths.length === 0) {
    throw new Error(`No timetable pages found for zennihon event ${eventId}`);
  }

  const pages = await Promise.all(
    timetablePaths.map((pagePath) =>
      fetchText(new URL(pagePath, baseUrl).toString(), "euc-jp"),
    ),
  );

  const allTokens = [...new Set(pages.flatMap(parseZennihonShowQueriesFromTimetable))];
  const rangeTokens = allTokens.filter((token) => token.includes("-"));
  const singleTokens = allTokens.filter((token) => !token.includes("-"));
  const uncoveredSingles = singleTokens.filter((token) => !isZennihonQueryCoveredByRanges(token, rangeTokens));
  return [...rangeTokens, ...uncoveredSingles];
}

function getZennihonCategoryInfo(kind) {
  const definitions = {
    MS: { categoryName: "Men Singles", discipline: "singles", gender: "men" },
    WS: { categoryName: "Women Singles", discipline: "singles", gender: "women" },
    MD: { categoryName: "Men Doubles", discipline: "doubles", gender: "men" },
    WD: { categoryName: "Women Doubles", discipline: "doubles", gender: "women" },
    XD: { categoryName: "Mixed Doubles", discipline: "mixed", gender: "mixed" },
    JB: { categoryName: "Junior Boys Singles", discipline: "singles", gender: "men" },
    JG: { categoryName: "Junior Girls Singles", discipline: "singles", gender: "women" },
  };

  const base = definitions[kind] || { categoryName: kind, discipline: "singles", gender: null };
  return {
    ...base,
    categoryName: toCanonicalCategoryName(base.categoryName, base.gender, base.discipline),
  };
}

function parseZennihonAffiliation(rawValue) {
  const text = stripHtml(rawValue);
  const match = text.match(/^(.*?)(?:\(([^()]*)\))?$/);
  return {
    affiliation: match ? match[1].trim() : text,
    prefecture: match && match[2] ? match[2].trim() : "",
  };
}

function buildZennihonCompetitor(rawBlockHtml) {
  const entries = [...String(rawBlockHtml || "").matchAll(/<dt>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<dd>([\s\S]*?)(?=\s*<dt>|\s*<\/dl>)/g)];
  const players = entries.map(([, rawNameHtml, rawAffiliationHtml], index) => {
    const names = normalizeZennihonCompetitorNames(rawNameHtml);
    const affiliationInfo = parseZennihonAffiliation(rawAffiliationHtml);
    return {
      id: null,
      name: names.join(" ").trim(),
      org: affiliationInfo.affiliation || "",
      position: index + 1,
    };
  }).filter((player) => player.name);

  if (players.length === 0) {
    const fallbackName = normalizeZennihonName(stripHtml(rawBlockHtml));
    return {
      type: "player",
      id: null,
      name: fallbackName,
      org: "",
      irm: null,
      players: fallbackName ? [{ id: null, name: fallbackName, org: "", position: 1 }] : [],
    };
  }

  const orgs = [...new Set(players.map((player) => player.org).filter(Boolean))];
  return {
    type: players.length >= 2 ? "pair" : "player",
    id: null,
    name: players.map((player) => player.name).join(" / "),
    org: orgs.length === 1 ? orgs[0] : orgs.join(" / "),
    irm: null,
    players,
  };
}

function parseZennihonGameScores(rawScoresHtml) {
  return decodeHtmlEntities(String(rawScoresHtml || ""))
    .split(/<br\s*\/?>/i)
    .map((score) => stripHtml(score))
    .filter(Boolean);
}

function parseZennihonShowTables(html, eventId) {
  const tables = [...String(html || "").matchAll(/<table class="game"[\s\S]*?<\/table>/g)];
  const matches = [];

  for (const tableMatch of tables) {
    const tableHtml = tableMatch[0];
    const headerMatch = tableHtml.match(/<td colspan="5">\s*([^:]+?)(?:\s+([^:]+?))?:\s*<a href="show\.cgi\?([A-Z]{2}\+[A-Z]{2}\d{3,4})">試合番号\s*(\d+)<\/a>/);
    const blockMatch = tableHtml.match(
      /<td rowspan="2">([\s\S]*?)<\/td>\s*<td rowspan="2">([\s\S]*?<dl>[\s\S]*?<\/dl>[\s\S]*?)<\/td>[\s\S]*?<th>([^<]+)<\/th>\s*<td rowspan="2">([\s\S]*?<dl>[\s\S]*?<\/dl>[\s\S]*?)<\/td>\s*<td rowspan="2">([\s\S]*?)<\/td>[\s\S]*?<td align="center">([\s\S]*?)<\/td>[\s\S]*?<td colspan="5">勝者:\s*([\s\S]*?)<\/td>/,
    );

    if (!headerMatch || !blockMatch) {
      continue;
    }

    const [, categoryLabelRaw, roundLabelRaw = "", documentCode, matchNumberRaw] = headerMatch;
    const [, leftIdRaw, leftBlockHtml, overallScore, rightBlockHtml, rightIdRaw, gameScoresHtml, winnerNameRaw] = blockMatch;
    const kind = documentCode.slice(0, 2);
    const categoryInfo = getZennihonCategoryInfo(kind);
    const roundLabel = stripHtml(roundLabelRaw);
    const leftCompetitor = buildZennihonCompetitor(leftBlockHtml);
    const rightCompetitor = buildZennihonCompetitor(rightBlockHtml);
    const competitors = [leftCompetitor, rightCompetitor];

    matches.push({
      matchType: "individual",
      id: null,
      eventId: String(eventId),
      documentCode,
      source: "zennihon",
      subEventType: stripHtml(categoryLabelRaw),
      categoryName: categoryInfo.categoryName,
      discipline: categoryInfo.discipline,
      gender: categoryInfo.gender,
      roundLabel,
      roundKey: normalizeRound(roundLabel),
      matchNumber: Number(matchNumberRaw),
      description: `${categoryInfo.categoryName} - ${roundLabel} - Match ${matchNumberRaw}`,
      venue: null,
      table: null,
      overallScore: stripHtml(overallScore),
      resultStatus: stripHtml(winnerNameRaw) ? `Winner: ${stripHtml(winnerNameRaw)}` : null,
      isParaClass: false,
      teams: [],
      singles: [],
      competitors: competitors.map((competitor, index) => ({
        type: competitor.type,
        id: index === 0 ? stripHtml(leftIdRaw) : stripHtml(rightIdRaw),
        name: competitor.name,
        org: competitor.org,
        irm: null,
        players: competitor.players,
      })),
      gameScores: parseZennihonGameScores(gameScoresHtml),
    });
  }

  return matches;
}

function inferZennihonMissingRounds(matches) {
  const grouped = new Map();

  for (const match of matches) {
    const key = [
      match?.source || "",
      match?.eventId || "",
      match?.categoryName || "",
    ].join("::");
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(match);
  }

  for (const group of grouped.values()) {
    const sorted = [...group].sort((left, right) => {
      const leftNumber = Number.isFinite(left?.matchNumber) ? left.matchNumber : Number.MAX_SAFE_INTEGER;
      const rightNumber = Number.isFinite(right?.matchNumber) ? right.matchNumber : Number.MAX_SAFE_INTEGER;
      return leftNumber - rightNumber;
    });

    let index = 0;
    while (index < sorted.length) {
      if (String(sorted[index]?.roundLabel || "").trim()) {
        index += 1;
        continue;
      }

      const start = index;
      while (index < sorted.length && !String(sorted[index]?.roundLabel || "").trim()) {
        index += 1;
      }

      const end = index - 1;
      const previousLabeled = start > 0 ? sorted[start - 1] : null;
      const nextLabeled = index < sorted.length ? sorted[index] : null;

      let inferredRoundLabel = "";
      if (previousLabeled && nextLabeled && previousLabeled.roundLabel === nextLabeled.roundLabel) {
        inferredRoundLabel = nextLabeled.roundLabel;
      } else if (!previousLabeled && nextLabeled) {
        inferredRoundLabel = nextLabeled.roundLabel;
      } else if (previousLabeled && nextLabeled) {
        const previousRound = String(previousLabeled.roundKey || "").match(/^knockout_round_(\d+)$/);
        const nextRound = String(nextLabeled.roundKey || "").match(/^knockout_round_(\d+)$/);
        if (previousRound && nextRound && Number(nextRound[1]) === Number(previousRound[1]) + 1) {
          inferredRoundLabel = previousLabeled.roundLabel;
        }
      } else if (previousLabeled && !nextLabeled) {
        inferredRoundLabel = previousLabeled.roundLabel;
      }

      if (!String(inferredRoundLabel || "").trim()) {
        continue;
      }

      for (let runIndex = start; runIndex <= end; runIndex += 1) {
        sorted[runIndex].roundLabel = inferredRoundLabel;
        sorted[runIndex].roundKey = normalizeRound(inferredRoundLabel);
        sorted[runIndex].description = `${sorted[runIndex].categoryName} - ${inferredRoundLabel} - Match ${sorted[runIndex].matchNumber}`;
      }
    }
  }

  return matches;
}

async function fetchZennihonOfficialResults(eventId, options = {}) {
  const archiveDir = options.zennihonArchiveDir || DEFAULT_ZENNIHON_ARCHIVE_DIR;
  const wantsArchive = shouldUseZennihonArchive(eventId);
  const archived = readZennihonArchive(archiveDir, eventId);
  if (archived) {
    return archived;
  }

  if (wantsArchive && !options.allowNetworkForZennihonArchiveMiss) {
    throw new Error(`全日本アーカイブが見つかりません: ${eventId}`);
  }

  const baseUrl = getZennihonResultBaseUrl(eventId);
  const queries = await collectZennihonShowQueries(eventId);
  const pages = await Promise.all(
    queries.map((query) => fetchText(new URL(`show.cgi?${query}`, baseUrl).toString(), "euc-jp")),
  );

  const deduped = new Map();
  for (const html of pages) {
    for (const match of parseZennihonShowTables(html, eventId)) {
      deduped.set(match.documentCode, match);
    }
  }

  const normalized = inferZennihonMissingRounds([...deduped.values()]);
  if (wantsArchive || options.writeZennihonArchive) {
    writeZennihonArchive(archiveDir, eventId, normalized);
  }
  return normalized;
}

function getBornanBaseUrl(eventId) {
  return `${ITTF_RESULTS_BASE_URL}/TTE${String(eventId || "").trim()}/`;
}

function getBornanEventKey(matchKey) {
  const parts = String(matchKey || "").split(".");
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : "";
}

function getBornanRoundLabelFromCode(matchKey) {
  const roundCode = String(matchKey || "").split(".")[2] || "";
  const roundLabels = {
    R64: "Round of 64",
    R32: "Round of 32",
    "8FNL": "Round of 16",
    QFNL: "Quarterfinals",
    SFNL: "Semifinals",
    "FNL-": "Finals",
  };

  if (roundLabels[roundCode]) {
    return roundLabels[roundCode];
  }

  const groupMatch = roundCode.match(/^GP(\d{2})$/);
  if (groupMatch) {
    return `Group ${Number(groupMatch[1])}`;
  }

  const positionMatch = roundCode.match(/^(\d{3})-$/);
  if (positionMatch) {
    const digits = positionMatch[1];
    return `Pos. ${Number(digits.slice(0, 1))}-${Number(digits.slice(1))}`;
  }

  return "";
}

function buildBornanCategoryInfo(categoryName) {
  const rawCategoryName = String(categoryName || "").trim();
  const discipline = normalizeDiscipline(rawCategoryName);
  const gender = inferGender(rawCategoryName);
  return {
    categoryName: toCanonicalCategoryName(rawCategoryName, gender, discipline),
    discipline,
    gender,
  };
}

function normalizeBornanSplitScores(homeSplits, awaySplits) {
  const length = Math.max(homeSplits.length, awaySplits.length);
  const scores = [];

  for (let index = 0; index < length; index += 1) {
    const home = String(homeSplits[index]?.Res || "").trim();
    const away = String(awaySplits[index]?.Res || "").trim();
    if (!home && !away) {
      continue;
    }
    scores.push(`${home || "0"}-${away || "0"}`);
  }

  return scores;
}

function normalizeBornanPlayers(side, fallbackType) {
  const members = Array.isArray(side?.Members) ? side.Members : [];
  if (members.length > 0) {
    return members.map((member, index) => ({
      id: member?.Reg ?? null,
      name: member?.Desc ?? "",
      org: member?.OrgDesc ?? side?.OrgDesc ?? member?.Org ?? side?.Org ?? "",
      orgCode: member?.Org ?? side?.Org ?? null,
      position: index + 1,
    }));
  }

  const name = String(side?.Desc || "").trim();
  if (!name) {
    return [];
  }

  return [{
    id: side?.Reg ?? null,
    name,
    org: side?.OrgDesc ?? side?.Org ?? "",
    orgCode: side?.Org ?? null,
    position: 1,
  }];
}

function normalizeBornanCompetitor(side, fallbackType = "player") {
  const players = normalizeBornanPlayers(side, fallbackType);
  const uniqueOrgs = [...new Set(players.map((player) => player.org).filter(Boolean))];
  const name = String(side?.Desc || "").trim() || players.map((player) => player.name).filter(Boolean).join(" / ");
  const org = side?.OrgDesc || (uniqueOrgs.length === 1 ? uniqueOrgs[0] : side?.Org || "");
  const type = fallbackType === "team"
    ? "team"
    : players.length >= 2
      ? "pair"
      : "player";

  return {
    type,
    id: side?.Reg ?? null,
    name,
    org,
    orgCode: side?.Org ?? null,
    irm: null,
    players,
  };
}

function normalizeBornanSubMatch(subMatch, order) {
  const home = normalizeBornanCompetitor(subMatch?.Home);
  const away = normalizeBornanCompetitor(subMatch?.Away);

  return {
    order,
    documentCode: null,
    description: null,
    overallScore: `${subMatch?.Home?.Res ?? "0"}-${subMatch?.Away?.Res ?? "0"}`,
    resultStatus: null,
    gameScores: normalizeBornanSplitScores(subMatch?.Home?.Splits || [], subMatch?.Away?.Splits || []),
    competitors: [home, away],
    winnerOrg: home?.org && subMatch?.Home?.Win ? home.org : away?.org && subMatch?.Away?.Win ? away.org : null,
  };
}

function normalizeBornanMatch(match, eventId, eventDescriptions) {
  const eventKey = getBornanEventKey(match?.Key);
  const categoryName = eventDescriptions.get(eventKey) || String(match?.Desc || "").split(" - ")[0] || eventKey;
  const categoryInfo = buildBornanCategoryInfo(categoryName);
  const roundLabel = String(match?.Desc || "").split(" - ")[1] || getBornanRoundLabelFromCode(match?.Key);
  const matchNumberMatch = String(match?.Desc || "").match(/\bMatch\s+(\d+)\b/i);
  const matchNumber = matchNumberMatch ? Number(matchNumberMatch[1]) : null;

  if (match?.Home?.Org === "BYE" || match?.Away?.Org === "BYE") {
    return null;
  }

  if (match?.IsTeam) {
    const homeTeam = normalizeBornanCompetitor(match?.Home, "team");
    const awayTeam = normalizeBornanCompetitor(match?.Away, "team");

    return {
      matchType: "team",
      id: null,
      eventId: String(eventId),
      documentCode: match?.Key ?? null,
      subEventType: categoryName,
      categoryName: categoryInfo.categoryName,
      discipline: categoryInfo.discipline,
      gender: categoryInfo.gender,
      roundLabel,
      roundKey: normalizeRound(roundLabel),
      matchNumber,
      description: match?.Desc || `${categoryName} - ${roundLabel}`,
      venue: match?.Venue || null,
      table: match?.LocDesc || match?.Loc || null,
      overallScore: `${match?.Home?.Res ?? "0"}-${match?.Away?.Res ?? "0"}`,
      resultStatus: String(match?.Status || "").trim() || null,
      teams: [
        { name: homeTeam.name, org: homeTeam.org, orgCode: homeTeam.orgCode },
        { name: awayTeam.name, org: awayTeam.org, orgCode: awayTeam.orgCode },
      ],
      singles: Array.isArray(match?.SubMatches)
        ? match.SubMatches.map((subMatch, index) => normalizeBornanSubMatch(subMatch, index + 1))
        : [],
      competitors: [],
      gameScores: [],
      source: "wtt",
    };
  }

  return {
    matchType: "individual",
    id: null,
    eventId: String(eventId),
    documentCode: match?.Key ?? null,
    subEventType: categoryName,
    categoryName: categoryInfo.categoryName,
    discipline: categoryInfo.discipline,
    gender: categoryInfo.gender,
    roundLabel,
    roundKey: normalizeRound(roundLabel),
    matchNumber,
    description: match?.Desc || `${categoryName} - ${roundLabel}`,
    venue: match?.Venue || null,
    table: match?.LocDesc || match?.Loc || null,
    overallScore: `${match?.Home?.Res ?? "0"}-${match?.Away?.Res ?? "0"}`,
    resultStatus: String(match?.Status || "").trim() || null,
    isParaClass: false,
    teams: [],
    singles: [],
    competitors: [
      normalizeBornanCompetitor(match?.Home, categoryInfo.discipline === "doubles" || categoryInfo.discipline === "mixed" ? "pair" : "player"),
      normalizeBornanCompetitor(match?.Away, categoryInfo.discipline === "doubles" || categoryInfo.discipline === "mixed" ? "pair" : "player"),
    ],
    gameScores: normalizeBornanSplitScores(match?.Home?.Splits || [], match?.Away?.Splits || []),
    source: "wtt",
  };
}

async function fetchBornanOfficialResults(eventId) {
  const baseUrl = getBornanBaseUrl(eventId);
  const champ = await fetchJson(new URL("champ.json", baseUrl).toString(), { allowNotFound: true });
  if (!champ || !Array.isArray(champ.dates) || champ.dates.length === 0) {
    return null;
  }

  const eventDescriptions = new Map(
    (Array.isArray(champ.events) ? champ.events : []).map((event) => [event?.Key, event?.Desc]),
  );

  const pages = await Promise.all(
    champ.dates
      .map((date) => date?.raw)
      .filter(Boolean)
      .map((rawDate) => fetchJson(new URL(`match/d${rawDate}.json`, baseUrl).toString(), { allowNotFound: true })),
  );

  const deduped = new Map();
  for (const page of pages) {
    if (!Array.isArray(page)) {
      continue;
    }
    for (const item of page) {
      const normalized = normalizeBornanMatch(item, eventId, eventDescriptions);
      if (normalized?.documentCode) {
        deduped.set(normalized.documentCode, normalized);
      }
    }
  }

  return [...deduped.values()];
}

async function fetchBornanEventMeta(eventId) {
  const baseUrl = getBornanBaseUrl(eventId);
  const champ = await fetchJson(new URL("champ.json", baseUrl).toString(), { allowNotFound: true });
  if (!champ) {
    return null;
  }

  const rawDates = Array.isArray(champ.dates)
    ? champ.dates.map((date) => String(date?.raw || "")).filter(Boolean)
    : [];
  const startDate = rawDates[0] || null;
  const endDate = rawDates[rawDates.length - 1] || null;
  const today = getLocalDateStamp();
  const isFinished = Boolean(champ.isFinished) || Boolean(endDate && endDate < today);

  return {
    eventId: String(eventId),
    source: "bornan",
    title: String(champ.champDesc || champ.champ || ""),
    startDate,
    endDate,
    isFinished,
    canAutoArchive: true,
  };
}

async function fetchWttOfficialResultsFromApi(eventId, take) {
  const url = new URL(WTT_API_URL);
  url.searchParams.set("EventId", String(eventId));
  url.searchParams.set("include_match_card", "true");
  url.searchParams.set("take", String(take));

  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      origin: "https://www.worldtabletennis.com",
      referer: "https://www.worldtabletennis.com/",
      "user-agent": "Mozilla/5.0 (compatible; TeamMatchExtractor/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function isLikelyBornanFallbackCandidate(eventId) {
  return /^\d+$/.test(String(eventId || "").trim());
}

async function getWttEventLifecycleMeta(eventId, options = {}) {
  const eventIdText = String(eventId || "").trim();
  const archiveIndexPath = options.wttArchiveIndexPath || DEFAULT_WTT_ARCHIVE_INDEX_PATH;
  const dateIndexPath = options.wttDateIndexPath || DEFAULT_WTT_DATE_INDEX_PATH;
  const archiveIndex = readWttArchiveIndex(archiveIndexPath);
  const dateIndex = readWttDateIndex(dateIndexPath);
  const indexedEntry = archiveIndex[eventIdText];
  const datedEntry = dateIndex[eventIdText];

  const mergedEntry = {
    ...(indexedEntry || {}),
    ...(datedEntry || {}),
  };

  if (indexedEntry?.archived && !indexedEntry?.forced) {
    return {
      eventId: eventIdText,
      source: mergedEntry.source || "wtt",
      title: mergedEntry.title || indexedEntry.title || "",
      startDate: mergedEntry.startDate || null,
      endDate: mergedEntry.endDate || null,
      isFinished: true,
      canAutoArchive: Boolean(indexedEntry.canAutoArchive),
      archived: true,
      mode: "archived",
    };
  }

  if (isLikelyBornanFallbackCandidate(eventIdText)) {
    const bornanMeta = await fetchBornanEventMeta(eventIdText);
    if (bornanMeta) {
      return {
        ...bornanMeta,
        archived: false,
        mode: bornanMeta.isFinished ? "finished" : "live",
      };
    }
  }

  return {
    eventId: eventIdText,
    source: mergedEntry?.source || "wtt",
    title: mergedEntry?.title || "",
    startDate: mergedEntry?.startDate || null,
    endDate: mergedEntry?.endDate || null,
    isFinished: false,
    canAutoArchive: false,
    archived: false,
    mode: "live",
  };
}

async function fetchWttOfficialResults(eventId, take) {
  let primaryPayload = null;
  let primaryError = null;

  try {
    primaryPayload = await fetchWttOfficialResultsFromApi(eventId, take);
    if (Array.isArray(primaryPayload) && primaryPayload.length > 0) {
      return primaryPayload;
    }
  } catch (error) {
    primaryError = error;
  }

  if (isLikelyBornanFallbackCandidate(eventId)) {
    const bornanPayload = await fetchBornanOfficialResults(eventId);
    if (Array.isArray(bornanPayload) && bornanPayload.length > 0) {
      return bornanPayload;
    }
  }

  if (primaryError) {
    throw primaryError;
  }

  return primaryPayload || [];
}

async function fetchSourceResults(source, eventId, take, options = {}) {
  if (source === "wtt") {
    return fetchWttOfficialResults(eventId, take);
  }

  if (source === "zennihon") {
    return fetchZennihonOfficialResults(eventId, options);
  }

  throw new Error(`Unsupported source: ${source}`);
}

async function fetchOfficialResultsCached(source, eventId, take, cacheDir, refreshCache, options = {}) {
  if (source === "wtt") {
    const meta = await getWttEventLifecycleMeta(eventId, options);
    const archiveDir = options.wttArchiveDir || DEFAULT_WTT_ARCHIVE_DIR;
    const archiveIndexPath = options.wttArchiveIndexPath || DEFAULT_WTT_ARCHIVE_INDEX_PATH;
    const archived = readWttArchive(archiveDir, eventId);

    if (archived && meta.isFinished) {
      return archived;
    }

    try {
      const payload = await fetchSourceResults(source, eventId, take, options);

      if (shouldReuseCachedPayload(source, payload)) {
        const timestamp = new Date().toISOString();
        writeWttArchive(archiveDir, eventId, payload);
        updateWttArchiveIndexEntry(archiveIndexPath, eventId, {
          pooled: true,
          source: meta.source || "wtt",
          title: meta.title || "",
          startDate: meta.startDate || null,
          endDate: meta.endDate || null,
          canAutoArchive: Boolean(meta.canAutoArchive),
          lastFetchedAt: timestamp,
          ...(meta.isFinished
            ? {
                archived: true,
                archivedAt: timestamp,
              }
            : {}),
        });
      }

      return payload;
    } catch (error) {
      if (archived) {
        return archived;
      }
      throw error;
    }
  }

  if (source === "zennihon" && shouldUseZennihonArchive(eventId)) {
    const archived = readZennihonArchive(options.zennihonArchiveDir || DEFAULT_ZENNIHON_ARCHIVE_DIR, eventId);
    if (archived) {
      return archived;
    }
    if (!refreshCache && !options.allowNetworkForZennihonArchiveMiss) {
      throw new Error(`全日本アーカイブが見つかりません: ${eventId}`);
    }
  }

  const cachePath = getCachePath(cacheDir, source, eventId, take);
  if (!refreshCache) {
    const cached = readCache(cachePath);
    if (shouldReuseCachedPayload(source, cached)) {
      return cached;
    }
    if (source === "wtt") {
      const legacyCached = readCache(getLegacyWttCachePath(cacheDir, eventId, take));
      if (shouldReuseCachedPayload(source, legacyCached)) {
        return legacyCached;
      }
    }
  }
  const payload = await fetchSourceResults(source, eventId, take, options);
  writeCache(cachePath, payload);
  return payload;
}

function applyFilters(matches, args, translations) {
  let filtered = matches.filter(Boolean).filter((match) => !match.isParaClass);

  if (args.category) {
    const categoryBase = filtered;
    const wantedLabel = normalizeCategoryLabel(args.category);
    const normalizedCategoryMatches = categoryBase.filter(
      (match) => normalizeCategoryLabel(match.categoryName) === wantedLabel,
    );

    if (normalizedCategoryMatches.length > 0) {
      filtered = normalizedCategoryMatches;
    } else {
      const wantedCategory = normalizeCategory(args.category);
      if (wantedCategory.isExactCategory && wantedCategory.categoryName) {
        filtered = categoryBase.filter(
          (match) => normalizeCategoryLabel(match.categoryName) === normalizeCategoryLabel(wantedCategory.categoryName),
        );
      }
    }

    if (filtered.length === 0) {
      const wantedCategory = normalizeCategory(args.category);
      if (!wantedCategory.isExactCategory) {
        filtered = categoryBase;
      }
    }
  }

  if (args.gender) {
    const wantedGender = inferGender(args.gender);
    filtered = filtered.filter((match) => match.gender === wantedGender);
  }

  if (args.discipline) {
    const wantedDiscipline = normalizeDiscipline(args.discipline);
    filtered = filtered.filter((match) => match.discipline === wantedDiscipline);
  }

  if (args.round) {
    const roundContext = buildJaRoundContext(filtered);
    const wantedRounds = (Array.isArray(args.round) ? args.round : [args.round])
      .map((round) => normalizeRound(round))
      .filter(Boolean);
    filtered = filtered.filter((match) =>
      wantedRounds.some((wantedRound) => matchesRoundFilter(match.roundKey, wantedRound, roundContext)),
    );
  }

  if (args.contains) {
    const needle = normalizeSearchText(args.contains);
    filtered = filtered.filter((match) => buildMatchSearchText(match, translations).includes(needle));
  }

  if (args.docCode) {
    filtered = filtered.filter((match) => match.documentCode === args.docCode);
  }

  if (Number.isInteger(args.limit) && args.limit > 0) {
    filtered = filtered.slice(0, args.limit);
  }

  return filtered;
}

function formatGameScoreForWinnerPerspective(score, winnerIndex) {
  const [leftRaw, rightRaw] = String(score).split("-");
  const left = Number(leftRaw);
  const right = Number(rightRaw);

  if (Number.isNaN(left) || Number.isNaN(right)) {
    return score;
  }

  const winnerPoints = winnerIndex === 0 ? left : right;
  const loserPoints = winnerIndex === 0 ? right : left;
  return `${loserPoints === 0 ? 0 : loserPoints > winnerPoints ? `-${winnerPoints}` : winnerPoints === 0 ? 0 : winnerPoints === left && winnerIndex === 0 ? loserPoints : winnerPoints === right && winnerIndex === 1 ? loserPoints : ""}`;
}

function getWinnerIndexFromScore(score) {
  const [leftRaw, rightRaw] = String(score || "").split("-");
  const leftToken = String(leftRaw || "").trim().toUpperCase();
  const rightToken = String(rightRaw || "").trim().toUpperCase();

  if (leftToken === "W" && rightToken === "L") {
    return 0;
  }
  if (leftToken === "L" && rightToken === "W") {
    return 1;
  }

  const left = Number(leftRaw);
  const right = Number(rightRaw);
  if (Number.isNaN(left) || Number.isNaN(right)) {
    return null;
  }
  if (left > right) {
    return 0;
  }
  if (right > left) {
    return 1;
  }
  return null;
}

function getSpecialResultJa(match) {
  const rawOverall = String(match?.overallScore || "").trim();
  const rawGames = Array.isArray(match?.gameScores) ? match.gameScores.join(" ") : "";
  const rawStatus = String(match?.resultStatus || "");
  const combined = `${rawOverall} ${rawGames} ${rawStatus}`.toLowerCase();

  if (/\bw\s*[-/]\s*l\b|\bl\s*[-/]\s*w\b|w\s*\/\s*o|walkover|wo\b/.test(combined)) {
    return "不戦勝";
  }
  if (/\bret\b|retired|棄権/.test(combined)) {
    return "棄権";
  }
  if (/\bins\b|injury|inj\./.test(combined)) {
    return "棄権";
  }

  return "";
}

function getTieDisplaySide(match) {
  const winnerIndex = getWinnerIndexFromScore(match.overallScore);
  return winnerIndex === 1 ? 1 : 0;
}

function getDisplayedTeamIndexes(match) {
  const leftIndex = getTieDisplaySide(match);
  return {
    leftIndex,
    rightIndex: leftIndex === 0 ? 1 : 0,
    leftOrg: match?.teams?.[leftIndex]?.org ?? null,
    rightOrg: match?.teams?.[leftIndex === 0 ? 1 : 0]?.org ?? null,
  };
}

function getSingleDisplayIndexes(single, displayedTeams) {
  const leftOrg = displayedTeams?.leftOrg ?? null;
  const rightOrg = displayedTeams?.rightOrg ?? null;
  const competitors = Array.isArray(single?.competitors) ? single.competitors : [];

  const leftByOrg = competitors.findIndex((competitor) => competitor?.org && competitor.org === leftOrg);
  const rightByOrg = competitors.findIndex((competitor) => competitor?.org && competitor.org === rightOrg);

  if (leftByOrg >= 0 && rightByOrg >= 0 && leftByOrg !== rightByOrg) {
    return {
      leftCompetitorIndex: leftByOrg,
      rightCompetitorIndex: rightByOrg,
    };
  }

  const leftCompetitorIndex = single?.tieLeftCompetitorIndex ?? 0;
  return {
    leftCompetitorIndex,
    rightCompetitorIndex: leftCompetitorIndex === 0 ? 1 : 0,
  };
}

function getIndividualDisplayIndexes(match) {
  const winnerIndex = getWinnerIndexFromScore(match.overallScore);
  return {
    leftCompetitorIndex: winnerIndex === 1 ? 1 : 0,
    rightCompetitorIndex: winnerIndex === 1 ? 0 : 1,
  };
}

function isMixedTeamMatch(match) {
  return match?.matchType === "team" && match?.discipline === "teams" && match?.gender === "mixed";
}

function getDisplayedOverallScoreValues(matchLike, leftIndex) {
  const [rawLeft = "0", rawRight = "0"] = String(matchLike?.overallScore || "0-0").split("-");
  if (leftIndex === 0) {
    return {
      left: Number(rawLeft) || 0,
      right: Number(rawRight) || 0,
    };
  }
  return {
    left: Number(rawRight) || 0,
    right: Number(rawLeft) || 0,
  };
}

function getMixedTeamGameTotals(match, displayedTeams) {
  return (match.singles || []).reduce(
    (totals, single) => {
      const { leftCompetitorIndex } = getSingleDisplayIndexes(single, displayedTeams);
      const score = getDisplayedOverallScoreValues(single, leftCompetitorIndex);
      totals.left += score.left;
      totals.right += score.right;
      return totals;
    },
    { left: 0, right: 0 },
  );
}

function getCompetitorDisplayName(competitor, translations) {
  if (!competitor) {
    return "";
  }

  const players = (competitor.players || [])
    .map((player) => ({
      name: translatePlayer(player?.name || "", translations),
      org: translateOrg(player?.org || competitor.org || "", translations, {
        orgCode: player?.orgCode || competitor.orgCode,
      }),
    }))
    .filter((player) => player.name);

  if (players.length >= 2) {
    const names = players.map((player) => player.name).join("／");
    const orgs = [...new Set(players.map((player) => player.org).filter(Boolean))];
    if (orgs.length === 0) {
      return names;
    }
    if (orgs.length === 1) {
      return `${names}（${orgs[0]}）`;
    }
    return `${names}（${orgs.join("／")}）`;
  }

  if (players.length === 1) {
    return players[0].org ? `${players[0].name}（${players[0].org}）` : players[0].name;
  }

  const name = translatePlayer(competitor.name || "", translations);
  const translatedOrg = translateOrg(competitor.org || "", translations, {
    orgCode: competitor.orgCode,
  });
  return translatedOrg ? `${name}（${translatedOrg}）` : name;
}

function getTeamSubMatchCompetitorName(competitor, translations) {
  if (!competitor) {
    return "";
  }

  const players = (competitor.players || [])
    .map((player) => translatePlayer(player?.name || "", translations))
    .filter(Boolean);

  if (players.length >= 2) {
    return players.join("／");
  }
  if (players.length === 1) {
    return players[0];
  }

  return translatePlayer(competitor.name || "", translations);
}

function getPlayerIdentityKey(player) {
  if (!player) {
    return "";
  }
  const id = String(player.id || "").trim();
  if (id) {
    return `id:${id}`;
  }
  return `name:${String(player.name || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()}`;
}

function getSinglePlayerFromCompetitor(competitor) {
  if (!competitor) {
    return null;
  }
  const players = Array.isArray(competitor.players) ? competitor.players.filter(Boolean) : [];
  if (players.length > 0) {
    return players[0];
  }
  const name = String(competitor.name || "").trim();
  if (!name) {
    return null;
  }
  return {
    id: competitor.id || "",
    name,
    org: competitor.org || "",
    orgCode: competitor.orgCode || "",
  };
}

function inferOlympicPendingTeamSchedule(match, displayedTeams) {
  if (!match || match.discipline !== "teams" || match.singles.length < 3) {
    return null;
  }

  const [doublesMatch, secondMatch, thirdMatch] = match.singles;
  if (!doublesMatch || !secondMatch || !thirdMatch) {
    return null;
  }

  const { leftIndex, rightIndex } = displayedTeams;
  const doublesLeft = doublesMatch.competitors?.[leftIndex];
  const doublesRight = doublesMatch.competitors?.[rightIndex];
  const secondLeft = getSinglePlayerFromCompetitor(secondMatch.competitors?.[leftIndex]);
  const secondRight = getSinglePlayerFromCompetitor(secondMatch.competitors?.[rightIndex]);
  const thirdLeft = getSinglePlayerFromCompetitor(thirdMatch.competitors?.[leftIndex]);
  const thirdRight = getSinglePlayerFromCompetitor(thirdMatch.competitors?.[rightIndex]);

  const doublesLeftPlayers = Array.isArray(doublesLeft?.players) ? doublesLeft.players.filter(Boolean) : [];
  const doublesRightPlayers = Array.isArray(doublesRight?.players) ? doublesRight.players.filter(Boolean) : [];

  if (
    doublesLeftPlayers.length < 2 ||
    doublesRightPlayers.length < 2 ||
    !secondLeft ||
    !secondRight ||
    !thirdLeft ||
    !thirdRight
  ) {
    return null;
  }

  const thirdLeftKey = getPlayerIdentityKey(thirdLeft);
  const thirdRightKey = getPlayerIdentityKey(thirdRight);
  const remainingLeft = doublesLeftPlayers.find((player) => getPlayerIdentityKey(player) !== thirdLeftKey);
  const remainingRight = doublesRightPlayers.find((player) => getPlayerIdentityKey(player) !== thirdRightKey);

  if (!remainingLeft || !remainingRight) {
    return null;
  }

  return [
    [remainingLeft.name || "", secondRight.name || ""],
    [secondLeft.name || "", remainingRight.name || ""],
  ];
}

function formatIndividualScoreJa(match, leftCompetitorIndex, options = {}) {
  const specialResult = getSpecialResultJa(match);
  if (specialResult) {
    return specialResult;
  }

  const [rawLeftSets, rawRightSets] = String(match.overallScore || "-").split("-");
  const leftSets = leftCompetitorIndex === 0 ? rawLeftSets : rawRightSets;
  const rightSets = leftCompetitorIndex === 0 ? rawRightSets : rawLeftSets;

  const normalizedGames = match.gameScores.map((game) => {
    const [rawLeft, rawRight] = String(game).split("-");
    const homePoints = Number(rawLeft);
    const awayPoints = Number(rawRight);
    if (Number.isNaN(homePoints) || Number.isNaN(awayPoints)) {
      return game;
    }

    const leftPoints = leftCompetitorIndex === 0 ? homePoints : awayPoints;
    const rightPoints = leftCompetitorIndex === 0 ? awayPoints : homePoints;
    return leftPoints > rightPoints ? String(rightPoints) : `-${leftPoints}`;
  });

  if (options.omitSetCounts) {
    return normalizedGames.join(",");
  }

  return `${leftSets}(${normalizedGames.join(",")})${rightSets}`;
}

function buildJaRoundContext(matches) {
  const knockoutOrder = [
    "round_of_128",
    "round_of_64",
    "round_of_32",
    "round_of_16",
    "quarterfinal",
    "semifinal",
    "final",
  ];
  const presentRounds = knockoutOrder.filter((roundKey) =>
    matches.some((match) => match.roundKey === roundKey),
  );
  const firstKnockoutRoundIndex = knockoutOrder.findIndex((roundKey) =>
    matches.some((match) => match.roundKey === roundKey),
  );

  return {
    knockoutRoundNumbers: Object.fromEntries(
      presentRounds.map((roundKey, index) => [roundKey, `${index + 1}回戦`]),
    ),
    firstKnockoutRoundIndex,
  };
}

function translateRoundJa(roundKey, roundLabel, translations, rules, context) {
  const mapped = translate(roundKey, translations.rounds);
  if (mapped && mapped !== roundKey) {
    return mapped;
  }

  const dynamicKnockoutLabel = context?.knockoutRoundNumbers?.[roundKey];
  if (dynamicKnockoutLabel) {
    return `${rules.labels.knockoutPrefix}${dynamicKnockoutLabel}`;
  }

  const qualifyingRoundMatch = String(roundKey || "").match(/^qualifying_round_(\d+)$/);
  if (qualifyingRoundMatch) {
    return `予選トーナメント${qualifyingRoundMatch[1]}回戦`;
  }

  const knockoutRoundMatch = String(roundKey || "").match(/^knockout_round_(\d+)$/);
  if (knockoutRoundMatch) {
    return `${knockoutRoundMatch[1]}回戦`;
  }

  const groupMatch = String(roundLabel || "").match(/^Group\s+(\d+)$/i);
  if (groupMatch) {
    return `${rules.labels.groupPrefix}${groupMatch[1]}`;
  }

  const stageGroupMatch = String(roundLabel || "").match(/^Stage\s*1([AB])(?:\s*[\(-]?\s*Group\s+(\d+)\)?)?$/i);
  if (stageGroupMatch) {
    const stageKey = `stage_1${stageGroupMatch[1].toLowerCase()}${stageGroupMatch[2] ? "_group" : ""}`;
    const stage = rules.labels.stageDisplay[stageKey] || `Stage1${stageGroupMatch[1].toUpperCase()}`;
    const groupNumber = stageGroupMatch[2];
    return groupNumber && !stage.includes(groupNumber) ? `${stage}${groupNumber}` : stage;
  }

  const splitStageGroupMatch = String(roundLabel || "").match(/^Stage\s*1([AB])\s*-\s*Group\s+(\d+)$/i);
  if (splitStageGroupMatch) {
    const stageKey = `stage_1${splitStageGroupMatch[1].toLowerCase()}_group`;
    const stage = rules.labels.stageDisplay[stageKey] || `Stage1${splitStageGroupMatch[1].toUpperCase()}グループ`;
    return `${stage}${splitStageGroupMatch[2]}`;
  }

  const fallback = {
    group: rules.labels.groupPrefix,
    stage_1a: rules.labels.stageDisplay.stage_1a || "Stage1A",
    stage_1a_group: rules.labels.stageDisplay.stage_1a_group || "Stage1Aグループ",
    stage_1b: rules.labels.stageDisplay.stage_1b || "Stage1B",
    stage_1b_group: rules.labels.stageDisplay.stage_1b_group || "Stage1Bグループ",
    bronze_medal_match: "3位決定戦",
    preliminary_round: rules.labels.preliminaryRound,
    ...rules.roundFallbacks,
  };
  return fallback[roundKey] || roundLabel || roundKey;
}

function translateRoundJaForMatch(match, translations, rules, context) {
  const roundLabel = String(
    translateRoundJa(match?.roundKey, match?.roundLabel, translations, rules, context) || match?.roundLabel || "",
  );
  if (match?.source === "zennihon") {
    return roundLabel.replace(/^決勝トーナメント/, "");
  }
  return roundLabel;
}

function getRoundSortValue(match, context) {
  const knockoutRoundMatch = String(match.roundKey || "").match(/^knockout_round_(\d+)$/);
  if (knockoutRoundMatch) {
    return Number(knockoutRoundMatch[1]);
  }

  const groupMatch = String(match.roundLabel || "").match(/^Group\s+(\d+)$/i);
  if (groupMatch) {
    return Number(groupMatch[1]);
  }

  const splitStageGroupMatch = String(match.roundLabel || "").match(/^Stage\s*1([AB])\s*-\s*Group\s+(\d+)$/i);
  if (splitStageGroupMatch) {
    const stageOffset = splitStageGroupMatch[1].toUpperCase() === "A" ? 0 : 100;
    return stageOffset + Number(splitStageGroupMatch[2]);
  }

  const stageGroupMatch = String(match.roundLabel || "").match(/^Stage\s*1([AB])(?:\s*[\(-]?\s*Group\s+(\d+)\)?)?$/i);
  if (stageGroupMatch && stageGroupMatch[2]) {
    const stageOffset = stageGroupMatch[1].toUpperCase() === "A" ? 0 : 100;
    return stageOffset + Number(stageGroupMatch[2]);
  }

  const qualifyingMatch = String(match.roundKey || "").match(/^qualifying_round_(\d+)$/);
  if (qualifyingMatch) {
    return Number(qualifyingMatch[1]);
  }

  if (match.roundKey === "preliminary_round") {
    return 99;
  }

  const knockoutLabel = context?.knockoutRoundNumbers?.[match.roundKey] || "";
  const knockoutMatch = knockoutLabel.match(/^(\d+)回戦$/);
  if (knockoutMatch) {
    return 100 + Number(knockoutMatch[1]);
  }

  if (match.roundKey === "quarterfinal") {
    return 103;
  }
  if (match.roundKey === "semifinal") {
    return 104;
  }
  if (match.roundKey === "final") {
    return 105;
  }

  return 999;
}

function getCategorySortValue(match) {
  const categoryName = String(match.categoryName || "").trim();
  if (/^Junior Boys Singles$/i.test(categoryName)) {
    return [0, 0, -18, 0, categoryName.toLowerCase()];
  }
  if (/^Junior Girls Singles$/i.test(categoryName)) {
    return [0, 0, -18, 1, categoryName.toLowerCase()];
  }
  const youthMatch = categoryName.match(/^U\s*(\d+)\s+(Boys|Girls|Mixed)\s*'?s?\s+(Singles|Doubles|Teams)$/i);
  if (youthMatch) {
    const [, ageRaw, division, eventType] = youthMatch;
    const age = Number(ageRaw);
    const disciplineOrder = /^singles$/i.test(eventType) ? 0 : /^doubles$/i.test(eventType) ? 1 : 2;
    const divisionOrder = /^boys$/i.test(division) ? 0 : /^girls$/i.test(division) ? 1 : 2;
    return [0, disciplineOrder, -age, divisionOrder, categoryName.toLowerCase()];
  }

  const normalizedCategory = categoryName
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const seniorOrder = {
    "men singles": [1, 0, 0],
    "mens singles": [1, 0, 0],
    "women singles": [1, 0, 1],
    "womens singles": [1, 0, 1],
    "men teams": [1, 1, 0],
    "mens teams": [1, 1, 0],
    "women teams": [1, 1, 1],
    "womens teams": [1, 1, 1],
    "mixed teams": [1, 1, 2],
    "mixed team": [1, 1, 2],
    "men doubles": [1, 1, 0],
    "mens doubles": [1, 1, 0],
    "women doubles": [1, 1, 1],
    "womens doubles": [1, 1, 1],
    "mixed doubles": [1, 1, 2],
    "mixed mixed": [1, 1, 2],
  };
  if (seniorOrder[normalizedCategory]) {
    return [...seniorOrder[normalizedCategory], normalizedCategory];
  }

  return [2, 0, 0, categoryName.toLowerCase()];
}

function sortIndividualMatches(matches, context) {
  return [...matches].sort((a, b) => {
    const categoryA = getCategorySortValue(a);
    const categoryB = getCategorySortValue(b);
    for (let index = 0; index < Math.max(categoryA.length, categoryB.length); index += 1) {
      const left = categoryA[index];
      const right = categoryB[index];
      if (left < right) {
        return -1;
      }
      if (left > right) {
        return 1;
      }
    }

    const roundDiff = getRoundSortValue(a, context) - getRoundSortValue(b, context);
    if (roundDiff !== 0) {
      return roundDiff;
    }

    const matchNumberA = Number.isFinite(a.matchNumber) ? a.matchNumber : Number.MAX_SAFE_INTEGER;
    const matchNumberB = Number.isFinite(b.matchNumber) ? b.matchNumber : Number.MAX_SAFE_INTEGER;
    if (matchNumberA !== matchNumberB) {
      return matchNumberA - matchNumberB;
    }

    return String(a.description || "").localeCompare(String(b.description || ""));
  });
}

function formatMatchCategoryJa(match) {
  const categoryName = String(match.categoryName || "").trim();
  if (categoryName) {
    const youthMatch = categoryName.match(/^U\s*(\d+)\s+(Boys|Girls|Mixed)\s*'?s?\s+(Singles|Doubles|Teams)$/i);
    if (youthMatch) {
      const [, age, division, eventType] = youthMatch;
      const divisionJa =
        /^boys$/i.test(division) ? "男子" : /^girls$/i.test(division) ? "女子" : "混合";
      const eventTypeJa = /^singles$/i.test(eventType)
        ? "シングルス"
        : /^doubles$/i.test(eventType)
          ? "ダブルス"
          : "団体";
      return `U${age}${divisionJa}${eventTypeJa}`;
    }

    const normalizedCategory = categoryName
      .replace(/['’]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const categoryLabels = {
      "junior boys singles": "ジュニア男子",
      "junior girls singles": "ジュニア女子",
      "men teams": "男子団体",
      "mens teams": "男子団体",
      "women teams": "女子団体",
      "womens teams": "女子団体",
      "mixed teams": "混合団体",
      "mixed team": "混合団体",
      "men singles": "男子シングルス",
      "mens singles": "男子シングルス",
      "women singles": "女子シングルス",
      "womens singles": "女子シングルス",
      "men doubles": "男子ダブルス",
      "mens doubles": "男子ダブルス",
      "women doubles": "女子ダブルス",
      "womens doubles": "女子ダブルス",
      "mixed doubles": "混合ダブルス",
      "mixed mixed": "混合ダブルス",
    };
    if (categoryLabels[normalizedCategory]) {
      return categoryLabels[normalizedCategory];
    }
  }

  if (match.gender === "men") {
    if (match.discipline === "teams") {
      return "男子団体";
    }
    return match.discipline === "doubles" ? "男子ダブルス" : "男子シングルス";
  }
  if (match.gender === "women") {
    if (match.discipline === "teams") {
      return "女子団体";
    }
    return match.discipline === "doubles" ? "女子ダブルス" : "女子シングルス";
  }
  if (match.gender === "mixed") {
    if (match.discipline === "teams") {
      return "混合団体";
    }
    return "混合ダブルス";
  }
  return "";
}

function formatJaHeader(match, translations, rules) {
  const categoryLabel = formatMatchCategoryJa(match);
  const roundLabel = translateRoundJaForMatch(match, translations, rules, match.roundContext);
  return `▼${categoryLabel}${roundLabel} 　`;
}

function formatJaTeamLine(match, translations) {
  const displayedTeams = getDisplayedTeamIndexes(match);
  const { leftIndex, rightIndex } = displayedTeams;
  const left = translateTeam(match.teams[leftIndex], translations);
  const right = translateTeam(match.teams[rightIndex], translations);
  if (isMixedTeamMatch(match)) {
    const totals = getMixedTeamGameTotals(match, displayedTeams);
    return `　${left}　【${totals.left}-${totals.right}】　${right}`;
  }
  const rawScore = String(match.overallScore || "-");
  const [scoreA, scoreB] = rawScore.split("-");
  const score = leftIndex === 1 ? `${scoreB}-${scoreA}` : rawScore;
  return `　${left}　${score}　${right}`;
}

function formatJaSinglesLine(single, translations, displayedTeams, options = {}) {
  const { leftCompetitorIndex, rightCompetitorIndex } = getSingleDisplayIndexes(single, displayedTeams);
  const score = formatIndividualScoreJa(
    single,
    leftCompetitorIndex,
    displayedTeams?.parentMatch && isMixedTeamMatch(displayedTeams.parentMatch)
      ? { ...options, omitSetCounts: true }
      : options,
  );
  const left = getTeamSubMatchCompetitorName(single.competitors[leftCompetitorIndex], translations);
  const right = getTeamSubMatchCompetitorName(single.competitors[rightCompetitorIndex], translations);
  if (displayedTeams?.parentMatch && isMixedTeamMatch(displayedTeams.parentMatch)) {
    const overall = getDisplayedOverallScoreValues(single, leftCompetitorIndex);
    return `【${overall.left}】${left}　${score}　${right}【${overall.right}】`;
  }
  const winnerIndex = getWinnerIndexFromScore(single.overallScore);

  if (winnerIndex === leftCompetitorIndex) {
    return `○${left}　${score}　${right}`;
  }
  if (winnerIndex === rightCompetitorIndex) {
    return `　${left}　${score}　${right}○`;
  }
  return `　${left}　${score}　${right}`;
}

function formatJaPendingLine(match, index, translations, displayedTeams) {
  const inferredSchedule = inferOlympicPendingTeamSchedule(match, displayedTeams);
  const leftPlayers = match.singles.slice(0, 3).map((single) => {
    const { leftCompetitorIndex } = getSingleDisplayIndexes(single, displayedTeams);
    return single.competitors[leftCompetitorIndex]?.name || "";
  });
  const rightPlayers = match.singles.slice(0, 3).map((single) => {
    const { rightCompetitorIndex } = getSingleDisplayIndexes(single, displayedTeams);
    return single.competitors[rightCompetitorIndex]?.name || "";
  });
  const schedule = inferredSchedule || [
    [leftPlayers[0], rightPlayers[1]],
    [leftPlayers[1], rightPlayers[0]],
  ];
  const pair = schedule[index - 4] || [];
  const left = translatePlayer(pair[0] || "", translations);
  const right = translatePlayer(pair[1] || "", translations);
  return `　${left}　-　${right}`;
}

function formatJaIndividualMatchLine(match, translations, options = {}) {
  const { leftCompetitorIndex, rightCompetitorIndex } = getIndividualDisplayIndexes(match);
  const left = getCompetitorDisplayName(match.competitors[leftCompetitorIndex], translations);
  const right = getCompetitorDisplayName(match.competitors[rightCompetitorIndex], translations);
  const score = formatIndividualScoreJa(match, leftCompetitorIndex, options);
  if (match.discipline === "doubles" || match.discipline === "mixed") {
    return `${left}\n　${score}\n　　${right}`;
  }
  return `${left}　${score}　${right}`;
}

function formatJapanese(matches, translations, rules, roundContext, options = {}) {
  const sortedMatches = sortIndividualMatches(matches, roundContext);
  const blocks = [];
  let individualGroup = null;

  const flushIndividualGroup = () => {
    if (!individualGroup) {
      return;
    }
    blocks.push([
      formatJaHeader(
        {
          source: individualGroup.matches[0]?.source,
          gender: individualGroup.matches[0]?.gender,
          discipline: individualGroup.matches[0]?.discipline,
          categoryName: individualGroup.matches[0]?.categoryName,
          roundKey: individualGroup.roundKey,
          roundLabel: individualGroup.roundLabel,
          roundContext,
        },
        translations,
        rules,
      ),
      ...individualGroup.matches.map((match) => formatJaIndividualMatchLine(match, translations, options)),
    ].join("\n"));
    individualGroup = null;
  };

  for (const match of sortedMatches) {
    if (match.matchType === "individual") {
      if (
        individualGroup &&
        individualGroup.roundKey === match.roundKey &&
        individualGroup.roundLabel === match.roundLabel &&
        individualGroup.categoryName === match.categoryName
      ) {
        individualGroup.matches.push(match);
      } else {
        flushIndividualGroup();
        individualGroup = {
          categoryName: match.categoryName,
          roundKey: match.roundKey,
          roundLabel: match.roundLabel,
          matches: [match],
        };
      }
      continue;
    }

    flushIndividualGroup();

    const displayedTeams = getDisplayedTeamIndexes(match);
    displayedTeams.parentMatch = match;
    const lines = [
      formatJaHeader({ ...match, roundContext }, translations, rules),
      formatJaTeamLine(match, translations),
      ...match.singles.map((single) =>
        formatJaSinglesLine(single, translations, displayedTeams, options),
      ),
    ];

    if (!(match.discipline === "teams" && match.gender === "mixed")) {
      for (let i = match.singles.length + 1; i <= 5; i += 1) {
        lines.push(formatJaPendingLine(match, i, translations, displayedTeams));
      }
    }

    blocks.push(lines.join("\n"));
  }

  flushIndividualGroup();
  return blocks.join("\n\n");
}

function formatList(matches) {
  return matches
    .map((match, index) => {
      if (match.matchType === "individual") {
        const left = getCompetitorDisplayName(match.competitors[0], { players: {}, teams: {} }) || "TBD";
        const right = getCompetitorDisplayName(match.competitors[1], { players: {}, teams: {} }) || "TBD";
        return `${index + 1}. ${match.description} | ${left} ${match.overallScore || ""} ${right}`.trim();
      }

      const left = match.teams[0] ? `${match.teams[0].name} (${match.teams[0].org})` : "TBD";
      const right = match.teams[1] ? `${match.teams[1].name} (${match.teams[1].org})` : "TBD";
      return `${index + 1}. ${match.description} | ${left} ${match.overallScore || ""} ${right}`.trim();
    })
    .join("\n");
}

function formatText(matches) {
  return matches
    .map((match, index) => {
      const lines = [];

      if (match.matchType === "individual") {
        const home = match.competitors[0];
        const away = match.competitors[1];
        const gameScores = match.gameScores.length ? match.gameScores.join(", ") : "-";
        lines.push(`[${index + 1}] ${match.description}`);
        lines.push(
          `${home?.name || "TBD"} (${home?.org || "-"}) ${match.overallScore || "-"} ${away?.name || "TBD"} (${away?.org || "-"})`,
        );
        lines.push(`games: ${gameScores}`);
        return lines.join("\n");
      }

      const left = match.teams[0] ? `${match.teams[0].name} (${match.teams[0].org})` : "TBD";
      const right = match.teams[1] ? `${match.teams[1].name} (${match.teams[1].org})` : "TBD";

      lines.push(`[${index + 1}] ${match.description}`);
      lines.push(`${left} ${match.overallScore || "-"} ${right}`);

      for (const singles of match.singles) {
        const home = singles.competitors[0];
        const away = singles.competitors[1];
        const gameScores = singles.gameScores.length ? singles.gameScores.join(", ") : "-";
        lines.push(
          `${singles.order}. ${home?.name || "TBD"} (${home?.org || "-"}) vs ${away?.name || "TBD"} (${away?.org || "-"}) | ${singles.overallScore || "-"} | ${gameScores}`,
        );
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function createArgs(overrides = {}) {
  const defaults = {
    source: "wtt",
    event: null,
    category: null,
    gender: null,
    discipline: null,
    round: null,
    contains: null,
    docCode: null,
    limit: null,
    take: DEFAULT_TAKE,
    json: false,
    list: false,
    pretty: true,
    ja: false,
    translations: DEFAULT_TRANSLATIONS_PATH,
    rules: DEFAULT_RULES_PATH,
    cacheDir: DEFAULT_CACHE_DIR,
    zennihonArchiveDir: DEFAULT_ZENNIHON_ARCHIVE_DIR,
    wttArchiveDir: DEFAULT_WTT_ARCHIVE_DIR,
    wttArchiveIndexPath: DEFAULT_WTT_ARCHIVE_INDEX_PATH,
    allowNetworkForZennihonArchiveMiss: false,
    writeZennihonArchive: false,
    refreshCache: false,
    omitSetCounts: false,
  };

  return Object.fromEntries(
    Object.entries({ ...defaults, ...overrides }).map(([key, value]) => [
      key,
      value === undefined ? defaults[key] : value,
    ]),
  );
}

async function getProcessedMatches(options = {}) {
  const args = createArgs(options);
  args.source = normalizeSource(args.source);
  if (!args.event) {
    throw new Error("--event is required");
  }

  let normalizedCategory = null;
  if (args.category) {
    normalizedCategory = normalizeCategory(args.category);
    if (!normalizedCategory.isExactCategory && !args.gender) {
      args.gender = normalizedCategory.gender;
    }
    if (!normalizedCategory.isExactCategory && !args.discipline) {
      args.discipline = normalizedCategory.discipline;
    }
  }

  const payload = await fetchOfficialResultsCached(
    args.source,
    args.event,
    args.take,
    args.cacheDir,
    args.refreshCache,
    {
      zennihonArchiveDir: args.zennihonArchiveDir,
      wttArchiveDir: args.wttArchiveDir,
      wttArchiveIndexPath: args.wttArchiveIndexPath,
      allowNetworkForZennihonArchiveMiss: args.allowNetworkForZennihonArchiveMiss,
      writeZennihonArchive: args.writeZennihonArchive,
    },
  );
  const normalized = args.source === "zennihon"
    ? payload.filter(Boolean)
    : payload.map((item) => (isPreNormalizedMatch(item) ? item : normalizeOfficialResultItem(item))).filter(Boolean);
  const translations = readTranslations(args.translations);
  const filtered = applyFilters(normalized, args, translations);
  const rules = readRules(args.rules);
  const jaRoundContext = buildJaRoundContext(
    normalized.filter((match) => {
      if (normalizedCategory?.isExactCategory && normalizedCategory.categoryName) {
        return match.categoryName === normalizedCategory.categoryName;
      }
      if (args.gender && match.gender !== inferGender(args.gender)) {
        return false;
      }
      if (args.discipline && match.discipline !== normalizeDiscipline(args.discipline)) {
        return false;
      }
      return true;
    }),
  );

  return {
    args,
    payload,
    normalized,
    filtered,
    translations,
    rules,
    jaRoundContext,
  };
}

function renderOutput(result) {
  const { args, filtered, translations, rules, jaRoundContext } = result;

  if (args.json) {
    const spacing = args.pretty ? 2 : 0;
    return JSON.stringify(filtered, null, spacing);
  }

  if (args.list) {
    return formatList(filtered);
  }

  if (args.ja) {
    return formatJapanese(filtered, translations, rules, jaRoundContext, {
      omitSetCounts: args.omitSetCounts,
    });
  }

  return formatText(filtered);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await getProcessedMatches(args);
  console.log(renderOutput(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_DATA_DIR,
  DEFAULT_CACHE_DIR,
  DEFAULT_RULES_PATH,
  DEFAULT_TAKE,
  DEFAULT_TRANSLATIONS_PATH,
  DEFAULT_WTT_ARCHIVE_DIR,
  DEFAULT_WTT_ARCHIVE_INDEX_PATH,
  DEFAULT_WTT_DATE_INDEX_PATH,
  DEFAULT_ZENNIHON_ARCHIVE_DIR,
  ZENNIHON_ARCHIVE_YEARS,
  applyFilters,
  buildJaRoundContext,
  createArgs,
  extractRound,
  fetchOfficialResultsCached,
  formatJapanese,
  formatList,
  formatText,
  getWttEventLifecycleMeta,
  getProcessedMatches,
  inferGender,
  matchesRoundFilter,
  normalizeCategory,
  normalizeSource,
  normalizeRound,
  normalizeOfficialResultItem,
  normalizeTeamMatch,
  normalizeStandaloneMatch,
  parseArgs,
  readZennihonArchive,
  readRules,
  readTranslations,
  readWttArchive,
  readWttDateIndex,
  renderOutput,
  shouldUseZennihonArchive,
  translateRoundJa,
  updateWttArchiveIndexEntry,
  writeWttArchive,
  writeWttDateIndex,
  writeZennihonArchive,
};
