#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  DEFAULT_WTT_DATE_INDEX_PATH,
  readWttDateIndex,
  writeWttDateIndex,
} = require("./extract_individual_matches");

const CALENDAR_API_URL = "https://wtt-website-api-prod-3-frontdoor-bddnb2haduafdze9.a01.azurefd.net/api/eventcalendar";

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

function toDateOnly(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function normalizeCalendarEntry(row) {
  const eventCode = String(row?.EventCode || "").trim();
  const eventId = String(row?.EventId || "").trim();
  const resolvedEventId = /^\d+$/.test(eventCode) && Number(eventCode) > 0 ? eventCode : eventId;
  if (!/^\d+$/.test(resolvedEventId)) {
    return null;
  }

  const useChangedDates = Boolean(row?.EventDateChangeId && row?.ShowInCalendar);
  const startDate = toDateOnly(useChangedDates ? row?.FromStartDate : row?.StartDateTime);
  const endDate = toDateOnly(useChangedDates ? row?.FromEndDate : row?.EndDateTime);
  const eventName = String(row?.EventName || "").replace(/\s+/g, " ").trim();

  if (!eventName || (!startDate && !endDate)) {
    return null;
  }

  return {
    event: resolvedEventId,
    eventName,
    startDate,
    endDate,
    source: "calendar",
    updatedAt: new Date().toISOString(),
  };
}

async function fetchCalendarRows() {
  const response = await fetch(CALENDAR_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      origin: "https://www.worldtabletennis.com",
      referer: "https://www.worldtabletennis.com/events_calendar",
      "user-agent": "Mozilla/5.0 (compatible; Codex/1.0)",
    },
    body: JSON.stringify({
      custom_filter: "[]",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch WTT calendar: ${response.status} ${text || response.statusText}`);
  }

  const payload = await response.json();
  const rows = payload?.[0]?.rows;
  if (!Array.isArray(rows)) {
    throw new Error("Unexpected WTT calendar response shape");
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(args.output);
  const current = readWttDateIndex(outputPath);
  const rows = await fetchCalendarRows();

  let updated = 0;
  for (const row of rows) {
    const normalized = normalizeCalendarEntry(row);
    if (!normalized) {
      continue;
    }
    current[normalized.event] = {
      ...(current[normalized.event] || {}),
      ...normalized,
    };
    updated += 1;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  writeWttDateIndex(outputPath, current);
  console.log(`Fetched ${rows.length} calendar rows, updated ${updated} date entries -> ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
