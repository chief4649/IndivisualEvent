#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const RAW_DIR = path.join(DATA_DIR, "wtt-records");
const SLIM_DIR = path.join(DATA_DIR, "wtt-records-slim");
const EVENT_INDEX_DIR = path.join(DATA_DIR, "player-records-index", "event-records");
const H2H_DIR = path.join(DATA_DIR, "player-records-index");

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function listEventIds(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((name) => /^\d+\.json$/i.test(name))
    .map((name) => name.slice(0, -5))
    .sort((left, right) => Number(left) - Number(right));
}

function getDocumentCode(item) {
  return String(item?.documentCode || item?.match_card?.documentCode || "").trim();
}

function getEventId(item) {
  return String(item?.eventId || item?.match_card?.eventId || "").trim();
}

function getMatchDate(item) {
  return String(
    item?.match_card?.matchDateTime?.startDateLocal
      || item?.startDateLocal
      || item?.matchDateTime?.startDateLocal
      || "",
  ).trim();
}

function parseMonthFirstDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : "";
}

function getExpectedEventEntry(eventId, indexes) {
  return indexes.reduce((merged, index) => ({ ...merged, ...(index[eventId] || {}) }), {});
}

function compareCodes(left, right) {
  const leftSet = new Set(left.filter(Boolean));
  const rightSet = new Set(right.filter(Boolean));
  return {
    onlyLeft: [...leftSet].filter((value) => !rightSet.has(value)),
    onlyRight: [...rightSet].filter((value) => !leftSet.has(value)),
  };
}

function getExpectedEventIndexMatchCount(raw) {
  if (!raw.some((item) => String(item?.matchType || "").trim())) {
    return raw.length;
  }

  return raw.reduce((count, item) => {
    if (String(item?.matchType || "").trim().toLowerCase() === "team") {
      return count + (Array.isArray(item?.singles) ? item.singles.length : 0);
    }
    return count + 1;
  }, 0);
}

function auditEvent(eventId, indexes) {
  const rawPath = path.join(RAW_DIR, `${eventId}.json`);
  const slimPath = path.join(SLIM_DIR, `${eventId}.json`);
  const eventIndexPath = path.join(EVENT_INDEX_DIR, `${eventId}.json`);
  const result = { eventId, raw: {}, slim: {}, eventIndex: {}, issues: [], unknowns: [] };
  const raw = readJson(rawPath);

  if (!Array.isArray(raw)) {
    result.raw.status = raw === null ? "invalid_json_or_missing" : "not_array";
    result.issues.push("raw_unreadable");
    return result;
  }

  const rawCodes = raw.map(getDocumentCode);
  const rawEventIds = raw.map(getEventId).filter(Boolean);
  const rawDates = raw.map(getMatchDate).map(parseMonthFirstDate).filter(Boolean).sort();
  const duplicateCodes = rawCodes.filter((code, index) => code && rawCodes.indexOf(code) !== index);
  const wrongEventIds = rawEventIds.filter((value) => value !== eventId);
  const expected = getExpectedEventEntry(eventId, indexes);
  const expectedEventIndexMatchCount = getExpectedEventIndexMatchCount(raw);

  result.raw = {
    status: "ok",
    matches: raw.length,
    uniqueDocumentCodes: new Set(rawCodes.filter(Boolean)).size,
    duplicateDocumentCodes: [...new Set(duplicateCodes)],
    wrongEventIds: [...new Set(wrongEventIds)],
    minMatchDate: rawDates[0] || null,
    maxMatchDate: rawDates.at(-1) || null,
    eventNameInRaw: null,
  };
  if (raw.length === 0) result.issues.push("raw_empty");
  if (wrongEventIds.length) result.issues.push("raw_event_id_mismatch");
  if (duplicateCodes.length) result.issues.push("raw_duplicate_document_code");
  if (!expected.eventName && !expected.title) result.unknowns.push("event_name_not_available_locally");
  if (expected.startDate && result.raw.maxMatchDate && result.raw.maxMatchDate < expected.startDate) {
    result.issues.push("raw_dates_before_event");
  }
  if (expected.endDate && result.raw.minMatchDate && result.raw.minMatchDate > expected.endDate) {
    result.issues.push("raw_dates_after_event");
  }

  const slim = readJson(slimPath);
  if (!Array.isArray(slim)) {
    result.slim.status = slim === null ? "missing_or_invalid" : "not_array";
    result.issues.push("slim_unreadable");
  } else {
    const diff = compareCodes(rawCodes, slim.map(getDocumentCode));
    result.slim = { status: "ok", matches: slim.length, ...diff };
    if (raw.length !== slim.length || diff.onlyLeft.length || diff.onlyRight.length) {
      result.issues.push("raw_slim_mismatch");
    }
  }

  const eventIndex = readJson(eventIndexPath);
  if (!eventIndex || typeof eventIndex !== "object" || Array.isArray(eventIndex)) {
    result.eventIndex.status = "missing_or_invalid";
    result.eventIndex = { status: "missing_or_invalid" };
    result.unknowns.push("event_index_not_available");
  } else {
    result.eventIndex = {
      status: "ok",
      indexedMatches: eventIndex.indexedMatches ?? null,
      expectedIndexedMatches: expectedEventIndexMatchCount,
      indexedEntries: eventIndex.indexedEntries ?? null,
      keyCount: eventIndex.keyCount ?? null,
    };
    if (eventIndex.indexedMatches !== expectedEventIndexMatchCount) result.issues.push("event_index_count_mismatch");
  }

  return result;
}

