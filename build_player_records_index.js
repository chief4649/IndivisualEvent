#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  buildJaRoundContext,
  getNameTranslationCandidates,
  normalizeOfficialResultItem,
  readRules,
  readTranslations,
  readWttDateIndex,
  translateRoundJa,
} = require("./extract_individual_matches");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const WTT_ARCHIVE_DIR = path.join(DATA_DIR, "wtt-records");
const WTT_SLIM_ARCHIVE_DIR = path.join(DATA_DIR, "wtt-records-slim");
const ITTF_ARCHIVE_DIR = path.join(DATA_DIR, "ittf-records");
const ITTF_SLIM_ARCHIVE_DIR = path.join(DATA_DIR, "ittf-records-slim");
const BUNDLED_WTT_ARCHIVE_DIR = path.join(__dirname, "wtt-records");
const BUNDLED_WTT_SLIM_ARCHIVE_DIR = path.join(__dirname, "wtt-records-slim");
const BUNDLED_ITTF_ARCHIVE_DIR = path.join(__dirname, "ittf-records");
const BUNDLED_ITTF_SLIM_ARCHIVE_DIR = path.join(__dirname, "ittf-records-slim");
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
const CANDIDATE_INDEX_FORMAT_VERSION = 2;

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

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value));
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function readCandidateIndex() {
  const monolithic = readJson(CANDIDATE_INDEX_PATH, null);
  if (monolithic && typeof monolithic === "object" && !Array.isArray(monolithic) && Object.keys(monolithic).length > 0) {
    return monolithic;
  }
  if (!fs.existsSync(CANDIDATE_SHARDS_DIR)) {
    return {};
  }
  const index = {};
  fs.readdirSync(CANDIDATE_SHARDS_DIR)
    .filter((fileName) => /^(?:[a-z0-9]|_)\.json$/i.test(fileName))
    .forEach((fileName) => {
      const shard = readJson(path.join(CANDIDATE_SHARDS_DIR, fileName), {});
      Object.assign(index, shard && typeof shard === "object" && !Array.isArray(shard) ? shard : {});
    });
  return index;
}

function readCandidateShardedIndex() {
  if (!fs.existsSync(CANDIDATE_SHARDS_DIR)) {
    return {};
  }
  const index = {};
  fs.readdirSync(CANDIDATE_SHARDS_DIR)
    .filter((fileName) => /^(?:[a-z0-9]|_)\.json$/i.test(fileName))
    .forEach((fileName) => {
      const shard = readJson(path.join(CANDIDATE_SHARDS_DIR, fileName), {});
      Object.assign(index, shard && typeof shard === "object" && !Array.isArray(shard) ? shard : {});
    });
  return index;
}

