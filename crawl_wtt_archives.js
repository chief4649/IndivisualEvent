#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  DEFAULT_DATA_DIR,
  DEFAULT_TAKE,
  WTT_SUSPICIOUS_RESULT_COUNTS,
  getProcessedMatches,
  getWttEventLifecycleMeta,
  updateWttArchiveIndexEntry,
  writeWttArchiveIfNotSmaller,
} = require("./extract_individual_matches");
const { updatePlayerRecordCandidateIndexForEvents } = require("./build_player_records_index");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const WTT_ARCHIVE_DIR = path.join(DATA_DIR, "wtt-records");
const WTT_SLIM_ARCHIVE_DIR = path.join(DATA_DIR, "wtt-records-slim");
const PLAYER_RECORD_EVENT_INDEX_DIR = path.join(DATA_DIR, "player-records-index", "event-records");
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
    skipDerivedIndexes: false,
    skipH2hIndex: false,
    keepRaw: false,
    auditSuspicious: false,
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
      case "--skip-derived-indexes":
        args.skipDerivedIndexes = true;
        break;
      case "--skip-h2h-index":
        args.skipH2hIndex = true;
        break;
      case "--keep-raw":
        args.keepRaw = true;
        break;
      case "--audit-suspicious":
        args.auditSuspicious = true;
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
    "  --skip-derived-indexes  Do not build slim records or player-record event indexes",
    "  --skip-h2h-index    Do not rebuild the head-to-head index after archiving",
    "  --keep-raw          Keep wtt-records/{event}.json after derived files are built",
    "  --audit-suspicious  Re-fetch finished archives with low or capped match counts",
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

function slimArchivePath(eventId) {
  return path.join(WTT_SLIM_ARCHIVE_DIR, `${String(eventId).trim()}.json`);
}

function playerRecordEventIndexPath(eventId) {
  return path.join(PLAYER_RECORD_EVENT_INDEX_DIR, `${String(eventId).trim()}.json`);
}

function getArchiveMatchCount(eventId) {
  for (const filePath of [archivePath(eventId), slimArchivePath(eventId)]) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(payload) ? payload.length : 0;
  }
  return 0;
}

function isSuspiciousArchiveCount(count, entry) {
  return WTT_SUSPICIOUS_RESULT_COUNTS.has(count) && entry?.archiveCompletenessVersion !== ARCHIVE_COMPLETENESS_VERSION;
}

function isAuditSuspiciousCount(count) {
  return count <= 30 || WTT_SUSPICIOUS_RESULT_COUNTS.has(count) || count === DEFAULT_TAKE;
}

function isTransientCrawlSkip(entry) {
  const reason = String(entry?.crawlSkipReason || "");
  return reason.startsWith("error:") || reason.includes("Timed out fetching") || reason.includes("fetch failed");
}

