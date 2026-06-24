#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  buildJaRoundContext,
  normalizeOfficialResultItem,
  readRules,
  readTranslations,
  readWttDateIndex,
  translateRoundJa,
} = require("./extract_individual_matches");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const WTT_ARCHIVE_DIR = path.join(DATA_DIR, "wtt-records");
const TRANSLATIONS_PATH = path.join(DATA_DIR, "translations.ja.json");
const RULES_PATH = path.join(DATA_DIR, "rules.json");
const WTT_ARCHIVE_INDEX_PATH = path.join(DATA_DIR, "wtt-archive-index.json");
const WTT_DATE_INDEX_PATH = path.join(DATA_DIR, "wtt-date-index.json");
const WTT_SEARCH_INDEX_PATH = path.join(DATA_DIR, "wtt-search-index.json");
const EVENT_NAMES_PATH = path.join(DATA_DIR, "event-names.json");
const OUTPUT_DIR = path.join(DATA_DIR, "player-records-index");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function listWttRecordFiles() {
  try {
    const tracked = execFileSync("git", ["ls-files", "wtt-records/*.json"], {
      cwd: DATA_DIR,
      encoding: "utf8",
    }).split(/\n/).filter(Boolean);
    if (tracked.length > 0) {
      return tracked.map((fileName) => ({
        eventId: path.basename(fileName, ".json"),
        filePath: path.join(DATA_DIR, fileName),
      }));
    }
  } catch {
    // Fall back to filesystem scan outside a git checkout.
  }
  if (!fs.existsSync(WTT_ARCHIVE_DIR)) {
    return [];
  }
  return fs.readdirSync(WTT_ARCHIVE_DIR)
    .filter((fileName) => /^\d+\.json$/.test(fileName))
    .map((fileName) => ({
      eventId: fileName.replace(/\.json$/, ""),
      filePath: path.join(WTT_ARCHIVE_DIR, fileName),
    }));
}

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

function normalizeArchivedMatch(item) {
  if (item && typeof item === "object" && typeof item.matchType === "string" && Array.isArray(item.competitors)) {
    return item;
  }
  return normalizeOfficialResultItem(item);
}

function translatePlayerNameForRecord(name, translations) {
  const raw = String(name || "").trim();
  if (!raw) {
    return "";
  }
  const reversed = raw.split(/\s+/).filter(Boolean).reverse().join(" ");
  return translations.players?.[raw] || translations.players?.[reversed] || raw;
}

function formatCompetitorForRecord(competitor, translations) {
  if (!competitor) {
    return "TBD";
  }
  const players = Array.isArray(competitor.players) ? competitor.players.filter(Boolean) : [];
  if (players.length > 0) {
    return players.map((player) => translatePlayerNameForRecord(player?.name, translations)).filter(Boolean).join("／");
  }
  return translatePlayerNameForRecord(competitor.name, translations) || "TBD";
}

function getWinnerIndexFromOverallScore(score) {
  const [leftRaw, rightRaw] = String(score || "").split("-");
  const left = Number(leftRaw);
  const right = Number(String(rightRaw || "").match(/\d+/)?.[0]);
  if (Number.isNaN(left) || Number.isNaN(right)) {
    return null;
  }
  if (left > right) {
    return 0;
  }
  if (right > left) {
    return 1;
  }
  return null;
}

function formatGameScoresForRecord(match, leftCompetitorIndex) {
  const games = Array.isArray(match?.gameScores) ? match.gameScores : [];
  const statusText = `${match?.overallScore || ""} ${match?.resultStatus || ""}`.toLowerCase();
  if (statusText.includes("wo")) {
    return "不戦勝";
  }
  if (games.length === 0) {
    return String(match?.overallScore || "").trim() || "-";
  }
  return games.map((game) => {
    const [rawLeft, rawRight] = String(game).split("-");
    const homePoints = Number(rawLeft);
    const awayPoints = Number(rawRight);
    if (Number.isNaN(homePoints) || Number.isNaN(awayPoints)) {
      return String(game);
    }
    const leftPoints = leftCompetitorIndex === 0 ? homePoints : awayPoints;
    const rightPoints = leftCompetitorIndex === 0 ? awayPoints : homePoints;
    return leftPoints > rightPoints ? String(rightPoints) : `-${leftPoints}`;
  }).join(",");
}

function buildPlayerRecordLine(match, playerCompetitorIndex, translations) {
  const winnerIndex = getWinnerIndexFromOverallScore(match.overallScore);
  const leftIndex = winnerIndex === playerCompetitorIndex ? playerCompetitorIndex : winnerIndex === null ? playerCompetitorIndex : winnerIndex;
  const rightIndex = leftIndex === 0 ? 1 : 0;
  const left = formatCompetitorForRecord(match.competitors?.[leftIndex], translations);
  const right = formatCompetitorForRecord(match.competitors?.[rightIndex], translations);
  const score = formatGameScoresForRecord(match, leftIndex);
  return `${left}　${score}　${right}`;
}

function formatDateRange(startDate, endDate) {
  const start = String(startDate || "").trim();
  const end = String(endDate || "").trim();
  const startMatch = start.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const endMatch = end.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (startMatch && endMatch) {
    const [, startYear, startMonth, startDay] = startMatch;
    const [, endYear, endMonth, endDay] = endMatch;
    if (startYear === endYear && startMonth === endMonth) {
      return `${startYear}/${Number(startMonth)}/${Number(startDay)}-${Number(endDay)}`;
    }
    return `${startYear}/${Number(startMonth)}/${Number(startDay)}-${Number(endMonth)}/${Number(endDay)}`;
  }
  if (startMatch) {
    const [, year, month, day] = startMatch;
    return `${year}/${Number(month)}/${Number(day)}`;
  }
  if (endMatch) {
    const [, year, month, day] = endMatch;
    return `${year}/${Number(month)}/${Number(day)}`;
  }
  return start || end || "";
}

