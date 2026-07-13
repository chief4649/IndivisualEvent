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
const BUNDLED_WTT_ARCHIVE_DIR = path.join(__dirname, "wtt-records");
const TRANSLATIONS_PATH = path.join(DATA_DIR, "translations.ja.json");
const RULES_PATH = path.join(DATA_DIR, "rules.json");
const WTT_ARCHIVE_INDEX_PATH = path.join(DATA_DIR, "wtt-archive-index.json");
const WTT_DATE_INDEX_PATH = path.join(DATA_DIR, "wtt-date-index.json");
const WTT_SEARCH_INDEX_PATH = path.join(DATA_DIR, "wtt-search-index.json");
const EVENT_NAMES_PATH = path.join(DATA_DIR, "event-names.json");
const OUTPUT_DIR = path.join(DATA_DIR, "player-records-index");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");
const CANDIDATE_INDEX_VERSION = 1;
const CANDIDATE_INDEX_PATH = path.join(OUTPUT_DIR, "candidate-events.json");
const CANDIDATE_MANIFEST_PATH = path.join(OUTPUT_DIR, "candidate-manifest.json");
const CANDIDATE_SHARDS_DIR = path.join(OUTPUT_DIR, "candidate-shards");

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
      return tracked.map((fileName) => {
        const filePath = path.join(DATA_DIR, fileName);
        const stat = fs.statSync(filePath);
        return {
          eventId: path.basename(fileName, ".json"),
          filePath,
          size: stat.size,
          mtimeMs: Math.trunc(stat.mtimeMs),
        };
      });
    }
  } catch {
    // Fall back to filesystem scan outside a git checkout.
  }
  const recordsByEventId = new Map();
  const addDir = (dirPath, priority) => {
    if (!fs.existsSync(dirPath)) {
      return;
    }
    fs.readdirSync(dirPath)
      .filter((fileName) => /^(?:TTE)?\d+\.json$/i.test(fileName))
      .forEach((fileName) => {
        const eventId = fileName.replace(/\.json$/i, "");
        const filePath = path.join(dirPath, fileName);
        const stat = fs.statSync(filePath);
        const next = {
          eventId,
          filePath,
          size: stat.size,
          mtimeMs: Math.trunc(stat.mtimeMs),
          priority,
        };
        const current = recordsByEventId.get(eventId);
        if (
          !current ||
          next.size > current.size ||
          (next.size === current.size && next.mtimeMs > current.mtimeMs) ||
          (next.size === current.size && next.mtimeMs === current.mtimeMs && next.priority > current.priority)
        ) {
          recordsByEventId.set(eventId, next);
        }
      });
  };
  addDir(WTT_ARCHIVE_DIR, 1);
  addDir(BUNDLED_WTT_ARCHIVE_DIR, 2);
  return [...recordsByEventId.values()]
    .map(({ priority, ...file }) => file)
    .sort((left, right) => String(left.eventId).localeCompare(String(right.eventId), "en", { numeric: true }));
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

