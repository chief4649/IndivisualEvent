"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const BUNDLED_PATH = path.join(__dirname, "ittf-para-calendar.json");
const calendarUrl = (year) => `https://www.ittf.com/${year}-para-table-tennis-calendar/`;

function textFromHtml(value) {
  return String(value).replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&(?:ndash|#8211);/gi, "-").replace(/&(?:mdash|#8212);/gi, "-")
    .replace(/\s+/g, " ").trim();
}

function dateString(year, month, day) {
  const value = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error(`Invalid calendar date: ${value}`);
  return value;
}

function normalizeRows(rows, year) {
  const events = {};
  const unresolved = [];
  for (const row of rows) {
    const text = textFromHtml(row.text).replace(/[\u2013\u2014]/g, "-");
    if (!/^\d.*:\s*.*para/i.test(text)) continue;
    const match = text.match(/^(\d{1,2})\s*(?:([A-Za-z]{3,9})\s*)?-\s*(\d{1,2})\s*([A-Za-z]{3,9})\s*:\s*(.+)$/);
    if (!match) throw new Error(`Unrecognized para calendar row: ${text}`);
    const [, firstDay, firstMonth, lastDay, lastMonth, title] = match;
    const startMonth = MONTHS.indexOf((firstMonth || lastMonth).slice(0, 3).toLowerCase());
    const endMonth = MONTHS.indexOf(lastMonth.slice(0, 3).toLowerCase());
    if (startMonth < 0 || endMonth < 0) throw new Error(`Invalid month: ${text}`);
    const startDate = dateString(year, startMonth, Number(firstDay));
    const endDate = dateString(year, endMonth, Number(lastDay));
    if (startDate > endDate) throw new Error(`Reversed calendar range: ${text}`);
    const cancelled = /\bcancelled\b/i.test(title);
    const eventName = title.replace(/\s*-?\s*Cancelled\s*$/i, "").replace(/\s*\([A-Z ]{3,5}\)\s*$/, "").trim();
    let tournamentId = null;
    if (row.href) {
      const url = new URL(row.href, calendarUrl(year));
      if (!["www.ittf.com", "ittf.com"].includes(url.hostname)) throw new Error("Unexpected calendar link host");
      tournamentId = url.pathname.match(/^\/tournament\/(\d+)\//)?.[1] || null;
    }
    const entry = { eventName, startDate, endDate, cancelled, source: "ittf", series: "Para", calendarSource: calendarUrl(year) };
    if (!tournamentId) {
      unresolved.push({ ...entry, reason: cancelled ? "cancelled" : "no-official-result-id" });
      continue;
    }
    const id = `TTE${tournamentId}`;
    if (events[id] && JSON.stringify(events[id]) !== JSON.stringify({ ...entry, event: id, eventUrl: row.href })) {
      throw new Error(`Conflicting para calendar id: ${id}`);
    }
    events[id] = { ...entry, event: id, eventUrl: row.href };
  }
  if (!Object.keys(events).length) throw new Error("Para calendar contains no linked events");
  return { version: 1, year, url: calendarUrl(year), events, unresolved };
}

function parseCalendarHtml(html, year) {
  const rows = [...String(html).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => ({
    text: textFromHtml(match[1]),
    href: match[1].match(/<a\b[^>]*href=["']([^"']*\/tournament\/[^"']*)["']/i)?.[1] || null,
  }));
  return normalizeRows(rows, year);
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temp, file);
}

async function refreshParaCalendar(dataDir, options = {}) {
  const year = options.year || new Date().getUTCFullYear();
  const outputPath = path.join(dataDir, "ittf-para-calendar.json");
  const bundled = readJson(BUNDLED_PATH);
  const runtime = readJson(outputPath);
  let catalog = runtime.year === year && runtime.verifiedAt >= (bundled.verifiedAt || "") ? runtime : bundled;
  let refreshError = null;
  try {
    const response = await (options.fetch || fetch)(calendarUrl(year), {
      signal: AbortSignal.timeout(30000), headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
    });
    if (!response.ok) throw new Error(`Official para calendar HTTP ${response.status}`);
    const fresh = parseCalendarHtml(await response.text(), year);
    if (Object.keys(fresh.events).length < 10) throw new Error("Incomplete official para calendar response");
    catalog = { ...fresh, verifiedAt: new Date().toISOString() };
  } catch (error) {
    refreshError = error.message;
    if (catalog.year !== year || !Object.keys(catalog.events || {}).length) throw error;
  }
  const status = { ...catalog, checkedAt: new Date().toISOString(), refreshError };
  writeAtomic(outputPath, status);
  const datePath = path.join(dataDir, "wtt-date-index.json");
  const dateIndex = readJson(datePath);
  const searchPath = path.join(dataDir, "wtt-search-index.json");
  const searchIndex = readJson(searchPath);
  for (const cancelled of catalog.unresolved.filter((entry) => entry.cancelled)) {
    for (const index of [dateIndex, searchIndex]) {
      for (const entry of Object.values(index)) {
        const name = String(entry.eventName || entry.title || "").trim();
        const withoutYear = (value) => value.replace(/\b20\d{2}\b/g, "").replace(/\s+/g, " ").trim().toLowerCase();
        if ((name.includes(String(year)) || String(entry.startDate || "").startsWith(String(year)))
          && withoutYear(name) === withoutYear(cancelled.eventName)) {
          Object.assign(entry, { cancelled: true, calendarSource: catalog.url });
        }
      }
    }
  }
  for (const [id, entry] of Object.entries(catalog.events)) {
    dateIndex[id] = { ...dateIndex[id], ...entry, updatedAt: catalog.verifiedAt };
    searchIndex[id] = { ...searchIndex[id], ...entry };
  }
  writeAtomic(datePath, dateIndex);
  writeAtomic(searchPath, searchIndex);
  return status;
}

module.exports = { normalizeRows, parseCalendarHtml, refreshParaCalendar };