function auditGlobalIndexes(eventIds) {
  const manifest = readJson(path.join(H2H_DIR, "head-to-head-manifest.json"), {});
  const eventManifest = readJson(path.join(H2H_DIR, "event-records-manifest.json"), {});
  return {
    h2h: {
      manifestExists: fs.existsSync(path.join(H2H_DIR, "head-to-head-manifest.json")),
      indexedEventCount: manifest.indexedEventCount ?? null,
      pairRecordCount: manifest.pairRecordCount ?? null,
      currentParseSources: manifest.currentParseSources ?? null,
    },
    eventIndex: {
      manifestExists: fs.existsSync(path.join(H2H_DIR, "event-records-manifest.json")),
      indexedEventCount: eventManifest.eventCount ?? null,
      checkedEventCount: eventIds.length,
    },
  };
}

function main() {
  const indexes = [
    readJson(path.join(DATA_DIR, "wtt-date-index.json"), {}),
    readJson(path.join(DATA_DIR, "wtt-search-index.json"), {}),
    readJson(path.join(DATA_DIR, "wtt-archive-index.json"), {}),
  ];
  const eventIds = listEventIds(RAW_DIR);
  const events = eventIds.map((eventId) => auditEvent(eventId, indexes));
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    dataDir: DATA_DIR,
    rawEventCount: events.length,
    rawMatchCount: events.reduce((sum, event) => sum + (event.raw.matches || 0), 0),
    issueEventCount: events.filter((event) => event.issues.length).length,
    unknownEventCount: events.filter((event) => event.unknowns.length).length,
    globalIndexes: auditGlobalIndexes(eventIds),
    events,
  };
  const reportPath = process.env.AUDIT_REPORT
    ? path.resolve(process.env.AUDIT_REPORT)
    : path.join(DATA_DIR, "data-integrity-audit.json");
  fs.writeFileSync(`${reportPath}.tmp-${process.pid}`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.renameSync(`${reportPath}.tmp-${process.pid}`, reportPath);
  console.log(JSON.stringify({
    ok: report.issueEventCount === 0,
    reportPath,
    rawEventCount: report.rawEventCount,
    rawMatchCount: report.rawMatchCount,
    issueEventCount: report.issueEventCount,
  }, null, 2));
}

main();