function mergeRecord(index, key, eventRecord) {
  if (!key || !eventRecord?.event) {
    return;
  }
  if (!index[key]) {
    index[key] = [];
  }
  index[key] = index[key].filter((item) => String(item?.event || "") !== String(eventRecord.event));
  index[key].push(eventRecord);
  index[key].sort(compareEvents);
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

function addMatchToIndex(index, file, eventMeta, match, translations, rules, parentMatch = null) {
  const sourceMatch = parentMatch || match;
  const competitors = Array.isArray(match.competitors) ? match.competitors : [];
  if (competitors.length === 0) {
    return 0;
  }
  const roundLabel = translateRoundJa(
    sourceMatch.roundKey || match.roundKey,
    sourceMatch.roundLabel || match.roundLabel,
    translations,
    rules,
    buildJaRoundContext([sourceMatch]),
  );
  competitors.forEach((competitor, competitorIndex) => {
    const keys = getCompetitorKeys(competitor, translations);
    if (keys.length === 0) {
      return;
    }
    const matchEntry = {
      categoryName: sourceMatch.categoryName || match.categoryName || "",
      roundLabel,
      line: buildPlayerRecordLine(match, competitorIndex, translations),
      documentCode: match.documentCode || sourceMatch.documentCode || "",
    };
    keys.forEach((key) => addRecord(index, key, eventMeta, matchEntry));
  });
  return 1;
}

function buildEventIndex(files, deps) {
  const index = {};
  let indexedMatches = 0;

  files.forEach(({ eventId, filePath }) => {
    const payload = readJson(filePath, []);
    if (!Array.isArray(payload)) {
      return;
    }
    const eventMeta = getEventRecordMeta(eventId, deps.searchIndex, deps.dateIndex, deps.archiveIndex, deps.eventNames);
    payload.forEach((item) => {
      const match = normalizeArchivedMatch(item);
      if (!match) {
        return;
      }
      if (match.matchType === "individual") {
        indexedMatches += addMatchToIndex(index, { eventId, filePath }, eventMeta, match, deps.translations, deps.rules);
        return;
      }
      if (match.matchType === "team") {
        (Array.isArray(match.singles) ? match.singles : []).forEach((single) => {
          indexedMatches += addMatchToIndex(index, { eventId, filePath }, eventMeta, single, deps.translations, deps.rules, match);
        });
      }
    });
  });

  Object.values(index).forEach((events) => {
    events.sort(compareEvents);
  });

  return {
    index,
    indexedMatches,
  };
}

function getPlayerRecordShardFiles() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    return [];
  }
  return fs.readdirSync(OUTPUT_DIR)
    .filter((fileName) => /^(?:[a-z0-9]|_)\.json$/i.test(fileName))
    .map((fileName) => path.join(OUTPUT_DIR, fileName));
}

function removeEventsFromExistingShards(eventIds) {
  const eventIdSet = new Set(eventIds.map((eventId) => String(eventId || "")).filter(Boolean));
  if (eventIdSet.size === 0) {
    return;
  }

  getPlayerRecordShardFiles().forEach((shardPath) => {
    const shard = readJson(shardPath, {});
    let changed = false;
    Object.keys(shard).forEach((key) => {
      const nextEvents = (Array.isArray(shard[key]) ? shard[key] : [])
        .filter((event) => !eventIdSet.has(String(event?.event || "")));
      if (nextEvents.length !== (Array.isArray(shard[key]) ? shard[key].length : 0)) {
        changed = true;
      }
      if (nextEvents.length > 0) {
        shard[key] = nextEvents;
      } else {
        delete shard[key];
      }
    });
    if (changed) {
      fs.writeFileSync(shardPath, JSON.stringify(shard));
    }
  });
}

function mergeIndexIntoExistingShards(index) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const grouped = {};
  Object.entries(index).forEach(([key, events]) => {
    const shardName = getShardName(key);
    if (!grouped[shardName]) {
      grouped[shardName] = {};
    }
    grouped[shardName][key] = events;
  });

  Object.entries(grouped).forEach(([shardName, shardIndex]) => {
    const shardPath = path.join(OUTPUT_DIR, `${shardName}.json`);
    const shard = readJson(shardPath, {});
    Object.entries(shardIndex).forEach(([key, events]) => {
      (Array.isArray(events) ? events : []).forEach((eventRecord) => {
        mergeRecord(shard, key, eventRecord);
      });
    });
    fs.writeFileSync(shardPath, JSON.stringify(shard));
  });
}

function writeManifest(payload) {
  let keyCount = 0;
  const shardFiles = getPlayerRecordShardFiles();
  shardFiles.forEach((shardPath) => {
    const shard = readJson(shardPath, {});
    keyCount += Object.keys(shard).length;
  });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
    ...payload,
    shardCount: shardFiles.length,
    keyCount,
  }));
}

function getPathStatToken(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return "missing";
  }
}

function getPlayerRecordCacheSignature(files) {
  const dataSignature = files.map((file) => `${file.eventId}:${file.size}:${file.mtimeMs}:raw:${file.size}:${file.mtimeMs}`).join("|");
  const configSignature = [
    TRANSLATIONS_PATH,
    RULES_PATH,
    WTT_ARCHIVE_INDEX_PATH,
    WTT_DATE_INDEX_PATH,
    WTT_SEARCH_INDEX_PATH,
    EVENT_NAMES_PATH,
  ].map((filePath) => `${path.basename(filePath)}:${getPathStatToken(filePath)}`).join("|");
  return `${dataSignature}::${configSignature}`;
}