function isPotentiallyPartialArchive(entry, archiveCount) {
  if (!archiveCount) {
    return false;
  }

  if (!entry?.archived) {
    return true;
  }

  if (entry?.forced && isFinished(entry)) {
    return true;
  }

  const endDate = String(entry?.endDate || "").slice(0, 10);
  const fetchedAt = String(entry?.archiveVerifiedAt || entry?.archivedAt || entry?.lastFetchedAt || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDate) && /^\d{4}-\d{2}-\d{2}$/.test(fetchedAt) && fetchedAt < endDate) {
    return true;
  }

  return false;
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
      const hasArchiveFile = [archivePath(eventId), slimArchivePath(eventId)].some((filePath) => fs.existsSync(filePath));
      const partialArchive = isPotentiallyPartialArchive(entry, archiveCount);
      return {
        eventId,
        title: entry.eventName || entry.title || "",
        source: entry.source || "wtt",
        startDate,
        endDate,
        archived: archiveCount > 0,
        archiveCount,
        suspiciousArchive: isSuspiciousArchiveCount(archiveCount, entry),
        auditSuspicious: Boolean(args.auditSuspicious && hasArchiveFile && isAuditSuspiciousCount(archiveCount)),
        partialArchive,
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
      if (args.auditSuspicious) {
        return candidate.finished && candidate.auditSuspicious;
      }
      if (!args.includeActive && !candidate.finished) {
        return false;
      }
      if (!args.force && candidate.archived && !candidate.suspiciousArchive && !candidate.partialArchive) {
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

function runNodeScript(args) {
  return execFileSync(process.execPath, args, {
    cwd: __dirname,
    env: {
      ...process.env,
      DATA_DIR,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function buildDerivedArchiveFiles(eventId, args) {
  if (args.skipDerivedIndexes) {
    return {
      skipped: true,
      rawDeleted: false,
    };
  }

  const rawPath = archivePath(eventId);
  const slimPath = slimArchivePath(eventId);
  const eventIndexPath = playerRecordEventIndexPath(eventId);
  if (!fs.existsSync(rawPath)) {
    throw new Error(`raw archive missing: ${rawPath}`);
  }

  const slimOutput = runNodeScript(["build_wtt_slim_records.js", rawPath]).trim();
  if (!fs.existsSync(slimPath) || fs.statSync(slimPath).size <= 0) {
    throw new Error(`slim archive was not created: ${slimPath}`);
  }

  const eventIndexOutput = runNodeScript([
    "-r",
    "./runtime_legacy_ittf_patch.js",
    "server.js",
    "--build-player-record-event-index",
    "--event",
    String(eventId),
    "--force",
  ]).trim();
  if (!fs.existsSync(eventIndexPath) || fs.statSync(eventIndexPath).size <= 0) {
    throw new Error(`player record event index was not created: ${eventIndexPath}`);
  }

  const candidateIndexResult = updatePlayerRecordCandidateIndexForEvents([eventId]);

  let rawDeleted = false;
  if (!args.keepRaw) {
    fs.rmSync(rawPath, { force: true });
    rawDeleted = !fs.existsSync(rawPath);
  }

  return {
    skipped: false,
    rawDeleted,
    slimBytes: fs.statSync(slimPath).size,
    eventIndexBytes: fs.statSync(eventIndexPath).size,
    candidateIndexResult,
    slimOutput,
    eventIndexOutput,
  };
}

function buildHeadToHeadIndex() {
  const output = runNodeScript([
    "-r",
    "./runtime_legacy_ittf_patch.js",
    "server.js",
    "--build-head-to-head-index",
  ]).trim();
  const parsed = (() => {
    try {
      return JSON.parse(output);
    } catch {
      return null;
    }
  })();
  if (!parsed?.ok) {
    throw new Error(`head-to-head index build failed: ${output}`);
  }
  return parsed;
}

async function archiveEvent(candidate, args) {
  const shouldRefresh = Boolean(args.force || candidate.suspiciousArchive || candidate.auditSuspicious);
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
    requireWttSubEventSupplementForSuspicious: true,
    skipWttArchiveWrite: args.auditSuspicious,
  });

  if (!Array.isArray(result.normalized) || result.normalized.length === 0) {
    return { eventId: candidate.eventId, status: "skipped", reason: "zero_matches" };
  }

  const existingArchiveCount = getArchiveMatchCount(candidate.eventId);
  if (args.auditSuspicious && existingArchiveCount > 0 && result.normalized.length <= existingArchiveCount) {
    return {
      eventId: candidate.eventId,
      status: "skipped",
      reason: `not_larger_payload:${result.normalized.length}<=${existingArchiveCount}`,
    };
  }
  if (!args.force && existingArchiveCount > 0 && result.normalized.length < existingArchiveCount) {
    return {
      eventId: candidate.eventId,
      status: "skipped",
      reason: `smaller_payload:${result.normalized.length}<${existingArchiveCount}`,
    };
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

  const summary = { archived: 0, skipped: 0, failed: 0, derivedFailed: 0 };
  let shouldBuildHeadToHeadIndex = false;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      console.log(`fetching: ${candidate.eventId}${candidate.suspiciousArchive ? ` (refresh suspicious ${candidate.archiveCount})` : ""}`);
      const result = await archiveEvent(candidate, args);
      if (result.status === "archived") {
        summary.archived += 1;
        console.log(`archived: ${result.eventId} (${result.matches} matches)`);
        let candidateIndexResult = null;
        try {
          const derivedResult = buildDerivedArchiveFiles(result.eventId, args);
          candidateIndexResult = derivedResult.candidateIndexResult || null;
          if (derivedResult.skipped) {
            console.log(`derived-indexes: ${result.eventId} skipped`);
          } else {
            console.log(`derived-indexes: ${result.eventId} slim=${derivedResult.slimBytes} eventIndex=${derivedResult.eventIndexBytes} rawDeleted=${derivedResult.rawDeleted}`);
            shouldBuildHeadToHeadIndex = true;
          }
        } catch (error) {
          summary.derivedFailed += 1;
          console.error(`derived-indexes failed: ${result.eventId} ${error?.message || error}`);
        }
        if (!candidateIndexResult) {
          candidateIndexResult = updatePlayerRecordCandidateIndexForEvents([result.eventId]);
        }
        console.log(`player-records-index: ${result.eventId} (${candidateIndexResult.indexedMatches} matches, ${candidateIndexResult.keyCount} player keys)`);
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

  if (shouldBuildHeadToHeadIndex && !args.skipDerivedIndexes && !args.skipH2hIndex) {
    try {
      console.log("head-to-head-index: building");
      const h2hResult = buildHeadToHeadIndex();
      console.log(`head-to-head-index: events=${h2hResult.eventCount} players=${h2hResult.playerKeyCount} pairs=${h2hResult.pairKeyCount}`);
    } catch (error) {
      summary.derivedFailed += 1;
      console.error(`head-to-head-index failed: ${error?.message || error}`);
    }
  }

  console.log(`done: archived=${summary.archived} skipped=${summary.skipped} failed=${summary.failed} derivedFailed=${summary.derivedFailed}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