function listWttRecordFiles() {
  const recordsByEventId = new Map();

  const shouldReplaceRecord = (current, next) => {
    if (!current) {
      return true;
    }
    const nextIsSlim = String(next.parseSource || "").endsWith("-slim");
    const currentIsSlim = String(current.parseSource || "").endsWith("-slim");
    if (nextIsSlim && !currentIsSlim) {
      return true;
    }
    if (currentIsSlim && !nextIsSlim) {
      return false;
    }
    return (
      next.size > current.size ||
      (next.size === current.size && next.mtimeMs > current.mtimeMs) ||
      (next.size === current.size && next.mtimeMs === current.mtimeMs && next.priority > current.priority)
    );
  };

  const addDir = (dirPath, priority, parseSource, rawDirPath = dirPath) => {
    if (!fs.existsSync(dirPath)) {
      return;
    }
    fs.readdirSync(dirPath)
      .filter((fileName) => /^(?:TTE)?\d+\.json$/i.test(fileName))
      .forEach((fileName) => {
        const eventId = fileName.replace(/\.json$/i, "");
        const filePath = path.join(rawDirPath, fileName);
        const parseFilePath = path.join(dirPath, fileName);
        const stat = fs.statSync(parseFilePath);
        const next = {
          eventId,
          filePath,
          parseFilePath,
          parseSource,
          size: stat.size,
          mtimeMs: Math.trunc(stat.mtimeMs),
          priority,
        };
        const current = recordsByEventId.get(eventId);
        if (shouldReplaceRecord(current, next)) {
          recordsByEventId.set(eventId, next);
        }
      });
  };

  // Slim archives are the canonical runtime source after raw archives are
  // converted and removed to stay within Render disk limits.
  addDir(WTT_ARCHIVE_DIR, 1, "runtime-raw");
  addDir(BUNDLED_WTT_ARCHIVE_DIR, 2, "bundled-raw");
  addDir(ITTF_ARCHIVE_DIR, 1, "runtime-raw");
  addDir(BUNDLED_ITTF_ARCHIVE_DIR, 2, "bundled-raw");
  if (process.env.WTT_SLIM_RECORDS_DISABLED !== "1") {
    addDir(BUNDLED_WTT_SLIM_ARCHIVE_DIR, 0, "bundled-slim", BUNDLED_WTT_ARCHIVE_DIR);
    addDir(WTT_SLIM_ARCHIVE_DIR, 3, "runtime-slim", WTT_ARCHIVE_DIR);
    addDir(BUNDLED_ITTF_SLIM_ARCHIVE_DIR, 0, "bundled-slim", BUNDLED_ITTF_ARCHIVE_DIR);
    addDir(ITTF_SLIM_ARCHIVE_DIR, 3, "runtime-slim", ITTF_ARCHIVE_DIR);
  }

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
  const values = [
    competitor?.name,
    competitor?.playerName,
    competitor?.competitorName,
    competitor?.competitiorName,
    competitor?.displayName,
    competitor?.description,
    competitor?.desc,
    competitor?.teamName,
    competitor?.team,
    ...(Array.isArray(competitor?.players) ? competitor.players.flatMap((player) => [
      player?.name,
      player?.playerName,
      player?.competitorName,
      player?.description,
      player?.desc,
    ]) : []),
  ].filter(Boolean);
  const names = values.flatMap((value) => [
    value,
    translateCandidateNameForRecord(value, translations),
    ...getNameTranslationCandidates(value),
    ...buildPlayerNameSearchValues(value),
    ...getCandidateNameTranslationAliases(value, "", translations),
  ]);

  const orgCandidates = (Array.isArray(competitor?.players) ? competitor.players : []).map((player) => ({
    name: player?.name || player?.playerName || player?.competitorName || player?.description || player?.desc,
    org: player?.orgCode || player?.org || competitor?.orgCode || competitor?.org,
  }));
  values.forEach((value) => {
    String(value || "").split(/\s*(?:\/|／|\+|&| and )\s*/i).map((name) => name.trim()).filter(Boolean)
      .forEach((name) => orgCandidates.push({ name, org: competitor?.orgCode || competitor?.org }));
  });
  orgCandidates.forEach(({ name, org }) => {
    if (!name) {
      return;
    }
    names.push(name, translateCandidateNameForRecord(name, translations), ...getNameTranslationCandidates(name));
    names.push(...getCandidatePlayerOrgOverrideNames(name, org, translations));
    names.push(...getCandidateNameTranslationAliases(name, org, translations));
  });

  return Array.from(new Set(names.flatMap(buildPlayerNameSearchValues).filter(Boolean)));
}

function getCandidateNameTokenSignature(value) {
  const tokens = normalizePlayerSearchText(value).split(/\s+/).filter(Boolean).sort();
  return tokens.length > 0 ? tokens.join(" ") : "";
}

function buildCandidateNameAliasLookup(translations) {
  const players = new Map();
  Object.entries(translations?.players || {}).forEach(([name, translated]) => {
    const signature = getCandidateNameTokenSignature(name);
    if (!signature) {
      return;
    }
    if (!players.has(signature)) {
      players.set(signature, []);
    }
    players.get(signature).push(name, translated);
  });
  const orgOverrides = new Map();
  Object.entries(translations?.playerOrgOverrides || {}).forEach(([key, translated]) => {
    const separator = String(key).lastIndexOf("|");
    if (separator <= 0 || !translated) {
      return;
    }
    const org = String(key.slice(separator + 1)).trim().toUpperCase();
    const signature = getCandidateNameTokenSignature(key.slice(0, separator));
    if (!org || !signature) {
      return;
    }
    const mapKey = `${org}|${signature}`;
    if (!orgOverrides.has(mapKey)) {
      orgOverrides.set(mapKey, []);
    }
    orgOverrides.get(mapKey).push(key.slice(0, separator), translated);
  });
  return { players, orgOverrides };
}

