#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { DEFAULT_DATA_DIR } = require("./extract_individual_matches");
const { updatePlayerRecordCandidateIndexForEvents } = require("./build_player_records_index");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const WTT_ARCHIVE_DIR = path.join(DATA_DIR, "wtt-records");
const WTT_SLIM_ARCHIVE_DIR = path.join(DATA_DIR, "wtt-records-slim");
const PLAYER_RECORD_EVENT_INDEX_DIR = path.join(DATA_DIR, "player-records-index", "event-records");

function parseArgs(argv) {
  const args = {
    events: [],
    force: true,
    keepRaw: false,
    skipH2hIndex: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--event" || arg === "--events" || arg === "-e") {
      args.events.push(...String(next || "").split(",").map((value) => value.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (arg.startsWith("--event=") || arg.startsWith("--events=")) {
      args.events.push(...arg.split("=").slice(1).join("=").split(",").map((value) => value.trim()).filter(Boolean));
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg === "--no-force") {
      args.force = false;
      continue;
    }
    if (arg === "--keep-raw") {
      args.keepRaw = true;
      continue;
    }
    if (arg === "--skip-h2h-index") {
      args.skipH2hIndex = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp(0);
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    args.events.push(...arg.split(",").map((value) => value.trim()).filter(Boolean));
  }

  args.events = Array.from(new Set(args.events));
  if (args.events.length === 0) {
    throw new Error("No event IDs specified. Use --event 3363 or pass IDs as arguments.");
  }
  return args;
}

function printHelp(exitCode = 0) {
  console.log([
    "Usage:",
    "  node update_wtt_event_indexes.js --event 3363",
    "  node update_wtt_event_indexes.js --event 3363,3449 --keep-raw",
    "",
    "Options:",
    "  --event ID[,ID]   Event IDs to update",
    "  --force           Rebuild player-record event indexes even if unchanged, default",
    "  --no-force        Skip current player-record event indexes",
    "  --keep-raw        Keep wtt-records/{event}.json after verified slim/index output",
    "  --skip-h2h-index  Do not rebuild the head-to-head index",
  ].join("\n"));
  process.exit(exitCode);
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

function archivePath(eventId) {
  return path.join(WTT_ARCHIVE_DIR, `${String(eventId).trim()}.json`);
}

function slimArchivePath(eventId) {
  return path.join(WTT_SLIM_ARCHIVE_DIR, `${String(eventId).trim()}.json`);
}

function playerRecordEventIndexPath(eventId) {
  return path.join(PLAYER_RECORD_EVENT_INDEX_DIR, `${String(eventId).trim()}.json`);
}

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function ensureSlimRecord(eventId) {
  const rawPath = archivePath(eventId);
  const slimPath = slimArchivePath(eventId);
  if (fs.existsSync(rawPath)) {
    runNodeScript(["build_wtt_slim_records.js", rawPath]);
  }
  if (!fs.existsSync(slimPath) || getFileSize(slimPath) <= 0) {
    throw new Error(`slim archive missing: ${slimPath}`);
  }
  return {
    rawPath,
    slimPath,
    rawExists: fs.existsSync(rawPath),
    slimBytes: getFileSize(slimPath),
  };
}

function buildPlayerRecordEventIndex(eventIds, force) {
  const args = [
    "-r",
    "./runtime_legacy_ittf_patch.js",
    "server.js",
    "--build-player-record-event-index",
    "--event",
    eventIds.join(","),
  ];
  if (force) {
    args.push("--force");
  }
  return runNodeScript(args).trim();
}

function verifyPlayerRecordEventIndexes(eventIds) {
  eventIds.forEach((eventId) => {
    const eventIndexPath = playerRecordEventIndexPath(eventId);
    if (!fs.existsSync(eventIndexPath) || getFileSize(eventIndexPath) <= 0) {
      throw new Error(`player record event index missing: ${eventIndexPath}`);
    }
  });
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

function removeRawArchivesIfVerified(records, keepRaw) {
  if (keepRaw) {
    return [];
  }
  const removed = [];
  records.forEach((record) => {
    if (!record.rawExists) {
      return;
    }
    fs.rmSync(record.rawPath, { force: true });
    if (!fs.existsSync(record.rawPath)) {
      removed.push(record.rawPath);
    }
  });
  return removed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = args.events.map((eventId) => {
    const record = ensureSlimRecord(eventId);
    console.log(`slim: ${eventId} ${record.slimBytes} bytes`);
    return record;
  });

  buildPlayerRecordEventIndex(args.events, args.force);
  verifyPlayerRecordEventIndexes(args.events);
  console.log(`player-record-event-index: ${args.events.length} events`);

  const candidateIndexResult = updatePlayerRecordCandidateIndexForEvents(args.events);
  console.log(`player-records-index: ${candidateIndexResult.eventCount} events, ${candidateIndexResult.indexedMatches} matches, ${candidateIndexResult.keyCount} player keys`);

  if (!args.skipH2hIndex) {
    console.log("head-to-head-index: building");
    const h2hResult = buildHeadToHeadIndex();
    console.log(`head-to-head-index: events=${h2hResult.eventCount} players=${h2hResult.playerKeyCount} pairs=${h2hResult.pairKeyCount}`);
  }

  const removed = removeRawArchivesIfVerified(records, args.keepRaw);
  if (removed.length > 0) {
    console.log(`raw-removed: ${removed.length}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}
