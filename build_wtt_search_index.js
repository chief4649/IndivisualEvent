#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const {
  DEFAULT_CACHE_DIR,
  DEFAULT_DATA_DIR,
  DEFAULT_WTT_ARCHIVE_DIR,
  DEFAULT_WTT_ARCHIVE_INDEX_PATH,
  DEFAULT_WTT_DATE_INDEX_PATH,
  fetchOfficialResultsCached,
  getWttEventLifecycleMeta,
  readWttDateIndex,
} = require("./extract_individual_matches");

const EVENT_NAME_API_KEY = "S_WTT_882jjh7basdj91834783mds8j2jsd81";
const DEFAULT_OUTPUT_PATH = path.join(DEFAULT_DATA_DIR, "wtt-search-index.json");

function parseArgs(argv) {
  const args = {
    start: 3000,
    end: 4100,
    take: 50,
    concurrency: 6,
    output: DEFAULT_OUTPUT_PATH,
    cacheDir: DEFAULT_CACHE_DIR,
    wttArchiveDir: DEFAULT_WTT_ARCHIVE_DIR,
    wttArchiveIndexPath: DEFAULT_WTT_ARCHIVE_INDEX_PATH,
    wttDateIndexPath: DEFAULT_WTT_DATE_INDEX_PATH,
    refresh: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--start":
        args.start = Number(next);
        i += 1;
        break;
      case "--end":
        args.end = Number(next);
        i += 1;
        break;
      case "--take":
        args.take = Number(next);
        i += 1;
        break;
      case "--concurrency":
        args.concurrency = Number(next);
        i += 1;
        break;
      case "--output":
        args.output = path.resolve(next);
        i += 1;
        break;
      case "--cache-dir":
        args.cacheDir = path.resolve(next);
        i += 1;
        break;
      case "--wtt-date-index":
        args.wttDateIndexPath = path.resolve(next);
        i += 1;
        break;
      case "--refresh":
        args.refresh = true;
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

  if (!Number.isInteger(args.start) || !Number.isInteger(args.end) || args.start <= 0 || args.end < args.start) {
    throw new Error("--start/--end must be positive integers and end >= start");
  }

  if (!Number.isInteger(args.concurrency) || args.concurrency <= 0) {
    throw new Error("--concurrency must be a positive integer");
  }

  return args;
}

function printHelp(exitCode = 0) {
  console.log([
    "Usage:",
    "  node build_wtt_search_index.js [options]",
    "",
    "Options:",
    "  --start        Start event ID to probe (default: 3000)",
    "  --end          End event ID to probe (default: 4100)",
    "  --take         Result page size for verification (default: 50)",
    "  --concurrency  Parallel probes (default: 6)",
    "  --output       Output JSON path",
    "  --cache-dir    Cache directory",
    "  --refresh      Ignore cached verification results",
  ].join("\n"));
  process.exit(exitCode);
}

function readIndex(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeIndex(filePath, index) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sorted = Object.fromEntries(
    Object.entries(index).sort((left, right) => Number(left[0]) - Number(right[0])),
  );
  fs.writeFileSync(filePath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

function mergeDateIndexEntries(index, dateIndex) {
  Object.entries(dateIndex || {}).forEach(([eventId, entry]) => {
    const normalizedId = String(eventId || "").trim();
    const numericId = Number(normalizedId);
    const eventName = String(entry?.eventName || entry?.title || "").trim();
    if (
      !normalizedId ||
      !Number.isFinite(numericId) ||
      numericId < 2500 ||
      !eventName ||
      !shouldIndexWttEventName(eventName)
    ) {
      return;
    }

    index[normalizedId] = {
      ...(index[normalizedId] || {}),
      event: normalizedId,
      eventName,
      startDate: entry?.startDate || index[normalizedId]?.startDate || null,
      endDate: entry?.endDate || index[normalizedId]?.endDate || null,
      dateLabel: formatDateRange(entry?.startDate || null, entry?.endDate || null),
      archived: Boolean(index[normalizedId]?.archived),
      status: resolveLifecycleStatus(
        entry?.startDate || null,
        entry?.endDate || null,
        index[normalizedId]?.status || "unknown",
        eventName,
      ),
      source: index[normalizedId]?.source || entry?.source || "calendar",
      series: classifyWttSeries(eventName),
      verifiedAt: index[normalizedId]?.verifiedAt || new Date().toISOString(),
    };
  });
}

function classifyWttSeries(eventName) {
  const text = String(eventName || "").toLowerCase();
  if (!text) {
    return "";
  }
  if (text.includes("world table tennis championships finals") || text.includes("world team table tennis championships finals")) {
    return "World Championships";
  }
  if (text.includes("youth")) {
    return "Youth";
  }
  if (text.includes("smash")) {
    return "Smash";
  }
  if (/\bchampions\b/.test(text)) {
    return "Champions";
  }
  if (text.includes("star contender")) {
    return "Star Contender";
  }
  if (text.includes("contender")) {
    return "Contender";
  }
  if (text.includes("feeder")) {
    return "Feeder";
  }
  if (text.includes("finals")) {
    return "Finals";
  }
  return "Other";
}

function shouldIndexWttEventName(eventName) {
  const text = String(eventName || "").trim();
  if (!text) {
    return false;
  }
  return !/\btest\b|\bsimulation\b/i.test(text);
}

function formatDateRange(startDate, endDate) {
  const start = String(startDate || "").trim();
  const end = String(endDate || "").trim();
  const startMatch = start.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const endMatch = end.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (startMatch && endMatch) {
    const [, startYear, startMonth, startDay] = startMatch;
    const [, endYear, endMonth, endDay] = endMatch;
    if (startYear === endYear && startMonth === endMonth) {
      return `${startYear}/${Number(startMonth)}/${Number(startDay)}-${Number(endDay)}`;
    }
    return `${startYear}/${Number(startMonth)}/${Number(startDay)}-${Number(endMonth)}/${Number(endDay)}`;
  }
  if (startMatch) {
    const [, year, month, day] = startMatch;
    return `${year}/${Number(month)}/${Number(day)}`;
  }
  if (endMatch) {
    const [, year, month, day] = endMatch;
    return `${year}/${Number(month)}/${Number(day)}`;
  }
  return start || end || "";
}

function toComparableDate(value, endOfDay = false) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text === "0001-01-01") {
    return null;
  }
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const date = new Date(`${text}${suffix}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deriveLifecycleStatus(startDate, endDate, fallbackStatus = "unknown") {
  const now = new Date();
  const start = toComparableDate(startDate, false);
  const end = toComparableDate(endDate, true);

  if (start && start > now) {
    return "upcoming";
  }
  if (end && end < now) {
    return "finished";
  }
  if (start && end && start <= now && end >= now) {
    return "live";
  }
  return fallbackStatus;
}

function inferStatusFromEventNameYear(eventName, fallbackStatus = "unknown") {
  const text = String(eventName || "").trim();
  if (!text) {
    return fallbackStatus;
  }

  const years = Array.from(text.matchAll(/\b(20\d{2})\b/g))
    .map((match) => Number(match[1]))
    .filter((year) => Number.isInteger(year));
  if (years.length === 0) {
    return fallbackStatus === "live" ? "unknown" : fallbackStatus;
  }

  const eventYear = Math.max(...years);
  const currentYear = new Date().getUTCFullYear();
  if (eventYear < currentYear) {
    return "finished";
  }
  if (eventYear > currentYear) {
    return "upcoming";
  }
  return fallbackStatus === "live" ? "unknown" : fallbackStatus;
}

function resolveLifecycleStatus(startDate, endDate, fallbackStatus = "unknown", eventName = "") {
  const derived = deriveLifecycleStatus(startDate, endDate, fallbackStatus);
  if (String(startDate || "").trim() || String(endDate || "").trim()) {
    return derived;
  }
  return inferStatusFromEventNameYear(eventName, derived);
}

function inferFinishedFromPayload(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    return false;
  }

  const categoryToHasOfficialFinal = new Map();
  for (const match of payload) {
    const categoryName = String(match?.categoryName || match?.subEventType || "").trim();
    if (!categoryName) {
      continue;
    }
    if (!categoryToHasOfficialFinal.has(categoryName)) {
      categoryToHasOfficialFinal.set(categoryName, false);
    }
    const roundKey = String(match?.roundKey || "").trim().toLowerCase();
    const roundLabel = String(match?.roundLabel || "").trim().toLowerCase();
    const status = String(match?.resultStatus || "").trim().toUpperCase();
    if ((roundKey === "final" || roundLabel === "final") && status === "OFFICIAL") {
      categoryToHasOfficialFinal.set(categoryName, true);
    }
  }

  return categoryToHasOfficialFinal.size > 0 && Array.from(categoryToHasOfficialFinal.values()).every(Boolean);
}

async function fetchEventName(eventId) {
  const response = await fetch(`https://liveeventsapi.worldtabletennis.com/api/cms/GetEventName/${encodeURIComponent(eventId)}`, {
    headers: {
      accept: "application/json, text/plain, */*",
      referer: "https://www.worldtabletennis.com/",
      "user-agent": "Mozilla/5.0 (compatible; Codex/1.0)",
      secapimkey: EVENT_NAME_API_KEY,
    },
  });

  if (!response.ok) {
    return "";
  }

  const payload = await response.json();
  return Array.isArray(payload)
    ? String(payload[0]?.eventName || "").trim()
    : String(payload?.eventName || "").trim();
}