function getCandidateNameTranslationAliases(value, orgCode, translations) {
  const lookup = translations?.candidateNameAliases;
  const signature = getCandidateNameTokenSignature(value);
  if (!lookup || !signature) {
    return [];
  }
  const aliases = [...(lookup.players.get(signature) || [])];
  const org = String(orgCode || "").trim().toUpperCase();
  if (org) {
    aliases.push(...(lookup.orgOverrides.get(`${org}|${signature}`) || []));
  }
  return aliases;
}

function translateCandidateNameForRecord(value, translations) {
  return String(value || "").split(/\s*(?:\/|／|\+|&| and )\s*/i)
    .map((part) => {
      for (const candidate of getNameTranslationCandidates(part)) {
        if (translations.players?.[candidate]) {
          return translations.players[candidate];
        }
      }
      return translatePlayerNameForRecord(part, translations);
    })
    .filter(Boolean)
    .join("／");
}

function getCandidatePlayerOrgOverrideNames(name, orgCode, translations) {
  const overrides = translations?.playerOrgOverrides;
  const lookup = translations?.candidateOrgOverrides;
  if (!overrides || typeof overrides !== "object" || !lookup) {
    return [];
  }
  const rawOrg = normalizePlayerSearchText(orgCode);
  if (!rawOrg) {
    return [];
  }
  const orgCodes = new Set([rawOrg.toUpperCase()]);
  const mappedOrg = lookup.orgs.get(rawOrg);
  if (mappedOrg) {
    orgCodes.add(mappedOrg);
  }
  const translatedNames = new Set();
  getNameTranslationCandidates(name).forEach((candidate) => {
    const normalizedName = normalizePlayerSearchText(candidate);
    orgCodes.forEach((org) => {
      const translated = lookup.names.get(`${org}|${normalizedName}`);
      if (translated) {
        translatedNames.add(translated);
      }
    });
  });
  return [...translatedNames];
}

function buildCandidateOrgOverrideLookup(translations) {
  const names = new Map();
  Object.entries(translations?.playerOrgOverrides || {}).forEach(([key, value]) => {
    const separator = String(key).lastIndexOf("|");
    if (separator <= 0 || !value) {
      return;
    }
    const name = normalizePlayerSearchText(key.slice(0, separator));
    const org = String(key.slice(separator + 1)).trim().toUpperCase();
    if (name && org) {
      names.set(`${org}|${name}`, value);
    }
  });
  const orgs = new Map();
  Object.entries(translations?.teams || {}).forEach(([code, translated]) => {
    const normalizedCode = normalizePlayerSearchText(code);
    const normalizedTranslated = normalizePlayerSearchText(translated);
    if (normalizedCode) {
      orgs.set(normalizedCode, code.toUpperCase());
    }
    if (normalizedTranslated) {
      orgs.set(normalizedTranslated, code.toUpperCase());
    }
  });
  return { names, orgs };
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

  files.forEach(({ eventId, filePath, parseFilePath }) => {
    const payload = readJson(parseFilePath || filePath, []);
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
  const dataSignature = files.map((file) => [
    file.eventId,
    file.size,
    file.mtimeMs,
    file.parseSource || "raw",
    file.parseFilePath || file.filePath,
  ].join(":")).join("|");
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
  const eventMatchCounts = {};
  const translations = {
    ...deps.translations,
    candidateOrgOverrides: buildCandidateOrgOverrideLookup(deps.translations),
    candidateNameAliases: buildCandidateNameAliasLookup(deps.translations),
  };

  files.forEach(({ eventId, filePath, parseFilePath }) => {
    eventMatchCounts[eventId] = 0;
    const payload = readJson(parseFilePath || filePath, []);
    if (!Array.isArray(payload)) {
      return;
    }
    payload.forEach((item) => {
      const match = normalizeArchivedMatch(item);
      if (!match) {
        return;
      }
      addCandidateMatch(index, eventId, match, translations);
      indexedMatches += 1;
      eventMatchCounts[eventId] = (eventMatchCounts[eventId] || 0) + 1;
    });
  });

  Object.keys(index).forEach((key) => {
    index[key].sort((left, right) => String(left).localeCompare(String(right), "en", { numeric: true }));
  });
  return { index, indexedMatches, eventMatchCounts };
}

function getCandidateShardName(key) {
  const first = String(key || "").trim().charAt(0).toLowerCase();
  return /^[a-z0-9]$/.test(first) ? `${first}.json` : "_.json";
}

function normalizeCandidateIndex(index) {
  const normalized = {};
  Object.keys(index || {}).sort().forEach((key) => {
    normalized[key] = [...new Set((Array.isArray(index[key]) ? index[key] : []).map(String))]
      .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  });
  return normalized;
}

function getCandidateIndexHash(index) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(normalizeCandidateIndex(index)))
    .digest("hex");
}

