#!/usr/bin/env node

const path = require("path");
const {
  DEFAULT_WTT_DATE_INDEX_PATH,
} = require("./extract_individual_matches");
const { refreshWttDateIndex } = require("./wtt_calendar");

function parseArgs(argv) {
  const args = {
    output: DEFAULT_WTT_DATE_INDEX_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--output" || arg === "-o") {
      args.output = path.resolve(next);
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(args.output);
  const result = await refreshWttDateIndex(outputPath);
  console.log(`Fetched ${result.rowCount} calendar rows, updated ${result.updated} date entries -> ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