function getEventRecordMeta(eventId, searchIndex, dateIndex, archiveIndex, eventNames) {
  const dateEntry = dateIndex[String(eventId || "").trim()] || {};
  const archiveEntry = archiveIndex[String(eventId || "").trim()] || {};
  const entry = searchIndex[String(eventId || "").trim()] || {};
  const merged = {
    ...(archiveEntry || {}),
    ...(entry || {}),
    ...(dateEntry || {}),
  };
  const eventName = String(merged?.eventName || merged?.title || eventNames?.wtt?.[eventId] || eventNames?.[eventId] || eventId);
  const startDate = merged?.startDate || null;
  const endDate = merged?.endDate || null;
  return {
    event: eventId,
    eventName,
    startDate,
    endDate,
    dateLabel: formatDateRange(startDate, endDate),
  };
}

function addRecord(index, key, eventMeta, matchEntry) {
  if (!key) {
    return;
  }
  if (!index[key]) {
    index[key] = [];
  }
  let eventRecord = index[key].find((item) => item.event === eventMeta.event);
  if (!eventRecord) {
    eventRecord = {
      ...eventMeta,
      matches: [],
    };
    index[key].push(eventRecord);
  }
  const duplicate = eventRecord.matches.some((existing) => (
    existing.documentCode === matchEntry.documentCode &&
    existing.categoryName === matchEntry.categoryName &&
    existing.roundLabel === matchEntry.roundLabel &&
    existing.line === matchEntry.line
  ));
  if (!duplicate) {
    eventRecord.matches.push(matchEntry);
  }
}

function getCompetitorKeys(competitor, translations) {
  return Array.from(new Set([
    competitor?.name,
    translations.players?.[competitor?.name || ""],
    ...(Array.isArray(competitor?.players) ? competitor.players.flatMap((player) => [
      player?.name,
      translations.players?.[player?.name || ""],
    ]) : []),
  ].flatMap(buildPlayerNameSearchValues).filter(Boolean)));
}

function compareEvents(left, right) {
  const leftDate = left.endDate || left.startDate || "";
  const rightDate = right.endDate || right.startDate || "";
  if (leftDate !== rightDate) {
    return String(rightDate).localeCompare(String(leftDate));
  }
  return String(right.event || "").localeCompare(String(left.event || ""), "en", { numeric: true });
}

function getShardName(key) {
  const match = String(key || "").match(/[a-z0-9]/i);
  return match ? match[0].toLowerCase() : "_";
}

function main() {
  const translations = readTranslations(TRANSLATIONS_PATH);
  const rules = readRules(RULES_PATH);
  const searchIndex = readJson(WTT_SEARCH_INDEX_PATH, {});
  const dateIndex = readWttDateIndex(WTT_DATE_INDEX_PATH);
  const archiveIndex = readJson(WTT_ARCHIVE_INDEX_PATH, {});
  const eventNames = readJson(EVENT_NAMES_PATH, {});
  const files = listWttRecordFiles();
  const index = {};
  let indexedMatches = 0;

  files.forEach(({ eventId, filePath }) => {
    const payload = readJson(filePath, []);
    if (!Array.isArray(payload)) {
      return;
    }
    const eventMeta = getEventRecordMeta(eventId, searchIndex, dateIndex, archiveIndex, eventNames);
    payload.forEach((item) => {
      const match = normalizeArchivedMatch(item);
      if (!match || match.matchType !== "individual") {
        return;
      }
      const competitors = Array.isArray(match.competitors) ? match.competitors : [];
      if (competitors.length === 0) {
        return;
      }
      const roundLabel = translateRoundJa(match.roundKey, match.roundLabel, translations, rules, buildJaRoundContext([match]));
      competitors.forEach((competitor, competitorIndex) => {
        const keys = getCompetitorKeys(competitor, translations);
        if (keys.length === 0) {
          return;
        }
        const matchEntry = {
          categoryName: match.categoryName || "",
          roundLabel,
          line: buildPlayerRecordLine(match, competitorIndex, translations),
          documentCode: match.documentCode || "",
        };
        keys.forEach((key) => addRecord(index, key, eventMeta, matchEntry));
      });
      indexedMatches += 1;
    });
  });

  Object.values(index).forEach((events) => {
    events.sort(compareEvents);
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    eventCount: files.length,
    indexedMatches,
  };

  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const shards = {};
  Object.entries(index).forEach(([key, events]) => {
    const shardName = getShardName(key);
    if (!shards[shardName]) {
      shards[shardName] = {};
    }
    shards[shardName][key] = events;
  });
  Object.entries(shards).forEach(([shardName, shardIndex]) => {
    fs.writeFileSync(path.join(OUTPUT_DIR, `${shardName}.json`), JSON.stringify(shardIndex));
  });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
    ...payload,
    shardCount: Object.keys(shards).length,
    keyCount: Object.keys(index).length,
  }));
  console.log(`indexed ${files.length} events, ${indexedMatches} matches, ${Object.keys(index).length} player keys`);
  console.log(OUTPUT_DIR);
}

main();