function groupCandidateIndexShards(index) {
  const shards = {};
  Object.entries(index).forEach(([key, eventIds]) => {
    const shardName = getCandidateShardName(key);
    if (!shards[shardName]) {
      shards[shardName] = {};
    }
    shards[shardName][key] = eventIds;
  });
  return shards;
}

function getCandidateEventSourceSignatures(files) {
  return Object.fromEntries(files.map((file) => [String(file.eventId), [
    file.size,
    file.mtimeMs,
    file.parseSource || "raw",
    file.parseFilePath || file.filePath,
  ].join(":")]));
}

function getCandidateConfigSignature() {
  return [
    TRANSLATIONS_PATH,
    RULES_PATH,
    WTT_ARCHIVE_INDEX_PATH,
    WTT_DATE_INDEX_PATH,
    WTT_SEARCH_INDEX_PATH,
    EVENT_NAMES_PATH,
  ].map((filePath) => `${path.basename(filePath)}:${getPathStatToken(filePath)}`).join("|");
}

function haveSameCandidateMapEntries(left, right) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && left[key] === right[key],
  );
}

function isCandidateIndexCompleteForIncrementalUpdate(manifest, files, requestedEventIds) {
  if (
    manifest?.formatVersion !== CANDIDATE_INDEX_FORMAT_VERSION ||
    manifest?.complete !== true ||
    !manifest?.sourceFiles ||
    !manifest?.eventMatchCounts ||
    manifest.configSignature !== getCandidateConfigSignature()
  ) {
    return false;
  }

  const previousSources = manifest.sourceFiles;
  const previousMatchCounts = manifest.eventMatchCounts;
  if (Object.keys(previousSources).length !== files.length || Object.keys(previousMatchCounts).length !== files.length) {
    return false;
  }
  return files.every((file) => {
    const eventId = String(file.eventId);
    if (requestedEventIds.has(eventId)) {
      return true;
    }
    return previousSources[eventId] === getCandidateEventSourceSignatures([file])[eventId];
  });
}

function writeCandidateIndex(files, index, indexedMatches, eventMatchCounts = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.rmSync(CANDIDATE_SHARDS_DIR, { recursive: true, force: true });
  fs.mkdirSync(CANDIDATE_SHARDS_DIR, { recursive: true });
  const shards = groupCandidateIndexShards(index);
  Object.entries(shards).forEach(([shardName, shard]) => {
    writeJsonAtomic(path.join(CANDIDATE_SHARDS_DIR, shardName), shard);
  });
  // The API reads the monolithic file as the authoritative candidate index.
  // Keep it in sync with the shards written by incremental crawler updates.
  writeJsonAtomic(CANDIDATE_INDEX_PATH, index);
  writeJsonAtomic(CANDIDATE_MANIFEST_PATH, {
    version: CANDIDATE_INDEX_VERSION,
    formatVersion: CANDIDATE_INDEX_FORMAT_VERSION,
    complete: true,
    generatedAt: new Date().toISOString(),
    signature: getPlayerRecordCacheSignature(files),
    configSignature: getCandidateConfigSignature(),
    sourceFiles: getCandidateEventSourceSignatures(files),
    eventMatchCounts,
    sharded: true,
    shardCount: Object.keys(shards).length,
    eventCount: files.length,
    indexedMatches,
    keyCount: Object.keys(index).length,
    indexSha256: getCandidateIndexHash(index),
    shardsSha256: getCandidateIndexHash(index),
  });
}