function addCandidateRecord(index, key, eventId) {
  const normalizedValues = buildPlayerNameSearchValues(key);
  normalizedValues.forEach((normalizedValue) => {
    if (normalizedValue.length < 2) {
      return;
    }
    if (!index[normalizedValue]) {
      index[normalizedValue] = [];
    }
    if (!index[normalizedValue].includes(eventId)) {
      index[normalizedValue].push(eventId);
    }
  });
}

function addCandidateMatch(index, eventId, match, translations) {
  (Array.isArray(match?.competitors) ? match.competitors : []).forEach((competitor) => {
    getCompetitorKeys(competitor, translations).forEach((key) => {
      addCandidateRecord(index, key, eventId);
    });
  });
  (Array.isArray(match?.singles) ? match.singles : []).forEach((single) => {
    addCandidateMatch(index, eventId, single, translations);
  });
}

function buildCandidateIndex(files, deps) {
  const index = {};
  let indexedMatches = 0;

  files.forEach(({ eventId, filePath }) => {
    const payload = readJson(filePath, []);
    if (!Array.isArray(payload)) {
      return;
    }
    payload.forEach((item) => {
      const match = normalizeArchivedMatch(item);
      if (!match) {
        return;
      }
      addCandidateMatch(index, eventId, match, deps.translations);
      indexedMatches += 1;
    });
  });

  Object.keys(index).forEach((key) => {
    index[key].sort((left, right) => String(left).localeCompare(String(right), "en", { numeric: true }));
  });
  return { index, indexedMatches };
}

function getCandidateShardName(key) {
  const first = String(key || "").trim().charAt(0).toLowerCase();
  return /^[a-z0-9]$/.test(first) ? `${first}.json` : "_.json";
}

function writeCandidateIndex(files, index, indexedMatches) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.rmSync(CANDIDATE_SHARDS_DIR, { recursive: true, force: true });
  fs.mkdirSync(CANDIDATE_SHARDS_DIR, { recursive: true });
  const shards = {};
  Object.entries(index).forEach(([key, eventIds]) => {
    const shardName = getCandidateShardName(key);
    if (!shards[shardName]) {
      shards[shardName] = {};
    }
    shards[shardName][key] = eventIds;
  });
  Object.entries(shards).forEach(([shardName, shard]) => {
    fs.writeFileSync(path.join(CANDIDATE_SHARDS_DIR, shardName), JSON.stringify(shard));
  });
  fs.writeFileSync(CANDIDATE_MANIFEST_PATH, JSON.stringify({
    version: CANDIDATE_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    signature: getPlayerRecordCacheSignature(files),
    sharded: true,
    shardCount: Object.keys(shards).length,
    eventCount: files.length,
    indexedMatches,
    keyCount: Object.keys(index).length,
  }));
}

function updatePlayerRecordCandidateIndexForEvents(eventIds) {
  const requested = new Set(eventIds.map((eventId) => String(eventId || "").trim()).filter(Boolean));
  if (requested.size === 0) {
    return { eventCount: 0, indexedMatches: 0, keyCount: 0 };
  }

  const allFiles = listWttRecordFiles();
  const files = allFiles.filter((file) => requested.has(String(file.eventId)));
  if (files.length === 0) {
    return { eventCount: 0, indexedMatches: 0, keyCount: 0 };
  }

  const deps = readBuildDeps();
  const existingIndex = readJson(CANDIDATE_INDEX_PATH, {});
  if (Object.keys(existingIndex).length === 0) {
    return rebuildPlayerRecordCandidateIndex();
  }
  Object.keys(existingIndex).forEach((key) => {
    const nextEventIds = (Array.isArray(existingIndex[key]) ? existingIndex[key] : [])
      .filter((eventId) => !requested.has(String(eventId)));
    if (nextEventIds.length > 0) {
      existingIndex[key] = nextEventIds;
    } else {
      delete existingIndex[key];
    }
  });

  const { index, indexedMatches } = buildCandidateIndex(files, deps);
  Object.entries(index).forEach(([key, eventIdsForKey]) => {
    if (!existingIndex[key]) {
      existingIndex[key] = [];
    }
    eventIdsForKey.forEach((eventId) => {
      if (!existingIndex[key].includes(eventId)) {
        existingIndex[key].push(eventId);
      }
    });
    existingIndex[key].sort((left, right) => String(left).localeCompare(String(right), "en", { numeric: true }));
  });

  writeCandidateIndex(allFiles, existingIndex, Number(readJson(CANDIDATE_MANIFEST_PATH, {}).indexedMatches || 0) + indexedMatches);
  return {
    eventCount: files.length,
    indexedMatches,
    keyCount: Object.keys(index).length,
  };
}

