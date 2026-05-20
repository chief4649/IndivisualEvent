#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const {
  DEFAULT_DATA_DIR,
  DEFAULT_TAKE,
  WTT_SUSPICIOUS_RESULT_COUNTS,
  getProcessedMatches,
  getWttEventLifecycleMeta,
  updateWttArchiveIndexEntry,
  writeWttArchiveIfNotSmaller,
} = require("./extract_individual_matches");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const WTT_ARCHIVE_DIR = path.join(DATA_DIR, "wtt-records");
const WTT_ARCHIVE_INDEX_PATH = path.join(DATA_DIR, "wtt-archive-index.json");
const WTT_DATE_INDEX_PATH = path.join(DATA_DIR, "wtt-date-index.json");
const WTT_SEARCH_INDEX_PATH = path.join(DATA_DIR, "wtt-search-index.json");
const ARCHIVE_COMPLETENESS_VERSION = 3;

function parseArgs(argv) {
  const args = {
    from: "",
    to: "",
    limit: 20,
    delayMs: 2000,
    take: DEFAULT_TAKE,
    force: false,
    includeActive: false,
    dryRun: false,
    events: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--from":
        args.from = String(next || "").trim();
        index += 1;
        break;
      case "--to":
        args.to = String(next || "").trim();
        index += 1;
        break;
      case "--limit":
        args.limit = Number(next);
        index += 1;
        break;
      case "--delay-ms":
        args.delayMs = Number(next);
        index += 1;
        break;
      case "--take":
        args.take = Number(next);
        index += 1;
        break;
      case "--event":
      case "-e":
        args.events.push(...String(next || "").split(",").map((value) => value.trim()).filter(Boolean));
        index += 1;
        break;
      case "--force":
        args.force = true;
        break;
      case "--include-active":
        args.includeActive = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--help":
      case "-h":
        printHelp(0);
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        args.events.push(...arg.split(",").map((value) => value.trim()).filter(Boolean));
    }
  }

  if (!Number.isFinite(args.limit) || args.limit < 1) {
    args.limit = 20;
  }
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) {
    args.delayMs = 2000;
  }
  if (!Number.isFinite(args.take) || args.take < 1) {
    args.take = DEFAULT_TAKE;
  }

  return args;
}