function deriveEventName(meta, payload) {
  if (meta?.title) {
    return String(meta.title).trim();
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const candidate = String(
        item?.EventName
          || item?.eventName
          || item?.TournamentName
          || item?.tournamentName
          || item?.CompetitionName
          || "",
      ).trim();
      if (candidate) {
        return candidate;
      }
    }
  }

  return "";
}

async function verifyEvent(eventId, args) {
  const meta = await getWttEventLifecycleMeta(eventId, {
    wttArchiveDir: args.wttArchiveDir,
    wttArchiveIndexPath: args.wttArchiveIndexPath,
    wttDateIndexPath: args.wttDateIndexPath,
  });

  const payload = await fetchOfficialResultsCached("wtt", eventId, args.take, args.cacheDir, args.refresh, {
    wttArchiveDir: args.wttArchiveDir,
    wttArchiveIndexPath: args.wttArchiveIndexPath,
    wttDateIndexPath: args.wttDateIndexPath,
  });

  if (!Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  const eventName = deriveEventName(meta, payload) || await fetchEventName(eventId);
  if (!shouldIndexWttEventName(eventName)) {
    return null;
  }
  const inferredFinished = Boolean(meta?.isFinished) || inferFinishedFromPayload(payload);

  return {
    event: String(eventId),
    eventName,
    startDate: meta?.startDate || null,
    endDate: meta?.endDate || null,
    dateLabel: formatDateRange(meta?.startDate, meta?.endDate),
    archived: Boolean(meta?.archived),
    status: resolveLifecycleStatus(
      meta?.startDate,
      meta?.endDate,
      inferredFinished ? "finished" : "unknown",
      eventName,
    ),
    source: meta?.source || "wtt",
    series: classifyWttSeries(eventName),
    verifiedAt: new Date().toISOString(),
  };
}

async function runPool(ids, concurrency, worker) {
  let index = 0;
  const results = [];

  async function next() {
    if (index >= ids.length) {
      return;
    }
    const current = ids[index];
    index += 1;
    const result = await worker(current);
    results.push(result);
    await next();
  }

  const workers = Array.from({ length: Math.min(concurrency, ids.length) }, () => next());
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const existingIndex = readIndex(args.output);
  const dateIndex = readWttDateIndex(args.wttDateIndexPath);
  const ids = [];
  for (let eventId = args.start; eventId <= args.end; eventId += 1) {
    ids.push(String(eventId));
  }

  console.error(`Scanning WTT event IDs ${args.start}-${args.end} ...`);

  await runPool(ids, args.concurrency, async (eventId) => {
    try {
      const entry = await verifyEvent(eventId, args);
      if (!entry) {
        delete existingIndex[eventId];
        return null;
      }
      existingIndex[eventId] = entry;
      console.error(`OK ${eventId} ${entry.eventName}`);
      return entry;
    } catch (error) {
      delete existingIndex[eventId];
      console.error(`SKIP ${eventId} ${error.message}`);
      return null;
    }
  });

  mergeDateIndexEntries(existingIndex, dateIndex);
  writeIndex(args.output, existingIndex);
  console.error(`Wrote ${Object.keys(existingIndex).length} indexed events to ${args.output}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
