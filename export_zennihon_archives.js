#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const {
  DEFAULT_CACHE_DIR,
  DEFAULT_DATA_DIR,
  DEFAULT_ZENNIHON_ARCHIVE_DIR,
  ZENNIHON_ARCHIVE_YEARS,
  getProcessedMatches,
  normalizeSource,
  writeZennihonArchive,
} = require("./extract_individual_matches");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const CACHE_DIR = path.join(DATA_DIR, ".cache");
const ARCHIVE_DIR = path.join(DATA_DIR, "zennihon-records");
const EVENT_NAMES_PATH = path.join(DATA_DIR, "event-names.json");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseArgs(argv) {
  const args = {
    years: [...ZENNIHON_ARCHIVE_YEARS].sort(),
    refreshCache: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--years":
        args.years = String(next || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        index += 1;
        break;
      case "--refresh-cache":
        args.refreshCache = true;
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

  return args;
}

function printHelp(exitCode = 0) {
  console.log([
    "Usage:",
    "  node export_zennihon_archives.js [options]",
    "",
    "Options:",
    "  --years  Comma separated years, default 2011-2025",
    "  --refresh-cache  Refetch zennihon source instead of reusing HTTP cache",
  ].join("\n"));
  process.exit(exitCode);
}

function readEventNamesMap() {
  if (!fs.existsSync(EVENT_NAMES_PATH)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(EVENT_NAMES_PATH, "utf8"));
}

function writePrettyJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function fetchZennihonEventName(eventId) {
  const response = await fetch(`https://www.japantabletennis.com/AJ/result${encodeURIComponent(eventId)}/`, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 (compatible; Codex/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch zennihon event name: ${response.status} ${response.statusText}`);
  }

  const html = new TextDecoder("euc-jp").decode(await response.arrayBuffer());
  const h3Match = html.match(/<h3>([\s\S]*?)<\/h3>/i);
  if (h3Match) {
    return String(h3Match[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  return titleMatch ? String(titleMatch[1]).replace(/\s+/g, " ").trim() : "";
}

async function exportYear(eventId, refreshCache, eventNames) {
  const result = await getProcessedMatches({
    source: normalizeSource("zennihon"),
    event: String(eventId),
    cacheDir: CACHE_DIR || DEFAULT_CACHE_DIR,
    zennihonArchiveDir: ARCHIVE_DIR || DEFAULT_ZENNIHON_ARCHIVE_DIR,
    allowNetworkForZennihonArchiveMiss: true,
    writeZennihonArchive: true,
    refreshCache,
  });
  writeZennihonArchive(ARCHIVE_DIR, String(eventId), result.normalized);

  const eventName = await fetchZennihonEventName(String(eventId));
  const nextEventNames = {
    ...eventNames,
    zennihon: {
      ...(eventNames.zennihon || {}),
      [String(eventId)]: eventName,
    },
  };
  writePrettyJson(EVENT_NAMES_PATH, nextEventNames);

  return {
    eventId: String(eventId),
    eventName,
    matches: result.normalized.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureDir(DATA_DIR);
  ensureDir(CACHE_DIR);
  ensureDir(ARCHIVE_DIR);

  let eventNames = readEventNamesMap();
  for (const year of args.years) {
    const summary = await exportYear(year, args.refreshCache, eventNames);
    eventNames = readEventNamesMap();
    console.log(`${summary.eventId}: ${summary.matches} matches`);
    if (summary.eventName) {
      console.log(`  ${summary.eventName}`);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
