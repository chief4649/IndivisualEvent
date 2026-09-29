const fs = require("fs");
const path = require("path");

const CALENDAR_API_URL = "https://wtt-website-api-prod-3-frontdoor-bddnb2haduafdze9.a01.azurefd.net/api/eventcalendar";

function toDateOnly(value) {
  const match = String(value || "").trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function normalizeCalendarEntry(row, updatedAt = new Date().toISOString()) {
  const eventCode = String(row?.EventCode || "").trim();
  const eventId = String(row?.EventId || "").trim();
  const resolvedEventId = /^\d+$/.test(eventCode) && Number(eventCode) > 0 ? eventCode : eventId;
  if (!/^\d+$/.test(resolvedEventId)) return null;

  const useChangedDates = Boolean(row?.EventDateChangeId && row?.ShowInCalendar);
  const startDate = toDateOnly(useChangedDates ? row?.FromStartDate : row?.StartDateTime);
  const endDate = toDateOnly(useChangedDates ? row?.FromEndDate : row?.EndDateTime);
  const eventName = String(row?.EventName || "").replace(/\s+/g, " ").trim();
  if (!eventName || (!startDate && !endDate)) return null;

  return {
    event: resolvedEventId,
    eventName,
    startDate,
    endDate,
    source: "calendar",
    updatedAt,
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
    body: JSON.stringify({ custom_filter: "[]" }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch WTT calendar: ${response.status} ${text || response.statusText}`);
  }

  const payload = await response.json();
  const rows = payload?.[0]?.rows;
  if (!Array.isArray(rows)) throw new Error("Unexpected WTT calendar response shape");
  return rows;
}

function readDateIndex(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function writeDateIndexAtomic(filePath, index) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

async function refreshWttDateIndex(outputPath, rows = null) {
  const calendarRows = rows || await fetchCalendarRows();
  const index = readDateIndex(outputPath);
  const updatedAt = new Date().toISOString();
  let updated = 0;

  for (const row of calendarRows) {
    const entry = normalizeCalendarEntry(row, updatedAt);
    if (!entry) continue;
    index[entry.event] = { ...(index[entry.event] || {}), ...entry };
    updated += 1;
  }

  writeDateIndexAtomic(outputPath, index);
  return { rowCount: calendarRows.length, updated, index };
}

module.exports = {
  fetchCalendarRows,
  normalizeCalendarEntry,
  refreshWttDateIndex,
};