function rebuildPlayerRecordCandidateIndex() {
  const files = listWttRecordFiles();
  const deps = readBuildDeps();
  const { index, indexedMatches } = buildCandidateIndex(files, deps);
  writeCandidateIndex(files, index, indexedMatches);
  return {
    eventCount: files.length,
    indexedMatches,
    keyCount: Object.keys(index).length,
  };
}

function readBuildDeps() {
  return {
    translations: readTranslations(TRANSLATIONS_PATH),
    rules: readRules(RULES_PATH),
    searchIndex: readJson(WTT_SEARCH_INDEX_PATH, {}),
    dateIndex: readWttDateIndex(WTT_DATE_INDEX_PATH),
    archiveIndex: readJson(WTT_ARCHIVE_INDEX_PATH, {}),
    eventNames: readJson(EVENT_NAMES_PATH, {}),
  };
}

function updatePlayerRecordsIndexForEvents(eventIds) {
  const requested = new Set(eventIds.map((eventId) => String(eventId || "").trim()).filter(Boolean));
  if (requested.size === 0) {
    return { eventCount: 0, indexedMatches: 0, keyCount: 0 };
  }

  const allFiles = listWttRecordFiles();
  const files = allFiles.filter((file) => requested.has(String(file.eventId)));
  if (files.length === 0) {
    return { eventCount: 0, indexedMatches: 0, keyCount: 0 };
  }
  const isAllIncrementalUpdate = files.length === allFiles.length;
  const existingManifest = readJson(MANIFEST_PATH, {});
  const deps = readBuildDeps();
  const { index, indexedMatches } = buildEventIndex(files, deps);
  removeEventsFromExistingShards([...requested]);
  mergeIndexIntoExistingShards(index);
  writeManifest({
    ...existingManifest,
    generatedAt: new Date().toISOString(),
    updateMode: isAllIncrementalUpdate ? "incremental-all" : "incremental",
    eventCount: allFiles.length,
    updatedEvents: [...requested],
    indexedMatches: isAllIncrementalUpdate ? indexedMatches : existingManifest.indexedMatches,
    incrementalIndexedMatches: indexedMatches,
  });
  return {
    eventCount: files.length,
    indexedMatches,
    keyCount: Object.keys(index).length,
  };
}

function parsePositiveIntegerArg(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index < 0) {
    return fallback;
  }
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function updateAllPlayerRecordsIndexIncrementally(argv) {
  return rebuildPlayerRecordCandidateIndex();
}

function parseEventArgs(argv) {
  const events = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--event" || arg === "-e") {
      events.push(...String(next || "").split(",").map((value) => value.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (!arg.startsWith("-")) {
      events.push(...arg.split(",").map((value) => value.trim()).filter(Boolean));
    }
  }
  return events;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--all-incremental")) {
    const result = updateAllPlayerRecordsIndexIncrementally(argv);
    console.log(`updated ${result.eventCount} events, ${result.indexedMatches} matches, ${result.keyCount} player keys`);
    console.log(OUTPUT_DIR);
    return;
  }

  const eventArgs = parseEventArgs(argv);
  if (eventArgs.length > 0) {
    const result = updatePlayerRecordCandidateIndexForEvents(eventArgs);
    console.log(`updated ${result.eventCount} events, ${result.indexedMatches} matches, ${result.keyCount} player keys`);
    console.log(OUTPUT_DIR);
    return;
  }

  const deps = readBuildDeps();
  const files = listWttRecordFiles();
  const { index, indexedMatches } = buildEventIndex(files, deps);

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
  writeManifest(payload);
  console.log(`indexed ${files.length} events, ${indexedMatches} matches, ${Object.keys(index).length} player keys`);
  console.log(OUTPUT_DIR);
}

if (require.main === module) {
  main();
}

module.exports = {
  updatePlayerRecordCandidateIndexForEvents,
};
