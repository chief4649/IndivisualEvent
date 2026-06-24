#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const WTT_ARCHIVE_DIR = path.join(DATA_DIR, "wtt-records");
const OUTPUT_PATH = path.join(DATA_DIR, "player-record-event-index.json");

function normalizePlayerSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (/^\d+$/.test(token) ? String(Number(token)) : token))
    .join(" ")
    .trim();
}

function buildPlayerNameSearchValues(value) {
  const normalized = normalizePlayerSearchText(value);
  if (!normalized) {
    return [];
  }
  const values = [normalized];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => /^[a-z]+$/i.test(token))) {
    values.push([...tokens].reverse().join(" "));
  }
  return Array.from(new Set(values));
}

function addIndexEntry(index, key, eventId) {
  if (!key) {
    return;
  }
  if (!index[key]) {
    index[key] = [];
  }
  if (!index[key].includes(eventId)) {
    index[key].push(eventId);
  }
}

function addPlayerName(index, name, eventId) {
  const raw = String(name || "").trim();
  if (!raw) {
    return;
  }
  const parts = raw.split(/[\/／]/).map((part) => part.trim()).filter(Boolean);
  const names = parts.length > 1 ? parts : [raw];
  names.forEach((value) => {
    buildPlayerNameSearchValues(value).forEach((key) => addIndexEntry(index, key, eventId));
  });
}

function extractQuotedJsonValues(text, propertyName) {
  const escapedName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`"${escapedName}"\\s*:\\s*"([^"]+)"`, "g");
  const values = [];
  let match = pattern.exec(text);
  while (match) {
    values.push(match[1]);
    match = pattern.exec(text);
  }
  return values;
}

function listWttRecordFiles() {
  if (!fs.existsSync(WTT_ARCHIVE_DIR)) {
    return [];
  }
  return fs.readdirSync(WTT_ARCHIVE_DIR)
    .filter((fileName) => /^\d+\.json$/.test(fileName))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .map((fileName) => ({
      eventId: fileName.replace(/\.json$/, ""),
      filePath: path.join(WTT_ARCHIVE_DIR, fileName),
    }));
}

function main() {
  const files = listWttRecordFiles();
  const index = {};

  files.forEach(({ eventId, filePath }) => {
    const text = fs.readFileSync(filePath, "utf8");
    [
      ...extractQuotedJsonValues(text, "playerName"),
      ...extractQuotedJsonValues(text, "competitiorName"),
      ...extractQuotedJsonValues(text, "name"),
    ].forEach((name) => addPlayerName(index, name, eventId));
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    eventCount: files.length,
    index,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload));
  console.log(`indexed ${files.length} events, ${Object.keys(index).length} player keys`);
  console.log(OUTPUT_PATH);
}

main();