function auditPlayerRecordCandidateIndex({ repair = false } = {}) {
  const files = listWttRecordFiles();
  const deps = readBuildDeps();
  const { index: expectedIndex, indexedMatches, eventMatchCounts } = buildCandidateIndex(files, deps);
  const manifest = readJson(CANDIDATE_MANIFEST_PATH, {});
  const monolithicIndex = readJson(CANDIDATE_INDEX_PATH, {});
  const shardedIndex = readCandidateShardedIndex();
  const expectedHash = getCandidateIndexHash(expectedIndex);
  const monolithicHash = getCandidateIndexHash(monolithicIndex);
  const shardedHash = getCandidateIndexHash(shardedIndex);
  const sourceSignature = getPlayerRecordCacheSignature(files);
  const reasons = [];

  if (manifest.version !== CANDIDATE_INDEX_VERSION) reasons.push("manifest-version");
  if (manifest.formatVersion !== CANDIDATE_INDEX_FORMAT_VERSION || manifest.complete !== true) reasons.push("incomplete-coverage-metadata");
  if (manifest.signature !== sourceSignature) reasons.push("source-signature");
  if (manifest.configSignature !== getCandidateConfigSignature()) reasons.push("config-signature");
  if (Number(manifest.eventCount) !== files.length) reasons.push("event-count");
  if (Number(manifest.indexedMatches) !== indexedMatches) reasons.push("match-count");
  if (
    !haveSameCandidateMapEntries(manifest.sourceFiles, getCandidateEventSourceSignatures(files)) ||
    !haveSameCandidateMapEntries(manifest.eventMatchCounts, eventMatchCounts)
  ) reasons.push("source-coverage");
  if (manifest.indexSha256 !== expectedHash) reasons.push("manifest-index-hash");
  if (manifest.shardsSha256 !== expectedHash) reasons.push("manifest-shards-hash");
  if (monolithicHash !== expectedHash) reasons.push("monolithic-content");
  if (shardedHash !== expectedHash) reasons.push("sharded-content");

  const repaired = repair && reasons.length > 0;
  if (repaired) {
    writeCandidateIndex(files, expectedIndex, indexedMatches, eventMatchCounts);
  }
  return {
    ok: reasons.length === 0 || repaired,
    consistent: reasons.length === 0,
    repaired,
    reasons,
    eventCount: files.length,
    indexedMatches,
    keyCount: Object.keys(expectedIndex).length,
    expectedHash,
  };
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
  const existingManifest = readJson(CANDIDATE_MANIFEST_PATH, {});
  if (!isCandidateIndexCompleteForIncrementalUpdate(existingManifest, allFiles, requested)) {
    return rebuildPlayerRecordCandidateIndex();
  }

  const existingIndex = readCandidateIndex();
  if (
    Object.keys(existingIndex).length === 0 ||
    getCandidateIndexHash(existingIndex) !== existingManifest.indexSha256 ||
    getCandidateIndexHash(readCandidateShardedIndex()) !== existingManifest.shardsSha256
  ) {
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

  const { index, indexedMatches, eventMatchCounts } = buildCandidateIndex(files, deps);
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

  const nextEventMatchCounts = { ...existingManifest.eventMatchCounts };
  requested.forEach((eventId) => {
    delete nextEventMatchCounts[eventId];
  });
  Object.assign(nextEventMatchCounts, eventMatchCounts);
  const totalIndexedMatches = Object.values(nextEventMatchCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  writeCandidateIndex(allFiles, existingIndex, totalIndexedMatches, nextEventMatchCounts);
  return {
    eventCount: files.length,
    indexedMatches,
    keyCount: Object.keys(index).length,
  };
}

function rebuildPlayerRecordCandidateIndex() {
  const files = listWttRecordFiles();
  const deps = readBuildDeps();
  const { index, indexedMatches, eventMatchCounts } = buildCandidateIndex(files, deps);
  writeCandidateIndex(files, index, indexedMatches, eventMatchCounts);
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
  if (argv.includes("--audit-candidates")) {
    const result = auditPlayerRecordCandidateIndex({ repair: argv.includes("--repair") });
    console.log(JSON.stringify(result));
    if (!result.ok) {
      process.exitCode = 2;
    }
    return;
  }
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
  auditPlayerRecordCandidateIndex,
  updatePlayerRecordCandidateIndexForEvents,
};