function printHelp(exitCode = 0) {
  console.log([
    "Usage:",
    "  node crawl_wtt_archives.js --from 2026-01 --to 2026-12 --limit 20",
    "  node crawl_wtt_archives.js --event 3360,3361 --include-active",
    "",
    "Options:",
    "  --from YYYY-MM[-DD]  Include events ending on or after this date/month",
    "  --to YYYY-MM[-DD]    Include events starting on or before this date/month",
    "  --limit N           Maximum events to fetch in this run, default 20",
    "  --delay-ms N        Delay between API fetches, default 2000",
    `  --take N            WTT API page size, default ${DEFAULT_TAKE}`,
    "  --event ID[,ID]     Fetch specific event IDs",
    "  --force             Re-fetch even when wtt-records/{event}.json exists",
    "  --include-active    Also fetch events that are not finished yet",
    "  --dry-run           Print planned work without fetching",
  ].join("\n"));
  process.exit(exitCode);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeDateBoundary(value, endOfRange = false) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const monthMatch = text.match(/^(\d{4})-(\d{1,2})$/);
  if (monthMatch) {
    const year = monthMatch[1];
    const month = String(Number(monthMatch[2])).padStart(2, "0");
    if (!endOfRange) {
      return `${year}-${month}-01`;
    }
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    return `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
  }
  const dateMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateMatch) {
    return `${dateMatch[1]}-${String(Number(dateMatch[2])).padStart(2, "0")}-${String(Number(dateMatch[3])).padStart(2, "0")}`;
  }
  throw new Error(`Invalid date: ${value}`);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isFinished(entry) {
  return isIsoDate(entry?.endDate) && entry.endDate < getTodayIso();
}

function archivePath(eventId) {
  return path.join(WTT_ARCHIVE_DIR, `${String(eventId).trim()}.json`);
}

function getArchiveMatchCount(eventId) {
  const filePath = archivePath(eventId);
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(payload) ? payload.length : 0;
}

function isSuspiciousArchiveCount(count, entry) {
  return WTT_SUSPICIOUS_RESULT_COUNTS.has(count) && entry?.archiveCompletenessVersion !== ARCHIVE_COMPLETENESS_VERSION;
}

function isTransientCrawlSkip(entry) {
  const reason = String(entry?.crawlSkipReason || "");
  return reason.startsWith("error:") || reason.includes("Timed out fetching") || reason.includes("fetch failed");
}

function buildCandidates(args) {
  const dateIndex = readJson(WTT_DATE_INDEX_PATH);
  const searchIndex = readJson(WTT_SEARCH_INDEX_PATH);
  const archiveIndex = readJson(WTT_ARCHIVE_INDEX_PATH);
  const from = normalizeDateBoundary(args.from, false);
  const to = normalizeDateBoundary(args.to, true);
  const requestedEvents = new Set(args.events.map((eventId) => String(eventId).trim()).filter(Boolean));
  const eventIds = requestedEvents.size
    ? requestedEvents
    : new Set([
      ...Object.keys(dateIndex),
      ...Object.keys(searchIndex),
      ...Object.keys(archiveIndex),
    ]);

  return [...eventIds]
    .map((eventId) => {
      const entry = {
        ...(dateIndex[eventId] || {}),
        ...(searchIndex[eventId] || {}),
        ...(archiveIndex[eventId] || {}),
      };
      const startDate = entry.startDate || "";
      const endDate = entry.endDate || "";
      const archiveCount = getArchiveMatchCount(eventId);
      return {
        eventId,
        title: entry.eventName || entry.title || "",
        source: entry.source || "wtt",
        startDate,
        endDate,
        archived: archiveCount > 0,
        archiveCount,
        suspiciousArchive: isSuspiciousArchiveCount(archiveCount, entry),
        crawlSkipped: Boolean(entry.crawlSkipped) && !isTransientCrawlSkip(entry),
        crawlSkipReason: entry.crawlSkipReason || "",
        finished: isFinished(entry),
      };
    })
    .filter((candidate) => {
      if (from && candidate.endDate && candidate.endDate < from) {
        return false;
      }
      if (to && candidate.startDate && candidate.startDate > to) {
        return false;
      }
      if (!args.includeActive && !candidate.finished) {
        return false;
      }
      if (!args.force && candidate.archived && !candidate.suspiciousArchive) {
        return false;
      }
      if (!args.force && candidate.crawlSkipped) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const leftDate = left.startDate || left.endDate || "";
      const rightDate = right.startDate || right.endDate || "";
      if (leftDate !== rightDate) {
        return leftDate.localeCompare(rightDate);
      }
      return Number(left.eventId) - Number(right.eventId);
    })
    .slice(0, args.limit);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markCrawlSkipped(candidate, reason) {
  const reasonText = String(reason || "");
  if (
    reasonText === "not_finished" ||
    reasonText.startsWith("smaller_payload:") ||
    reasonText.startsWith("error:") ||
    reasonText.includes("Timed out fetching") ||
    reasonText.includes("fetch failed")
  ) {
    return;
  }

  updateWttArchiveIndexEntry(WTT_ARCHIVE_INDEX_PATH, candidate.eventId, {
    source: candidate.source || "wtt",
    title: candidate.title || "",
    startDate: candidate.startDate || null,
    endDate: candidate.endDate || null,
    crawlSkipped: true,
    crawlSkipReason: reason,
    crawlSkippedAt: new Date().toISOString(),
  });
}

async function archiveEvent(candidate, args) {
  const shouldRefresh = Boolean(args.force || candidate.suspiciousArchive);
  const meta = await getWttEventLifecycleMeta(candidate.eventId, {
    wttArchiveDir: WTT_ARCHIVE_DIR,
    wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
  });

  if (!args.includeActive && !meta.isFinished) {
    return { eventId: candidate.eventId, status: "skipped", reason: "not_finished" };
  }

  const result = await getProcessedMatches({
    source: "wtt",
    event: candidate.eventId,
    take: args.take,
    wttArchiveDir: WTT_ARCHIVE_DIR,
    wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
    refreshCache: shouldRefresh,
    skipWttMinimalHydration: true,
    requireWttSubEventSupplementForSuspicious: true,
  });

  if (!Array.isArray(result.normalized) || result.normalized.length === 0) {
    return { eventId: candidate.eventId, status: "skipped", reason: "zero_matches" };
  }

  const archiveWrite = writeWttArchiveIfNotSmaller(WTT_ARCHIVE_DIR, candidate.eventId, result.normalized, {
    force: args.force,
  });
  if (!archiveWrite.written) {
    return {
      eventId: candidate.eventId,
      status: "skipped",
      reason: `${archiveWrite.reason}:${archiveWrite.nextCount}<${archiveWrite.existingCount}`,
    };
  }

  updateWttArchiveIndexEntry(WTT_ARCHIVE_INDEX_PATH, candidate.eventId, {
    archived: true,
    source: meta.source || candidate.source || "wtt",
    title: meta.title || candidate.title || "",
    startDate: meta.startDate || candidate.startDate || null,
    endDate: meta.endDate || candidate.endDate || null,
    canAutoArchive: Boolean(meta.canAutoArchive),
    archiveMatchCount: result.normalized.length,
    archiveFetchTake: args.take,
    archiveRefreshed: shouldRefresh,
    archiveCompletenessVersion: ARCHIVE_COMPLETENESS_VERSION,
    archiveVerifiedAt: new Date().toISOString(),
    crawlSkipped: false,
    crawlSkipReason: null,
    crawlSkippedAt: null,
    archivedAt: new Date().toISOString(),
    forced: Boolean(args.includeActive && !meta.isFinished),
  });

  return { eventId: candidate.eventId, status: "archived", matches: result.normalized.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidates = buildCandidates(args);

  console.log(`candidates: ${candidates.length}`);
  candidates.forEach((candidate, index) => {
    const dateLabel = [candidate.startDate, candidate.endDate].filter(Boolean).join(" - ");
    console.log(`${index + 1}. ${candidate.eventId} ${dateLabel} ${candidate.title}`.trim());
  });

  if (args.dryRun || candidates.length === 0) {
    return;
  }

  const summary = { archived: 0, skipped: 0, failed: 0 };
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      console.log(`fetching: ${candidate.eventId}${candidate.suspiciousArchive ? ` (refresh suspicious ${candidate.archiveCount})` : ""}`);
      const result = await archiveEvent(candidate, args);
      if (result.status === "archived") {
        summary.archived += 1;
        console.log(`archived: ${result.eventId} (${result.matches} matches)`);
      } else {
        summary.skipped += 1;
        markCrawlSkipped(candidate, result.reason);
        console.log(`skipped: ${result.eventId} (${result.reason})`);
      }
    } catch (error) {
      summary.failed += 1;
      markCrawlSkipped(candidate, `error:${error?.message || error}`);
      console.error(`failed: ${candidate.eventId} ${error?.message || error}`);
    }

    if (index < candidates.length - 1 && args.delayMs > 0) {
      await sleep(args.delayMs);
    }
  }

  console.log(`done: archived=${summary.archived} skipped=${summary.skipped} failed=${summary.failed}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
