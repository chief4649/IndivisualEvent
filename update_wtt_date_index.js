#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  DEFAULT_DATA_DIR,
  DEFAULT_WTT_DATE_INDEX_PATH,
} = require("./extract_individual_matches");

function parseArgs(argv) {
  const args = {
    input: null,
    output: DEFAULT_WTT_DATE_INDEX_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--input" || arg === "-i") {
      args.input = next;
      index += 1;
    } else if (arg === "--output" || arg === "-o") {
      args.output = next;
      index += 1;
    }
  }

  if (!args.input) {
    throw new Error("Missing required --input");
  }

  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeEntry(eventId, entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const startDate = String(entry.startDate || entry.StartDateTime || entry.start || "").trim();
  const endDate = String(entry.endDate || entry.EndDateTime || entry.end || "").trim();
  const eventName = String(entry.eventName || entry.EventName || entry.title || "").trim();

  if (!eventId) {
    return null;
  }

  return {
    event: String(eventId),
    eventName,
    startDate: startDate || null,
    endDate: endDate || null,
    source: String(entry.source || "calendar").trim() || "calendar",
    updatedAt: new Date().toISOString(),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = readJson(path.resolve(args.input), {});
  const outputPath = path.resolve(args.output || path.join(DEFAULT_DATA_DIR, "wtt-date-index.json"));
  const current = readJson(outputPath, {});

  const entries = Array.isArray(input)
    ? input
    : Object.entries(input).map(([eventId, entry]) => ({ eventId, ...entry }));

  let updated = 0;
  entries.forEach((row) => {
    const eventId = String(row.eventId || row.event || row.EventId || "").trim();
    const normalized = normalizeEntry(eventId, row);
    if (!normalized) {
      return;
    }
    current[eventId] = {
      ...(current[eventId] || {}),
      ...normalized,
    };
    updated += 1;
  });

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(current, null, 2) + "\n", "utf8");
  console.log(`Updated ${updated} WTT date entries -> ${outputPath}`);
}

main();
