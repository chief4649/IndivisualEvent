#!/usr/bin/env node

const path = require("path");

const {
  DEFAULT_DATA_DIR,
  DEFAULT_WTT_ARCHIVE_DIR,
  DEFAULT_WTT_ARCHIVE_INDEX_PATH,
  getProcessedMatches,
  getWttEventLifecycleMeta,
  resolveEventId,
  writeWttArchiveIfNotSmaller,
  updateWttArchiveIndexEntry,
} = require("./extract_individual_matches");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const WTT_ARCHIVE_DIR = path.join(DATA_DIR, "wtt-records");
const WTT_ARCHIVE_INDEX_PATH = path.join(DATA_DIR, "wtt-archive-index.json");

function parseArgs(argv) {
  const args = {
    event: null,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--event":
      case "-e":
        args.event = next;
        index += 1;
        break;
      case "--force":
        args.force = true;
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

  if (!args.event) {
    throw new Error("--event is required");
  }

  return args;
}

function printHelp(exitCode = 0) {
  console.log([
    "Usage:",
    "  node export_wtt_archive.js --event 3231 [--force]",
    "",
    "Options:",
    "  --force  Archive even when the event cannot be auto-verified as finished",
  ].join("\n"));
  process.exit(exitCode);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const archiveEventId = resolveEventId("wtt", args.event);
  const meta = await getWttEventLifecycleMeta(archiveEventId, {
    wttArchiveDir: WTT_ARCHIVE_DIR,
    wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
  });

  if (!meta.isFinished && !args.force) {
    throw new Error("大会が終了済みと判定できません。必要なら --force を使ってください。");
  }

  const result = await getProcessedMatches({
    source: "wtt",
    event: archiveEventId,
    wttArchiveDir: WTT_ARCHIVE_DIR,
    wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
  });

  const archiveWrite = writeWttArchiveIfNotSmaller(WTT_ARCHIVE_DIR, archiveEventId, result.normalized, {
    force: args.force,
  });
  if (!archiveWrite.written) {
    console.log(`skipped: ${archiveEventId}`);
    console.log(`reason: ${archiveWrite.reason}`);
    console.log(`matches: ${archiveWrite.nextCount} < ${archiveWrite.existingCount}`);
    return;
  }

  updateWttArchiveIndexEntry(WTT_ARCHIVE_INDEX_PATH, archiveEventId, {
    archived: true,
    source: meta.source || "wtt",
    title: meta.title || "",
    startDate: meta.startDate || null,
    endDate: meta.endDate || null,
    canAutoArchive: Boolean(meta.canAutoArchive),
    archivedAt: new Date().toISOString(),
    forced: Boolean(args.force && !meta.isFinished),
  });

  console.log(`archived: ${archiveEventId}`);
  console.log(`matches: ${result.normalized.length}`);
  if (meta.startDate || meta.endDate) {
    console.log(`dates: ${meta.startDate || "?"} - ${meta.endDate || "?"}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
