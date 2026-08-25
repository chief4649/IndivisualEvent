#!/usr/bin/env node

const crypto = require("crypto");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const {
  DEFAULT_CACHE_DIR,
  DEFAULT_RULES_PATH,
  DEFAULT_TRANSLATIONS_PATH,
  applyFilters,
  buildJaRoundContext,
  createArgs,
  fetchOfficialResultsCached,
  getWttEventLifecycleMeta,
  getProcessedMatches,
  inferGender,
  normalizeOfficialResultItem,
  normalizePreNormalizedMatch,
  normalizeCategory,
  normalizeDiscipline,
  normalizeSource,
  readRules,
  readTranslations,
  readWttDateIndex,
  renderOutput,
  translateRoundJa,
} = require("./extract_individual_matches");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const TRANSLATIONS_PATH = path.join(DATA_DIR, "translations.ja.json");
const RULES_PATH = path.join(DATA_DIR, "rules.json");
const CACHE_DIR = path.join(DATA_DIR, ".cache");
const ZENNIHON_ARCHIVE_DIR = path.join(DATA_DIR, "zennihon-records");
const WTT_ARCHIVE_DIR = path.join(DATA_DIR, "wtt-records");
const WTT_SLIM_ARCHIVE_DIR = path.join(DATA_DIR, "wtt-records-slim");
const BUNDLED_WTT_ARCHIVE_DIR = path.join(__dirname, "wtt-records");
const BUNDLED_WTT_SLIM_ARCHIVE_DIR = path.join(__dirname, "wtt-records-slim");
const WTT_ARCHIVE_INDEX_PATH = path.join(DATA_DIR, "wtt-archive-index.json");
const WTT_DATE_INDEX_PATH = path.join(DATA_DIR, "wtt-date-index.json");
const WTT_SEARCH_INDEX_PATH = path.join(DATA_DIR, "wtt-search-index.json");
const EVENT_NAMES_PATH = path.join(DATA_DIR, "event-names.json");
const BACKFILL_5000_STATUS_PATH = path.join(DATA_DIR, "backfill-5000-status.json");
const PLAYER_RECORDS_INDEX_DIR = path.join(DATA_DIR, "player-records-index");
const BUNDLED_PLAYER_RECORDS_INDEX_DIR = path.join(__dirname, "player-records-index");
const PLAYER_RECORD_CANDIDATE_INDEX_VERSION = 1;
const PLAYER_RECORD_CANDIDATE_INDEX_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "candidate-events.json");
const PLAYER_RECORD_CANDIDATE_INDEX_MANIFEST_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "candidate-manifest.json");
const PLAYER_RECORD_CANDIDATE_SHARDS_DIR = path.join(PLAYER_RECORDS_INDEX_DIR, "candidate-shards");
const BUNDLED_PLAYER_RECORD_CANDIDATE_INDEX_MANIFEST_PATH = path.join(BUNDLED_PLAYER_RECORDS_INDEX_DIR, "candidate-manifest.json");
const BUNDLED_PLAYER_RECORD_CANDIDATE_SHARDS_DIR = path.join(BUNDLED_PLAYER_RECORDS_INDEX_DIR, "candidate-shards");
const PLAYER_RECORD_EVENT_INDEX_VERSION = 1;
const PLAYER_RECORD_EVENT_INDEX_DIR = path.join(PLAYER_RECORDS_INDEX_DIR, "event-records");
const PLAYER_RECORD_EVENT_INDEX_MANIFEST_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "event-records-manifest.json");
const BUNDLED_PLAYER_RECORD_EVENT_INDEX_DIR = path.join(BUNDLED_PLAYER_RECORDS_INDEX_DIR, "event-records");
const BUNDLED_PLAYER_RECORD_EVENT_INDEX_MANIFEST_PATH = path.join(BUNDLED_PLAYER_RECORDS_INDEX_DIR, "event-records-manifest.json");
const PLAYER_SEARCH_ARCHIVE_NAME_INDEX_VERSION = 1;
const PLAYER_SEARCH_ARCHIVE_NAME_INDEX_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "player-search-names.json");
const PLAYER_SEARCH_ARCHIVE_NAME_INDEX_MANIFEST_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "player-search-names-manifest.json");
const HEAD_TO_HEAD_INDEX_VERSION = 4;
const HEAD_TO_HEAD_PLAYER_INDEX_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "head-to-head-players.json");
const HEAD_TO_HEAD_PAIR_SHARDS_DIR = path.join(PLAYER_RECORDS_INDEX_DIR, "head-to-head-pairs");
const HEAD_TO_HEAD_INDEX_MANIFEST_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "head-to-head-manifest.json");
const HEAD_TO_HEAD_INDEX_STATUS_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "head-to-head-status.json");
const HEAD_TO_HEAD_DELTA_INDEX_VERSION = 1;
const HEAD_TO_HEAD_PAIR_INDEX_VERSION = 1;
const HEAD_TO_HEAD_DELTA_INDEX_DIR = path.join(PLAYER_RECORDS_INDEX_DIR, "head-to-head-delta");
const HEAD_TO_HEAD_DELTA_INDEX_MANIFEST_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "head-to-head-delta-manifest.json");
const HEAD_TO_HEAD_DELTA_PAIR_SHARDS_DIR = path.join(HEAD_TO_HEAD_DELTA_INDEX_DIR, "pairs");
const WTT_CRAWL_STATUS_PATH = path.join(DATA_DIR, "wtt-crawl-status.json");
const PLAYER_RECORD_MATCH_SHARDS_DIR = path.join(PLAYER_RECORDS_INDEX_DIR, "player-record-match-shards");
const BUNDLED_HEAD_TO_HEAD_PLAYER_INDEX_PATH = path.join(BUNDLED_PLAYER_RECORDS_INDEX_DIR, "head-to-head-players.json");
const BUNDLED_HEAD_TO_HEAD_PAIR_SHARDS_DIR = path.join(BUNDLED_PLAYER_RECORDS_INDEX_DIR, "head-to-head-pairs");
const BUNDLED_HEAD_TO_HEAD_INDEX_MANIFEST_PATH = path.join(BUNDLED_PLAYER_RECORDS_INDEX_DIR, "head-to-head-manifest.json");
const BUNDLED_PLAYER_RECORD_MATCH_SHARDS_DIR = path.join(BUNDLED_PLAYER_RECORDS_INDEX_DIR, "player-record-match-shards");
const WTT_CALENDAR_API_URL = "https://wtt-website-api-prod-3-frontdoor-bddnb2haduafdze9.a01.azurefd.net/api/eventcalendar";
const WTT_EVENT_ID_ALIASES = {
  "3487": "34031",
  "5524": "3500",
  "5513": "2755",
  "3440": "TTE3440",
};
const WTT_EVENT_PUBLIC_URLS = {
  "2587": "https://www.ittf.com/competitions_temp/competitions2.asp?Competition_ID=2587&category=WTTC",
  "3150": "https://results.ittf.com/ittf-web-results/html/TTE5676/results.html#/results",
  "3487": "https://www.ittf.com/tournament/3403/ITTF%20Americas%20Central%20American%20%20Caribbean%20Championships%20Santo%20Domingo%202026/",
  "wmc2026": "https://wmc2026.ittf.com/",
};
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const VIEWER_PASSWORD = process.env.VIEWER_PASSWORD || "";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 60);
const RATE_LIMIT_MAX_CLIENTS = Number(process.env.RATE_LIMIT_MAX_CLIENTS || 1_000);
const HEAVY_API_MAX_CONCURRENT = Math.max(Number(process.env.HEAVY_API_MAX_CONCURRENT || 1) || 1, 1);
const HEAVY_API_MAX_QUEUE = Math.max(Number(process.env.HEAVY_API_MAX_QUEUE || 20) || 20, 0);
const SKIP_RUNTIME_ARCHIVE_SYNC = process.env.SKIP_RUNTIME_ARCHIVE_SYNC === "1" || process.env.RENDER === "true";
const VIEWER_COOKIE_NAME = "ttreport_individual_viewer_auth";
const TEAM_TRANSLATIONS_BASE_URL = String(process.env.TEAM_TRANSLATIONS_BASE_URL || "").trim().replace(/\/+$/, "");
const TEAM_TRANSLATIONS_ADMIN_TOKEN = process.env.TEAM_TRANSLATIONS_ADMIN_TOKEN || "";
const TEAM_TRANSLATIONS_VIEWER_PASSWORD = process.env.TEAM_TRANSLATIONS_VIEWER_PASSWORD || "";
const SHARED_TRANSLATIONS_TIMEOUT_MS = Number(process.env.SHARED_TRANSLATIONS_TIMEOUT_MS || 8000);
const SHARED_TRANSLATIONS_SYNC_TTL_MS = Number(process.env.SHARED_TRANSLATIONS_SYNC_TTL_MS || 60_000);
const EVENT_NAME_CACHE_MAX_ENTRIES = Number(process.env.EVENT_NAME_CACHE_MAX_ENTRIES || 500);
const PROCESSED_MATCHES_CACHE_MAX_ENTRIES = Number(process.env.PROCESSED_MATCHES_CACHE_MAX_ENTRIES || 3);
const REQUEST_BODY_MAX_BYTES = Number(process.env.REQUEST_BODY_MAX_BYTES || 1_048_576);
const rateLimitStore = new Map();
const eventNameCache = new Map();
const processedMatchesCache = new Map();
let heavyApiActiveCount = 0;
const heavyApiQueue = [];
let headToHeadIndexBuildProcess = null;
let wttCrawlProcess = null;
let backfill5000Promise = null;
let translationsLastSyncAt = 0;
let translationsLastSyncMeta = null;
const EVENT_NAME_API_KEY = "S_WTT_882jjh7basdj91834783mds8j2jsd81";
const PROCESSED_MATCHES_CACHE_TTL_MS = Number(process.env.PROCESSED_MATCHES_CACHE_TTL_MS || 15_000);
const STORAGE_MANAGED_FILES = [
  ["translations.ja.json", TRANSLATIONS_PATH],
  ["rules.json", RULES_PATH],
  ["event-names.json", EVENT_NAMES_PATH],
  ["wtt-search-index.json", WTT_SEARCH_INDEX_PATH],
  ["wtt-date-index.json", WTT_DATE_INDEX_PATH],
  ["wtt-archive-index.json", WTT_ARCHIVE_INDEX_PATH],
];
let translationsSyncPromise = null;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFileFromDefault(targetPath, sourcePath) {
  if (fs.existsSync(targetPath)) {
    return;
  }
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return;
  }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function syncFileFromDefaultIfNewer(targetPath, sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return;
  }
  if (!fs.existsSync(targetPath)) {
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
    return;
  }
  const sourceStat = fs.statSync(sourcePath);
  const targetStat = fs.statSync(targetPath);
  if (sourceStat.mtimeMs <= targetStat.mtimeMs) {
    return;
  }
  fs.copyFileSync(sourcePath, targetPath);
}

function ensureDirectoryFilesFromDefault(targetDir, sourceDir) {
  ensureDir(targetDir);
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    return;
  }
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  entries.forEach((entry) => {
    if (!entry.isFile()) {
      return;
    }
    ensureFileFromDefault(path.join(targetDir, entry.name), path.join(sourceDir, entry.name));
  });
}

function syncDirectoryFilesFromDefaultIfNewer(targetDir, sourceDir) {
  ensureDir(targetDir);
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    return;
  }
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  entries.forEach((entry) => {
    if (!entry.isFile()) {
      return;
    }
    syncFileFromDefaultIfNewer(path.join(targetDir, entry.name), path.join(sourceDir, entry.name));
  });
}

function ensureRuntimeFiles() {
  ensureDir(DATA_DIR);
  ensureDir(CACHE_DIR);
  try {
    fs.rmSync(path.join(PLAYER_RECORDS_INDEX_DIR, "player-record-matches"), { recursive: true, force: true });
  } catch {
    // Best-effort cleanup for aborted experimental index builds.
  }
  try {
    if (fs.existsSync(PLAYER_RECORDS_INDEX_DIR)) {
      fs.readdirSync(PLAYER_RECORDS_INDEX_DIR)
        .filter((name) => /^player-record-match-shards\.tmp-/.test(name))
        .forEach((name) => fs.rmSync(path.join(PLAYER_RECORDS_INDEX_DIR, name), { recursive: true, force: true }));
    }
  } catch {
    // Best-effort cleanup for aborted shard builds.
  }
  if (!SKIP_RUNTIME_ARCHIVE_SYNC) {
    syncDirectoryFilesFromDefaultIfNewer(ZENNIHON_ARCHIVE_DIR, path.join(__dirname, "zennihon-records"));
    syncDirectoryFilesFromDefaultIfNewer(WTT_ARCHIVE_DIR, path.join(__dirname, "wtt-records"));
  }
  ensureFileFromDefault(TRANSLATIONS_PATH, DEFAULT_TRANSLATIONS_PATH);
  ensureFileFromDefault(RULES_PATH, DEFAULT_RULES_PATH);
  syncFileFromDefaultIfNewer(WTT_DATE_INDEX_PATH, path.join(__dirname, "wtt-date-index.json"));
  syncFileFromDefaultIfNewer(WTT_SEARCH_INDEX_PATH, path.join(__dirname, "wtt-search-index.json"));
  syncFileFromDefaultIfNewer(EVENT_NAMES_PATH, path.join(__dirname, "event-names.json"));
  syncFileFromDefaultIfNewer(WTT_ARCHIVE_INDEX_PATH, path.join(__dirname, "wtt-archive-index.json"));
}

function validateTranslationsPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("辞書 JSON はオブジェクト形式である必要があります。");
  }

  const normalized = {
    teams: value.teams && typeof value.teams === "object" && !Array.isArray(value.teams) ? value.teams : {},
    players: value.players && typeof value.players === "object" && !Array.isArray(value.players) ? value.players : {},
    playerOrgOverrides: value.playerOrgOverrides && typeof value.playerOrgOverrides === "object" && !Array.isArray(value.playerOrgOverrides) ? value.playerOrgOverrides : {},
    rounds: value.rounds && typeof value.rounds === "object" && !Array.isArray(value.rounds) ? value.rounds : {},
    headers: value.headers && typeof value.headers === "object" && !Array.isArray(value.headers) ? value.headers : {},
  };

  if (Object.keys(normalized.teams).length === 0 && Object.keys(normalized.players).length === 0) {
    throw new Error("辞書が空です。空保存を防ぐため、teams または players に1件以上必要です。");
  }

  return normalized;
}

function hasSharedTranslationsSource() {
  return Boolean(TEAM_TRANSLATIONS_BASE_URL && TEAM_TRANSLATIONS_ADMIN_TOKEN && TEAM_TRANSLATIONS_VIEWER_PASSWORD);
}

function getSharedViewerCookieValue() {
  return crypto
    .createHash("sha256")
    .update(`ttreport-viewer:${TEAM_TRANSLATIONS_VIEWER_PASSWORD}`)
    .digest("hex");
}

function getSharedTranslationsHeaders() {
  const headers = {
    accept: "application/json, text/plain, */*",
    authorization: `Bearer ${TEAM_TRANSLATIONS_ADMIN_TOKEN}`,
    cookie: `ttreport_viewer_auth=${encodeURIComponent(getSharedViewerCookieValue())}`,
    "user-agent": "Mozilla/5.0 (compatible; Codex/1.0)",
  };
  return headers;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 0) {
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    return await fetch(url, {
      ...options,
      signal: controller?.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Timed out fetching ${url}`);
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function readJsonFromResponse(response, contextLabel) {
  const text = await response.text();
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const snippet = text.trim().replace(/\s+/g, " ").slice(0, 120);
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error(`${contextLabel} returned an empty response`);
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const isHtml = contentType.includes("html") || /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
    const kind = isHtml ? "HTML content" : "non-JSON content";
    throw new Error(`${contextLabel} returned ${kind} (${contentType || "unknown"}): ${snippet}`);
  }
}

async function fetchSharedTranslations() {
  const response = await fetchJsonWithTimeout(`${TEAM_TRANSLATIONS_BASE_URL}/api/config/translations`, {
    headers: getSharedTranslationsHeaders(),
  }, SHARED_TRANSLATIONS_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`Failed to fetch shared translations: ${response.status} ${response.statusText}`);
  }
  const payload = await readJsonFromResponse(response, "Shared translations API");
  return payload?.data || null;
}

async function saveSharedTranslations(payload) {
  const response = await fetchJsonWithTimeout(`${TEAM_TRANSLATIONS_BASE_URL}/api/config/translations`, {
    method: "PUT",
    headers: {
      ...getSharedTranslationsHeaders(),
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  }, SHARED_TRANSLATIONS_TIMEOUT_MS);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to save shared translations: ${response.status} ${errorText || response.statusText}`);
  }
}

async function syncTranslationsFromSharedSource(force = false) {
  if (!hasSharedTranslationsSource()) {
    return { synced: false, source: "local", reason: "shared_source_disabled" };
  }
  const now = Date.now();
  if (
    !force &&
    translationsLastSyncMeta &&
    SHARED_TRANSLATIONS_SYNC_TTL_MS > 0 &&
    now - translationsLastSyncAt < SHARED_TRANSLATIONS_SYNC_TTL_MS
  ) {
    return {
      ...translationsLastSyncMeta,
      cacheHit: true,
    };
  }
  if (!force && translationsSyncPromise) {
    await translationsSyncPromise;
    return {
      ...(translationsLastSyncMeta || { synced: true, source: "shared" }),
      cacheHit: true,
    };
  }
  translationsSyncPromise = (async () => {
    const translations = await fetchSharedTranslations();
    if (translations) {
      writePrettyJson(TRANSLATIONS_PATH, translations);
    }
    return { synced: Boolean(translations), source: "shared" };
  })();
  try {
    const result = await translationsSyncPromise;
    translationsLastSyncAt = Date.now();
    translationsLastSyncMeta = result;
    return result;
  } catch (error) {
    console.error(`[translations sync] ${error.message}`);
    const result = {
      synced: false,
      source: "local",
      reason: error.message,
    };
    translationsLastSyncAt = Date.now();
    translationsLastSyncMeta = result;
    return result;
  } finally {
    translationsSyncPromise = null;
  }
}

function refreshTranslationsInBackground(context = "translations") {
  syncTranslationsFromSharedSource().catch((error) => {
    console.warn(`[${context}] background translations sync failed:`, error?.message || error);
  });
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function setBoundedMapValue(map, key, value, maxEntries) {
  const limit = toPositiveInteger(maxEntries, 0);
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);

  if (!limit) {
    return;
  }
  while (map.size > limit) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    map.delete(oldestKey);
  }
}

function setEventNameCache(cacheKey, eventName) {
  setBoundedMapValue(eventNameCache, cacheKey, eventName, EVENT_NAME_CACHE_MAX_ENTRIES);
}

function getClientIp(request) {
  if (TRUST_PROXY) {
    const forwardedFor = request.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
      return forwardedFor.split(",")[0].trim();
    }
  }
  return request.socket.remoteAddress || "unknown";
}

function isRateLimited(request) {
  const ip = getClientIp(request);
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now - entry.startedAt >= RATE_LIMIT_WINDOW_MS) {
    for (const [key, value] of rateLimitStore.entries()) {
      if (now - value.startedAt >= RATE_LIMIT_WINDOW_MS) {
        rateLimitStore.delete(key);
      }
    }
    setBoundedMapValue(rateLimitStore, ip, { count: 1, startedAt: now }, RATE_LIMIT_MAX_CLIENTS);
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

function buildHealthPayload() {
  return {
    ok: true,
    deploy: {
      renderGitCommit: process.env.RENDER_GIT_COMMIT || null,
      renderServiceId: process.env.RENDER_SERVICE_ID || null,
      nodeEnv: process.env.NODE_ENV || null,
    },
    adminProtected: Boolean(ADMIN_TOKEN),
    viewerProtected: Boolean(VIEWER_PASSWORD),
    runtimeArchiveSyncSkipped: SKIP_RUNTIME_ARCHIVE_SYNC,
    files: {
      server: getHealthFileMeta(path.join(__dirname, "server.js")),
      bundledTranslations: getHealthFileMeta(path.join(__dirname, "translations.ja.json")),
      runtimeTranslations: getHealthFileMeta(TRANSLATIONS_PATH),
      headToHeadManifest: getHealthFileMeta(HEAD_TO_HEAD_INDEX_MANIFEST_PATH),
      bundledHeadToHeadManifest: getHealthFileMeta(BUNDLED_HEAD_TO_HEAD_INDEX_MANIFEST_PATH),
      playerRecordEventManifest: getHealthFileMeta(PLAYER_RECORD_EVENT_INDEX_MANIFEST_PATH),
      bundledPlayerRecordEventManifest: getHealthFileMeta(BUNDLED_PLAYER_RECORD_EVENT_INDEX_MANIFEST_PATH),
    },
    playerOrgOverrides: buildPlayerOrgOverrideHealth(),
    headToHead: buildHeadToHeadHealth(),
    playerRecords: {
      source: "wtt-records",
      archiveMode: "runtime+bundled",
      parseMode: "slim-if-available",
      candidateMode: "candidate-index+grep-fallback",
      eventIndexMode: "event-records-with-missing-index-fallback",
      displayMode: "player-record-org-v4-category-groups-keep-round-order",
      cacheTtlMs: PLAYER_RECORD_RESULT_CACHE_TTL_MS,
    },
    heavyApi: {
      active: heavyApiActiveCount,
      queued: heavyApiQueue.length,
      maxConcurrent: HEAVY_API_MAX_CONCURRENT,
      maxQueue: HEAVY_API_MAX_QUEUE,
    },
  };
}

function runHeavyApi(task, response) {
  let queued = false;
  let started = false;
  let cancelled = false;
  const start = () => {
    queued = false;
    if (cancelled || response.destroyed) {
      return;
    }
    started = true;
    heavyApiActiveCount += 1;
    Promise.resolve()
      .then(task)
      .catch((error) => {
        console.error("[heavy-api]", error?.stack || error);
        if (!response.headersSent && !response.destroyed) {
          sendJson(response, 500, {
            error: createFriendlyErrorMessage(error),
          });
        }
      })
      .finally(() => {
        heavyApiActiveCount = Math.max(heavyApiActiveCount - 1, 0);
        const next = heavyApiQueue.shift();
        if (next) {
          setImmediate(next);
        }
      });
  };

  response.once("close", () => {
    if (!queued || started) {
      return;
    }
    cancelled = true;
    const index = heavyApiQueue.indexOf(start);
    if (index >= 0) {
      heavyApiQueue.splice(index, 1);
    }
  });

  if (heavyApiActiveCount < HEAVY_API_MAX_CONCURRENT) {
    start();
    return;
  }

  if (heavyApiQueue.length >= HEAVY_API_MAX_QUEUE) {
    sendJson(response, 503, {
      error: "Server is busy. Please retry shortly.",
      active: heavyApiActiveCount,
      queued: heavyApiQueue.length,
    }, {
      "retry-after": "3",
    });
    return;
  }

  queued = true;
  heavyApiQueue.push(start);
}

function getBearerToken(request) {
  const header = request.headers.authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function isAuthorized(request) {
  if (!ADMIN_TOKEN) {
    return true;
  }
  return getBearerToken(request) === ADMIN_TOKEN || request.headers["x-admin-token"] === ADMIN_TOKEN;
}

function requireAuthorization(request, response) {
  if (isAuthorized(request)) {
    return true;
  }
  sendJson(response, 401, {
    error: "管理者トークンが未入力か正しくありません。管理者トークンを入力してから再度実行してください。",
  });
  return false;
}

function sendText(response, statusCode, body, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(body);
}

function serveFile(response, filePath) {
  if (!fs.existsSync(filePath)) {
    sendText(response, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === ".html"
    ? "text/html; charset=utf-8"
    : ext === ".css"
      ? "text/css; charset=utf-8"
      : ext === ".js"
        ? "text/javascript; charset=utf-8"
        : ext === ".svg"
          ? "image/svg+xml"
          : "application/octet-stream";

  sendText(response, 200, fs.readFileSync(filePath), contentType);
}

function parseCookies(request) {
  const raw = String(request.headers.cookie || "");
  return Object.fromEntries(
    raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex < 0) {
          return [part, ""];
        }
        return [
          decodeURIComponent(part.slice(0, separatorIndex).trim()),
          decodeURIComponent(part.slice(separatorIndex + 1).trim()),
        ];
      }),
  );
}

function getViewerCookieValue() {
  return crypto
    .createHash("sha256")
    .update(`ttreport-individual-viewer:${VIEWER_PASSWORD}`)
    .digest("hex");
}

function createViewerCookie() {
  return `${VIEWER_COOKIE_NAME}=${encodeURIComponent(getViewerCookieValue())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

function clearViewerCookie() {
  return `${VIEWER_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function isViewerAuthorized(request) {
  if (!VIEWER_PASSWORD) {
    return true;
  }

  const cookies = parseCookies(request);
  return cookies[VIEWER_COOKIE_NAME] === getViewerCookieValue();
}

function getLoginPage(errorMessage = "") {
  const errorHtml = errorMessage
    ? `<p class="error">${escapeHtml(errorMessage)}</p>`
    : "";

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ログイン | 個人戦記録出力システム</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <style>
      :root {
        --bg: #f7f1e6;
        --panel: rgba(255, 251, 245, 0.94);
        --ink: #1c1917;
        --muted: #6b6258;
        --line: rgba(89, 73, 58, 0.16);
        --accent: #ab2f20;
        --shadow: 0 24px 60px rgba(84, 54, 28, 0.16);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(171, 47, 32, 0.16), transparent 30%),
          radial-gradient(circle at top right, rgba(15, 118, 110, 0.14), transparent 24%),
          linear-gradient(180deg, #efe3cf 0%, var(--bg) 44%, #f4ede2 100%);
      }
      .panel {
        width: min(440px, 100%);
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: var(--shadow);
        padding: 28px;
      }
      h1 { margin: 0 0 10px; font-size: 1.4rem; }
      p { margin: 0 0 16px; color: var(--muted); line-height: 1.7; }
      label { display: grid; gap: 8px; font-size: 0.92rem; }
      input {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.9);
        padding: 12px 14px;
        color: var(--ink);
        font: inherit;
      }
      button {
        margin-top: 16px;
        width: 100%;
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        cursor: pointer;
        background: var(--accent);
        color: #fff9f5;
      }
      .error {
        margin-bottom: 16px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(171, 47, 32, 0.08);
        color: #7f1d1d;
      }
    </style>
  </head>
  <body>
    <main class="panel">
      <h1>閲覧パスワード</h1>
      <p>このページは限定公開です。閲覧用パスワードを入力してください。</p>
      ${errorHtml}
      <form method="post" action="/login">
        <label>
          パスワード
          <input type="password" name="password" autocomplete="current-password" required>
        </label>
        <button type="submit">ログイン</button>
      </form>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (REQUEST_BODY_MAX_BYTES > 0 && totalBytes > REQUEST_BODY_MAX_BYTES) {
        const error = new Error("Request body too large");
        error.statusCode = 413;
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function writePrettyJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function computeFileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function getFileMeta(filePath, options = {}) {
  const includeSha256 = options.includeSha256 !== false;
  const normalizedPath = String(filePath || "");
  if (!normalizedPath || !fs.existsSync(normalizedPath)) {
    return {
      exists: false,
      path: normalizedPath,
      size: 0,
      mtime: null,
      sha256: null,
    };
  }

  const stat = fs.statSync(normalizedPath);
  return {
    exists: true,
    path: normalizedPath,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    sha256: includeSha256 ? computeFileSha256(filePath) : null,
  };
}

function getHealthFileMeta(filePath) {
  const meta = getFileMeta(filePath, { includeSha256: true });
  return {
    exists: meta.exists,
    size: meta.size,
    mtime: meta.mtime,
    sha256: meta.sha256 ? meta.sha256.slice(0, 12) : null,
  };
}

function readJsonFileSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function buildPlayerOrgOverrideHealth() {
  const runtime = readJsonFileSafe(TRANSLATIONS_PATH);
  const bundled = readJsonFileSafe(path.join(__dirname, "translations.ja.json"));
  const runtimeOverrides = runtime?.playerOrgOverrides || {};
  const bundledOverrides = bundled?.playerOrgOverrides || {};
  const merged = readTranslations(TRANSLATIONS_PATH).playerOrgOverrides || {};
  return {
    runtime: {
      exists: Boolean(runtime?.playerOrgOverrides),
      xuYiChn: runtimeOverrides["XU Yi|CHN"] || null,
      xuYiHkg: runtimeOverrides["XU Yi|HKG"] || null,
    },
    bundled: {
      exists: Boolean(bundled?.playerOrgOverrides),
      xuYiChn: bundledOverrides["XU Yi|CHN"] || null,
      xuYiHkg: bundledOverrides["XU Yi|HKG"] || null,
    },
    merged: {
      xuYiChn: merged["XU Yi|CHN"] || null,
      xuYiHkg: merged["XU Yi|HKG"] || null,
    },
  };
}

function buildHeadToHeadHealth() {
  const manifest = readJsonFileSafe(HEAD_TO_HEAD_INDEX_MANIFEST_PATH);
  const snapshot = getWttRecordFileSnapshot();
  const effective = getHeadToHeadEffectiveEventIndex(manifest);
  const eventSignatures = effective.eventSignatures;
  const pairShardDir = manifest?.pairRecordShardDir || HEAD_TO_HEAD_PAIR_SHARDS_DIR;
  let pairShardEventCount = 0;
  try {
    pairShardEventCount = fs.readdirSync(pairShardDir, { withFileTypes: true })
      .filter((entry) => entry.isFile()).length;
  } catch {
    pairShardEventCount = 0;
  }
  const coveredEventCount = manifest?.pairRecordIndex === true
    ? snapshot.filter((file) => isHeadToHeadPairIndexEventCurrent(
      file,
      eventSignatures[String(file.eventId)],
      effective.generatedAt,
    )).length
    : 0;
  const currentParseSources = {};
  const indexedParseSources = {};
  snapshot.forEach((file) => {
    const source = file.parseSource || "raw";
    currentParseSources[source] = (currentParseSources[source] || 0) + 1;
    const indexedSource = String(eventSignatures[String(file.eventId)] || "").split(":")[2] || "missing";
    indexedParseSources[indexedSource] = (indexedParseSources[indexedSource] || 0) + 1;
  });
  return {
    manifestExists: Boolean(manifest),
    manifestVersion: manifest?.version || null,
    generatedAt: manifest?.generatedAt || null,
    indexedEventCount: effective.eventIds.size,
    currentWttEventCount: snapshot.length,
    pairRecordIndex: manifest?.pairRecordIndex === true,
    pairRecordCount: manifest?.pairRecordCount || 0,
    pairShardEventCount,
    pairIndexCoveredEventCount: coveredEventCount,
    currentParseSources,
    indexedParseSources,
    pairIndexCoversCurrentSnapshot: Boolean(
      manifest?.pairRecordIndex === true &&
      snapshot.length > 0 &&
      coveredEventCount === snapshot.length,
    ),
    deltaManifest: getHealthFileMeta(HEAD_TO_HEAD_DELTA_INDEX_MANIFEST_PATH),
  };
}

function listRecordFiles(dirPath, limit = 20, options = {}) {
  const includeSha256 = options.includeSha256 === true;
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  if (!dirPath || !fs.existsSync(dirPath)) {
    return {
      count: 0,
      latest: [],
      latestEventIds: [],
      sample: [],
    };
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        eventId: entry.name.replace(/\.json$/i, ""),
        filename: entry.name,
        path: fullPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs,
        sha256: includeSha256 ? computeFileSha256(fullPath) : null,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.filename.localeCompare(b.filename));

  const latest = entries.slice(0, normalizedLimit).map(({ mtimeMs, ...item }) => item);
  const sample = entries.slice(0, Math.min(5, normalizedLimit)).map(({ mtimeMs, ...item }) => item);

  return {
    count: entries.length,
    latest,
    latestEventIds: latest.map((item) => item.eventId),
    sample,
  };
}

function getStorageLookup(source, eventId) {
  const normalizedSource = normalizeSource(source || "wtt");
  const normalizedId = String(eventId || "").trim();
  const dirPath = normalizedSource === "zennihon" ? ZENNIHON_ARCHIVE_DIR : WTT_ARCHIVE_DIR;
  const meta = getFileMeta(path.join(dirPath, `${normalizedId}.json`), { includeSha256: false });
  const slimMeta = normalizedSource === "wtt"
    ? getFileMeta(path.join(WTT_SLIM_ARCHIVE_DIR, `${normalizedId}.json`), { includeSha256: false })
    : null;
  const primaryMeta = slimMeta?.exists ? slimMeta : meta;
  return {
    requestedEventId: normalizedId,
    exists: Boolean(primaryMeta.exists),
    path: primaryMeta.path,
    size: primaryMeta.size,
    mtime: primaryMeta.mtime,
    storage: slimMeta?.exists ? "slim" : "raw",
    raw: meta,
    slim: slimMeta,
  };
}

function syncBundledRecordToRuntime(source, eventId) {
  const normalizedSource = normalizeSource(source || "wtt");
  const normalizedId = String(eventId || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalizedId)) {
    const error = new Error("event must be a simple event id.");
    error.statusCode = 400;
    throw error;
  }
  if (normalizedSource !== "wtt") {
    const error = new Error("Bundled record sync currently supports WTT records only.");
    error.statusCode = 400;
    throw error;
  }

  const sourcePath = path.join(BUNDLED_WTT_ARCHIVE_DIR, `${normalizedId}.json`);
  const targetPath = path.join(WTT_ARCHIVE_DIR, `${normalizedId}.json`);
  if (!fs.existsSync(sourcePath)) {
    const error = new Error(`Bundled record not found: ${normalizedId}.json`);
    error.statusCode = 404;
    throw error;
  }

  ensureDir(WTT_ARCHIVE_DIR);
  fs.copyFileSync(sourcePath, targetPath);
  clearProcessedMatchesCache();
  clearPlayerRecordResultCache();
  clearHeadToHeadResultCache();
  clearPlayerRecordArchiveParseCache();

  return {
    source: normalizedSource,
    eventId: normalizedId,
    copied: true,
    from: sourcePath,
    to: targetPath,
    runtime: getFileMeta(targetPath, { includeSha256: false }),
    bundled: getFileMeta(sourcePath, { includeSha256: false }),
  };
}

function buildStorageStatus(options = {}) {
  const source = normalizeSource(options.source || "wtt");
  const eventId = String(options.event || "").trim();
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
  return {
    dataDir: DATA_DIR,
    generatedAt: new Date().toISOString(),
    wttRecordsDir: WTT_ARCHIVE_DIR,
    wttSlimRecordsDir: WTT_SLIM_ARCHIVE_DIR,
    zennihonRecordsDir: ZENNIHON_ARCHIVE_DIR,
    files: Object.fromEntries(
      STORAGE_MANAGED_FILES.map(([name, filePath]) => [name, getFileMeta(filePath)]),
    ),
    wttRecords: listRecordFiles(WTT_ARCHIVE_DIR, limit),
    wttSlimRecords: listRecordFiles(WTT_SLIM_ARCHIVE_DIR, limit),
    zennihonRecords: listRecordFiles(ZENNIHON_ARCHIVE_DIR, Math.min(limit, 20)),
    lookup: eventId ? getStorageLookup(source, eventId) : null,
  };
}

function buildSyncManifest(options = {}) {
  const includeSha256 = String(options.sha256 || "1") !== "0";
  const includeZennihon = String(options.includeZennihon || "0") === "1";
  const entries = STORAGE_MANAGED_FILES.map(([name, filePath]) => ({
    name,
    type: "file",
    ...getFileMeta(filePath, { includeSha256 }),
  }));

  const addDirectory = (dirPath) => {
    if (!dirPath || !fs.existsSync(dirPath)) {
      return;
    }
    fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .forEach((entry) => {
        entries.push({
          name: entry.name,
          type: "dir-entry",
          ...getFileMeta(path.join(dirPath, entry.name), { includeSha256 }),
        });
      });
  };

  addDirectory(WTT_ARCHIVE_DIR);
  if (includeZennihon) {
    addDirectory(ZENNIHON_ARCHIVE_DIR);
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    dataDir: DATA_DIR,
    generatedAt: new Date().toISOString(),
    includeSha256,
    includeZennihon,
    entries,
  };
}

function createExportFilename() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `indivisualevent-data-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.tar.gz`;
}

function getExportRelativePaths(includeZennihon) {
  const paths = STORAGE_MANAGED_FILES
    .map(([, filePath]) => path.relative(DATA_DIR, filePath))
    .filter((relativePath) => relativePath && !relativePath.startsWith(".."));
  paths.push(path.relative(DATA_DIR, WTT_ARCHIVE_DIR));
  if (includeZennihon) {
    paths.push(path.relative(DATA_DIR, ZENNIHON_ARCHIVE_DIR));
  }
  return paths.filter((relativePath) => fs.existsSync(path.join(DATA_DIR, relativePath)));
}

function getEventNamesMap() {
  try {
    if (!fs.existsSync(EVENT_NAMES_PATH)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(EVENT_NAMES_PATH, "utf8"));
  } catch {
    return {};
  }
}

function getStoredEventName(source, eventId) {
  const normalizedSource = normalizeSource(source);
  const normalizedId = String(eventId || "").trim();
  if (!normalizedId) {
    return "";
  }

  const eventNames = getEventNamesMap();
  if (eventNames[normalizedSource] && typeof eventNames[normalizedSource] === "object") {
    return String(eventNames[normalizedSource][normalizedId] || "");
  }

  if (normalizedSource === "wtt") {
    return String(eventNames[normalizedId] || "");
  }

  return "";
}

function getRelatedWttEventIds(eventId) {
  const normalizedId = String(eventId || "").trim();
  if (!normalizedId) {
    return [];
  }
  const ids = new Set([normalizedId]);
  Object.entries(WTT_EVENT_ID_ALIASES).forEach(([aliasId, canonicalId]) => {
    if (aliasId === normalizedId || canonicalId === normalizedId) {
      ids.add(aliasId);
      ids.add(canonicalId);
    }
  });
  return [...ids];
}

function getStoredWttIndexedName(eventId) {
  for (const candidateId of getRelatedWttEventIds(eventId)) {
    const searchEntry = readWttSearchIndex()[candidateId];
    if (searchEntry?.eventName) {
      return String(searchEntry.eventName);
    }
    const dateEntry = readWttDateIndex(WTT_DATE_INDEX_PATH)[candidateId];
    if (dateEntry?.eventName || dateEntry?.title) {
      return String(dateEntry.eventName || dateEntry.title);
    }
  }
  return "";
}

function shouldPreferStoredWttEventName(eventId, indexedName = "") {
  const normalizedId = String(eventId || "").trim();
  if (!/^(?:TTE)?\d+$/i.test(normalizedId) || !String(indexedName || "").trim()) {
    return false;
  }

  // Historical ITTF/Bornan numeric IDs can collide with newer WTT event-name API IDs.
  // If we already have an indexed name for old IDs, it is more reliable than GetEventName.
  return /^TTE/i.test(normalizedId) || Number(normalizedId) < 3000;
}

function isWttTeamEventName(eventName) {
  const name = String(eventName || "").trim().toLowerCase();
  if (!name) {
    return false;
  }
  return /\bteam\b/.test(name);
}

function isWttHostedEventName(eventName) {
  const name = String(eventName || "").trim().toLowerCase();
  if (!name) {
    return false;
  }
  return /\bwtt\b/.test(name) || /world team table tennis championships finals/.test(name);
}

function isIttfResultsPreferredEventName(eventName) {
  const name = String(eventName || "").trim().toLowerCase();
  if (!name || isWttHostedEventName(name)) {
    return false;
  }
  return (
    /\bittf\b/.test(name) ||
    /\bworld table tennis championships\b/.test(name) ||
    /\bworld para\b/.test(name) ||
    /special event qualifier/.test(name) ||
    /youth championships?/.test(name) ||
    /youth cup/.test(name) ||
    /para (future|open|event)/.test(name)
  );
}

function getEventUrl(source, eventId) {
  const normalizedSource = normalizeSource(source);
  const normalizedId = String(eventId || "").trim();
  if (!normalizedId) {
    return "";
  }

  if (normalizedSource === "wtt") {
    return `https://www.worldtabletennis.com/eventInfo?eventId=${encodeURIComponent(normalizedId)}`;
  }

  if (normalizedSource === "zennihon") {
    return `https://www.japantabletennis.com/AJ/result${encodeURIComponent(normalizedId)}/`;
  }

  return "";
}

function resolveEventId(source, eventId) {
  const normalizedSource = normalizeSource(source);
  const normalizedId = String(eventId || "").trim();
  if (!normalizedId) {
    return "";
  }
  if (normalizedSource === "wtt" && WTT_EVENT_ID_ALIASES[normalizedId]) {
    return WTT_EVENT_ID_ALIASES[normalizedId];
  }
  return normalizedId;
}

function getWttEventUrl(eventId, sourceHint = "", eventName = "") {
  const normalizedId = String(eventId || "").trim();
  if (!normalizedId) {
    return "";
  }
  if (/^TTE\d+$/i.test(normalizedId)) {
    return `https://results.ittf.com/ittf-web-results/html/${encodeURIComponent(normalizedId)}/results.html#/results`;
  }
  if (WTT_EVENT_PUBLIC_URLS[normalizedId]) {
    return WTT_EVENT_PUBLIC_URLS[normalizedId];
  }
  const resolvedName = String(eventName || "").trim() || getStoredWttIndexedName(normalizedId);
  if (/^\d+$/.test(normalizedId) && Number(normalizedId) < 3000 && !isWttHostedEventName(resolvedName)) {
    return `https://results.ittf.com/ittf-web-results/html/${encodeURIComponent(normalizedId)}/results.html#/results`;
  }
  const sourceText = String(sourceHint || "").trim().toLowerCase();
  if (
    (
      ["bornan", "ittf", "ittf_results", "ittf-results"].includes(sourceText) ||
      isIttfResultsPreferredEventName(resolvedName)
    ) &&
    !isWttHostedEventName(resolvedName)
  ) {
    return `https://results.ittf.com/ittf-web-results/html/TTE${encodeURIComponent(normalizedId)}/results.html#/results`;
  }
  if (isWttTeamEventName(resolvedName)) {
    return `https://www.worldtabletennis.com/teamseventInfo?eventId=${encodeURIComponent(normalizedId)}`;
  }
  return getEventUrl("wtt", normalizedId);
}

function readWttArchiveIndex() {
  try {
    if (!fs.existsSync(WTT_ARCHIVE_INDEX_PATH)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(WTT_ARCHIVE_INDEX_PATH, "utf8"));
  } catch {
    return {};
  }
}

function readWttSearchIndex() {
  try {
    if (!fs.existsSync(WTT_SEARCH_INDEX_PATH)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(WTT_SEARCH_INDEX_PATH, "utf8"));
  } catch {
    return {};
  }
}

function readBackfill5000Status() {
  try {
    if (!fs.existsSync(BACKFILL_5000_STATUS_PATH)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(BACKFILL_5000_STATUS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeBackfill5000Status(status) {
  ensureDir(path.dirname(BACKFILL_5000_STATUS_PATH));
  writePrettyJson(BACKFILL_5000_STATUS_PATH, {
    ...status,
    statusPath: BACKFILL_5000_STATUS_PATH,
    updatedAt: new Date().toISOString(),
  });
}

function getBackfill5000StoredEventIds() {
  const ids = new Set();
  if (!fs.existsSync(WTT_ARCHIVE_DIR)) {
    return ids;
  }
  fs.readdirSync(WTT_ARCHIVE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+\.json$/i.test(entry.name))
    .forEach((entry) => ids.add(entry.name.replace(/\.json$/i, "")));
  return ids;
}

function getBackfill5000CandidateEvents() {
  const searchIndex = readWttSearchIndex();
  const storedIds = getBackfill5000StoredEventIds();
  return Object.keys(searchIndex)
    .filter((eventId) => /^5\d\d\d$/.test(eventId))
    .sort((left, right) => Number(left) - Number(right))
    .map((eventId) => {
      const aliasId = WTT_EVENT_ID_ALIASES[eventId] || "";
      const entry = searchIndex[eventId] || {};
      const storedAs = storedIds.has(eventId)
        ? eventId
        : aliasId && storedIds.has(aliasId)
          ? aliasId
          : "";
      return {
        eventId,
        eventName: String(entry.eventName || entry.title || ""),
        startDate: entry.startDate || null,
        endDate: entry.endDate || null,
        storedAs,
      };
    });
}

function buildBackfill5000Plan(options = {}) {
  const retryFailed = String(options.retryFailed || "0") === "1";
  const onlyFailed = String(options.onlyFailed || "0") === "1";
  const previous = readBackfill5000Status();
  const failedIds = new Set(
    Array.isArray(previous?.failed)
      ? previous.failed.map((item) => String(item.eventId || "")).filter(Boolean)
      : [],
  );
  const blockedIds = retryFailed || onlyFailed
    ? new Set()
    : new Set([
      ...(Array.isArray(previous?.failed) ? previous.failed.map((item) => String(item.eventId || "")) : []),
      ...(Array.isArray(previous?.empty) ? previous.empty.map((item) => String(item.eventId || "")) : []),
    ].filter(Boolean));
  const candidates = getBackfill5000CandidateEvents();
  const missing = candidates.filter((item) => !item.storedAs);
  const pending = missing.filter((item) => {
    if (onlyFailed && !failedIds.has(item.eventId)) {
      return false;
    }
    return !blockedIds.has(item.eventId);
  });
  return {
    candidateCount: candidates.length,
    coveredCount: candidates.length - missing.length,
    missingCount: missing.length,
    pending,
  };
}

function getBackfill5000StatusPayload() {
  const storedStatus = readBackfill5000Status();
  const plan = buildBackfill5000Plan();
  return {
    ok: true,
    running: Boolean(backfill5000Promise),
    status: storedStatus || {
      state: "idle",
      statusPath: BACKFILL_5000_STATUS_PATH,
    },
    plan: {
      candidateCount: plan.candidateCount,
      coveredCount: plan.coveredCount,
      missingCount: plan.missingCount,
      pendingCount: plan.pending.length,
      next: plan.pending.slice(0, 20),
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBackfill5000Job(options = {}) {
  const maxEvents = Math.max(1, Math.min(Number(options.maxEvents) || 20, 50));
  const requestedDelayMs = Number(options.delayMs);
  const delayMs = Math.max(0, Math.min(Number.isFinite(requestedDelayMs) ? requestedDelayMs : 1000, 10000));
  const retryFailed = String(options.retryFailed || "0") === "1";
  const onlyFailed = String(options.onlyFailed || "0") === "1";
  const previous = readBackfill5000Status();
  const carriedFailed = !retryFailed && !onlyFailed && Array.isArray(previous?.failed) ? previous.failed : [];
  const carriedEmpty = !retryFailed && Array.isArray(previous?.empty) ? previous.empty : [];
  const startedAt = new Date().toISOString();
  const plan = buildBackfill5000Plan({ retryFailed, onlyFailed });
  const batch = plan.pending.slice(0, maxEvents);
  const status = {
    state: "running",
    startedAt,
    finishedAt: null,
    maxEvents,
    delayMs,
    retryFailed,
    onlyFailed,
    candidateCount: plan.candidateCount,
    coveredCountAtStart: plan.coveredCount,
    missingCountAtStart: plan.missingCount,
    batchCount: batch.length,
    currentEventId: null,
    processed: [],
    succeeded: [],
    empty: carriedEmpty,
    failed: carriedFailed,
  };
  writeBackfill5000Status(status);

  for (const item of batch) {
    status.currentEventId = item.eventId;
    status.processed.push(item.eventId);
    writeBackfill5000Status(status);
    try {
      const payload = await fetchOfficialResultsCached("wtt", item.eventId, 1200, CACHE_DIR, true, {
        wttArchiveDir: WTT_ARCHIVE_DIR,
        wttSlimArchiveDir: WTT_SLIM_ARCHIVE_DIR,
        bundledWttArchiveDir: BUNDLED_WTT_ARCHIVE_DIR,
        bundledWttSlimArchiveDir: BUNDLED_WTT_SLIM_ARCHIVE_DIR,
        wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
        wttDateIndexPath: WTT_DATE_INDEX_PATH,
        allowBornanFallback: true,
      });
      const matchCount = Array.isArray(payload) ? payload.length : 0;
      if (matchCount > 0) {
        status.succeeded.push({
          eventId: item.eventId,
          eventName: item.eventName,
          matchCount,
        });
        clearProcessedMatchesCache();
        clearPlayerRecordResultCache();
        clearHeadToHeadResultCache();
        clearPlayerRecordArchiveParseCache();
      } else {
        status.empty.push({
          eventId: item.eventId,
          eventName: item.eventName,
          reason: "no_matches",
        });
      }
    } catch (error) {
      status.failed.push({
        eventId: item.eventId,
        eventName: item.eventName,
        error: createFriendlyErrorMessage(error),
      });
    }
    writeBackfill5000Status(status);
    if (delayMs > 0) {
      await wait(delayMs);
    }
  }

  const nextPlan = buildBackfill5000Plan({ retryFailed: false });
  status.state = "complete";
  status.finishedAt = new Date().toISOString();
  status.currentEventId = null;
  status.coveredCountAtFinish = nextPlan.coveredCount;
  status.missingCountAtFinish = nextPlan.missingCount;
  status.pendingCountAtFinish = nextPlan.pending.length;
  writeBackfill5000Status(status);
}

function getMergedWttSearchEntry(eventId, entry, dateIndex, archiveIndex) {
  const dateEntry = dateIndex[String(eventId || "").trim()] || {};
  const archiveEntry = archiveIndex[String(eventId || "").trim()] || {};
  const merged = {
    ...(archiveEntry || {}),
    ...(entry || {}),
    ...(dateEntry || {}),
  };
  if (archiveEntry?.source && archiveEntry.source !== "calendar") {
    merged.source = archiveEntry.source;
  } else if (entry?.source) {
    merged.source = entry.source;
  } else if (archiveEntry?.source) {
    merged.source = archiveEntry.source;
  }
  return merged;
}

function toDateOnly(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function normalizeWttCalendarEntry(row) {
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

async function fetchWttCalendarDateEntry(eventId) {
  const response = await fetch(WTT_CALENDAR_API_URL, {
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
    throw new Error(`Failed to fetch WTT calendar: ${response.status} ${response.statusText}`);
  }

  const payload = await readJsonFromResponse(response, "WTT calendar API");
  const rows = Array.isArray(payload?.[0]?.rows) ? payload[0].rows : [];
  for (const row of rows) {
    const normalized = normalizeWttCalendarEntry(row);
    if (normalized?.event === String(eventId || "").trim()) {
      const current = readWttDateIndex(WTT_DATE_INDEX_PATH);
      current[normalized.event] = {
        ...(current[normalized.event] || {}),
        ...normalized,
      };
      writeWttDateIndex(WTT_DATE_INDEX_PATH, current);
      return current[normalized.event];
    }
  }

  return null;
}

async function getWttDateEntryWithFallback(eventId) {
  const normalizedId = String(eventId || "").trim();
  const current = readWttDateIndex(WTT_DATE_INDEX_PATH);
  if (current[normalizedId]?.startDate || current[normalizedId]?.endDate) {
    return current[normalizedId];
  }
  try {
    return await fetchWttCalendarDateEntry(normalizedId);
  } catch {
    return current[normalizedId] || null;
  }
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

function toComparableDate(value, endOfDay = false) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text === "0001-01-01") {
    return null;
  }
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const date = new Date(`${text}${suffix}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deriveLifecycleStatus(startDate, endDate, fallbackStatus = "unknown") {
  const now = new Date();
  const start = toComparableDate(startDate, false);
  const end = toComparableDate(endDate, true);

  if (start && start > now) {
    return "upcoming";
  }
  if (end && end < now) {
    return "finished";
  }
  if (start && end && start <= now && end >= now) {
    return "live";
  }
  return fallbackStatus;
}

function compareSearchEvents(left, right) {
  const leftStart = toComparableDate(left?.startDate, false);
  const rightStart = toComparableDate(right?.startDate, false);
  if (leftStart && rightStart && leftStart.getTime() !== rightStart.getTime()) {
    return leftStart - rightStart;
  }
  if (leftStart && !rightStart) {
    return -1;
  }
  if (!leftStart && rightStart) {
    return 1;
  }

  const leftEnd = toComparableDate(left?.endDate, true);
  const rightEnd = toComparableDate(right?.endDate, true);
  if (leftEnd && rightEnd && leftEnd.getTime() !== rightEnd.getTime()) {
    return leftEnd - rightEnd;
  }
  if (leftEnd && !rightEnd) {
    return -1;
  }
  if (!leftEnd && rightEnd) {
    return 1;
  }

  return String(left?.event || "").localeCompare(String(right?.event || ""), "en", { numeric: true });
}

function inferStatusFromEventNameYear(eventName, fallbackStatus = "unknown") {
  const text = String(eventName || "").trim();
  if (!text) {
    return fallbackStatus;
  }

  const years = Array.from(text.matchAll(/\b(20\d{2})\b/g))
    .map((match) => Number(match[1]))
    .filter((year) => Number.isInteger(year));
  if (years.length === 0) {
    return fallbackStatus === "live" ? "unknown" : fallbackStatus;
  }

  const eventYear = Math.max(...years);
  const currentYear = new Date().getUTCFullYear();
  if (eventYear < currentYear) {
    return "finished";
  }
  if (eventYear > currentYear) {
    return "upcoming";
  }
  return fallbackStatus === "live" ? "unknown" : fallbackStatus;
}

function resolveLifecycleStatus(startDate, endDate, fallbackStatus = "unknown", eventName = "") {
  const derived = deriveLifecycleStatus(startDate, endDate, fallbackStatus);
  if (String(startDate || "").trim() || String(endDate || "").trim()) {
    return derived;
  }
  return inferStatusFromEventNameYear(eventName, derived);
}

async function fetchEventMeta(eventId, source = "wtt") {
  const normalizedSource = normalizeSource(source);
  const normalizedId = resolveEventId(normalizedSource, eventId);
  const eventName = await fetchEventName(normalizedId, normalizedSource);
  let eventUrl = getEventUrl(normalizedSource, normalizedId);

  if (normalizedSource === "wtt") {
    try {
      const lifecycle = await getWttEventLifecycleMeta(normalizedId, {
        wttArchiveDir: WTT_ARCHIVE_DIR,
        wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
        wttDateIndexPath: WTT_DATE_INDEX_PATH,
      });
      const dateEntry = (!lifecycle?.startDate && !lifecycle?.endDate)
        ? await getWttDateEntryWithFallback(normalizedId)
        : null;
      const startDate = lifecycle?.startDate || dateEntry?.startDate || null;
      const endDate = lifecycle?.endDate || dateEntry?.endDate || null;
      return {
        source: normalizedSource,
        event: normalizedId,
        eventName: eventName || lifecycle?.title || "",
        eventUrl: getWttEventUrl(normalizedId, lifecycle?.source, eventName || lifecycle?.title || ""),
        startDate,
        endDate,
        dateLabel: formatDateRange(startDate, endDate),
        archived: Boolean(lifecycle?.archived),
        status: resolveLifecycleStatus(
          startDate,
          endDate,
          lifecycle?.isFinished ? "finished" : "unknown",
          eventName || lifecycle?.title || "",
        ),
      };
    } catch {
      return {
        source: normalizedSource,
        event: normalizedId,
        eventName,
        eventUrl,
        startDate: null,
        endDate: null,
        dateLabel: "",
        archived: false,
        status: "unknown",
      };
    }
  }

  return {
    source: normalizedSource,
    event: normalizedId,
    eventName,
    eventUrl,
    startDate: null,
    endDate: null,
    dateLabel: "",
    archived: false,
    status: "finished",
  };
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (/^\d+$/.test(token) ? String(Number(token)) : token))
    .join(" ")
    .trim();
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

function buildDateSearchValues(startDate, endDate, dateLabel) {
  const values = [startDate, endDate, dateLabel].filter(Boolean).map((value) => String(value));
  const addMonthParts = (year, month) => {
    const monthNum = String(Number(month));
    const monthPadded = String(month).padStart(2, "0");
    const shortYear = String(year).slice(-2);
    values.push(`${year}/${monthNum}`);
    values.push(`${year}-${monthNum}`);
    values.push(`${year} ${monthNum}`);
    values.push(`${year}${monthPadded}`);
    values.push(`${shortYear}/${monthNum}`);
    values.push(`${shortYear}-${monthNum}`);
    values.push(`${shortYear} ${monthNum}`);
    values.push(`${shortYear}${monthPadded}`);
  };
  const addDateParts = (rawDate) => {
    const match = String(rawDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return;
    }
    const [, year, month, day] = match;
    const monthNum = String(Number(month));
    const dayNum = String(Number(day));
    const shortYear = String(year).slice(-2);
    addMonthParts(year, month);
    values.push(`${year}/${monthNum}/${dayNum}`);
    values.push(`${year}-${monthNum}-${dayNum}`);
    values.push(`${year} ${monthNum} ${dayNum}`);
    values.push(`${year}${month}${day}`);
    values.push(`${shortYear}${month}${day}`);
  };

  addDateParts(startDate);
  addDateParts(endDate);

  const startMatch = String(startDate || "").match(/^(\d{4})-(\d{2})-\d{2}$/);
  const endMatch = String(endDate || "").match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (startMatch && endMatch) {
    const startMonthIndex = Number(startMatch[1]) * 12 + Number(startMatch[2]) - 1;
    const endMonthIndex = Number(endMatch[1]) * 12 + Number(endMatch[2]) - 1;
    const startYear = Number(startMatch[1]);
    const endYear = Number(endMatch[1]);
    const monthSpan = endMonthIndex - startMonthIndex;
    if (
      startYear >= 1900 &&
      endYear >= 1900 &&
      Number.isFinite(startMonthIndex) &&
      Number.isFinite(endMonthIndex) &&
      monthSpan > 1 &&
      monthSpan <= 24
    ) {
      for (let index = startMonthIndex + 1; index < endMonthIndex; index += 1) {
        const year = Math.floor(index / 12);
        const month = String((index % 12) + 1).padStart(2, "0");
        addMonthParts(String(year), month);
      }
    }
  }

  return [...new Set(values)];
}

function isDateLikeSearchQuery(rawQuery, normalizedQuery) {
  const raw = String(rawQuery || "").trim();
  const normalized = String(normalizedQuery || "").trim();
  if (/^\d{4}\s*年\s*\d{1,2}\s*月?(?:\s*\d{1,2}\s*日?)?$/.test(raw)) {
    return true;
  }
  if (/^\d{2,4}\s*[\/-]\s*\d{1,2}(?:\s*[\/-]\s*\d{1,2})?$/.test(raw)) {
    return true;
  }
  if (/^\d{2,4}\s+\d{1,2}(?:\s+\d{1,2})?$/.test(normalized)) {
    return true;
  }
  return /^\d{4,8}$/.test(normalized);
}

function matchesSearchQuery(eventId, eventName, query, extraValues = []) {
  const rawQuery = String(query || "").trim();
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const normalizedEventId = String(eventId || "").trim().toLowerCase();
  const normalizedName = normalizeSearchText(eventName);
  const normalizedExtraValues = extraValues
    .map((value) => normalizeSearchText(value))
    .filter(Boolean);
  const normalizedExtras = normalizedExtraValues.join(" ");
  const isDateLikeQuery = isDateLikeSearchQuery(rawQuery, normalizedQuery);
  if (isDateLikeQuery) {
    return normalizedEventId === normalizedQuery || normalizedExtraValues.some((value) => value === normalizedQuery);
  }

  const haystack = `${normalizedEventId} ${normalizedName} ${normalizedExtras}`.trim();
  if (haystack.includes(normalizedQuery)) {
    return true;
  }

  const haystackTokens = new Set(haystack.split(/\s+/).filter(Boolean));
  const haystackTokenList = [...haystackTokens];
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const isDirectEventIdQuery = /^\d+$/.test(normalizedQuery);
  if (queryTokens.length === 0) {
    return true;
  }

  return queryTokens.every((token) => {
    if (isDirectEventIdQuery && /^\d+$/.test(token)) {
      return normalizedEventId.includes(token) || haystackTokens.has(token);
    }
    return normalizedEventId.includes(token) || haystackTokenList.some((value) => value.includes(token));
  });
}

function getSearchQueryScore(eventId, eventName, query, extraValues = []) {
  const rawQuery = String(query || "").trim();
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const normalizedEventId = String(eventId || "").trim().toLowerCase();
  const normalizedName = normalizeSearchText(eventName);
  const normalizedExtraValues = extraValues
    .map((value) => normalizeSearchText(value))
    .filter(Boolean);
  const isDateLikeQuery = isDateLikeSearchQuery(rawQuery, normalizedQuery);
  if (isDateLikeQuery) {
    if (normalizedEventId === normalizedQuery) return 0;
    if (normalizedExtraValues.some((value) => value === normalizedQuery)) return 1;
    return 99;
  }

  const haystack = `${normalizedEventId} ${normalizedName} ${normalizedExtraValues.join(" ")}`.trim();
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (normalizedEventId === normalizedQuery) return 0;
  if (/^\d+$/.test(normalizedQuery) && normalizedEventId.includes(normalizedQuery)) return 1;
  if (normalizedName === normalizedQuery) return 2;
  if (normalizedName.includes(normalizedQuery)) return 3;
  if (haystack.includes(normalizedQuery)) return 4;

  const haystackTokens = haystack.split(/\s+/).filter(Boolean);
  if (queryTokens.length > 0 && queryTokens.every((token) => haystackTokens.includes(token))) {
    return 5;
  }
  if (queryTokens.length > 0 && queryTokens.every((token) => haystackTokens.some((value) => value.includes(token)))) {
    return 6;
  }
  return 99;
}

function compareSearchEventsByRecency(left, right) {
  const leftStart = toComparableDate(left?.startDate, false);
  const rightStart = toComparableDate(right?.startDate, false);
  if (leftStart && rightStart && leftStart.getTime() !== rightStart.getTime()) {
    return rightStart - leftStart;
  }
  if (leftStart && !rightStart) {
    return -1;
  }
  if (!leftStart && rightStart) {
    return 1;
  }

  const leftEnd = toComparableDate(left?.endDate, true);
  const rightEnd = toComparableDate(right?.endDate, true);
  if (leftEnd && rightEnd && leftEnd.getTime() !== rightEnd.getTime()) {
    return rightEnd - leftEnd;
  }
  if (leftEnd && !rightEnd) {
    return -1;
  }
  if (!leftEnd && rightEnd) {
    return 1;
  }

  return String(right?.event || "").localeCompare(String(left?.event || ""), "en", { numeric: true });
}

function compareSearchEventsForQuery(left, right, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery || isDateLikeSearchQuery(query, normalizedQuery)) {
    return compareSearchEvents(left, right);
  }

  const leftScore = getSearchQueryScore(left.event, left.eventName, query, left.searchValues || []);
  const rightScore = getSearchQueryScore(right.event, right.eventName, query, right.searchValues || []);
  if (leftScore !== rightScore) {
    return leftScore - rightScore;
  }
  return compareSearchEventsByRecency(left, right);
}

function dedupeWttSearchEventsByResolvedId(events) {
  const byResolvedId = new Map();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const resolvedId = resolveEventId("wtt", event?.event);
    const key = resolvedId || String(event?.event || "");
    if (!key) {
      return;
    }
    const existing = byResolvedId.get(key);
    if (
      !existing ||
      String(event?.event || "") === key ||
      (!String(existing?.event || "").startsWith("TTE") && String(event?.event || "").startsWith("TTE"))
    ) {
      byResolvedId.set(key, event);
    }
  });
  return [...byResolvedId.values()];
}

function buildSearchableEvents(source, query) {
  const normalizedSource = normalizeSource(source);
  const eventNames = getEventNamesMap();
  const results = [];

  if (normalizedSource === "zennihon") {
    const zennihonEvents = eventNames.zennihon || {};
    Object.entries(zennihonEvents).forEach(([eventId, eventName]) => {
      if (matchesSearchQuery(eventId, eventName, query)) {
        results.push({
          source: normalizedSource,
          event: eventId,
          eventName,
          eventUrl: getEventUrl(normalizedSource, eventId),
          dateLabel: "",
          archived: true,
          status: "finished",
        });
      }
    });

    return results.sort((left, right) => Number(right.event) - Number(left.event));
  }

  const searchIndex = readWttSearchIndex();
  const dateIndex = readWttDateIndex(WTT_DATE_INDEX_PATH);
  const archiveIndex = readWttArchiveIndex();
  const indexedEventIds = new Set([
    ...Object.keys(archiveIndex || {}),
    ...Object.keys(searchIndex || {}),
    ...Object.keys(dateIndex || {}),
  ]);

  indexedEventIds.forEach((eventId) => {
    const mergedEntry = getMergedWttSearchEntry(
      eventId,
      searchIndex[eventId],
      dateIndex,
      archiveIndex,
    );
    const name = String(mergedEntry?.eventName || mergedEntry?.title || eventNames[eventId] || "");
    const dateLabel = formatDateRange(mergedEntry?.startDate, mergedEntry?.endDate);
    const searchValues = buildDateSearchValues(mergedEntry?.startDate, mergedEntry?.endDate, dateLabel);
    if (!shouldDisplayWttSearchEntry(name)) {
      return;
    }
    if (
      matchesSearchQuery(eventId, name, query, searchValues)
    ) {
      results.push({
        source: normalizedSource,
        event: eventId,
        eventName: name,
        eventUrl: getWttEventUrl(eventId, mergedEntry?.source, name),
        startDate: mergedEntry?.startDate || null,
        endDate: mergedEntry?.endDate || null,
        dateLabel,
        archived: Boolean(mergedEntry?.archived),
        status: resolveLifecycleStatus(
          mergedEntry?.startDate,
          mergedEntry?.endDate,
          mergedEntry?.status || "unknown",
          name,
        ),
        series: mergedEntry?.series || classifyWttSeries(name),
        governingBody: /^TTE\d+$/i.test(eventId) || mergedEntry?.source === "ittf"
          ? "ITTF"
          : classifyWttGoverningBody(name),
        searchValues,
      });
    }
  });

  return dedupeWttSearchEventsByResolvedId(
    results.sort((left, right) => compareSearchEventsForQuery(left, right, query)),
  )
    .slice(0, 50)
    .map(({ searchValues, ...event }) => event);
}

function classifyWttSeries(eventName) {
  const text = String(eventName || "").toLowerCase();
  if (!text) {
    return "";
  }
  if (text.includes("world table tennis championships finals") || text.includes("world team table tennis championships finals")) {
    return "World Championships";
  }
  if (text.includes("youth")) {
    return "Youth";
  }
  if (text.includes("smash")) {
    return "Smash";
  }
  if (/\bchampions\b/.test(text)) {
    return "Champions";
  }
  if (text.includes("star contender")) {
    return "Star Contender";
  }
  if (text.includes("contender")) {
    return "Contender";
  }
  if (text.includes("feeder")) {
    return "Feeder";
  }
  if (text.includes("finals")) {
    return "Finals";
  }
  return "Other";
}

function classifyWttGoverningBody(eventName) {
  const text = String(eventName || "").toLowerCase();
  if (!text) {
    return "WTT";
  }
  if (
    text.includes("ittf")
    || text.includes("para")
    || text.includes("championships")
    || text.includes("world table tennis championships finals")
    || text.includes("world team table tennis championships finals")
    || text.includes("world youth championships")
    || text.includes("pan american youth championships")
    || text.includes("international open")
    || text.includes("africa cup")
  ) {
    return "ITTF";
  }
  return "WTT";
}

function shouldDisplayWttSearchEntry(eventName) {
  const text = String(eventName || "").trim();
  if (!text) {
    return false;
  }
  return !/\btest\b|\bsimulation\b/i.test(text);
}

function inferFinishedFromPayload(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    return false;
  }

  const categoryToHasOfficialFinal = new Map();
  payload.forEach((match) => {
    const categoryName = String(match?.categoryName || match?.subEventType || "").trim();
    if (!categoryName) {
      return;
    }
    if (!categoryToHasOfficialFinal.has(categoryName)) {
      categoryToHasOfficialFinal.set(categoryName, false);
    }
    const roundKey = String(match?.roundKey || "").trim().toLowerCase();
    const roundLabel = String(match?.roundLabel || "").trim().toLowerCase();
    const status = String(match?.resultStatus || "").trim().toUpperCase();
    if ((roundKey === "final" || roundLabel === "final") && status === "OFFICIAL") {
      categoryToHasOfficialFinal.set(categoryName, true);
    }
  });

  return categoryToHasOfficialFinal.size > 0 && Array.from(categoryToHasOfficialFinal.values()).every(Boolean);
}

async function discoverWttSearchEvent(eventId) {
  const normalizedId = String(eventId || "").trim();
  if (!/^\d+$/.test(normalizedId)) {
    return null;
  }

  const payload = await fetchOfficialResultsCached("wtt", normalizedId, 50, CACHE_DIR, false, {
    wttArchiveDir: WTT_ARCHIVE_DIR,
    wttSlimArchiveDir: WTT_SLIM_ARCHIVE_DIR,
    bundledWttArchiveDir: BUNDLED_WTT_ARCHIVE_DIR,
    bundledWttSlimArchiveDir: BUNDLED_WTT_SLIM_ARCHIVE_DIR,
    wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
    wttDateIndexPath: WTT_DATE_INDEX_PATH,
  });
  if (!Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  const meta = await fetchEventMeta(normalizedId, "wtt");
  const eventName = String(meta?.eventName || "").trim();
  if (!shouldDisplayWttSearchEntry(eventName)) {
    return null;
  }
  const inferredFinished = Boolean(meta?.status === "finished" || meta?.archived) || inferFinishedFromPayload(payload);
  return {
    source: "wtt",
    event: normalizedId,
    eventName,
    eventUrl: meta?.eventUrl || getWttEventUrl(normalizedId, "", eventName),
    startDate: meta?.startDate || null,
    endDate: meta?.endDate || null,
    dateLabel: meta?.dateLabel || "",
    archived: Boolean(meta?.archived),
    status: resolveLifecycleStatus(
      meta?.startDate,
      meta?.endDate,
      inferredFinished ? "finished" : (meta?.status || "unknown"),
      eventName,
    ),
    series: classifyWttSeries(eventName),
    governingBody: classifyWttGoverningBody(eventName),
  };
}

async function fetchZennihonEventName(eventId) {
  const normalizedId = String(eventId || "").trim();
  if (!normalizedId) {
    return "";
  }

  const response = await fetch(`https://www.japantabletennis.com/AJ/result${encodeURIComponent(normalizedId)}/`, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 (compatible; Codex/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch zennihon event name: ${response.status} ${response.statusText}`);
  }

  const html = new TextDecoder("euc-jp").decode(await response.arrayBuffer());
  const h3Match = html.match(/<h3>([\s\S]*?)<\/h3>/i);
  if (h3Match) {
    return String(h3Match[1])
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  return titleMatch ? String(titleMatch[1]).replace(/\s+/g, " ").trim() : "";
}

async function fetchEventName(eventId, source = "wtt") {
  const normalizedSource = normalizeSource(source);
  const normalizedId = resolveEventId(normalizedSource, eventId);
  if (!normalizedId) {
    return "";
  }

  const cacheKey = `${normalizedSource}:${normalizedId}`;
  if (eventNameCache.has(cacheKey)) {
    return eventNameCache.get(cacheKey);
  }

  const storedName = getStoredEventName(normalizedSource, normalizedId);
  const indexedName = normalizedSource === "wtt" ? getStoredWttIndexedName(normalizedId) : "";
  if (normalizedSource !== "wtt") {
    if (storedName) {
      setEventNameCache(cacheKey, storedName);
      return storedName;
    }
    const eventName = normalizedSource === "zennihon"
      ? await fetchZennihonEventName(normalizedId)
      : "";
    setEventNameCache(cacheKey, eventName);
    return eventName;
  }

  const localWttName = storedName || indexedName;
  if (shouldPreferStoredWttEventName(normalizedId, localWttName)) {
    setEventNameCache(cacheKey, localWttName);
    return localWttName;
  }

  try {
    const response = await fetch(`https://liveeventsapi.worldtabletennis.com/api/cms/GetEventName/${encodeURIComponent(normalizedId)}`, {
      headers: {
        accept: "application/json, text/plain, */*",
        referer: "https://www.worldtabletennis.com/",
        "user-agent": "Mozilla/5.0 (compatible; Codex/1.0)",
        secapimkey: EVENT_NAME_API_KEY,
      },
    });

    if (!response.ok) {
      const fallbackName = storedName || indexedName;
      if (fallbackName) {
        setEventNameCache(cacheKey, fallbackName);
        return fallbackName;
      }
      throw new Error(`Failed to fetch event name: ${response.status} ${response.statusText}`);
    }

    const payload = await readJsonFromResponse(response, "WTT event name API");
    const eventName = Array.isArray(payload)
      ? String(payload[0]?.eventName || "")
      : String(payload?.eventName || "") || storedName || indexedName;
    setEventNameCache(cacheKey, eventName);
    return eventName;
  } catch (error) {
    const fallbackName = storedName || indexedName;
    if (fallbackName) {
      setEventNameCache(cacheKey, fallbackName);
      return fallbackName;
    }
    throw new Error(`Failed to fetch event name: ${error?.message || error}`);
  }
}

function parseBoolean(value) {
  return value === "1" || value === "true";
}

function toOptionalNumber(value) {
  if (!value) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pickFormat(searchParams) {
  const format = String(searchParams.get("format") || "ja").toLowerCase();
  if (["ja", "en", "list", "json", "text"].includes(format)) {
    return format;
  }
  return "ja";
}

function buildOptions(searchParams) {
  const format = pickFormat(searchParams);
  const source = normalizeSource(searchParams.get("source") || "wtt");
  const refreshCache = parseBoolean(searchParams.get("refreshCache"));
  const rounds = searchParams.getAll("round").map((value) => String(value || "").trim()).filter(Boolean);

  return {
    source,
    event: resolveEventId(source, searchParams.get("event")),
    category: searchParams.get("category") || null,
    gender: searchParams.get("gender") || null,
    discipline: searchParams.get("discipline") || null,
    round: rounds.length > 1 ? rounds : rounds[0] || null,
    contains: searchParams.get("contains") || null,
    docCode: searchParams.get("docCode") || null,
    limit: toOptionalNumber(searchParams.get("limit")),
    take: toOptionalNumber(searchParams.get("take")) || undefined,
    pretty: !parseBoolean(searchParams.get("compact")),
    list: format === "list",
    json: format === "json",
    ja: format === "ja",
    en: format === "en",
    translations: TRANSLATIONS_PATH,
    rules: RULES_PATH,
    cacheDir: CACHE_DIR,
    zennihonArchiveDir: ZENNIHON_ARCHIVE_DIR,
    wttArchiveDir: WTT_ARCHIVE_DIR,
    wttSlimArchiveDir: WTT_SLIM_ARCHIVE_DIR,
    bundledWttArchiveDir: BUNDLED_WTT_ARCHIVE_DIR,
    bundledWttSlimArchiveDir: BUNDLED_WTT_SLIM_ARCHIVE_DIR,
    wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
    refreshCache,
    omitSetCounts: parseBoolean(searchParams.get("omitSetCounts")),
  };
}

function createFriendlyErrorMessage(error) {
  const message = String(error?.message || "Unknown error");
  if (
    message.includes("liveeventsapi.worldtabletennis.com") ||
    message.includes("worldtabletennis.com") ||
    message.includes("GetOfficialResult") ||
    message.includes("Failed to fetch event name")
  ) {
    return "WTT API への接続に失敗しました。少し待って再試行してください。";
  }
  if (
    message.includes("japantabletennis.com") ||
    message.includes("Failed to fetch zennihon event name")
  ) {
    return "全日本の記録サイトへの接続に失敗しました。少し待って再試行してください。";
  }
  if (message.includes("全日本アーカイブが見つかりません")) {
    return "全日本アーカイブがまだ作成されていません。管理側でアーカイブ生成が必要です。";
  }
  if (message.includes("results.ittf.com") || message.includes("ittf-web-results")) {
    return "ITTF Results への接続に失敗しました。少し待って再試行してください。";
  }
  if (message.includes("fetch failed")) {
    return "外部データの取得に失敗しました。少し待って再試行してください。";
  }
  if (message.includes("ECONNRESET") || message.includes("ETIMEDOUT")) {
    return "外部データの取得がタイムアウトしました。少し待って再試行してください。";
  }
  if (message.includes("Failed to fetch")) {
    return message;
  }
  if (message.includes("400 Bad Request")) {
    return "WTT API がこの条件を受け付けませんでした。eventId や取得時期を確認してください。";
  }
  if (message.includes("全日本ソースはまだ取得処理を実装していません")) {
    return message;
  }
  return message;
}

function handleAdminStorageStatus(request, response) {
  if (!requireAuthorization(request, response)) {
    return true;
  }
  try {
    const searchParams = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`).searchParams;
    sendJson(response, 200, buildStorageStatus({
      source: searchParams.get("source") || "wtt",
      event: searchParams.get("event") || "",
      limit: searchParams.get("limit") || "20",
    }));
  } catch (error) {
    sendJson(response, 500, { error: createFriendlyErrorMessage(error) });
  }
  return true;
}

function handleAdminSyncManifest(request, response) {
  if (!requireAuthorization(request, response)) {
    return true;
  }
  try {
    const searchParams = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`).searchParams;
    sendJson(response, 200, buildSyncManifest({
      includeZennihon: searchParams.get("includeZennihon") || "0",
      sha256: searchParams.get("sha256") || "1",
    }));
  } catch (error) {
    sendJson(response, 500, { error: createFriendlyErrorMessage(error) });
  }
  return true;
}

function handleAdminSyncBundledRecord(request, response) {
  if (!requireAuthorization(request, response)) {
    return true;
  }
  try {
    const searchParams = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`).searchParams;
    const result = syncBundledRecordToRuntime(
      searchParams.get("source") || "wtt",
      searchParams.get("event") || "",
    );
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: createFriendlyErrorMessage(error) });
  }
  return true;
}

function handleAdminBackfill5000Status(request, response) {
  if (!requireAuthorization(request, response)) {
    return true;
  }
  try {
    sendJson(response, 200, getBackfill5000StatusPayload());
  } catch (error) {
    sendJson(response, 500, { error: createFriendlyErrorMessage(error) });
  }
  return true;
}

function readWttCrawlStatus() {
  try {
    return JSON.parse(fs.readFileSync(WTT_CRAWL_STATUS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeWttCrawlStatus(status) {
  writeJsonFileAtomic(WTT_CRAWL_STATUS_PATH, {
    updatedAt: new Date().toISOString(),
    ...status,
  });
}

function getDefaultNightlyCrawlRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const formatMonth = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    from: formatMonth(from),
    to: formatMonth(to),
  };
}

function buildWttCrawlArgs(searchParams) {
  const defaults = getDefaultNightlyCrawlRange();
  const args = [
    "crawl_wtt_archives.js",
    "--from",
    searchParams.get("from") || process.env.WTT_NIGHTLY_CRAWL_FROM || defaults.from,
    "--to",
    searchParams.get("to") || process.env.WTT_NIGHTLY_CRAWL_TO || defaults.to,
    "--limit",
    searchParams.get("limit") || process.env.WTT_NIGHTLY_CRAWL_LIMIT || "20",
    "--delay-ms",
    searchParams.get("delayMs") || process.env.WTT_NIGHTLY_CRAWL_DELAY_MS || "2000",
    "--take",
    searchParams.get("take") || process.env.WTT_NIGHTLY_CRAWL_TAKE || "1200",
  ];

  if (parseBoolean(searchParams.get("force")) || process.env.WTT_NIGHTLY_CRAWL_FORCE === "1") {
    args.push("--force");
  }
  if (parseBoolean(searchParams.get("keepRaw")) || process.env.WTT_NIGHTLY_CRAWL_KEEP_RAW === "1") {
    args.push("--keep-raw");
  }
  if (parseBoolean(searchParams.get("skipH2hIndex")) || process.env.WTT_NIGHTLY_CRAWL_SKIP_H2H_INDEX === "1") {
    args.push("--skip-h2h-index");
  }
  return args;
}

function handleAdminWttCrawlStatus(request, response) {
  if (!requireAuthorization(request, response)) {
    return true;
  }
  sendJson(response, 200, {
    ok: true,
    running: Boolean(wttCrawlProcess),
    pid: wttCrawlProcess?.pid || null,
    status: readWttCrawlStatus(),
  });
  return true;
}

function handleAdminWttCrawlStart(request, response) {
  if (!requireAuthorization(request, response)) {
    return true;
  }

  if (wttCrawlProcess) {
    sendJson(response, 202, {
      ok: true,
      status: "running",
      pid: wttCrawlProcess.pid,
      previous: readWttCrawlStatus(),
    });
    return true;
  }

  const searchParams = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`).searchParams;
  const args = buildWttCrawlArgs(searchParams);
  const startedAt = new Date().toISOString();
  writeWttCrawlStatus({
    ok: true,
    status: "running",
    startedAt,
    finishedAt: null,
    pid: null,
    args,
    outputTail: "",
    errorTail: "",
  });

  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: {
      ...process.env,
      DATA_DIR,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  wttCrawlProcess = child;
  let outputTail = "";
  let errorTail = "";
  const appendTail = (current, chunk) => {
    const next = `${current}${String(chunk || "")}`;
    return next.length > 8000 ? next.slice(-8000) : next;
  };

  writeWttCrawlStatus({
    ok: true,
    status: "running",
    startedAt,
    finishedAt: null,
    pid: child.pid,
    args,
    outputTail,
    errorTail,
  });

  child.stdout.on("data", (chunk) => {
    outputTail = appendTail(outputTail, chunk);
  });
  child.stderr.on("data", (chunk) => {
    errorTail = appendTail(errorTail, chunk);
  });
  child.on("error", (error) => {
    errorTail = appendTail(errorTail, error?.stack || error?.message || error);
  });
  child.on("close", (code) => {
    const ok = code === 0;
    writeWttCrawlStatus({
      ok,
      status: ok ? "complete" : "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      pid: child.pid,
      exitCode: code,
      args,
      outputTail,
      errorTail,
    });
    wttCrawlProcess = null;
    clearProcessedMatchesCache();
    clearPlayerRecordResultCache();
    clearHeadToHeadResultCache();
    clearPlayerRecordArchiveParseCache();
  });

  sendJson(response, 202, {
    ok: true,
    status: "started",
    pid: child.pid,
    args,
    statusFile: WTT_CRAWL_STATUS_PATH,
  });
  return true;
}

function handleAdminBackfill5000Start(request, response) {
  if (!requireAuthorization(request, response)) {
    return true;
  }
  try {
    const searchParams = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`).searchParams;
    if (!backfill5000Promise) {
      const options = {
        maxEvents: searchParams.get("maxEvents") || searchParams.get("limit") || "20",
        delayMs: searchParams.get("delayMs") || "1000",
        retryFailed: searchParams.get("retryFailed") || "0",
        onlyFailed: searchParams.get("onlyFailed") || "0",
      };
      backfill5000Promise = runBackfill5000Job(options)
        .catch((error) => {
          const previous = readBackfill5000Status() || {};
          writeBackfill5000Status({
            ...previous,
            state: "failed",
            finishedAt: new Date().toISOString(),
            currentEventId: null,
            fatalError: createFriendlyErrorMessage(error),
          });
        })
        .finally(() => {
          backfill5000Promise = null;
        });
    }
    sendJson(response, 202, getBackfill5000StatusPayload());
  } catch (error) {
    sendJson(response, 500, { error: createFriendlyErrorMessage(error) });
  }
  return true;
}

function handleAdminExportData(request, response) {
  if (!requireAuthorization(request, response)) {
    return true;
  }

  const searchParams = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`).searchParams;
  const format = String(searchParams.get("format") || "tar.gz").toLowerCase();
  const includeZennihon = String(searchParams.get("includeZennihon") || "0") === "1";
  if (format !== "tar.gz") {
    sendJson(response, 400, { error: "Only tar.gz is supported" });
    return true;
  }

  const relativePaths = getExportRelativePaths(includeZennihon);
  if (!relativePaths.length) {
    sendJson(response, 404, { error: "No exportable files found" });
    return true;
  }

  response.writeHead(200, {
    "content-type": "application/gzip",
    "content-disposition": `attachment; filename="${createExportFilename()}"`,
    "cache-control": "no-store",
  });

  const tarProcess = spawn("tar", ["-czf", "-", "-C", DATA_DIR, ...relativePaths], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  tarProcess.stdout.pipe(response);
  tarProcess.stderr.on("data", (chunk) => {
    console.error(`[admin export-data] ${chunk.toString("utf8").trim()}`);
  });
  tarProcess.on("error", (error) => {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: createFriendlyErrorMessage(error) });
      return;
    }
    response.destroy(error);
  });
  tarProcess.on("close", (code) => {
    if (code !== 0 && !response.destroyed) {
      response.destroy(new Error(`tar exited with code ${code}`));
    }
  });
  return true;
}

function handleAdminBuildHeadToHeadIndex(request, response) {
  if (!requireAuthorization(request, response)) {
    return true;
  }

  if (headToHeadIndexBuildProcess) {
    sendJson(response, 202, {
      ok: true,
      status: "running",
      pid: headToHeadIndexBuildProcess.pid,
    });
    return true;
  }

  const child = spawn(process.execPath, [__filename, "--build-head-to-head-index"], {
    cwd: __dirname,
    env: process.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  headToHeadIndexBuildProcess = child;
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 4000) {
      stderr = stderr.slice(-4000);
    }
  });
  child.on("error", (error) => {
    console.error("[head-to-head-index] build spawn failed:", error?.message || error);
  });
  child.on("close", (code) => {
    if (code !== 0) {
      console.error("[head-to-head-index] build failed:", stderr.trim() || `exit ${code}`);
      writeHeadToHeadIndexStatus({
        ok: false,
        status: "failed",
        exitCode: code,
        error: stderr.trim() || `exit ${code}`,
      });
    }
    headToHeadIndexBuildProcess = null;
    headToHeadPersistentIndexState.signature = null;
    headToHeadPersistentIndexState.currentSignature = null;
    headToHeadPersistentIndexState.generatedAt = null;
    headToHeadPersistentIndexState.stale = false;
    headToHeadPersistentIndexState.eventIds = [];
    headToHeadPersistentIndexState.index = null;
  });

  sendJson(response, 202, {
    ok: true,
    status: "started",
    pid: child.pid,
    manifest: HEAD_TO_HEAD_INDEX_MANIFEST_PATH,
    players: HEAD_TO_HEAD_PLAYER_INDEX_PATH,
    pairShards: HEAD_TO_HEAD_PAIR_SHARDS_DIR,
  });
  return true;
}

function handleAdminHeadToHeadIndexStatus(request, response) {
  if (!requireAuthorization(request, response)) {
    return true;
  }

  let status = null;
  try {
    status = JSON.parse(fs.readFileSync(HEAD_TO_HEAD_INDEX_STATUS_PATH, "utf8"));
  } catch {
    status = null;
  }

  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(HEAD_TO_HEAD_INDEX_MANIFEST_PATH, "utf8"));
  } catch {
    manifest = null;
  }

  sendJson(response, 200, {
    ok: true,
    running: Boolean(headToHeadIndexBuildProcess),
    pid: headToHeadIndexBuildProcess?.pid || null,
    status,
    manifest,
  });
  return true;
}

function summarizeRounds(matches) {
  return [...new Set(matches.map((match) => match.roundLabel).filter(Boolean))];
}

function getRoundOptionSortValue(match, context) {
  const knockoutRoundMatch = String(match.roundKey || "").match(/^knockout_round_(\d+)$/);
  if (knockoutRoundMatch) {
    return Number(knockoutRoundMatch[1]);
  }

  const groupMatch = String(match.roundLabel || "").match(/^Group\s+([A-Z0-9]+)$/i);
  if (groupMatch) {
    const groupValue = groupMatch[1].toUpperCase();
    if (/^\d+$/.test(groupValue)) {
      return Number(groupValue);
    }
    return groupValue.charCodeAt(0) - 64;
  }

  const qualifyingMatch = String(match.roundKey || "").match(/^qualifying_round_(\d+)$/);
  if (qualifyingMatch) {
    return 90 + Number(qualifyingMatch[1]);
  }

  if (match.roundKey === "qualification_elimination_round") {
    return 99;
  }

  if (match.roundKey === "round_2" || /^Round\s+2$/i.test(String(match.roundLabel || ""))) {
    return 100;
  }

  const knockoutLabel = context?.knockoutRoundNumbers?.[match.roundKey] || "";
  const knockoutMatch = knockoutLabel.match(/^(\d+)回戦$/);
  if (knockoutMatch) {
    return 100 + Number(knockoutMatch[1]);
  }

  if (match.roundKey === "quarterfinal") {
    return 103;
  }
  if (match.roundKey === "semifinal") {
    return 104;
  }
  if (match.roundKey === "final") {
    return 105;
  }

  return 999;
}

function getRoundContextKey(match) {
  return [
    match?.source || "",
    match?.categoryName || "",
    match?.gender || "",
    match?.discipline || "",
  ].join("\u0000");
}

function buildRoundContextsByCategory(matches) {
  const grouped = new Map();
  for (const match of matches) {
    const key = getRoundContextKey(match);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(match);
  }

  return new Map([...grouped.entries()].map(([key, categoryMatches]) => [
    key,
    buildJaRoundContext(categoryMatches),
  ]));
}

function getRoundOptionValue(match, context) {
  if (!["round_of_128", "round_of_64", "round_of_32", "round_of_16"].includes(match.roundKey)) {
    return String(match.roundLabel || "").trim();
  }
  const knockoutLabel = context?.knockoutRoundNumbers?.[match.roundKey] || "";
  const knockoutMatch = knockoutLabel.match(/^(\d+)回戦$/);
  if (knockoutMatch) {
    return `knockout_round_${knockoutMatch[1]}`;
  }
  return String(match.roundLabel || "").trim();
}

function summarizeRoundOptions(matches, rules, translations) {
  const contextsByCategory = buildRoundContextsByCategory(matches);
  const fallbackContext = buildJaRoundContext(matches);
  const seen = new Set();
  const options = [];

  for (const match of matches) {
    const value = String(match.roundLabel || "").trim();
    if (!value) {
      continue;
    }
    const contextKey = getRoundContextKey(match);
    const context = contextsByCategory.get(contextKey) || fallbackContext;
    const optionValue = getRoundOptionValue(match, context);
    if (seen.has(optionValue)) {
      continue;
    }
    seen.add(optionValue);
    const translatedLabel = String(
      translateRoundJa(match.roundKey, match.roundLabel, translations, rules, context) || match.roundLabel || value,
    );
    options.push({
      value: optionValue,
      label: match?.source === "zennihon"
        ? translatedLabel.replace(/^決勝トーナメント/, "")
        : translatedLabel,
      sortValue: getRoundOptionSortValue(match, context),
    });
  }

  options.sort((left, right) => {
    if (left.sortValue !== right.sortValue) {
      return left.sortValue - right.sortValue;
    }
    return left.label.localeCompare(right.label, "ja");
  });

  return options.map(({ value, label }) => ({ value, label }));
}

function formatCategoryLabel(categoryName, gender, discipline) {
  const text = String(categoryName || "").trim();
  const genericLabels = {
    "junior boys singles": "ジュニア男子",
    "junior girls singles": "ジュニア女子",
    "men teams": "男子団体",
    "mens teams": "男子団体",
    "women teams": "女子団体",
    "womens teams": "女子団体",
    "mixed teams": "混合団体",
    "mixed team": "混合団体",
    "men singles": "男子シングルス",
    "mens singles": "男子シングルス",
    "women singles": "女子シングルス",
    "womens singles": "女子シングルス",
    "men doubles": "男子ダブルス",
    "mens doubles": "男子ダブルス",
    "women doubles": "女子ダブルス",
    "womens doubles": "女子ダブルス",
    "mixed mixed": "混合ダブルス",
    "mixed doubles": "混合ダブルス",
  };

  if (!text) {
    const value = `${gender || ""} ${discipline || ""}`.trim();
    return genericLabels[value] || value;
  }

  const youthMatch = text.match(/^U\s*(\d+)\s+(Men|Women|Boys|Girls|Mixed)\s*'?s?\s+(Singles|Doubles|Teams)$/i);
  if (youthMatch) {
    const [, age, division, eventType] = youthMatch;
    const divisionJa =
      /^(men|boys)$/i.test(division) ? "男子" : /^(women|girls)$/i.test(division) ? "女子" : "混合";
    const eventTypeJa = /^singles$/i.test(eventType)
      ? "シングルス"
      : /^doubles$/i.test(eventType)
        ? "ダブルス"
        : "団体";
    return `U${age}${divisionJa}${eventTypeJa}`;
  }

  const normalizedText = text
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return genericLabels[normalizedText] || text;
}

function getCategorySortKey(category) {
  const value = String(category?.value || "").trim();
  const label = String(category?.label || "").trim();
  const paraSortKey = getParaCategorySortKey(value);
  if (paraSortKey) {
    return paraSortKey;
  }

  if (/^Junior Boys Singles$/i.test(value)) {
    return [0, 0, -18, 0, value.toLowerCase()];
  }
  if (/^Junior Girls Singles$/i.test(value)) {
    return [0, 0, -18, 1, value.toLowerCase()];
  }
  const youthMatch = value.match(/^U\s*(\d+)\s+(Men|Women|Boys|Girls|Mixed)\s*'?s?\s+(Singles|Doubles|Teams)$/i);

  if (youthMatch) {
    const [, ageRaw, division, eventType] = youthMatch;
    const age = Number(ageRaw);
    const disciplineOrder = /^singles$/i.test(eventType) ? 0 : /^teams$/i.test(eventType) ? 1 : 2;
    const divisionOrder = /^(men|boys)$/i.test(division) ? 0 : /^(women|girls)$/i.test(division) ? 1 : 2;
    return [0, disciplineOrder, -age, divisionOrder, value.toLowerCase()];
  }

  const seniorMatch = label.match(/^(男子|女子|混合)(シングルス|ダブルス|団体)$/);
  if (seniorMatch) {
    const [, divisionJa, eventTypeJa] = seniorMatch;
    const disciplineOrder = eventTypeJa === "シングルス" ? 0 : eventTypeJa === "団体" ? 1 : 2;
    const divisionOrder = divisionJa === "男子" ? 0 : divisionJa === "女子" ? 1 : 2;
    return [1, disciplineOrder, 0, divisionOrder, label];
  }

  return [2, 0, 0, 0, label.toLowerCase()];
}

function getParaCategorySortKey(value) {
  const text = String(value || "")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const match = text.match(/^(Men|Women|Mixed)\s+(Singles|Doubles)\s+Class(?:es)?\s+([A-Z]*)(\d+)(?:-(\d+))?$/i);
  if (!match) {
    return null;
  }

  const [, divisionRaw, eventTypeRaw, classPrefixRaw, classStartRaw, classEndRaw] = match;
  const eventType = eventTypeRaw.toLowerCase();
  const division = divisionRaw.toLowerCase();
  const classPrefix = classPrefixRaw.toUpperCase();
  const classStart = Number(classStartRaw);
  const classEnd = Number(classEndRaw || classStartRaw);
  const disciplineOrder = eventType === "singles" ? 0 : division === "mixed" ? 2 : 1;
  const divisionOrder = division === "men" ? 0 : division === "women" ? 1 : 2;

  return [
    1,
    disciplineOrder,
    divisionOrder,
    Number.isFinite(classStart) ? classStart : 999,
    Number.isFinite(classEnd) ? classEnd : 999,
    classPrefix,
    text.toLowerCase(),
  ];
}

function summarizeCategories(matches) {
  const seen = new Set();
  const categories = [];

  for (const match of matches) {
    const value = String(
      match.categoryName || `${match.gender || ""} ${match.discipline || ""}`.trim(),
    ).trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    categories.push({
      value,
      label: formatCategoryLabel(match.categoryName, match.gender, match.discipline),
    });
  }

  categories.sort((left, right) => {
    const leftKey = getCategorySortKey(left);
    const rightKey = getCategorySortKey(right);
    for (let index = 0; index < leftKey.length; index += 1) {
      if (leftKey[index] < rightKey[index]) {
        return -1;
      }
      if (leftKey[index] > rightKey[index]) {
        return 1;
      }
    }
    return 0;
  });

  return categories;
}

function normalizeCategoryLookupValue(value) {
  return String(value || "")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getCategorySummaryMatches(matches, options = {}) {
  const normalizedCategory = normalizeCategoryLookupValue(options.category);
  const normalizedGender = String(options.gender || "").trim().toLowerCase();
  const normalizedDiscipline = String(options.discipline || "").trim().toLowerCase();

  return (Array.isArray(matches) ? matches : []).filter((match) => {
    if (!match) {
      return false;
    }

    if (normalizedCategory) {
      const matchCategory = normalizeCategoryLookupValue(match.categoryName || `${match.gender || ""} ${match.discipline || ""}`.trim());
      if (matchCategory !== normalizedCategory) {
        return false;
      }
    }

    if (normalizedGender && String(match.gender || "").trim().toLowerCase() !== normalizedGender) {
      return false;
    }

    if (normalizedDiscipline && String(match.discipline || "").trim().toLowerCase() !== normalizedDiscipline) {
      return false;
    }

    return true;
  });
}

function buildProcessedMatchesCacheKey(options = {}) {
  return JSON.stringify({
    source: options.source || "wtt",
    event: options.event || "",
    take: options.take ?? null,
  });
}

function buildBaseProcessedMatchesOptions(options = {}) {
  return {
    source: options.source || "wtt",
    event: options.event || "",
    take: options.take,
    translations: options.translations || TRANSLATIONS_PATH,
    rules: options.rules || RULES_PATH,
    cacheDir: options.cacheDir || CACHE_DIR,
    zennihonArchiveDir: options.zennihonArchiveDir || ZENNIHON_ARCHIVE_DIR,
    wttArchiveDir: options.wttArchiveDir || WTT_ARCHIVE_DIR,
    wttSlimArchiveDir: options.wttSlimArchiveDir || WTT_SLIM_ARCHIVE_DIR,
    bundledWttArchiveDir: options.bundledWttArchiveDir || BUNDLED_WTT_ARCHIVE_DIR,
    bundledWttSlimArchiveDir: options.bundledWttSlimArchiveDir || BUNDLED_WTT_SLIM_ARCHIVE_DIR,
    wttArchiveIndexPath: options.wttArchiveIndexPath || WTT_ARCHIVE_INDEX_PATH,
    wttDateIndexPath: options.wttDateIndexPath || WTT_DATE_INDEX_PATH,
    wttRecordResolutionCachePath: options.wttRecordResolutionCachePath || path.join(CACHE_DIR, "wtt-record-source-resolutions.json"),
    refreshCache: Boolean(options.refreshCache),
  };
}

function compactProcessedMatchesBase(result) {
  return {
    args: result.args,
    normalized: result.normalized,
    translations: result.translations,
    rules: result.rules,
  };
}

function stripRawPayload(result) {
  return {
    ...result,
    payload: null,
  };
}

function pruneProcessedMatchesCache(now = Date.now()) {
  for (const [key, entry] of processedMatchesCache.entries()) {
    if (entry.expiresAt <= now) {
      processedMatchesCache.delete(key);
    }
  }
  const limit = toPositiveInteger(PROCESSED_MATCHES_CACHE_MAX_ENTRIES, 0);
  while (limit > 0 && processedMatchesCache.size > limit) {
    const oldestKey = processedMatchesCache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    processedMatchesCache.delete(oldestKey);
  }
}

function clearProcessedMatchesCache() {
  processedMatchesCache.clear();
}

function buildFilteredProcessedMatches(base, options = {}) {
  const args = createArgs({
    ...options,
    translations: options.translations || TRANSLATIONS_PATH,
    rules: options.rules || RULES_PATH,
    cacheDir: options.cacheDir || CACHE_DIR,
    zennihonArchiveDir: options.zennihonArchiveDir || ZENNIHON_ARCHIVE_DIR,
    wttArchiveDir: options.wttArchiveDir || WTT_ARCHIVE_DIR,
    wttSlimArchiveDir: options.wttSlimArchiveDir || WTT_SLIM_ARCHIVE_DIR,
    bundledWttArchiveDir: options.bundledWttArchiveDir || BUNDLED_WTT_ARCHIVE_DIR,
    bundledWttSlimArchiveDir: options.bundledWttSlimArchiveDir || BUNDLED_WTT_SLIM_ARCHIVE_DIR,
    wttArchiveIndexPath: options.wttArchiveIndexPath || WTT_ARCHIVE_INDEX_PATH,
  });
  args.source = normalizeSource(args.source);
  args.event = resolveEventId(args.source, args.event);

  let normalizedCategory = null;
  if (args.category) {
    normalizedCategory = normalizeCategory(args.category);
    if (!normalizedCategory.isExactCategory && !args.gender) {
      args.gender = normalizedCategory.gender;
    }
    if (!normalizedCategory.isExactCategory && !args.discipline) {
      args.discipline = normalizedCategory.discipline;
    }
  }

  const filtered = applyFilters(base.normalized, args, base.translations);
  const contextMatches = base.normalized.filter((match) => {
    if (normalizedCategory?.isExactCategory && normalizedCategory.categoryName) {
      return match.categoryName === normalizedCategory.categoryName;
    }
    if (args.gender && match.gender !== inferGender(args.gender)) {
      return false;
    }
    if (args.discipline && match.discipline !== normalizeDiscipline(args.discipline)) {
      return false;
    }
    return true;
  });

  return {
    args,
    payload: null,
    normalized: base.normalized,
    filtered,
    translations: base.translations,
    rules: base.rules,
    jaRoundContext: buildJaRoundContext(contextMatches),
  };
}

async function getProcessedMatchesBaseCached(options = {}) {
  const cacheTtlMs = Number(PROCESSED_MATCHES_CACHE_TTL_MS);
  const cacheMaxEntries = toPositiveInteger(PROCESSED_MATCHES_CACHE_MAX_ENTRIES, 0);
  const baseOptions = buildBaseProcessedMatchesOptions(options);

  if (baseOptions.refreshCache || cacheTtlMs <= 0 || cacheMaxEntries <= 0) {
    const result = await getProcessedMatches(baseOptions);
    return compactProcessedMatchesBase(result);
  }

  const now = Date.now();
  pruneProcessedMatchesCache(now);
  const cacheKey = buildProcessedMatchesCacheKey(baseOptions);
  const cached = processedMatchesCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = getProcessedMatches(baseOptions)
    .then(compactProcessedMatchesBase)
    .catch((error) => {
      processedMatchesCache.delete(cacheKey);
      throw error;
    });

  setBoundedMapValue(processedMatchesCache, cacheKey, {
    expiresAt: now + cacheTtlMs,
    promise,
  }, cacheMaxEntries);

  return promise;
}

async function getProcessedMatchesCached(options = {}) {
  if (options.refreshCache) {
    const result = await getProcessedMatches(options);
    return stripRawPayload(result);
  }

  const base = await getProcessedMatchesBaseCached(options);
  return buildFilteredProcessedMatches(base, options);
}

async function handleApi(requestUrl, response) {
  try {
    await syncTranslationsFromSharedSource();
    const options = buildOptions(requestUrl.searchParams);
    if (!options.event) {
      sendJson(response, 400, {
        error: "event is required",
      });
      return;
    }

    const result = await getProcessedMatchesCached(options);
    const output = renderOutput(result);
    const includeMatches = parseBoolean(requestUrl.searchParams.get("includeMatches"));
    const categoryMatches = getCategorySummaryMatches(result.normalized, {
      gender: options.gender,
      discipline: options.discipline,
    });
    const roundMatches = getCategorySummaryMatches(result.normalized, {
      category: options.category,
      gender: options.gender,
      discipline: options.discipline,
    });
    sendJson(response, 200, {
      query: {
        source: options.source,
        event: options.event,
        category: options.category,
        gender: options.gender,
        discipline: options.discipline,
        round: options.round,
        contains: options.contains,
        docCode: options.docCode,
        limit: options.limit,
        format: pickFormat(requestUrl.searchParams),
        refreshCache: options.refreshCache,
        omitSetCounts: options.omitSetCounts,
      },
      meta: {
        fetchedMatches: result.normalized.length,
        returnedMatches: result.filtered.length,
        availableRounds: summarizeRounds(result.normalized),
        categoryOptions: summarizeCategories(categoryMatches),
        roundOptions: summarizeRoundOptions(roundMatches, result.rules, result.translations),
      },
      output,
      ...(includeMatches ? { matches: result.filtered } : {}),
    });
    scheduleDerivedIndexesForFinishedWttEvent(options);
  } catch (error) {
    console.error("[handleApi]", error?.stack || error);
    sendJson(response, 500, {
      error: createFriendlyErrorMessage(error),
    });
  }
}

async function handleCategoriesApi(requestUrl, response) {
  try {
    await syncTranslationsFromSharedSource();
    const options = buildOptions(requestUrl.searchParams);
    if (!options.event) {
      sendJson(response, 400, { error: "event is required" });
      return;
    }

    const result = await getProcessedMatchesCached({
      source: options.source,
      event: options.event,
      gender: options.gender,
      discipline: options.discipline,
      take: options.take,
      translations: TRANSLATIONS_PATH,
      rules: RULES_PATH,
      cacheDir: CACHE_DIR,
      wttArchiveDir: WTT_ARCHIVE_DIR,
      wttSlimArchiveDir: WTT_SLIM_ARCHIVE_DIR,
      bundledWttArchiveDir: BUNDLED_WTT_ARCHIVE_DIR,
      bundledWttSlimArchiveDir: BUNDLED_WTT_SLIM_ARCHIVE_DIR,
      wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
      refreshCache: options.refreshCache,
    });

    sendJson(response, 200, {
      source: options.source,
      event: options.event,
      categories: summarizeCategories(result.filtered),
    });
    scheduleDerivedIndexesForFinishedWttEvent(options);
  } catch (error) {
    sendJson(response, 500, {
      error: createFriendlyErrorMessage(error),
    });
  }
}

async function handleRoundsApi(requestUrl, response) {
  try {
    await syncTranslationsFromSharedSource();
    const options = buildOptions(requestUrl.searchParams);
    if (!options.event) {
      sendJson(response, 400, { error: "event is required" });
      return;
    }

    const result = await getProcessedMatchesCached({
      source: options.source,
      event: options.event,
      category: options.category,
      gender: options.gender,
      discipline: options.discipline,
      take: options.take,
      translations: TRANSLATIONS_PATH,
      rules: RULES_PATH,
      cacheDir: CACHE_DIR,
      wttArchiveDir: WTT_ARCHIVE_DIR,
      wttSlimArchiveDir: WTT_SLIM_ARCHIVE_DIR,
      bundledWttArchiveDir: BUNDLED_WTT_ARCHIVE_DIR,
      bundledWttSlimArchiveDir: BUNDLED_WTT_SLIM_ARCHIVE_DIR,
      wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
      refreshCache: options.refreshCache,
    });

    sendJson(response, 200, {
      source: options.source,
      event: options.event,
      rounds: summarizeRoundOptions(result.filtered, result.rules, result.translations),
    });
    scheduleDerivedIndexesForFinishedWttEvent(options);
  } catch (error) {
    sendJson(response, 500, {
      error: createFriendlyErrorMessage(error),
    });
  }
}

async function handleEventSearchApi(requestUrl, response) {
  try {
    const searchParams = requestUrl.searchParams;
    const source = normalizeSource(searchParams.get("source") || "wtt");
    const query = String(searchParams.get("q") || "").trim();
    let results = buildSearchableEvents(source, query);

    if (source === "wtt" && /^\d+$/.test(query)) {
      results = await Promise.all(results.map(async (item) => {
        if (item.event !== query || item.dateLabel) {
          return item;
        }
        const meta = await fetchEventMeta(item.event, source);
        return {
          ...item,
          startDate: meta.startDate || item.startDate || null,
          endDate: meta.endDate || item.endDate || null,
          dateLabel: meta.dateLabel || item.dateLabel || "",
          status: meta.status || item.status,
        };
      }));
    }

    if (source === "wtt" && /^\d+$/.test(query) && !results.some((item) => item.event === query)) {
      const discovered = await discoverWttSearchEvent(query);
      if (discovered) {
        results = [discovered, ...results];
      }
    }

    sendJson(response, 200, {
      source,
      query,
      events: results.slice(0, 50),
    });
  } catch (error) {
    sendJson(response, 500, {
      error: createFriendlyErrorMessage(error),
    });
  }
}


function getCanonicalPlayerSearchNameKey(name) {
  const normalized = normalizePlayerSearchText(name);
  if (!normalized) {
    return "";
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }

  return tokens
    .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }))
    .join(" ");
}

function getPlayerSearchIdentityKey(name, translatedName = "") {
  const canonicalName = getCanonicalPlayerSearchNameKey(name);
  if (!canonicalName) {
    return "";
  }
  const normalizedTranslatedName = normalizePlayerSearchText(translatedName);
  return normalizedTranslatedName && normalizedTranslatedName !== "未登録"
    ? `name:${canonicalName}|translated:${normalizedTranslatedName}`
    : `name:${canonicalName}`;
}

function mergePlayerSearchResultCandidate(existing, candidate) {
  if (!existing) {
    return candidate;
  }

  const compared = comparePlayerSearchResult(candidate, existing);
  const winner = compared < 0 ? candidate : existing;
  const loser = winner === candidate ? existing : candidate;

  return {
    ...winner,
    aliases: Array.from(new Set([
      ...(Array.isArray(winner.aliases) ? winner.aliases : [winner.name].filter(Boolean)),
      ...(Array.isArray(loser.aliases) ? loser.aliases : [loser.name].filter(Boolean)),
    ].filter(Boolean))),
    registered: Boolean(winner.registered || loser.registered),
    translatedName: String(winner.translatedName || "").trim() && winner.translatedName !== "未登録"
      ? winner.translatedName
      : loser.translatedName,
  };
}

const playerSearchArchiveResultCache = new Map();
const PLAYER_SEARCH_ARCHIVE_RESULT_CACHE_MAX = Number(process.env.PLAYER_SEARCH_ARCHIVE_RESULT_CACHE_MAX || 20);
const PLAYER_SEARCH_ARCHIVE_RESULT_CACHE_TTL_MS = Number(process.env.PLAYER_SEARCH_ARCHIVE_RESULT_CACHE_TTL_MS || 60_000);
const PLAYER_SEARCH_ARCHIVE_INDEX_GREP_MAX_BYTES = Number(process.env.PLAYER_SEARCH_ARCHIVE_INDEX_GREP_MAX_BYTES || 64_000_000);
const playerSearchArchiveIndexState = {
  signature: "",
  builtAt: 0,
  generatedAt: null,
  names: [],
  building: null,
};

function setPlayerSearchArchiveResultCacheValue(key, value) {
  if (playerSearchArchiveResultCache.has(key)) {
    playerSearchArchiveResultCache.delete(key);
  }
  playerSearchArchiveResultCache.set(key, value);
  while (playerSearchArchiveResultCache.size > PLAYER_SEARCH_ARCHIVE_RESULT_CACHE_MAX) {
    const oldestKey = playerSearchArchiveResultCache.keys().next().value;
    playerSearchArchiveResultCache.delete(oldestKey);
  }
}

function unquoteJsonStringLiteral(value) {
  try {
    return JSON.parse(`"${String(value || "")}"`);
  } catch {
    return String(value || "").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
}

function splitArchivedPlayerSearchName(value) {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw || /^(?:tbd|bye|n\/a|null|undefined)$/i.test(raw)) {
    return [];
  }
  return raw
    .split(/\s*(?:\/|／|\+|&|\band\b)\s*/i)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part && !/^(?:tbd|bye|n\/a|null|undefined)$/i.test(part));
}

function extractPlayerSearchNamesFromArchiveText(text) {
  const names = new Set();
  const source = String(text || "");
  const pattern = /"(?:name|playerName|player_name|competitiorName|competitior_name|competitorName|competitor_name)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = pattern.exec(source))) {
    splitArchivedPlayerSearchName(unquoteJsonStringLiteral(match[1]))
      .forEach((name) => names.add(name));
  }
  return [...names];
}

function setPlayerSearchArchiveIndexState(indexState) {
  playerSearchArchiveIndexState.signature = indexState.signature;
  playerSearchArchiveIndexState.builtAt = indexState.builtAt || Date.now();
  playerSearchArchiveIndexState.generatedAt = indexState.generatedAt || null;
  playerSearchArchiveIndexState.names = Array.isArray(indexState.names) ? indexState.names : [];
  playerSearchArchiveIndexState.building = null;
}

function readPlayerSearchArchiveNameIndexFromDisk(signature) {
  try {
    const manifest = JSON.parse(fs.readFileSync(PLAYER_SEARCH_ARCHIVE_NAME_INDEX_MANIFEST_PATH, "utf8"));
    if (
      manifest?.version !== PLAYER_SEARCH_ARCHIVE_NAME_INDEX_VERSION ||
      manifest?.signature !== signature
    ) {
      return null;
    }

    const names = JSON.parse(fs.readFileSync(PLAYER_SEARCH_ARCHIVE_NAME_INDEX_PATH, "utf8"));
    if (!Array.isArray(names) || names.length === 0) {
      return null;
    }

    return {
      signature,
      builtAt: Date.parse(manifest.generatedAt || "") || Date.now(),
      generatedAt: manifest.generatedAt || null,
      names,
    };
  } catch {
    return null;
  }
}

function readAnyPlayerSearchArchiveNameIndexFromDisk(signature) {
  try {
    const manifest = JSON.parse(fs.readFileSync(PLAYER_SEARCH_ARCHIVE_NAME_INDEX_MANIFEST_PATH, "utf8"));
    if (manifest?.version !== PLAYER_SEARCH_ARCHIVE_NAME_INDEX_VERSION) {
      return null;
    }

    const names = JSON.parse(fs.readFileSync(PLAYER_SEARCH_ARCHIVE_NAME_INDEX_PATH, "utf8"));
    if (!Array.isArray(names) || names.length === 0) {
      return null;
    }

    return {
      signature,
      builtAt: Date.parse(manifest.generatedAt || "") || Date.now(),
      generatedAt: manifest.generatedAt || null,
      names,
      stale: manifest.signature !== signature,
    };
  } catch {
    return null;
  }
}

function writePlayerSearchArchiveNameIndexToDisk(indexState) {
  const names = Array.isArray(indexState?.names) ? indexState.names : [];
  const generatedAt = indexState?.generatedAt || new Date().toISOString();
  const manifest = {
    version: PLAYER_SEARCH_ARCHIVE_NAME_INDEX_VERSION,
    generatedAt,
    signature: indexState?.signature || "",
    nameCount: names.length,
  };

  try {
    writeJsonFileAtomic(PLAYER_SEARCH_ARCHIVE_NAME_INDEX_PATH, names);
    writeJsonFileAtomic(PLAYER_SEARCH_ARCHIVE_NAME_INDEX_MANIFEST_PATH, manifest);
  } catch (error) {
    console.warn("[player-search-archive-index] write failed:", error?.message || error);
  }
}

function getPlayerSearchTranslatedName(name, translations) {
  for (const candidate of getNameTranslationCandidates(name)) {
    const translatedName = String(translations.players?.[candidate] || "").trim();
    if (translatedName) {
      return translatedName;
    }
  }
  return "";
}

function addPlayerSearchResultCandidate(resultByPlayerKey, query, item) {
  const normalizedName = normalizePlayerSearchText(item?.name);
  if (!normalizedName) {
    return;
  }
  const translatedName = String(item?.translatedName || "").trim() || "未登録";
  const candidate = {
    name: String(item.name || "").trim(),
    translatedName,
    registered: Boolean(item.registered || (translatedName && translatedName !== "未登録")),
    orgCode: String(item.orgCode || "").trim().toUpperCase() || undefined,
    score: Number.isFinite(item.score) ? item.score : getPlayerSearchScore(query, item.name, translatedName),
  };
  const playerKey = getPlayerSearchIdentityKey(candidate.name, candidate.translatedName);
  if (!playerKey) {
    return;
  }
  const existing = resultByPlayerKey.get(playerKey);
  resultByPlayerKey.set(playerKey, mergePlayerSearchResultCandidate(existing, candidate));
}

function addPlayerSearchArchiveCandidate(resultByPlayerKey, query, name, translations) {
  const normalizedName = normalizePlayerSearchText(name);
  if (!normalizedName) {
    return;
  }
  const tokens = normalizePlayerSearchText(query).split(/\s+/).filter(Boolean);
  const translatedName = getPlayerSearchTranslatedName(name, translations);
  const haystack = normalizePlayerSearchText(`${name} ${translatedName}`);
  if (!tokens.every((token) => haystack.includes(token))) {
    return;
  }

  const item = {
    name: String(name || "").trim(),
    translatedName: translatedName || "未登録",
    registered: Boolean(translatedName),
    score: getPlayerSearchScore(query, name, translatedName),
  };
  addPlayerSearchResultCandidate(resultByPlayerKey, query, item);
}

function runGrepPlayerSearchFieldLines(files) {
  if (files.length === 0) {
    return Promise.resolve([]);
  }

  const lines = [];
  const chunkSize = 80;
  const runChunk = (chunk) => new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const grep = spawn("grep", [
      "-I",
      "-h",
      "-E",
      "--",
      "\"(name|playerName|player_name|competitiorName|competitior_name|competitorName|competitor_name)\"[[:space:]]*:",
      ...chunk.map((file) => file.parseFilePath || file.filePath),
    ]);

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    grep.stdout.on("data", (data) => {
      stdout += data.toString("utf8");
      if (Buffer.byteLength(stdout, "utf8") > PLAYER_SEARCH_ARCHIVE_INDEX_GREP_MAX_BYTES) {
        grep.kill("SIGTERM");
      }
    });

    grep.on("error", (error) => {
      if (error && error.code === "ENOENT") {
        finish(null);
        return;
      }
      finish([]);
    });

    grep.on("close", (code) => {
      if ((code === 0 || stdout) && stdout) {
        finish(stdout.split(/\n/).filter(Boolean));
        return;
      }
      finish([]);
    });
  });

  return (async () => {
    for (let index = 0; index < files.length; index += chunkSize) {
      const chunk = files.slice(index, index + chunkSize);
      const matchedLines = await runChunk(chunk);
      if (matchedLines === null) {
        return [];
      }
      lines.push(...matchedLines);
      if (Buffer.byteLength(lines.join("\n"), "utf8") > PLAYER_SEARCH_ARCHIVE_INDEX_GREP_MAX_BYTES) {
        break;
      }
    }
    return lines;
  })();
}

async function buildPlayerSearchArchiveNameIndex(snapshot, signature) {
  const lines = await runGrepPlayerSearchFieldLines(snapshot);
  const names = new Set();
  lines.forEach((line) => {
    extractPlayerSearchNamesFromArchiveText(line).forEach((name) => names.add(name));
  });
  const indexState = {
    signature,
    builtAt: Date.now(),
    generatedAt: new Date().toISOString(),
    names: [...names].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" })),
  };
  setPlayerSearchArchiveIndexState(indexState);
  writePlayerSearchArchiveNameIndexToDisk(indexState);
}

function getPlayerSearchArchiveIndexNames(snapshot, signature) {
  if (playerSearchArchiveIndexState.signature === signature && playerSearchArchiveIndexState.names.length > 0) {
    return playerSearchArchiveIndexState.names;
  }

  const diskIndex = readPlayerSearchArchiveNameIndexFromDisk(signature);
  if (diskIndex) {
    setPlayerSearchArchiveIndexState(diskIndex);
    return playerSearchArchiveIndexState.names;
  }

  const staleDiskIndex = readAnyPlayerSearchArchiveNameIndexFromDisk(signature);
  if (staleDiskIndex) {
    setPlayerSearchArchiveIndexState(staleDiskIndex);
    if (!playerSearchArchiveIndexState.building) {
      playerSearchArchiveIndexState.building = buildPlayerSearchArchiveNameIndex(snapshot, signature).catch(() => {
        playerSearchArchiveIndexState.building = null;
      });
    }
    return playerSearchArchiveIndexState.names;
  }

  if (!playerSearchArchiveIndexState.building) {
    playerSearchArchiveIndexState.building = buildPlayerSearchArchiveNameIndex(snapshot, signature).catch(() => {
      playerSearchArchiveIndexState.building = null;
    });
  }
  return null;
}

async function collectPlayerSearchArchiveCandidates(query, translations, limit) {
  const normalizedQuery = normalizePlayerSearchText(query);
  const queryTokens = normalizedQuery.split(/\s+/).filter((token) => token.length >= 2);
  if (queryTokens.length === 0) {
    return [];
  }

  const snapshot = getWttRecordFileSnapshot();
  const signature = getPlayerRecordCacheSignature(snapshot);
  const cacheKey = `${signature}::${normalizedQuery}`;
  const cached = playerSearchArchiveResultCache.get(cacheKey);
  if (cached && Date.now() - cached.builtAt < PLAYER_SEARCH_ARCHIVE_RESULT_CACHE_TTL_MS) {
    return cached.results;
  }

  const archiveNames = getPlayerSearchArchiveIndexNames(snapshot, signature);
  if (!archiveNames) {
    return [];
  }

  const resultByPlayerKey = new Map();

  for (const name of archiveNames) {
    addPlayerSearchArchiveCandidate(resultByPlayerKey, query, name, translations);
    if (resultByPlayerKey.size >= limit * 3) {
      break;
    }
  }

  const results = [...resultByPlayerKey.values()]
    .sort(comparePlayerSearchResult)
    .slice(0, limit);
  setPlayerSearchArchiveResultCacheValue(cacheKey, {
    builtAt: Date.now(),
    results,
  });
  return results;
}

async function handlePlayerSearchApi(requestUrl, response) {
  try {
    // Candidate search should use the local snapshot immediately. Shared dictionary
    // synchronization is kept in the background so a slow remote sync cannot delay typing.
    syncTranslationsFromSharedSource().catch((error) => {
      console.warn("[player-search] background translations sync failed:", error?.message || error);
    });
    const query = String(requestUrl.searchParams.get("q") || "").trim();
    const limit = Math.min(Math.max(Number(requestUrl.searchParams.get("limit") || 50) || 50, 1), 100);
    const translations = readTranslations(TRANSLATIONS_PATH);
    const players = translations.players && typeof translations.players === "object" && !Array.isArray(translations.players)
      ? translations.players
      : {};
    const tokens = normalizePlayerSearchText(query).split(/\s+/).filter(Boolean);
    const results = [];
    const resultByPlayerKey = new Map();

    if (tokens.length > 0) {
      Object.entries(players).forEach(([name, translatedName]) => {
        const haystack = normalizePlayerSearchText(`${name} ${translatedName}`);
        if (tokens.every((token) => haystack.includes(token))) {
          addPlayerSearchResultCandidate(resultByPlayerKey, query, {
            name,
            translatedName: String(translatedName || "").trim() || "未登録",
            registered: Boolean(String(translatedName || "").trim()),
            score: getPlayerSearchScore(query, name, translatedName),
          });
        }
      });
      Object.entries(translations.playerOrgOverrides || {}).forEach(([key, translatedName]) => {
        const [namePart, orgPart] = String(key || "").split("|");
        const name = String(namePart || "").trim();
        const orgCode = String(orgPart || "").trim().toUpperCase();
        const translated = String(translatedName || "").trim();
        if (!name || !translated) {
          return;
        }
        const haystack = normalizePlayerSearchText(`${name} ${translated} ${orgCode}`);
        if (!tokens.every((token) => haystack.includes(token))) {
          return;
        }
        addPlayerSearchResultCandidate(resultByPlayerKey, query, {
          name,
          translatedName: translated,
          registered: true,
          orgCode,
          score: getPlayerSearchScore(query, name, translated),
        });
      });
    }

    const archiveResults = tokens.length > 0
      ? await collectPlayerSearchArchiveCandidates(query, translations, limit)
      : [];
    archiveResults.forEach((item) => {
      addPlayerSearchResultCandidate(resultByPlayerKey, query, item);
    });

    results.push(...resultByPlayerKey.values());
    results.sort((left, right) =>
      comparePlayerSearchResult(left, right),
    );

    sendJson(response, 200, {
      query,
      results: results.slice(0, limit).map(({ score, ...item }) => item),
      fallback: query && results.length === 0
        ? {
            name: query,
            translatedName: "未登録",
            registered: false,
          }
        : null,
    });
  } catch (error) {
    sendJson(response, 500, {
      error: createFriendlyErrorMessage(error),
    });
  }
}

function getPlayerSearchScore(query, name, translatedName) {
  const normalizedQuery = normalizePlayerSearchText(query);
  const normalizedName = normalizePlayerSearchText(name);
  const normalizedTranslatedName = normalizePlayerSearchText(translatedName);
  if (!normalizedQuery) {
    return 99;
  }
  if (normalizedTranslatedName === normalizedQuery) {
    return 0;
  }
  if (normalizedName === normalizedQuery) {
    return 0;
  }
  if (normalizedTranslatedName.startsWith(normalizedQuery)) {
    return 1 + Math.min(normalizedTranslatedName.length, 50) / 1000;
  }
  if (normalizedName.startsWith(`${normalizedQuery} `) || normalizedName.startsWith(normalizedQuery)) {
    return 1;
  }
  if (normalizedName.split(/\s+/).some((token) => token.startsWith(normalizedQuery))) {
    return 2;
  }
  return 3;
}

function getPlayerNameDisplayPriority(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1 && /^[A-Z0-9.'-]+$/.test(parts[0])) {
    return 0;
  }
  if (parts.length > 1 && /^[A-Z0-9.'-]+$/.test(parts[parts.length - 1])) {
    return 1;
  }
  return 2;
}

function comparePlayerSearchResult(left, right) {
  return (
    (left.score || 0) - (right.score || 0) ||
    getPlayerNameDisplayPriority(left.name) - getPlayerNameDisplayPriority(right.name) ||
    String(left.name || "").localeCompare(String(right.name || ""), "en", {
      numeric: true,
      sensitivity: "base",
    })
  );
}

const playerRecordResultCache = new Map();
const legacyPlayerRecordShardCache = new Map();
const PLAYER_RECORD_RESULT_CACHE_MAX = 10;
const PLAYER_RECORD_RESULT_CACHE_TTL_MS = Number(process.env.PLAYER_RECORD_RESULT_CACHE_TTL_MS || 60_000);
const headToHeadResultCache = new Map();
const HEAD_TO_HEAD_RESULT_CACHE_MAX = Number(process.env.HEAD_TO_HEAD_RESULT_CACHE_MAX || 20);
const HEAD_TO_HEAD_RESULT_CACHE_TTL_MS = Number(process.env.HEAD_TO_HEAD_RESULT_CACHE_TTL_MS || 60_000);
const headToHeadPlayerKeyMatchCaches = new WeakMap();
const HEAD_TO_HEAD_LIVE_REFRESH_ENABLED = process.env.HEAD_TO_HEAD_LIVE_REFRESH_ENABLED === "1";
const HEAD_TO_HEAD_MAX_STALE_DELTA_EVENTS = Number(process.env.HEAD_TO_HEAD_MAX_STALE_DELTA_EVENTS || 24);
const HEAD_TO_HEAD_PAIR_INDEX_MIN_FREE_BYTES = Number(
  process.env.HEAD_TO_HEAD_PAIR_INDEX_MIN_FREE_BYTES || 256 * 1024 * 1024,
);
const playerRecordArchiveParseCache = new Map();
const PLAYER_RECORD_ARCHIVE_PARSE_CACHE_MAX = Number(process.env.PLAYER_RECORD_ARCHIVE_PARSE_CACHE_MAX || 0);
const LIVE_EVENT_REFRESH_GRACE_DAYS = Number(process.env.LIVE_EVENT_REFRESH_GRACE_DAYS || 2);
const AUTO_DERIVED_INDEX_DISABLED = process.env.AUTO_DERIVED_INDEX_DISABLED === "1";
const autoDerivedIndexBuilds = new Set();
const autoDerivedIndexLastScheduled = new Map();
let autoHeadToHeadIndexUpdatePromise = Promise.resolve();
const AUTO_DERIVED_INDEX_RESCHEDULE_TTL_MS = Number(process.env.AUTO_DERIVED_INDEX_RESCHEDULE_TTL_MS || 10 * 60_000);

function getPathStatToken(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return "missing";
  }
}

function getAvailableWttArchiveDir() {
  const hasJsonRecords = (dirPath) => {
    try {
      return fs.existsSync(dirPath) && fs.readdirSync(dirPath).some((fileName) => /^\d+\.json$/.test(fileName));
    } catch {
      return false;
    }
  };
  if (hasJsonRecords(WTT_ARCHIVE_DIR)) {
    return WTT_ARCHIVE_DIR;
  }
  if (hasJsonRecords(BUNDLED_WTT_ARCHIVE_DIR)) {
    return BUNDLED_WTT_ARCHIVE_DIR;
  }
  return WTT_ARCHIVE_DIR;
}

function getSlimWttRecordFile(originalFilePath, slimDir) {
  if (process.env.WTT_SLIM_RECORDS_DISABLED === "1") {
    return null;
  }
  if (!originalFilePath || !slimDir) {
    return null;
  }

  const slimFilePath = path.join(slimDir, path.basename(originalFilePath));
  try {
    const originalStat = fs.statSync(originalFilePath);
    const stat = fs.statSync(slimFilePath);
    if (!stat.isFile() || stat.size <= 0) {
      return null;
    }
    if (originalStat.isFile() && stat.mtimeMs < originalStat.mtimeMs) {
      return null;
    }
    return {
      filePath: slimFilePath,
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
    };
  } catch {
    if (slimDir !== BUNDLED_WTT_SLIM_ARCHIVE_DIR) {
      return getSlimWttRecordFile(originalFilePath, BUNDLED_WTT_SLIM_ARCHIVE_DIR);
    }
    return null;
  }
}

function shouldPreferWttRecordFile(current, next) {
  if (!current) {
    return true;
  }

  const currentIsSlim = current.parseSource === "slim";
  const nextIsSlim = next.parseSource === "slim";
  if (nextIsSlim && !currentIsSlim) {
    return true;
  }
  if (currentIsSlim && !nextIsSlim) {
    return false;
  }

  // Runtime DATA_DIR can contain stale persistent raw files on Render.
  // Bundled repo files can contain newer deployed records.
  // Prefer larger/newer files; if tied, prefer bundled deployment data.
  return (
    next.parseSize > current.parseSize ||
    (next.parseSize === current.parseSize && next.parseMtimeMs > current.parseMtimeMs) ||
    (
      next.parseSize === current.parseSize &&
      next.parseMtimeMs === current.parseMtimeMs &&
      next.sourcePriority > current.sourcePriority
    )
  );
}

function createWttRecordFileEntry(options) {
  const eventId = String(options.eventId || "");
  const filePath = options.filePath;
  const parseFilePath = options.parseFilePath || filePath;
  const fileStat = options.fileStat || fs.statSync(filePath);
  const parseStat = options.parseStat || fileStat;
  return {
    eventId,
    filePath,
    parseFilePath,
    parseSize: parseStat.size,
    parseMtimeMs: Math.trunc(parseStat.mtimeMs),
    parseSource: options.parseSource,
    size: fileStat.size,
    mtimeMs: Math.trunc(fileStat.mtimeMs),
    sourcePriority: options.sourcePriority,
    sourceLabel: options.sourceLabel,
  };
}

function getWttRecordFileSnapshot() {
  const recordsByEventId = new Map();

  const addDirectory = (dirPath, sourcePriority, sourceLabel) => {
    try {
      if (!dirPath || !fs.existsSync(dirPath)) {
        return;
      }

      fs.readdirSync(dirPath)
        .filter((fileName) => /^(?:TTE)?\d+\.json$/i.test(fileName))
        .forEach((fileName) => {
          const eventId = fileName.replace(/\.json$/, "");
          const filePath = path.join(dirPath, fileName);
          const stat = fs.statSync(filePath);
          const slim = getSlimWttRecordFile(
            filePath,
            sourceLabel === "runtime" ? WTT_SLIM_ARCHIVE_DIR : BUNDLED_WTT_SLIM_ARCHIVE_DIR
          );
          const next = createWttRecordFileEntry({
            eventId,
            filePath,
            parseFilePath: slim?.filePath || filePath,
            parseStat: slim ? { size: slim.size, mtimeMs: slim.mtimeMs } : stat,
            parseSource: slim ? "slim" : "raw",
            fileStat: stat,
            sourcePriority,
            sourceLabel,
          });

          const current = recordsByEventId.get(eventId);
          if (shouldPreferWttRecordFile(current, next)) {
            recordsByEventId.set(eventId, next);
          }
        });
    } catch {
      // Ignore unreadable archive directories.
    }
  };

  const addSlimDirectory = (dirPath, sourcePriority, sourceLabel, rawDirPath) => {
    if (process.env.WTT_SLIM_RECORDS_DISABLED === "1") {
      return;
    }
    try {
      if (!dirPath || !fs.existsSync(dirPath)) {
        return;
      }

      fs.readdirSync(dirPath)
        .filter((fileName) => /^(?:TTE)?\d+\.json$/i.test(fileName))
        .forEach((fileName) => {
          const eventId = fileName.replace(/\.json$/, "");
          const filePath = path.join(rawDirPath || dirPath, fileName);
          const slimFilePath = path.join(dirPath, fileName);
          const stat = fs.statSync(slimFilePath);
          try {
            const rawStat = fs.statSync(filePath);
            if (rawStat.isFile() && stat.mtimeMs < rawStat.mtimeMs) {
              return;
            }
          } catch {
            // The bundled slim file may be the only available copy.
          }
          const next = createWttRecordFileEntry({
            eventId,
            filePath,
            parseFilePath: slimFilePath,
            parseStat: stat,
            fileStat: stat,
            parseSource: "slim",
            sourcePriority,
            sourceLabel,
          });

          const current = recordsByEventId.get(eventId);
          if (shouldPreferWttRecordFile(current, next)) {
            recordsByEventId.set(eventId, next);
          }
        });
    } catch {
      // Ignore unreadable slim archive directories.
    }
  };

  addDirectory(WTT_ARCHIVE_DIR, 1, "runtime");
  addDirectory(BUNDLED_WTT_ARCHIVE_DIR, 2, "bundled");
  addSlimDirectory(WTT_SLIM_ARCHIVE_DIR, 3, "runtime-slim", WTT_ARCHIVE_DIR);
  addSlimDirectory(BUNDLED_WTT_SLIM_ARCHIVE_DIR, 0, "bundled-slim", BUNDLED_WTT_ARCHIVE_DIR);

  const searchIndex = readWttSearchIndex();
  const dateIndex = readWttDateIndex(WTT_DATE_INDEX_PATH);
  const archiveIndex = readWttArchiveIndex();
  const eventNames = getEventNamesMap();
  const recordsByLogicalEvent = new Map();
  [...recordsByEventId.values()].forEach((file) => {
    const meta = getEventRecordMeta(file.eventId, searchIndex, dateIndex, archiveIndex, eventNames);
    const eventName = String(meta.eventName || "").trim();
    const logicalKey = eventName && eventName !== String(file.eventId) && (meta.startDate || meta.endDate)
      ? [
          normalizeHeadToHeadMatchValue(eventName),
          String(meta.startDate || ""),
          String(meta.endDate || ""),
        ].join("\u0001")
      : `id\u0001${resolveEventId("wtt", file.eventId).toLowerCase()}`;
    const current = recordsByLogicalEvent.get(logicalKey);
    if (!current || shouldPreferWttRecordFile(current, file)) {
      recordsByLogicalEvent.set(logicalKey, file);
    }
  });

  return [...recordsByLogicalEvent.values()]
    .map(({ sourcePriority, ...file }) => file)
    .sort((left, right) => String(left.eventId).localeCompare(String(right.eventId), "en", { numeric: true }));
}

function isArchivedWttEvent(eventId) {
  const archiveEntry = readWttArchiveIndex()[String(eventId || "").trim()];
  return Boolean(archiveEntry?.archived);
}

function spawnDerivedIndexProcess(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: __dirname,
      env: {
        ...process.env,
        DATA_DIR,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
      if (stderr.length > 4000) {
        stderr = stderr.slice(-4000);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

function getRuntimeWttRecordFile(eventId) {
  const normalizedEventId = String(eventId || "").trim();
  if (!normalizedEventId) {
    return null;
  }
  return getWttRecordFileSnapshot().find((file) => String(file.eventId) === normalizedEventId) || null;
}

async function buildDerivedIndexesForFinishedWttEvent(eventId) {
  const file = getRuntimeWttRecordFile(eventId);
  if (!file) {
    return;
  }

  if (file.parseSource !== "slim" && fs.existsSync(file.filePath)) {
    await spawnDerivedIndexProcess(["build_wtt_slim_records.js", file.filePath], "build_wtt_slim_records");
  }

  const refreshedFile = getRuntimeWttRecordFile(eventId) || file;
  if (!isPlayerRecordEventIndexCurrent(refreshedFile)) {
    await spawnDerivedIndexProcess([
      "-r",
      "./runtime_legacy_ittf_patch.js",
      "server.js",
      "--build-player-record-event-index",
      "--event",
      String(eventId),
      "--force",
    ], "build-player-record-event-index");
  }
  await spawnDerivedIndexProcess([
    "build_player_records_index.js",
    String(eventId),
  ], "build_player_records_index");
  await enqueueAutoHeadToHeadIndexUpdate(eventId);
  clearPlayerRecordResultCache();

  clearHeadToHeadResultCache();
}

function scheduleDerivedIndexesForFinishedWttEvent(options = {}) {
  if (AUTO_DERIVED_INDEX_DISABLED || normalizeSource(options.source || "wtt") !== "wtt") {
    return;
  }
  const eventId = String(options.event || "").trim();
  if (!eventId || !isArchivedWttEvent(eventId)) {
    return;
  }
  const file = getRuntimeWttRecordFile(eventId);
  if (!file || (isPlayerRecordEventIndexCurrent(file) && isHeadToHeadPersistentIndexCurrent())) {
    const lastScheduledAt = autoDerivedIndexLastScheduled.get(eventId) || 0;
    if (Date.now() - lastScheduledAt < AUTO_DERIVED_INDEX_RESCHEDULE_TTL_MS) {
      return;
    }
  }
  if (autoDerivedIndexBuilds.has(eventId)) {
    return;
  }

  autoDerivedIndexLastScheduled.set(eventId, Date.now());
  autoDerivedIndexBuilds.add(eventId);
  setImmediate(() => {
    buildDerivedIndexesForFinishedWttEvent(eventId)
      .catch((error) => {
        console.error(`[auto-derived-index] ${eventId} failed:`, error?.message || error);
      })
      .finally(() => {
        autoDerivedIndexBuilds.delete(eventId);
      });
  });
}

function getPlayerRecordCacheSignature(snapshot) {
  const dataSignature = snapshot.map((file) => `${file.eventId}:${file.size}:${file.mtimeMs}:${file.parseSource || "raw"}:${file.parseSize || file.size}:${file.parseMtimeMs || file.mtimeMs}`).join("|");
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

function setPlayerRecordResultCacheValue(key, value) {
  if (playerRecordResultCache.has(key)) {
    playerRecordResultCache.delete(key);
  }
  playerRecordResultCache.set(key, value);
  while (playerRecordResultCache.size > PLAYER_RECORD_RESULT_CACHE_MAX) {
    const oldestKey = playerRecordResultCache.keys().next().value;
    playerRecordResultCache.delete(oldestKey);
  }
}

function clearPlayerRecordResultCache() {
  playerRecordResultCache.clear();
  legacyPlayerRecordShardCache.clear();
}

function setHeadToHeadResultCacheValue(key, value) {
  if (headToHeadResultCache.has(key)) {
    headToHeadResultCache.delete(key);
  }
  headToHeadResultCache.set(key, value);
  while (headToHeadResultCache.size > HEAD_TO_HEAD_RESULT_CACHE_MAX) {
    const oldestKey = headToHeadResultCache.keys().next().value;
    headToHeadResultCache.delete(oldestKey);
  }
}

function clearHeadToHeadResultCache() {
  headToHeadResultCache.clear();
}

function enqueueAutoHeadToHeadIndexUpdate(eventId) {
  const eventIds = Array.isArray(eventId)
    ? eventId.map((value) => String(value || "").trim()).filter(Boolean)
    : [String(eventId || "").trim()].filter(Boolean);
  if (eventIds.length === 0) {
    return Promise.resolve();
  }
  const run = autoHeadToHeadIndexUpdatePromise.then(() => spawnDerivedIndexProcess([
    "-r",
    "./runtime_legacy_ittf_patch.js",
    "server.js",
    "--update-head-to-head-index",
    "--event",
    eventIds.join(","),
  ], "update-head-to-head-index"));
  autoHeadToHeadIndexUpdatePromise = run.catch(() => {});
  return run;
}

function scheduleHeadToHeadIndexReconciliation() {
  if (AUTO_DERIVED_INDEX_DISABLED || !fs.existsSync(HEAD_TO_HEAD_INDEX_MANIFEST_PATH)) {
    return;
  }

  const timer = setTimeout(() => {
    try {
      const manifest = readJsonFileSafe(HEAD_TO_HEAD_INDEX_MANIFEST_PATH);
      const snapshot = getWttRecordFileSnapshot();
      const effective = getHeadToHeadEffectiveEventIndex(manifest);
      const staleEventIds = snapshot
        .filter((file) => !effective.eventIds.has(String(file.eventId)) ||
          !isHeadToHeadPairIndexEventCurrent(
            file,
            effective.eventSignatures[String(file.eventId)],
            effective.generatedAt,
          ))
        .map((file) => String(file.eventId));
      if (staleEventIds.length === 0) {
        return;
      }
      console.log(`[head-to-head-index] background reconcile ${staleEventIds.length} event(s)`);
      enqueueAutoHeadToHeadIndexUpdate(staleEventIds).catch((error) => {
        console.error("[head-to-head-index] background reconcile failed:", error?.message || error);
      });
    } catch (error) {
      console.error("[head-to-head-index] background reconcile check failed:", error?.message || error);
    }
  }, 15_000);
  timer.unref?.();
}

function setPlayerRecordArchiveParseCacheValue(key, value) {
  if (playerRecordArchiveParseCache.has(key)) {
    playerRecordArchiveParseCache.delete(key);
  }
  playerRecordArchiveParseCache.set(key, value);
  while (playerRecordArchiveParseCache.size > PLAYER_RECORD_ARCHIVE_PARSE_CACHE_MAX) {
    const oldestKey = playerRecordArchiveParseCache.keys().next().value;
    playerRecordArchiveParseCache.delete(oldestKey);
  }
}

function clearPlayerRecordArchiveParseCache() {
  playerRecordArchiveParseCache.clear();
}

function normalizeArchivedMatch(item) {
  if (item && typeof item === "object" && typeof item.matchType === "string" && Array.isArray(item.competitors)) {
    return normalizePreNormalizedMatch(item) || item;
  }
  return normalizeOfficialResultItem(item);
}

function getPlayerTranslationAliasNames(value, translations) {
  const normalized = normalizePlayerSearchText(value);
  if (!normalized) {
    return [];
  }
  return Object.entries(translations.players || {})
    .filter(([, translated]) => {
      const normalizedTranslated = normalizePlayerSearchText(translated);
      return (
        normalizedTranslated === normalized ||
        playerRecordNameMatchesNeedle(normalizedTranslated, normalized) ||
        playerRecordNameMatchesNeedle(normalized, normalizedTranslated)
      );
    })
    .map(([rawName]) => rawName);
}

function getPlayerOrgOverrideAliasNames(value, translations) {
  const normalized = normalizePlayerSearchText(value);
  if (!normalized) {
    return [];
  }
  return Object.entries(translations.playerOrgOverrides || {})
    .filter(([, translated]) => {
      const normalizedTranslated = normalizePlayerSearchText(translated);
      return (
        normalizedTranslated === normalized ||
        playerRecordNameMatchesNeedle(normalizedTranslated, normalized) ||
        playerRecordNameMatchesNeedle(normalized, normalizedTranslated)
      );
    })
    .map(([key]) => String(key || "").split("|")[0])
    .filter(Boolean);
}

function buildPlayerRecordOrgFilter(translatedName, translations) {
  const normalizedTranslatedName = normalizePlayerSearchText(translatedName);
  if (!normalizedTranslatedName) {
    return null;
  }

  const entries = Object.entries(translations.playerOrgOverrides || {})
    .map(([key, translated]) => {
      const [namePart, orgPart] = String(key || "").split("|");
      return {
        name: String(namePart || "").trim(),
        org: String(orgPart || "").trim().toUpperCase(),
        translated: String(translated || "").trim(),
      };
    })
    .filter((entry) =>
      entry.name &&
      entry.org &&
      normalizePlayerSearchText(entry.translated) === normalizedTranslatedName,
    );

  if (entries.length === 0) {
    return null;
  }

  return {
    translatedName,
    normalizedTranslatedName,
    names: new Set(entries.flatMap((entry) => getNameTranslationCandidates(entry.name).map(normalizePlayerTranslationKey))),
    orgs: new Set(entries.map((entry) => entry.org)),
    orgLabels: new Set(entries.flatMap((entry) => [
      entry.org,
      translations.teams?.[entry.org],
    ]).filter(Boolean)),
  };
}

function buildPlayerRecordNeedles(name, translatedName, translations) {
  const aliasNames = [
    ...getPlayerTranslationAliasNames(name, translations),
    ...getPlayerTranslationAliasNames(translatedName, translations),
    ...getPlayerOrgOverrideAliasNames(name, translations),
    ...getPlayerOrgOverrideAliasNames(translatedName, translations),
  ];
  return [
    ...buildPlayerNameSearchValues(name),
    ...buildPlayerNameSearchValues(translatedName),
    ...aliasNames.flatMap(buildPlayerNameSearchValues),
  ].filter(Boolean);
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

function playerRecordNameMatchesNeedle(value, needle) {
  const normalizedValue = normalizePlayerSearchText(value);
  const normalizedNeedle = normalizePlayerSearchText(needle);

  if (!normalizedValue || !normalizedNeedle) {
    return false;
  }

  if (normalizedValue === normalizedNeedle) {
    return true;
  }

  const valueTokens = normalizedValue.split(/\s+/).filter(Boolean);
  const needleTokens = normalizedNeedle.split(/\s+/).filter(Boolean);

  if (needleTokens.length === 0) {
    return false;
  }

  // Source records may include country codes, pair names, descriptors,
  // or other suffixes/prefixes around the player name.
  if (` ${normalizedValue} `.includes(` ${normalizedNeedle} `)) {
    return true;
  }

  // Generalized token match: "UDA Yukiya JPN", "Yukiya UDA", etc.
  return needleTokens.every((token) => valueTokens.includes(token));
}

function getCompetitorPlayerOrgFilterCandidates(competitor) {
  const players = Array.isArray(competitor?.players) ? competitor.players : [];
  const candidates = [];

  players.forEach((player) => {
    candidates.push({
      name: player?.name || player?.playerName || player?.competitorName || player?.description || player?.desc,
      org: player?.orgCode || player?.org || competitor?.orgCode || competitor?.org,
    });
  });

  getCompetitorNameCandidates(competitor).forEach((name) => {
    String(name || "")
      .split(/\s*(?:\/|／|\+|&| and )\s*/i)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        candidates.push({
          name: part,
          org: competitor?.orgCode || competitor?.org,
        });
      });
  });

  return candidates.filter((candidate) => candidate.name);
}

function playerMatchesOrgFilter(competitor, orgFilter, translations) {
  if (!orgFilter) {
    return true;
  }

  return getCompetitorPlayerOrgFilterCandidates(competitor).some((candidate) => {
    const nameMatches = getNameTranslationCandidates(candidate.name)
      .map(normalizePlayerTranslationKey)
      .some((name) => orgFilter.names.has(name));
    if (!nameMatches) {
      return false;
    }

    const orgMatches = getPlayerOrgOverrideOrgCandidates(candidate.org, translations)
      .map((org) => String(org || "").toUpperCase())
      .some((org) => orgFilter.orgs.has(org));
    if (!orgMatches) {
      return false;
    }

    return normalizePlayerSearchText(translatePlayerWithOrg(candidate.name, candidate.org, translations)) === orgFilter.normalizedTranslatedName;
  });
}

function playerMatchesCompetitor(competitor, needles, translations, orgFilter = null) {
  if (!competitor || needles.length === 0) {
    return false;
  }

  const values = [
    ...getCompetitorNameCandidates(competitor),
    ...(Array.isArray(competitor.players) ? competitor.players.flatMap((player) => [
      player?.name,
      player?.playerName,
      player?.competitorName,
      player?.description,
      player?.desc,
      translations.players?.[player?.name || ""],
      translatePlayerWithOrg(player?.name || "", player?.orgCode || player?.org || competitor.orgCode || competitor.org, translations),
    ]) : []),
  ].filter(Boolean);

  const expandedValues = values.flatMap((value) => [
    value,
    translatePlayerNameForRecord(value, translations, competitor.orgCode || competitor.org),
    ...buildPlayerNameSearchValues(value),
  ]).filter(Boolean);

  const nameMatches = expandedValues.some((value) =>
    needles.some((needle) => playerRecordNameMatchesNeedle(value, needle)),
  );

  return nameMatches && playerMatchesOrgFilter(competitor, orgFilter, translations);
}

function findPlayerCompetitorIndex(match, needles, translations, orgFilter = null) {
  const competitors = Array.isArray(match?.competitors) ? match.competitors : [];
  return competitors.findIndex((competitor) => playerMatchesCompetitor(competitor, needles, translations, orgFilter));
}

function compactJapaneseName(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々ヶ]+ [\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々ヶ]+$/u.test(raw)) {
    return raw.replace(/ /g, "");
  }

  return raw;
}

function getNameTranslationCandidates(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  const collapsed = raw.replace(/\s+/g, " ");
  const candidates = [raw];

  if (collapsed !== raw) {
    candidates.push(collapsed);
  }

  const parts = collapsed.split(" ").filter(Boolean);
  if (parts.length === 2) {
    candidates.push(`${parts[1]} ${parts[0]}`);
    candidates.push(`${parts[1].toUpperCase()} ${parts[0]}`);
    candidates.push(`${parts[0]} ${parts[1].toUpperCase()}`);
  }

  if (parts.length >= 2) {
    const givenNames = parts.slice(0, -1).join(" ");
    const familyName = parts[parts.length - 1];
    candidates.push(`${familyName} ${givenNames}`);
    candidates.push(`${familyName.toUpperCase()} ${givenNames}`);
    candidates.push(`${givenNames} ${familyName.toUpperCase()}`);
  }

  return [...new Set(candidates)];
}

const playerTranslationLookupCache = new WeakMap();

function normalizePlayerTranslationKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function getPlayerOrgOverrideOrgCandidates(orgCode, translations) {
  const raw = String(orgCode || "").trim();
  if (!raw) {
    return [];
  }

  const values = new Set([raw, raw.toUpperCase()]);
  const normalizedRaw = normalizePlayerTranslationKey(raw.replace(/,/g, " "));

  Object.entries(translations?.teams || {}).forEach(([code, translated]) => {
    if (!code) {
      return;
    }
    const normalizedCode = normalizePlayerTranslationKey(code);
    const normalizedTranslated = normalizePlayerTranslationKey(translated);
    if (normalizedCode === normalizedRaw || normalizedTranslated === normalizedRaw) {
      values.add(code);
      values.add(String(code).toUpperCase());
    }
  });

  const aliases = {
    "china": "CHN",
    "people s republic of china": "CHN",
    "hong kong": "HKG",
    "hong kong china": "HKG",
    "hong kong, china": "HKG",
    "hong kong macau": "HKG",
    "korea republic": "KOR",
    "republic of korea": "KOR",
  };
  const alias = aliases[normalizedRaw] || aliases[normalizePlayerTranslationKey(raw)];
  if (alias) {
    values.add(alias);
  }

  return [...values].filter(Boolean);
}

function getPlayerTranslationLookup(translations) {
  const players = translations?.players;
  if (!players || typeof players !== "object") {
    return null;
  }
  const cached = playerTranslationLookupCache.get(players);
  if (cached) {
    return cached;
  }
  const lookup = new Map();
  for (const [key, value] of Object.entries(players)) {
    const normalizedKey = normalizePlayerTranslationKey(key);
    if (normalizedKey && !lookup.has(normalizedKey)) {
      lookup.set(normalizedKey, value);
    }
  }
  playerTranslationLookupCache.set(players, lookup);
  return lookup;
}

function translatePlayer(value, translations) {
  const candidates = getNameTranslationCandidates(value);
  const lookup = getPlayerTranslationLookup(translations);

  for (const candidate of candidates) {
    if (translations.players?.[candidate]) {
      return translations.players[candidate];
    }
    const normalizedCandidate = normalizePlayerTranslationKey(candidate);
    if (lookup?.has(normalizedCandidate)) {
      return lookup.get(normalizedCandidate);
    }
  }

  return compactJapaneseName(value);
}

function translatePlayerWithOrg(value, orgCode, translations) {
  const overrides = translations?.playerOrgOverrides;
  const rawOrg = String(orgCode || "").trim();
  if (!overrides || typeof overrides !== "object" || !rawOrg) {
    return translatePlayer(value, translations);
  }

  const orgCandidates = getPlayerOrgOverrideOrgCandidates(rawOrg, translations);
  for (const candidate of getNameTranslationCandidates(value)) {
    for (const org of orgCandidates) {
      const exactKey = `${candidate}|${org}`;
      if (overrides[exactKey]) {
        return overrides[exactKey];
      }
      const normalizedKey = `${normalizePlayerTranslationKey(candidate)}|${String(org).toUpperCase()}`;
      const matched = Object.entries(overrides).find(([key]) => {
        const [namePart, orgPart] = String(key).split("|");
        return normalizePlayerTranslationKey(namePart) === normalizePlayerTranslationKey(candidate) &&
          String(orgPart || "").toUpperCase() === String(org).toUpperCase();
      });
      if (matched && matched[1]) {
        return matched[1];
      }
      if (overrides[normalizedKey]) {
        return overrides[normalizedKey];
      }
    }
  }

  return translatePlayer(value, translations);
}

function translateOrg(value, translations, options = {}) {
  const raw = String(value || "").trim();
  const rawCode = String(options.orgCode || "").trim();
  if (rawCode && translations.teams?.[rawCode]) {
    return translations.teams[rawCode];
  }
  if (!raw) {
    return "";
  }

  if (translations.teams?.[raw]) {
    return translations.teams[raw];
  }

  if (raw.includes("/")) {
    return raw
      .split("/")
      .map((part) => translations.teams?.[part] || part)
      .join("/");
  }

  return raw;
}

function translatePlayerNameForRecord(name, translations, orgCode = "") {
  const raw = String(name || "").trim();
  if (!raw) {
    return "";
  }

  const parts = raw.split(/\s*(?:\/|／|\+|&| and )\s*/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    return parts.map((part) => translatePlayerWithOrg(part, orgCode, translations)).filter(Boolean).join("／");
  }

  return translatePlayerWithOrg(raw, orgCode, translations);
}

function getCompetitorNameCandidates(competitor) {
  if (!competitor || typeof competitor !== "object") {
    return [];
  }

  const values = [
    competitor.name,
    competitor.playerName,
    competitor.competitorName,
    competitor.competitiorName,
    competitor.displayName,
    competitor.description,
    competitor.desc,
    competitor.teamName,
    competitor.team,
  ];

  if (competitor.organization && typeof competitor.organization === "object") {
    values.push(competitor.organization.name, competitor.organization.description, competitor.organization.desc);
  }

  if (competitor.org && typeof competitor.org === "object") {
    values.push(competitor.org.name, competitor.org.description, competitor.org.desc);
  }

  return values.map((value) => String(value || "").trim()).filter(Boolean);
}

function getCompetitorDisplayNameForRecord(competitor, translations) {
  if (!competitor) {
    return "";
  }

  const players = (competitor.players || [])
    .map((player) => ({
      name: translatePlayerWithOrg(player?.name || "", player?.orgCode || player?.org || competitor.orgCode || competitor.org, translations),
      org: translateOrg(player?.org || competitor.org || "", translations, {
        orgCode: player?.orgCode || competitor.orgCode,
      }),
    }))
    .filter((player) => player.name);

  if (players.length >= 2) {
    const names = players.map((player) => player.name).join("／");
    const orgs = [...new Set(players.map((player) => player.org).filter(Boolean))];
    if (orgs.length === 0) {
      return names;
    }
    if (orgs.length === 1) {
      return `${names}（${orgs[0]}）`;
    }
    return `${names}（${orgs.join("／")}）`;
  }

  if (players.length === 1) {
    return players[0].org ? `${players[0].name}（${players[0].org}）` : players[0].name;
  }

  for (const candidate of getCompetitorNameCandidates(competitor)) {
    const name = translatePlayerNameForRecord(candidate, translations, competitor.orgCode || competitor.org);
    if (!name) {
      continue;
    }
    const translatedOrg = translateOrg(competitor.org || "", translations, {
      orgCode: competitor.orgCode,
    });
    return translatedOrg ? `${name}（${translatedOrg}）` : name;
  }

  return "";
}

function formatCompetitorForRecord(competitor, translations) {
  return getCompetitorDisplayNameForRecord(competitor, translations) || "TBD";
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

function getWinnerIndexFromGameScores(gameScores) {
  const games = Array.isArray(gameScores) ? gameScores : [];
  let leftWins = 0;
  let rightWins = 0;

  games.forEach((game) => {
    const [rawLeft, rawRight] = String(game || "").split("-");
    const left = Number(rawLeft);
    const right = Number(rawRight);
    if (Number.isNaN(left) || Number.isNaN(right) || left === right) {
      return;
    }
    if (left > right) {
      leftWins += 1;
    } else {
      rightWins += 1;
    }
  });

  if (leftWins >= 3 && leftWins > rightWins) {
    return 0;
  }
  if (rightWins >= 3 && rightWins > leftWins) {
    return 1;
  }
  return null;
}

function getWinnerIndexForRecord(match) {
  const overallWinnerIndex = getWinnerIndexFromOverallScore(match?.overallScore);
  if (overallWinnerIndex !== null) {
    return overallWinnerIndex;
  }
  return getWinnerIndexFromGameScores(match?.gameScores);
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
  const winnerIndex = getWinnerIndexForRecord(match);
  const leftIndex = winnerIndex === playerCompetitorIndex ? playerCompetitorIndex : winnerIndex === null ? playerCompetitorIndex : winnerIndex;
  const rightIndex = leftIndex === 0 ? 1 : 0;
  const left = formatCompetitorForRecord(match.competitors?.[leftIndex], translations);
  const right = formatCompetitorForRecord(match.competitors?.[rightIndex], translations);
  const score = formatGameScoresForRecord(match, leftIndex);
  return `${left}　${score}　${right}`;
}

function getEventRecordMeta(eventId, searchIndex, dateIndex, archiveIndex, eventNames) {
  const merged = getMergedWttSearchEntry(eventId, searchIndex[eventId], dateIndex, archiveIndex);
  const eventName = String(merged?.eventName || merged?.title || eventNames[eventId] || eventId);
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

function parseDateOnly(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shouldRefreshLiveEventMeta(meta, now = new Date()) {
  const startDate = parseDateOnly(meta?.startDate);
  const endDate = parseDateOnly(meta?.endDate || meta?.startDate);
  if (!endDate) {
    return false;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const refreshUntil = new Date(endDate.getTime() + LIVE_EVENT_REFRESH_GRACE_DAYS * dayMs);
  if (todayUtc > refreshUntil) {
    return false;
  }
  if (startDate && todayUtc < new Date(startDate.getTime() - dayMs)) {
    return false;
  }
  return true;
}

async function getLiveEventSnapshot(file, meta) {
  if (!file?.eventId || !shouldRefreshLiveEventMeta(meta)) {
    return null;
  }
  try {
    const result = await getProcessedMatchesCached({
      source: "wtt",
      event: String(file.eventId),
      translations: TRANSLATIONS_PATH,
      rules: RULES_PATH,
      cacheDir: CACHE_DIR,
      wttArchiveDir: WTT_ARCHIVE_DIR,
      wttSlimArchiveDir: WTT_SLIM_ARCHIVE_DIR,
      bundledWttArchiveDir: BUNDLED_WTT_ARCHIVE_DIR,
      bundledWttSlimArchiveDir: BUNDLED_WTT_SLIM_ARCHIVE_DIR,
      refreshCache: true,
    });
    const normalizedMatches = Array.isArray(result?.normalized) ? result.normalized : [];
    if (normalizedMatches.length === 0) {
      return null;
    }
    return {
      ...file,
      sourceLabel: "live",
      liveNormalizedMatches: normalizedMatches,
    };
  } catch (error) {
    console.warn(`[live-event-refresh] ${file.eventId} failed:`, error?.message || error);
    return null;
  }
}

function comparePlayerRecordEvents(left, right) {
  const leftDate = toComparableDate(left?.endDate || left?.startDate, true);
  const rightDate = toComparableDate(right?.endDate || right?.startDate, true);
  if (leftDate && rightDate && leftDate.getTime() !== rightDate.getTime()) {
    return rightDate - leftDate;
  }
  if (leftDate && !rightDate) {
    return -1;
  }
  if (!leftDate && rightDate) {
    return 1;
  }
  return String(right?.event || "").localeCompare(String(left?.event || ""), "en", { numeric: true });
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseJsonArrayFromText(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getFileHashToken(filePath) {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return "missing";
  }
}

function getParsedPlayerRecordArchive(file, existingText = null) {
  if (Array.isArray(file?.liveNormalizedMatches)) {
    const normalizedMatches = file.liveNormalizedMatches.map(normalizeArchivedMatch).filter(Boolean);
    return {
      normalizedMatches,
      contextsByCategory: buildRoundContextsByCategory(normalizedMatches),
      fallbackRoundContext: buildJaRoundContext(normalizedMatches),
    };
  }

  const parseFilePath = file.parseFilePath || file.filePath;
  const parseSize = file.parseSize || file.size;
  const parseMtimeMs = file.parseMtimeMs || file.mtimeMs;
  const cacheKey = `${parseFilePath}:${parseSize}:${parseMtimeMs}`;
  const cached = playerRecordArchiveParseCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const text = typeof existingText === "string" ? existingText : readTextFile(parseFilePath);
  const payload = parseJsonArrayFromText(text);
  const normalizedMatches = [];
  for (const item of payload) {
    const match = normalizeArchivedMatch(item);
    if (match) {
      normalizedMatches.push(match);
    }
  }
  const parsedArchive = {
    normalizedMatches,
    contextsByCategory: buildRoundContextsByCategory(normalizedMatches),
    fallbackRoundContext: buildJaRoundContext(normalizedMatches),
  };
  setPlayerRecordArchiveParseCacheValue(cacheKey, parsedArchive);
  return parsedArchive;
}

function buildPlayerRecordTextNeedles(...names) {
  const normalizedValues = names.flatMap(buildPlayerNameSearchValues)
    .filter((value) => /^[a-z0-9 ]+$/.test(value))
    .map((value) => {
      const tokens = value.split(/\s+/).filter(Boolean);
      return {
        phrase: value.toLowerCase(),
        compact: tokens.join("").toLowerCase(),
        tokens: tokens.map((token) => token.toLowerCase()),
      };
    })
    .filter((value) => value.phrase.length >= 2);
  return normalizedValues;
}

function textLikelyContainsPlayer(text, textNeedles) {
  if (textNeedles.length === 0) {
    return false;
  }
  const haystack = text.toLowerCase();
  const compactHaystack = haystack.replace(/[^a-z0-9]+/g, "");
  return textNeedles.some((needle) => {
    if (haystack.includes(needle.phrase) || compactHaystack.includes(needle.compact)) {
      return true;
    }
    if (needle.tokens.length > 1) {
      return needle.tokens.every((token) => haystack.includes(token));
    }
    return needle.tokens.some((token) => token.length >= 2 && haystack.includes(token));
  });
}

const playerRecordCandidateIndexState = {
  signature: null,
  generatedAt: null,
  index: null,
  building: null,
  buildingSignature: null,
};

function writeJsonFileAtomic(filePath, payload) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function writeCompactJsonFileAtomic(filePath, payload) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function writeHeadToHeadIndexStatus(status) {
  try {
    writeJsonFileAtomic(HEAD_TO_HEAD_INDEX_STATUS_PATH, {
      updatedAt: new Date().toISOString(),
      ...status,
    });
  } catch (error) {
    console.error("[head-to-head-index] failed to write status:", error?.message || error);
  }
}

function readPlayerRecordCandidateIndexFromDisk(signature) {
  try {
    const manifest = JSON.parse(fs.readFileSync(PLAYER_RECORD_CANDIDATE_INDEX_MANIFEST_PATH, "utf8"));
    if (
      manifest?.version !== PLAYER_RECORD_CANDIDATE_INDEX_VERSION ||
      manifest?.signature !== signature
    ) {
      return null;
    }
    const index = JSON.parse(fs.readFileSync(PLAYER_RECORD_CANDIDATE_INDEX_PATH, "utf8"));
    if (!index || typeof index !== "object" || Array.isArray(index)) {
      return null;
    }
    return {
      signature,
      generatedAt: manifest.generatedAt || null,
      index,
    };
  } catch {
    return null;
  }
}

function getPlayerRecordCandidateShardName(key) {
  const first = String(key || "").trim().charAt(0).toLowerCase();
  return /^[a-z0-9]$/.test(first) ? `${first}.json` : "_.json";
}

function readPlayerRecordCandidateManifestFromPath(filePath, signature) {
  try {
    const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (manifest?.version !== PLAYER_RECORD_CANDIDATE_INDEX_VERSION) {
      return null;
    }
    if (!manifest?.sharded && manifest?.signature !== signature) {
      return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

function getPlayerRecordCandidateManifestLocations(signature) {
  const locations = [
    {
      manifestPath: PLAYER_RECORD_CANDIDATE_INDEX_MANIFEST_PATH,
      shardsDir: PLAYER_RECORD_CANDIDATE_SHARDS_DIR,
    },
    {
      manifestPath: BUNDLED_PLAYER_RECORD_CANDIDATE_INDEX_MANIFEST_PATH,
      shardsDir: BUNDLED_PLAYER_RECORD_CANDIDATE_SHARDS_DIR,
    },
  ];

  return locations.flatMap((location) => {
    const manifest = readPlayerRecordCandidateManifestFromPath(location.manifestPath, signature);
    return manifest
      ? [{
        ...manifest,
        shardsDir: location.shardsDir,
      }]
      : [];
  });
}

function readPlayerRecordCandidateManifest(signature) {
  return getPlayerRecordCandidateManifestLocations(signature)[0] || null;
}

function getPlayerRecordShardedEventIds(signature, textNeedles) {
  if (!Array.isArray(textNeedles) || textNeedles.length === 0) {
    return null;
  }
  const manifests = getPlayerRecordCandidateManifestLocations(signature).filter((manifest) => manifest?.sharded);
  if (manifests.length === 0) {
    return null;
  }

  const shards = new Map();
  const getShard = (manifest, phrase) => {
    const shardName = getPlayerRecordCandidateShardName(phrase);
    const shardKey = `${manifest.shardsDir || PLAYER_RECORD_CANDIDATE_SHARDS_DIR}:${shardName}`;
    if (!shards.has(shardKey)) {
      try {
        const shardPath = path.join(manifest.shardsDir || PLAYER_RECORD_CANDIDATE_SHARDS_DIR, shardName);
        const shard = JSON.parse(fs.readFileSync(shardPath, "utf8"));
        shards.set(shardKey, shard && typeof shard === "object" && !Array.isArray(shard) ? shard : {});
      } catch {
        shards.set(shardKey, {});
      }
    }
    return shards.get(shardKey) || {};
  };

  const eventIds = new Set();
  let playerKeyCount = 0;
  textNeedles.forEach((needle) => {
    const phrase = String(needle?.phrase || "").trim();
    if (!phrase) {
      return;
    }
    manifests.forEach((manifest) => {
      const shard = getShard(manifest, phrase);
      if (Array.isArray(shard[phrase])) {
        playerKeyCount += 1;
        shard[phrase].forEach((eventId) => eventIds.add(eventId));
      }
    });
  });

  if (eventIds.size === 0) {
    textNeedles.forEach((needle) => {
      const phrase = String(needle?.phrase || "").trim();
      if (!phrase) {
        return;
      }
      manifests.forEach((manifest) => {
        const shard = getShard(manifest, phrase);
        Object.keys(shard).forEach((key) => {
          if (playerRecordNameMatchesNeedle(key, phrase)) {
            playerKeyCount += 1;
            shard[key].forEach((eventId) => eventIds.add(eventId));
          }
        });
      });
    });
  }

  return eventIds.size > 0 ? {
    eventIds,
    generatedAt: manifests.map((manifest) => manifest.generatedAt).filter(Boolean).sort().pop() || null,
    playerKeyCount,
  } : null;
}

function setPlayerRecordCandidateIndexState(indexState) {
  playerRecordCandidateIndexState.signature = indexState.signature;
  playerRecordCandidateIndexState.generatedAt = indexState.generatedAt;
  playerRecordCandidateIndexState.index = indexState.index;
}

function getPlayerRecordCandidateIndexNameValues(competitor, translations) {
  if (!competitor || typeof competitor !== "object") {
    return [];
  }
  const values = [
    ...getCompetitorNameCandidates(competitor),
    ...(Array.isArray(competitor.players) ? competitor.players.flatMap((player) => [
      player?.name,
      player?.playerName,
      player?.competitorName,
      player?.description,
      player?.desc,
    ]) : []),
  ].filter(Boolean);

  return values.flatMap((value) => [
    value,
    translatePlayerNameForRecord(value, translations),
    ...buildPlayerNameSearchValues(value),
  ]).filter(Boolean);
}

function getPlayerRecordEventIndexNameValues(competitor, translations) {
  if (!competitor || typeof competitor !== "object") {
    return [];
  }
  const values = [
    ...getPlayerRecordCandidateIndexNameValues(competitor, translations),
  ];

  getCompetitorPlayerOrgFilterCandidates(competitor).forEach((candidate) => {
    const rawName = String(candidate.name || "").trim();
    if (!rawName) {
      return;
    }
    values.push(rawName);
    values.push(translatePlayerWithOrg(rawName, candidate.org, translations));
    getNameTranslationCandidates(rawName).forEach((name) => {
      values.push(name);
      values.push(translatePlayerWithOrg(name, candidate.org, translations));
    });
  });

  return Array.from(new Set(values.flatMap(buildPlayerNameSearchValues).filter(Boolean)));
}

function getPlayerRecordEventStoredMatchId(matchEntry) {
  return crypto.createHash("sha1").update(JSON.stringify([
    matchEntry?.documentCode || "",
    matchEntry?.categoryName || "",
    matchEntry?.roundLabel || "",
    matchEntry?.line || "",
    matchEntry?.record || null,
  ])).digest("hex").slice(0, 16);
}

function addPlayerRecordEventIndexedMatch(players, matches, key, eventMeta, matchEntry) {
  if (!key || !matchEntry) {
    return false;
  }
  if (!players[key]) {
    players[key] = [];
  }
  const matchId = getPlayerRecordEventStoredMatchId(matchEntry);
  if (!matches[matchId]) {
    matches[matchId] = matchEntry;
  }
  if (players[key].includes(matchId)) {
    return false;
  }
  players[key].push(matchId);
  return true;
}

function compactPlayerRecordCompetitor(competitor) {
  if (!competitor || typeof competitor !== "object") {
    return null;
  }
  const players = Array.isArray(competitor.players) ? competitor.players : [];
  return {
    type: competitor.type || "",
    name: competitor.name || "",
    org: competitor.org || "",
    orgCode: competitor.orgCode || "",
    players: players.map((player) => ({
      name: player?.name || "",
      org: player?.org || competitor.org || "",
      orgCode: player?.orgCode || competitor.orgCode || "",
    })).filter((player) => player.name),
  };
}

function buildPlayerRecordMatchRecord(match, playerCompetitorIndex) {
  const winnerIndex = getWinnerIndexForRecord(match);
  const leftIndex = winnerIndex === playerCompetitorIndex ? playerCompetitorIndex : winnerIndex === null ? playerCompetitorIndex : winnerIndex;
  const rightIndex = leftIndex === 0 ? 1 : 0;
  return {
    version: 1,
    leftIndex,
    left: compactPlayerRecordCompetitor(match.competitors?.[leftIndex]),
    right: compactPlayerRecordCompetitor(match.competitors?.[rightIndex]),
    overallScore: match.overallScore || "",
    resultStatus: match.resultStatus || "",
    gameScores: Array.isArray(match.gameScores) ? match.gameScores : [],
  };
}

function addPlayerRecordEventIndexMatch(players, matches, eventMeta, match, translations, rules, roundContext, parentMatch = null) {
  const competitors = Array.isArray(match?.competitors) ? match.competitors : [];
  let indexedEntries = 0;

  competitors.forEach((competitor, competitorIndex) => {
    const matchEntries = [];
    pushPlayerRecordMatch(matchEntries, match, competitorIndex, translations, rules, roundContext, parentMatch);
    const matchEntry = matchEntries[0];
    if (!matchEntry) {
      return;
    }
    matchEntry.record = buildPlayerRecordMatchRecord(match, competitorIndex);
    delete matchEntry.line;
    getPlayerRecordEventIndexNameValues(competitor, translations).forEach((key) => {
      if (addPlayerRecordEventIndexedMatch(players, matches, key, eventMeta, matchEntry)) {
        indexedEntries += 1;
      }
    });
  });

  return indexedEntries;
}

function getPlayerRecordEventIndexPath(eventId, dirPath = PLAYER_RECORD_EVENT_INDEX_DIR) {
  return path.join(dirPath, `${String(eventId || "").trim()}.json`);
}

function getPlayerRecordEventIndexFreshnessValue(index) {
  const sourceMtimeMs = Number(index?.sourceMtimeMs || 0);
  if (Number.isFinite(sourceMtimeMs) && sourceMtimeMs > 0) {
    return sourceMtimeMs;
  }

  const generatedAtMs = Date.parse(String(index?.generatedAt || ""));
  if (Number.isFinite(generatedAtMs) && generatedAtMs > 0) {
    return generatedAtMs;
  }

  return 0;
}

function comparePlayerRecordEventIndexQuality(left, right) {
  const leftMatchCount = Number(left?.indexedMatches || left?.storedMatchCount || 0);
  const rightMatchCount = Number(right?.indexedMatches || right?.storedMatchCount || 0);
  if (leftMatchCount !== rightMatchCount) {
    return leftMatchCount - rightMatchCount;
  }

  const leftEntries = Number(left?.indexedEntries || 0);
  const rightEntries = Number(right?.indexedEntries || 0);
  if (leftEntries !== rightEntries) {
    return leftEntries - rightEntries;
  }

  const leftSize = Number(left?.sourceSize || 0);
  const rightSize = Number(right?.sourceSize || 0);
  if (leftSize !== rightSize) {
    return leftSize - rightSize;
  }

  return getPlayerRecordEventIndexFreshnessValue(left) - getPlayerRecordEventIndexFreshnessValue(right);
}

function isPlayerRecordEventIndexForFile(index, file) {
  if (!file) {
    return true;
  }
  const indexSourceSize = Number(index?.sourceSize || 0);
  const fileSourceSize = Number(file.parseSize || file.size || 0);
  if (indexSourceSize > 0 && fileSourceSize > 0) {
    return indexSourceSize === fileSourceSize;
  }

  const indexSourceMtimeMs = Number(index?.sourceMtimeMs || 0);
  const fileSourceMtimeMs = Number(file.parseMtimeMs || file.mtimeMs || 0);
  if (indexSourceMtimeMs > 0 && fileSourceMtimeMs > 0) {
    return indexSourceMtimeMs === fileSourceMtimeMs;
  }

  return true;
}

function mergePlayerRecordEventIndexes(indexes) {
  const validIndexes = (Array.isArray(indexes) ? indexes : []).filter((index) =>
    index?.version === PLAYER_RECORD_EVENT_INDEX_VERSION &&
    index?.players &&
    typeof index.players === "object",
  );
  if (validIndexes.length === 0) {
    return null;
  }

  return [...validIndexes].sort(comparePlayerRecordEventIndexQuality).pop();
}

function readPlayerRecordEventIndex(eventId, file = null) {
  const candidates = [
    getPlayerRecordEventIndexPath(eventId, PLAYER_RECORD_EVENT_INDEX_DIR),
    getPlayerRecordEventIndexPath(eventId, BUNDLED_PLAYER_RECORD_EVENT_INDEX_DIR),
  ];

  const indexes = [];
  for (const filePath of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (
        parsed?.version === PLAYER_RECORD_EVENT_INDEX_VERSION &&
        parsed?.players &&
        typeof parsed.players === "object" &&
        isPlayerRecordEventIndexForFile(parsed, file)
      ) {
        indexes.push(parsed);
      }
    } catch {
      // Try the next event index location.
    }
  }
  return mergePlayerRecordEventIndexes(indexes);
}

function buildPlayerRecordEventIndexForFile(file, deps = null) {
  const activeDeps = deps || {
    translations: readTranslations(TRANSLATIONS_PATH),
    rules: readRules(RULES_PATH),
    searchIndex: readWttSearchIndex(),
    dateIndex: readWttDateIndex(WTT_DATE_INDEX_PATH),
    archiveIndex: readWttArchiveIndex(),
    eventNames: getEventNamesMap(),
  };
  const text = readTextFile(file.parseFilePath || file.filePath);
  const payload = parseJsonArrayFromText(text);
  const normalizedMatches = payload.map(normalizeArchivedMatch).filter(Boolean);
  const contextsByCategory = buildRoundContextsByCategory(normalizedMatches);
  const fallbackRoundContext = buildJaRoundContext(normalizedMatches);
  const eventMeta = getEventRecordMeta(file.eventId, activeDeps.searchIndex, activeDeps.dateIndex, activeDeps.archiveIndex, activeDeps.eventNames);
  const players = {};
  const matches = {};
  let indexedEntries = 0;
  let indexedMatches = 0;

  normalizedMatches.forEach((match) => {
    const roundContext = contextsByCategory.get(getRoundContextKey(match)) || fallbackRoundContext;
    if (match.matchType === "individual") {
      indexedEntries += addPlayerRecordEventIndexMatch(players, matches, eventMeta, match, activeDeps.translations, activeDeps.rules, roundContext);
      indexedMatches += 1;
      return;
    }
    if (match.matchType === "team") {
      (Array.isArray(match.singles) ? match.singles : []).forEach((single) => {
        indexedEntries += addPlayerRecordEventIndexMatch(players, matches, eventMeta, single, activeDeps.translations, activeDeps.rules, roundContext, match);
        indexedMatches += 1;
      });
    }
  });

  Object.values(players).forEach((matches) => {
    matches.sort(comparePlayerRecordMatches);
  });

  return {
    version: PLAYER_RECORD_EVENT_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    eventId: String(file.eventId),
    source: file.parseSource || file.sourceLabel || "",
    sourceSize: file.parseSize || file.size || 0,
    sourceMtimeMs: file.parseMtimeMs || file.mtimeMs || 0,
    event: eventMeta,
    indexedMatches,
    indexedEntries,
    keyCount: Object.keys(players).length,
    storedMatchCount: Object.keys(matches).length,
    players,
    matches,
  };
}

function writePlayerRecordEventIndexForFile(file, deps = null) {
  const index = buildPlayerRecordEventIndexForFile(file, deps);
  ensureDir(PLAYER_RECORD_EVENT_INDEX_DIR);
  const outputPath = getPlayerRecordEventIndexPath(file.eventId);
  writeCompactJsonFileAtomic(outputPath, index);
  return {
    eventId: String(file.eventId),
    outputPath,
    indexedMatches: index.indexedMatches,
    indexedEntries: index.indexedEntries,
    keyCount: index.keyCount,
    bytes: fs.statSync(outputPath).size,
  };
}

function buildPlayerRecordLineFromRecord(record, translations) {
  if (!record || typeof record !== "object") {
    return "";
  }
  const matchForScore = {
    gameScores: Array.isArray(record.gameScores) ? record.gameScores : [],
    overallScore: record.overallScore || "",
    resultStatus: record.resultStatus || "",
  };
  const left = formatCompetitorForRecord(record.left, translations);
  const right = formatCompetitorForRecord(record.right, translations);
  const score = formatGameScoresForRecord(matchForScore, Number(record.leftIndex || 0));
  return `${left}　${score}　${right}`;
}

function materializePlayerRecordMatch(match, translations) {
  if (!match || typeof match !== "object") {
    return match;
  }
  if (!match.record) {
    return match;
  }
  const line = buildPlayerRecordLineFromRecord(match.record, translations);
  if (!line) {
    return match;
  }
  const { record, ...displayMatch } = match;
  return { ...displayMatch, line };
}

function resolvePlayerRecordIndexedMatch(index, entry) {
  if (!entry) {
    return null;
  }
  if (typeof entry === "string") {
    return index.matches?.[entry] || null;
  }
  if (typeof entry === "object") {
    return entry;
  }
  return null;
}

function collectPlayerRecordEventsFromEventIndex(snapshot, needles, options = {}) {
  const eventLimit = Number.isFinite(options.eventLimit) && options.eventLimit > 0 ? options.eventLimit : Infinity;
  const matchLimit = Number.isFinite(options.matchLimit) && options.matchLimit > 0 ? options.matchLimit : Infinity;
  const orgFilter = options.orgFilter || null;
  const translations = readTranslations(TRANSLATIONS_PATH);
  const needleKeys = Array.from(new Set((Array.isArray(needles) ? needles : []).flatMap(buildPlayerNameSearchValues).filter(Boolean)));
  const eventsById = new Map();
  const missingIndexedFiles = [];
  let indexedEvents = 0;
  let missingIndexedEvents = 0;
  let scannedMatches = 0;
  let playerKeyCount = 0;

  for (const file of (Array.isArray(snapshot) ? snapshot : [])) {
    if (eventsById.size >= eventLimit) {
      break;
    }
    const index = readPlayerRecordEventIndex(file.eventId, file);
    if (!index) {
      missingIndexedEvents += 1;
      missingIndexedFiles.push(file);
      continue;
    }
    indexedEvents += 1;
    const eventMeta = index.event || getEventRecordMeta(file.eventId, readWttSearchIndex(), readWttDateIndex(WTT_DATE_INDEX_PATH), readWttArchiveIndex(), getEventNamesMap());
    const matches = [];
    const seen = new Set();

    needleKeys.forEach((key) => {
      const indexedMatches = Array.isArray(index.players?.[key]) ? index.players[key] : [];
      if (indexedMatches.length > 0) {
        playerKeyCount += 1;
      }
      indexedMatches.forEach((entry) => {
        const match = resolvePlayerRecordIndexedMatch(index, entry);
        if (!match) {
          return;
        }
        scannedMatches += 1;
        const matchId = getPlayerRecordIndexMatchId(match);
        if (seen.has(matchId)) {
          return;
        }
        matches.push(materializePlayerRecordMatch(match, translations));
        seen.add(matchId);
      });
    });

    if (matches.length === 0) {
      continue;
    }

    const matchGroups = buildPlayerRecordMatchGroups(matches);
    eventsById.set(String(eventMeta.event || file.eventId), {
      ...eventMeta,
      source: file.sourceLabel || "",
      matches: matchGroups.flatMap((group) => group.matches),
      matchGroups,
    });

    const collectedMatchCount = [...eventsById.values()].reduce((sum, event) => sum + (event.matches?.length || 0), 0);
    if (collectedMatchCount >= matchLimit) {
      break;
    }
  }

  let events = [...eventsById.values()].sort(comparePlayerRecordEvents);
  let result = {
    events,
    parsedEvents: 0,
    scannedMatches,
    indexedEvents,
    missingIndexedEvents,
    missingIndexedFiles,
    candidateEventCount: Array.isArray(snapshot) ? snapshot.length : 0,
    playerKeyCount,
  };

  if (orgFilter) {
    result = filterIndexedPlayerRecordEventsByOrgFilter(result, orgFilter, translations);
  }

  return result;
}

function stripInternalPlayerRecordCollectionFields(result) {
  if (!result || typeof result !== "object") {
    return result;
  }
  const { missingIndexedFiles, ...publicResult } = result;
  return publicResult;
}

function mergePlayerRecordCollectedResults(primary, fallback) {
  const base = primary || {};
  const extra = fallback || {};
  const eventsById = new Map();

  const addEvent = (event) => {
    if (!event || typeof event !== "object") {
      return;
    }
    const eventId = String(event.event || event.eventId || "");
    if (!eventId) {
      return;
    }
    if (!eventsById.has(eventId)) {
      eventsById.set(eventId, {
        ...event,
        matches: [],
      });
    }
    const target = eventsById.get(eventId);
    const seen = new Set((Array.isArray(target.matches) ? target.matches : []).map(getPlayerRecordIndexMatchId));
    (Array.isArray(event.matches) ? event.matches : []).forEach((match) => {
      const matchId = getPlayerRecordIndexMatchId(match);
      if (seen.has(matchId)) {
        return;
      }
      target.matches.push(match);
      seen.add(matchId);
    });
  };

  (Array.isArray(base.events) ? base.events : []).forEach(addEvent);
  (Array.isArray(extra.events) ? extra.events : []).forEach(addEvent);

  const events = [...eventsById.values()].map((event) => {
    const matchGroups = buildPlayerRecordMatchGroups(event.matches || []);
    return {
      ...event,
      matches: matchGroups.flatMap((group) => group.matches),
      matchGroups,
    };
  }).sort(comparePlayerRecordEvents);

  return {
    ...stripInternalPlayerRecordCollectionFields(base),
    events,
    parsedEvents: (base.parsedEvents || 0) + (extra.parsedEvents || 0),
    scannedMatches: (base.scannedMatches || 0) + (extra.scannedMatches || 0),
    fallbackParsedEvents: extra.parsedEvents || 0,
    fallbackScannedMatches: extra.scannedMatches || 0,
  };
}

async function collectPlayerRecordEventsWithMissingIndexFallback(snapshot, needles, textNeedles, options = {}) {
  const indexed = collectPlayerRecordEventsFromEventIndex(snapshot, needles, options);
  const missingFiles = Array.isArray(indexed.missingIndexedFiles) ? indexed.missingIndexedFiles : [];
  if (missingFiles.length === 0) {
    return stripInternalPlayerRecordCollectionFields(indexed);
  }

  const eventLimit = Number.isFinite(options.eventLimit) && options.eventLimit > 0 ? options.eventLimit : Infinity;
  const matchLimit = Number.isFinite(options.matchLimit) && options.matchLimit > 0 ? options.matchLimit : Infinity;
  const indexedMatchCount = (Array.isArray(indexed.events) ? indexed.events : [])
    .reduce((sum, event) => sum + (Array.isArray(event.matches) ? event.matches.length : 0), 0);
  if ((Array.isArray(indexed.events) ? indexed.events.length : 0) >= eventLimit || indexedMatchCount >= matchLimit) {
    return stripInternalPlayerRecordCollectionFields(indexed);
  }

  const fallback = await collectPlayerRecordEvents(missingFiles, needles, textNeedles, options);
  return mergePlayerRecordCollectedResults(indexed, fallback);
}

function addPlayerRecordCandidateIndexName(index, eventId, value) {
  const normalizedValues = buildPlayerNameSearchValues(value);
  normalizedValues.forEach((normalizedValue) => {
    if (normalizedValue.length < 2) {
      return;
    }
    if (!index[normalizedValue]) {
      index[normalizedValue] = [];
    }
    const eventIds = index[normalizedValue];
    if (eventIds[eventIds.length - 1] !== eventId && !eventIds.includes(eventId)) {
      eventIds.push(eventId);
    }
  });
}

function addPlayerRecordCandidateIndexMatch(index, eventId, match, translations) {
  (Array.isArray(match?.competitors) ? match.competitors : []).forEach((competitor) => {
    getPlayerRecordCandidateIndexNameValues(competitor, translations).forEach((name) => {
      addPlayerRecordCandidateIndexName(index, eventId, name);
    });
  });

  (Array.isArray(match?.singles) ? match.singles : []).forEach((single) => {
    addPlayerRecordCandidateIndexMatch(index, eventId, single, translations);
  });
}

async function buildPlayerRecordCandidateIndex(snapshot, signature) {
  const translations = readTranslations(TRANSLATIONS_PATH);
  const index = {};
  let indexedMatches = 0;

  for (let indexPosition = 0; indexPosition < snapshot.length; indexPosition += 1) {
    if (indexPosition % 20 === 0) {
      await yieldToEventLoop();
    }
    const file = snapshot[indexPosition];
    const { normalizedMatches } = getParsedPlayerRecordArchive(file);
    if (!Array.isArray(normalizedMatches) || normalizedMatches.length === 0) {
      continue;
    }
    indexedMatches += normalizedMatches.length;
    normalizedMatches.forEach((match) => {
      addPlayerRecordCandidateIndexMatch(index, file.eventId, match, translations);
    });
  }

  Object.keys(index).forEach((key) => {
    index[key].sort((left, right) => String(left).localeCompare(String(right), "en", { numeric: true }));
  });

  const generatedAt = new Date().toISOString();
  const manifest = {
    version: PLAYER_RECORD_CANDIDATE_INDEX_VERSION,
    generatedAt,
    signature,
    eventCount: snapshot.length,
    indexedMatches,
    keyCount: Object.keys(index).length,
  };

  try {
    writeJsonFileAtomic(PLAYER_RECORD_CANDIDATE_INDEX_PATH, index);
    writeJsonFileAtomic(PLAYER_RECORD_CANDIDATE_INDEX_MANIFEST_PATH, manifest);
  } catch (error) {
    console.warn("[player-record-candidate-index] write failed:", error?.message || error);
  }

  return {
    signature,
    generatedAt,
    index,
  };
}

async function getPlayerRecordCandidateIndex(snapshot, signature) {
  if (process.env.PLAYER_RECORD_CANDIDATE_INDEX_DISABLED === "1") {
    return null;
  }

  if (
    playerRecordCandidateIndexState.signature === signature &&
    playerRecordCandidateIndexState.index
  ) {
    return playerRecordCandidateIndexState;
  }

  const diskIndex = readPlayerRecordCandidateIndexFromDisk(signature);
  if (diskIndex) {
    setPlayerRecordCandidateIndexState(diskIndex);
    return playerRecordCandidateIndexState;
  }

  return null;
}

function startPlayerRecordCandidateIndexBuild(snapshot, signature) {
  if (process.env.PLAYER_RECORD_CANDIDATE_INDEX_DISABLED === "1") {
    return;
  }
  if (
    playerRecordCandidateIndexState.signature === signature &&
    playerRecordCandidateIndexState.index
  ) {
    return;
  }
  if (
    playerRecordCandidateIndexState.building &&
    playerRecordCandidateIndexState.buildingSignature === signature
  ) {
    return;
  }

  playerRecordCandidateIndexState.buildingSignature = signature;
  playerRecordCandidateIndexState.building = buildPlayerRecordCandidateIndex(snapshot, signature)
    .then((builtIndex) => {
      setPlayerRecordCandidateIndexState(builtIndex);
      return playerRecordCandidateIndexState;
    })
    .catch((error) => {
      console.warn("[player-record-candidate-index] build failed:", error?.message || error);
      return null;
    })
    .finally(() => {
      playerRecordCandidateIndexState.building = null;
      playerRecordCandidateIndexState.buildingSignature = null;
    });
}

function getPlayerRecordIndexedEventIds(candidateIndex, textNeedles) {
  if (!candidateIndex || !candidateIndex.index || !Array.isArray(textNeedles) || textNeedles.length === 0) {
    return null;
  }

  const eventIds = new Set();
  const index = candidateIndex.index;
  const keys = Object.keys(index);

  textNeedles.forEach((needle) => {
    const phrase = String(needle?.phrase || "").trim();
    if (phrase && Array.isArray(index[phrase])) {
      index[phrase].forEach((eventId) => eventIds.add(eventId));
    }
  });

  if (eventIds.size > 0) {
    return eventIds;
  }

  for (const key of keys) {
    if (textNeedles.some((needle) => playerRecordNameMatchesNeedle(key, needle?.phrase || ""))) {
      index[key].forEach((eventId) => eventIds.add(eventId));
    }
  }

  return eventIds.size > 0 ? eventIds : null;
}

async function getPlayerRecordIndexedCandidateSnapshot(snapshot, textNeedles, signature) {
  const sharded = getPlayerRecordShardedEventIds(signature, textNeedles);
  if (sharded) {
    return {
      snapshot: snapshot.filter((file) => sharded.eventIds.has(file.eventId)),
      generatedAt: sharded.generatedAt,
      playerKeyCount: sharded.playerKeyCount,
    };
  }

  const candidateIndex = await getPlayerRecordCandidateIndex(snapshot, signature);
  const eventIds = getPlayerRecordIndexedEventIds(candidateIndex, textNeedles);
  if (!eventIds) {
    return null;
  }
  return {
    snapshot: snapshot.filter((file) => eventIds.has(file.eventId)),
    generatedAt: candidateIndex.generatedAt,
  };
}

async function getPlayerRecordGrepCandidatePaths(snapshot, textNeedles) {
  if (!Array.isArray(snapshot) || snapshot.length === 0 || !Array.isArray(textNeedles) || textNeedles.length === 0) {
    return null;
  }

  const tokenGroups = [];
  textNeedles.forEach((needle) => {
    const tokens = Array.isArray(needle.tokens) ? needle.tokens.filter((token) => String(token || "").length >= 2) : [];
    if (tokens.length > 0) {
      tokenGroups.push(tokens);
    }
  });

  if (tokenGroups.length === 0) {
    return null;
  }

  const bestGroup = tokenGroups.sort((left, right) => right.length - left.length)[0];
  let candidatePaths = new Set(snapshot.map((file) => file.parseFilePath || file.filePath));

  for (const token of bestGroup) {
    const currentFiles = snapshot.filter((file) => candidatePaths.has(file.parseFilePath || file.filePath));
    const matchedPaths = await runGrepFileCandidates(currentFiles, token);
    if (matchedPaths === null) {
      return null;
    }
    candidatePaths = matchedPaths;
    if (candidatePaths.size === 0) {
      break;
    }
  }

  return candidatePaths;
}

async function getHeadToHeadGrepCandidateSnapshot(snapshot, playerATextNeedles, playerBTextNeedles) {
  const [playerAPaths, playerBPaths] = await Promise.all([
    getPlayerRecordGrepCandidatePaths(snapshot, playerATextNeedles),
    getPlayerRecordGrepCandidatePaths(snapshot, playerBTextNeedles),
  ]);
  if (!playerAPaths || !playerBPaths) {
    return null;
  }

  const bothPaths = new Set();
  playerAPaths.forEach((filePath) => {
    if (playerBPaths.has(filePath)) {
      bothPaths.add(filePath);
    }
  });

  return {
    snapshot: snapshot.filter((file) => bothPaths.has(file.parseFilePath || file.filePath)),
    playerAEventCount: playerAPaths.size,
    playerBEventCount: playerBPaths.size,
  };
}

async function getHeadToHeadIndexedCandidateSnapshot(snapshot, playerATextNeedles, playerBTextNeedles, signature) {
  const candidateIndex = await getPlayerRecordCandidateIndex(snapshot, signature);
  const playerAEventIds = getPlayerRecordIndexedEventIds(candidateIndex, playerATextNeedles);
  const playerBEventIds = getPlayerRecordIndexedEventIds(candidateIndex, playerBTextNeedles);
  if (!playerAEventIds || !playerBEventIds) {
    return null;
  }

  const bothEventIds = new Set();
  playerAEventIds.forEach((eventId) => {
    if (playerBEventIds.has(eventId)) {
      bothEventIds.add(eventId);
    }
  });

  return {
    snapshot: snapshot.filter((file) => bothEventIds.has(file.eventId)),
    generatedAt: candidateIndex.generatedAt,
    playerAEventCount: playerAEventIds.size,
    playerBEventCount: playerBEventIds.size,
  };
}

function pushPlayerRecordMatch(matches, match, competitorIndex, translations, rules, roundContext, parentMatch = null) {
  const sourceMatch = parentMatch || match;
  matches.push({
    categoryName: sourceMatch.categoryName || match.categoryName || "",
    roundLabel: translateRoundJa(
      sourceMatch.roundKey || match.roundKey,
      sourceMatch.roundLabel || match.roundLabel,
      translations,
      rules,
      roundContext,
    ),
    line: buildPlayerRecordLine(match, competitorIndex, translations),
    documentCode: match.documentCode || sourceMatch.documentCode || "",
  });
}


function escapeGrepFixedPattern(value) {
  return String(value || "").replace(/\n/g, " ").trim();
}

function runGrepFileCandidates(files, token) {
  const pattern = escapeGrepFixedPattern(token);
  if (!pattern || files.length === 0) {
    return Promise.resolve([]);
  }

  const results = new Set();
  const chunkSize = 100;
  const runChunk = (chunk) => new Promise((resolve) => {
    let stdout = "";
    const grep = spawn("grep", [
      "-I",
      "-l",
      "-i",
      "-F",
      "--",
      pattern,
      ...chunk.map((file) => file.parseFilePath || file.filePath),
    ]);

    grep.stdout.on("data", (data) => {
      stdout += data.toString("utf8");
    });

    grep.on("error", (error) => {
      if (error && error.code === "ENOENT") {
        resolve(null);
        return;
      }
      resolve(new Set());
    });

    grep.on("close", (code) => {
      if (code === 0 && stdout) {
        resolve(new Set(stdout.split(/\n/).filter(Boolean)));
        return;
      }
      resolve(new Set());
    });
  });

  return (async () => {
    for (let index = 0; index < files.length; index += chunkSize) {
      const chunk = files.slice(index, index + chunkSize);
      const matchedPaths = await runChunk(chunk);
      if (matchedPaths === null) {
        return null;
      }
      matchedPaths.forEach((filePath) => results.add(filePath));
    }

    return results;
  })();
}

async function getPlayerRecordCandidateSnapshot(snapshot, textNeedles, signature) {
  if (!Array.isArray(snapshot) || snapshot.length === 0 || !Array.isArray(textNeedles) || textNeedles.length === 0) {
    return {
      snapshot: [],
      source: "candidate-index-miss",
      generatedAt: null,
    };
  }

  const indexedCandidate = await getPlayerRecordIndexedCandidateSnapshot(snapshot, textNeedles, signature);
  if (indexedCandidate) {
    return {
      snapshot: indexedCandidate.snapshot,
      source: "candidate-index",
      generatedAt: indexedCandidate.generatedAt,
    };
  }

  return {
    snapshot: [],
    source: "candidate-index-miss",
    generatedAt: null,
  };
}


function getPlayerRecordCategorySortValue(categoryName) {
  const text = String(categoryName || "")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!text) {
    return [9, 9, text];
  }

  const isPara = /\bclass(?:es)?\b|para/.test(text);
  const genderOrder = /\bmen\b|\bmens\b|男子/.test(text)
    ? 0
    : /\bwomen\b|\bwomens\b|女子/.test(text)
      ? 1
      : /\bmixed\b|混合/.test(text)
        ? 2
        : 3;
  const disciplineOrder = /\bsingles\b|シングルス/.test(text)
    ? 0
    : /\bteams?\b|団体/.test(text)
      ? 1
      : /\bdoubles\b|ダブルス/.test(text)
        ? 2
        : 3;

  return [isPara ? 1 : 0, disciplineOrder, genderOrder, text];
}

function comparePlayerRecordCategoryName(left, right) {
  const leftKey = getPlayerRecordCategorySortValue(left);
  const rightKey = getPlayerRecordCategorySortValue(right);
  for (let index = 0; index < Math.max(leftKey.length, rightKey.length); index += 1) {
    if (leftKey[index] < rightKey[index]) {
      return -1;
    }
    if (leftKey[index] > rightKey[index]) {
      return 1;
    }
  }
  return 0;
}

function comparePlayerRecordMatches(left, right) {
  const categoryCompare = comparePlayerRecordCategoryName(left?.categoryName, right?.categoryName);
  if (categoryCompare !== 0) {
    return categoryCompare;
  }
  const roundCompare = getPlayerRecordRoundSortValue(left) - getPlayerRecordRoundSortValue(right);
  if (roundCompare !== 0) {
    return roundCompare;
  }
  return String(left?.documentCode || "").localeCompare(String(right?.documentCode || ""), "en", { numeric: true });
}

function getPlayerRecordRoundSortValue(match) {
  const label = String(match?.roundLabel || "").toLowerCase();
  const documentCode = String(match?.documentCode || "").toUpperCase();
  const value = `${label} ${documentCode}`;

  if (/決勝|final/.test(label) || /FNL/.test(documentCode)) {
    if (/準決勝|semi/.test(label) || /SFNL/.test(documentCode)) return 20;
    if (/準々決勝|quarter/.test(label) || /QFNL/.test(documentCode)) return 30;
    if (/8FNL|round\s+of\s+16|ベスト16|4回戦/.test(value)) return 40;
    if (/R32|round\s+of\s+32|3回戦/.test(value)) return 50;
    if (/R64|round\s+of\s+64|2回戦/.test(value)) return 60;
    if (/R128|round\s+of\s+128|1回戦/.test(value)) return 70;
    if (/決勝トーナメント1回戦/.test(label)) return 80;
    return 10;
  }

  const qualifyingSortValue = getPlayerRecordQualifyingRoundSortValue(match);
  if (qualifyingSortValue !== null) {
    return qualifyingSortValue;
  }
  if (/グループ|group|GP\d+/i.test(value)) {
    return 300;
  }
  return 400;
}

function getPlayerRecordQualifyingRoundSortValue(match) {
  const roundKey = String(match?.roundKey || "").trim().toLowerCase();
  const label = String(match?.roundLabel || "").trim().toLowerCase();
  const documentCode = String(match?.documentCode || "").trim().toUpperCase();
  const value = `${roundKey} ${label} ${documentCode}`;

  if (
    roundKey === "qualification_elimination_round" ||
    /予選(?:トーナメント)?決定戦|qualification\s+elimination/.test(value)
  ) {
    return 200;
  }

  const roundNumber =
    roundKey.match(/^qualifying_round_(\d+)$/)?.[1] ||
    label.match(/qualifying\s+round\s+(\d+)/)?.[1] ||
    label.match(/予選(?:第)?(\d+)回戦/)?.[1] ||
    documentCode.match(/RND(\d+)/)?.[1];

  if (roundNumber) {
    return 250 - Number(roundNumber);
  }

  if (/予選|予備|qualification|qualifying|RND/i.test(value)) {
    return 250;
  }

  return null;
}

function buildPlayerRecordMatchGroups(matches) {
  const grouped = new Map();

  (Array.isArray(matches) ? matches : []).forEach((match) => {
    const categoryName = String(match?.categoryName || "その他").trim() || "その他";
    if (!grouped.has(categoryName)) {
      grouped.set(categoryName, []);
    }
    grouped.get(categoryName).push(match);
  });

  return [...grouped.entries()]
    .sort(([leftCategory], [rightCategory]) => comparePlayerRecordCategoryName(leftCategory, rightCategory))
    .map(([categoryName, groupMatches]) => ({
      categoryName,
      matches: [...groupMatches].sort(comparePlayerRecordMatches),
    }));
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function collectPlayerRecordEvents(snapshot, needles, textNeedles, options = {}) {
  const translations = readTranslations(TRANSLATIONS_PATH);
  const rules = readRules(RULES_PATH);
  const searchIndex = readWttSearchIndex();
  const dateIndex = readWttDateIndex(WTT_DATE_INDEX_PATH);
  const archiveIndex = readWttArchiveIndex();
  const eventNames = getEventNamesMap();
  const eventLimit = Number.isFinite(options.eventLimit) && options.eventLimit > 0 ? options.eventLimit : Infinity;
  const matchLimit = Number.isFinite(options.matchLimit) && options.matchLimit > 0 ? options.matchLimit : Infinity;
  const orgFilter = options.orgFilter || null;
  const files = (Array.isArray(snapshot) ? snapshot : [])
    .map((file) => ({
      file,
      meta: getEventRecordMeta(file.eventId, searchIndex, dateIndex, archiveIndex, eventNames),
    }))
    .sort((left, right) => comparePlayerRecordEvents(left.meta, right.meta));
  const events = [];
  let collectedMatches = 0;
  let parsedEvents = 0;
  let scannedMatches = 0;

  for (const { file, meta } of files) {
    if (events.length >= eventLimit || collectedMatches >= matchLimit) {
      break;
    }
    await yieldToEventLoop();
    const text = readTextFile(file.parseFilePath || file.filePath);
    if (!text || (Array.isArray(textNeedles) && textNeedles.length > 0 && !textLikelyContainsPlayer(text, textNeedles))) {
      continue;
    }

    const {
      normalizedMatches,
      contextsByCategory,
      fallbackRoundContext,
    } = getParsedPlayerRecordArchive(file, text);
    if (!Array.isArray(normalizedMatches) || normalizedMatches.length === 0) {
      continue;
    }

    parsedEvents += 1;
    const matches = [];

    for (const match of normalizedMatches) {
      const matchRoundContext = contextsByCategory.get(getRoundContextKey(match)) || fallbackRoundContext;

      scannedMatches += 1;

      if (match.matchType === "individual") {
        const competitorIndex = findPlayerCompetitorIndex(match, needles, translations, orgFilter);
        if (competitorIndex >= 0) {
          pushPlayerRecordMatch(
            matches,
            match,
            competitorIndex,
            translations,
            rules,
            matchRoundContext,
          );
        }
        continue;
      }

      if (match.matchType !== "team") {
        continue;
      }

      (Array.isArray(match.singles) ? match.singles : []).forEach((single) => {
        scannedMatches += 1;
        const competitorIndex = findPlayerCompetitorIndex(single, needles, translations, orgFilter);
        if (competitorIndex >= 0) {
          pushPlayerRecordMatch(
            matches,
            single,
            competitorIndex,
            translations,
            rules,
            matchRoundContext,
            match,
          );
        }
      });
    }

    if (matches.length === 0) {
      continue;
    }

    const matchGroups = buildPlayerRecordMatchGroups(matches);
    collectedMatches += matches.length;
    events.push({
      ...meta,
      source: file.sourceLabel || "",
      matches: matchGroups.flatMap((group) => group.matches),
      matchGroups,
    });
  }

  events.sort(comparePlayerRecordEvents);
  return {
    events,
    parsedEvents,
    scannedMatches,
  };
}

function collectPlayerRecordEventsFromPersistentIndex(indexState, needles) {
  const index = indexState?.index;
  if (!index?.players || !index?.records || Object.keys(index.records).length === 0) {
    return null;
  }

  const playerKeys = getHeadToHeadIndexPlayerKeys(index, needles);
  if (playerKeys.size === 0) {
    return {
      events: [],
      parsedEvents: 0,
      scannedMatches: 0,
      candidateEventCount: 0,
      playerKeyCount: 0,
    };
  }

  const eventsById = new Map();
  let hasIndexedRecordForPlayer = false;
  playerKeys.forEach((key) => {
    const recordsByEventId = index.records[key] || {};
    if (Object.keys(recordsByEventId).length > 0) {
      hasIndexedRecordForPlayer = true;
    }
    Object.entries(recordsByEventId).forEach(([eventId, event]) => {
      if (!eventsById.has(eventId)) {
        eventsById.set(eventId, {
          ...event,
          matches: [],
        });
      }
      const target = eventsById.get(eventId);
      const seen = new Set(target.matches.map(getPlayerRecordIndexMatchId));
      (Array.isArray(event.matches) ? event.matches : []).forEach((match) => {
        const matchId = getPlayerRecordIndexMatchId(match);
        if (!seen.has(matchId)) {
          target.matches.push(match);
          seen.add(matchId);
        }
      });
    });
  });

  if (!hasIndexedRecordForPlayer) {
    return null;
  }

  const events = [...eventsById.values()].map((event) => {
    const matchGroups = buildPlayerRecordMatchGroups(event.matches || []);
    return {
      ...event,
      matches: matchGroups.flatMap((group) => group.matches),
      matchGroups,
    };
  }).sort(comparePlayerRecordEvents);

  return {
    events,
    parsedEvents: 0,
    scannedMatches: 0,
    candidateEventCount: events.length,
    playerKeyCount: playerKeys.size,
  };
}

function filterIndexedPlayerRecordEventsByOrgFilter(indexed, orgFilter, translations = {}) {
  if (!orgFilter || !indexed || !Array.isArray(indexed.events)) {
    return indexed;
  }

  const translatedNeedle = String(orgFilter.translatedName || "").trim();
  const orgLabels = [...(orgFilter.orgLabels || [])].map((value) => String(value || "").trim()).filter(Boolean);
  const siblingTranslatedNames = Object.entries(translations.playerOrgOverrides || {})
    .filter(([key]) => {
      const [namePart] = String(key || "").split("|");
      return getNameTranslationCandidates(namePart)
        .map(normalizePlayerTranslationKey)
        .some((name) => orgFilter.names.has(name));
    })
    .map(([, translated]) => String(translated || "").trim())
    .filter((translated) => translated && translated !== translatedNeedle);

  const normalizeIndexedLine = (line) => {
    let normalizedLine = String(line || "");
    orgLabels.forEach((label) => {
      siblingTranslatedNames.forEach((siblingName) => {
        normalizedLine = normalizedLine.replaceAll(`${siblingName}（${label}）`, `${translatedNeedle}（${label}）`);
      });
    });
    return normalizedLine;
  };

  const events = indexed.events
    .map((event) => {
      const matches = (event.matches || []).map((match) => {
        const line = String(match?.line || "");
        const hasOrgLabel = orgLabels.some((label) => line.includes(`（${label}）`) || line.includes(`／${label}`));
        if (!hasOrgLabel) {
          return null;
        }
        const normalizedLine = normalizeIndexedLine(line);
        if (!normalizedLine.includes(translatedNeedle)) {
          return null;
        }
        return normalizedLine === line ? match : { ...match, line: normalizedLine };
      }).filter(Boolean);
      if (matches.length === 0) {
        return null;
      }
      const matchGroups = buildPlayerRecordMatchGroups(matches);
      return {
        ...event,
        matches: matchGroups.flatMap((group) => group.matches),
        matchGroups,
      };
    })
    .filter(Boolean);

  return {
    ...indexed,
    events,
    candidateEventCount: events.length,
  };
}

function getLegacyPlayerRecordShardName(key) {
  const first = String(key || "").trim().charAt(0).toLowerCase();
  return /^[a-z]$/.test(first) ? `${first}.json` : "_.json";
}

function readLegacyPlayerRecordShard(dirPath, shardName) {
  const cacheKey = `${dirPath}:${shardName}`;
  if (legacyPlayerRecordShardCache.has(cacheKey)) {
    return legacyPlayerRecordShardCache.get(cacheKey);
  }
  try {
    const shardPath = path.join(dirPath, shardName);
    const shard = JSON.parse(fs.readFileSync(shardPath, "utf8"));
    legacyPlayerRecordShardCache.set(cacheKey, shard && typeof shard === "object" && !Array.isArray(shard) ? shard : {});
  } catch {
    legacyPlayerRecordShardCache.set(cacheKey, {});
  }
  while (legacyPlayerRecordShardCache.size > 4) {
    const oldestKey = legacyPlayerRecordShardCache.keys().next().value;
    legacyPlayerRecordShardCache.delete(oldestKey);
  }
  return legacyPlayerRecordShardCache.get(cacheKey) || {};
}

function getLegacyPlayerRecordEventsForNeedles(needles) {
  const dirs = [PLAYER_RECORDS_INDEX_DIR, BUNDLED_PLAYER_RECORDS_INDEX_DIR];
  const eventsById = new Map();
  let playerKeyCount = 0;

  Array.from(new Set(needles.map(normalizePlayerSearchText).filter(Boolean))).forEach((needle) => {
    const shardName = getLegacyPlayerRecordShardName(needle);
    dirs.forEach((dirPath) => {
      if (!fs.existsSync(path.join(dirPath, shardName))) {
        return;
      }
      const shard = readLegacyPlayerRecordShard(dirPath, shardName);
      const events = Array.isArray(shard[needle]) ? shard[needle] : [];
      if (events.length === 0) {
        return;
      }
      playerKeyCount += 1;
      events.forEach((event) => {
        const eventId = String(event?.event || "");
        if (!eventId) {
          return;
        }
        if (!eventsById.has(eventId)) {
          eventsById.set(eventId, {
            ...event,
            matches: [],
          });
        }
        const target = eventsById.get(eventId);
        const seen = new Set(target.matches.map(getPlayerRecordIndexMatchId));
        (Array.isArray(event.matches) ? event.matches : []).forEach((match) => {
          const matchId = getPlayerRecordIndexMatchId(match);
          if (!seen.has(matchId)) {
            target.matches.push(match);
            seen.add(matchId);
          }
        });
      });
    });
  });

  if (eventsById.size === 0) {
    return null;
  }

  const events = [...eventsById.values()].map((event) => {
    const matchGroups = buildPlayerRecordMatchGroups(event.matches || []);
    return {
      ...event,
      matches: matchGroups.flatMap((group) => group.matches),
      matchGroups,
    };
  }).sort(comparePlayerRecordEvents);

  return {
    events,
    parsedEvents: 0,
    scannedMatches: 0,
    candidateEventCount: events.length,
    playerKeyCount,
  };
}

function collectPlayerRecordEventsFromShardIndex(indexState, needles) {
  const index = indexState?.index;
  if (!index?.players || !index?.playerRecordMatchShardsDir) {
    return null;
  }

  const playerKeys = getHeadToHeadIndexPlayerKeys(index, needles);
  if (playerKeys.size === 0) {
    return {
      events: [],
      parsedEvents: 0,
      scannedMatches: 0,
      candidateEventCount: 0,
      playerKeyCount: 0,
    };
  }

  const eventMap = new Map();
  let scannedShardLines = 0;
  const recordKeys = new Set([...playerKeys].map((key) => index.recordAliases?.[key] || key));
  recordKeys.forEach((recordKey) => {
    const keyToken = `"key":${JSON.stringify(recordKey)}`;
    getPlayerRecordShardLines(index, recordKey).forEach((line) => {
      scannedShardLines += 1;
      if (!line.includes(keyToken)) {
        return;
      }
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return;
      }
      if (entry?.key !== recordKey || !entry?.event || !entry?.match) {
        return;
      }
      const eventId = String(entry.event.event || "");
      if (!eventId) {
        return;
      }
      if (!eventMap.has(eventId)) {
        eventMap.set(eventId, {
          ...entry.event,
          matches: [],
        });
      }
      const event = eventMap.get(eventId);
      const matchId = getPlayerRecordIndexMatchId(entry.match);
      if (!event.matches.some((existing) => getPlayerRecordIndexMatchId(existing) === matchId)) {
        event.matches.push(entry.match);
      }
    });
  });

  const events = [...eventMap.values()].map((event) => {
    const matchGroups = buildPlayerRecordMatchGroups(event.matches || []);
    return {
      ...event,
      matches: matchGroups.flatMap((group) => group.matches),
      matchGroups,
    };
  }).sort(comparePlayerRecordEvents);

  return {
    events,
    parsedEvents: 0,
    scannedMatches: scannedShardLines,
    candidateEventCount: events.length,
    playerKeyCount: playerKeys.size,
  };
}

function getPlayerRecordCandidateSnapshotFromHeadToHeadIndex(indexState, snapshot, needles) {
  const index = indexState?.index;
  if (!index?.players) {
    return null;
  }

  const playerKeys = getHeadToHeadIndexPlayerKeys(index, needles);
  if (playerKeys.size === 0) {
    return null;
  }

  const eventIds = getHeadToHeadIndexEventIdsForPlayer(index, playerKeys);
  if (eventIds.size === 0) {
    return null;
  }

  const indexedEventIds = new Set(Array.isArray(indexState.eventIds) ? indexState.eventIds.map(String) : []);
  const candidateSnapshot = snapshot.filter((file) => {
    const eventId = String(file.eventId);
    return eventIds.has(eventId) || (indexState.stale && indexedEventIds.size > 0 && !indexedEventIds.has(eventId));
  });
  if (candidateSnapshot.length === 0) {
    return null;
  }

  return {
    snapshot: candidateSnapshot,
    source: indexState.stale ? "head-to-head-player-events+delta" : "head-to-head-player-events",
    generatedAt: indexState.generatedAt,
    playerKeyCount: playerKeys.size,
    eventIdCount: eventIds.size,
  };
}

async function getPlayerRecordSearchResult(name, translatedName, needles, options = {}) {
  const snapshot = getWttRecordFileSnapshot();
  const signature = getPlayerRecordCacheSignature(snapshot);
  const eventLimit = Number.isFinite(options.eventLimit) && options.eventLimit > 0 ? options.eventLimit : null;
  const matchLimit = Number.isFinite(options.matchLimit) && options.matchLimit > 0 ? options.matchLimit : null;
  const orgFilter = options.orgFilter || null;
  const orgFilterKey = orgFilter
    ? `${orgFilter.normalizedTranslatedName}:${[...orgFilter.orgs].sort().join(",")}`
    : "none";
  const cacheKey = `${signature}::${needles.join("|")}::org=${orgFilterKey}::events=${eventLimit || "all"}::matches=${matchLimit || "all"}`;
  const cached = playerRecordResultCache.get(cacheKey);
  if (cached && Date.now() - cached.builtAt < PLAYER_RECORD_RESULT_CACHE_TTL_MS) {
    return {
      ...cached,
      cacheHit: true,
    };
  }

  const textNeedles = buildPlayerRecordTextNeedles(...needles);
  const indexedCandidate = await getPlayerRecordIndexedCandidateSnapshot(snapshot, textNeedles, signature);
  if (indexedCandidate) {
    const collected = await collectPlayerRecordEventsWithMissingIndexFallback(
      indexedCandidate.snapshot,
      needles,
      textNeedles,
      { eventLimit, matchLimit, orgFilter },
    );
    const result = {
      signature,
      builtAt: Date.now(),
      eventIndexSource: "player-record-event-index",
      candidateIndexSource: "candidate-index",
      candidateIndexGeneratedAt: indexedCandidate.generatedAt,
      eventIndexGeneratedAt: null,
      scannedEvents: snapshot.length,
      candidateEvents: indexedCandidate.snapshot.length,
      playerKeyCount: indexedCandidate.playerKeyCount || 0,
      deltaEvents: 0,
      ...collected,
    };
    setPlayerRecordResultCacheValue(cacheKey, result);
    return {
      ...result,
      cacheHit: false,
    };
  }

  const candidateResult = await getPlayerRecordCandidateSnapshot(snapshot, textNeedles, signature);
  const candidateSnapshot = candidateResult.snapshot;
  const collected = await collectPlayerRecordEventsWithMissingIndexFallback(
    candidateSnapshot,
    needles,
    textNeedles,
    { eventLimit, matchLimit, orgFilter },
  );
  const result = {
    signature,
    builtAt: Date.now(),
    eventIndexSource: "player-record-event-index",
    candidateIndexSource: candidateResult.source,
    candidateIndexGeneratedAt: candidateResult.generatedAt,
    eventIndexGeneratedAt: null,
    scannedEvents: snapshot.length,
    candidateEvents: candidateSnapshot.length,
    playerKeyCount: candidateResult.playerKeyCount || 0,
    ...collected,
  };
  setPlayerRecordResultCacheValue(cacheKey, result);
  return {
    ...result,
    cacheHit: false,
  };
}

function buildHeadToHeadMatchLine(match, translations) {
  const winnerIndex = getWinnerIndexForRecord(match);
  const leftIndex = winnerIndex === 0 || winnerIndex === 1 ? winnerIndex : 0;
  const rightIndex = leftIndex === 0 ? 1 : 0;
  const left = formatCompetitorForRecord(match.competitors?.[leftIndex], translations);
  const right = formatCompetitorForRecord(match.competitors?.[rightIndex], translations);
  const score = formatGameScoresForRecord(match, leftIndex);
  return `${left}　${score}　${right}`;
}

const headToHeadPersistentIndexState = {
  signature: null,
  currentSignature: null,
  generatedAt: null,
  stale: false,
  eventIds: [],
  eventSignatures: {},
  index: null,
};

function getHeadToHeadPersistentIndexSignature(snapshot) {
  const dataSignature = snapshot.map((file) => [
    file.eventId,
    getHeadToHeadEventFileSignature(file),
  ].join(":")).join("|");
  const configSignature = [
    TRANSLATIONS_PATH,
    RULES_PATH,
    WTT_ARCHIVE_INDEX_PATH,
    WTT_DATE_INDEX_PATH,
    WTT_SEARCH_INDEX_PATH,
    EVENT_NAMES_PATH,
  ].map((filePath) => `${path.basename(filePath)}:${getFileHashToken(filePath)}`).join("|");
  return crypto.createHash("sha1").update(`${dataSignature}::${configSignature}`).digest("hex");
}

function getHeadToHeadEventFileSignature(file) {
  const parseSource = file?.parseSource || "raw";
  // Bundled/runtime SLIM files can receive a new mtime during deployment or
  // persistence sync without changing their contents.  RAW files remain
  // mtime-sensitive because they can be updated before their SLIM derivative
  // is generated.
  const parseMtimeMs = parseSource === "raw"
    ? (file?.parseMtimeMs || file?.mtimeMs || 0)
    : 0;
  return [
    file?.size || 0,
    parseMtimeMs,
    parseSource,
    file?.parseSize || file?.size || 0,
    parseMtimeMs,
  ].join(":");
}

function isHeadToHeadPairIndexEventCurrent(file, indexedSignature, indexGeneratedAt = null) {
  const currentSignature = getHeadToHeadEventFileSignature(file);
  if (indexedSignature === currentSignature) {
    return true;
  }
  const indexedParts = String(indexedSignature || "").split(":");
  const currentParts = currentSignature.split(":");
  // Compatibility for indexes generated before SLIM mtimes were excluded.
  // Match the stable fields only; a deployment timestamp must not invalidate
  // an otherwise identical SLIM event.
  if (
    currentParts[2] === "slim" &&
    indexedParts[2] === "slim" &&
    indexedParts[0] === currentParts[0] &&
    indexedParts[3] === currentParts[3]
  ) {
    return true;
  }
  // SLIM preserves the match fields used by H2H. A RAW-built pair shard
  // remains valid when the same event is later read from its SLIM derivative.
  if (indexedParts[2] === "raw" && file?.parseSource === "slim") {
    return true;
  }
  const generatedAtMs = Date.parse(String(indexGeneratedAt || ""));
  const fileMtimeMs = Math.max(Number(file?.mtimeMs || 0), Number(file?.parseMtimeMs || 0));
  return Number.isFinite(generatedAtMs) && fileMtimeMs > 0 && fileMtimeMs <= generatedAtMs;
}

function isHeadToHeadPersistentIndexCurrent(snapshot = getWttRecordFileSnapshot()) {
  for (const manifestPath of [HEAD_TO_HEAD_INDEX_MANIFEST_PATH, BUNDLED_HEAD_TO_HEAD_INDEX_MANIFEST_PATH]) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest?.version !== HEAD_TO_HEAD_INDEX_VERSION) {
        continue;
      }
      const effective = getHeadToHeadEffectiveEventIndex(manifest, manifestPath);
      if (
        manifest?.pairRecordIndex === true &&
        snapshot.every((file) => effective.eventIds.has(String(file.eventId)) &&
          isHeadToHeadPairIndexEventCurrent(
            file,
            effective.eventSignatures[String(file.eventId)],
            effective.generatedAt,
          ))
      ) {
        return true;
      }
    } catch {
      // Try the next manifest location.
    }
  }
  return false;
}

function getHeadToHeadEffectiveEventIndex(manifest, manifestPath = HEAD_TO_HEAD_INDEX_MANIFEST_PATH) {
  const eventIds = new Set(Array.isArray(manifest?.eventIds) ? manifest.eventIds.map(String) : []);
  const eventSignatures = {
    ...(manifest?.eventSignatures || {}),
  };
  let generatedAt = manifest?.generatedAt || null;

  // Incremental H2H updates are stored as a delta overlay. Treat its event
  // signatures as part of the effective index for coverage and freshness
  // checks; the base manifest is intentionally not rewritten on every event.
  if (manifestPath === HEAD_TO_HEAD_INDEX_MANIFEST_PATH) {
    try {
      const delta = JSON.parse(fs.readFileSync(HEAD_TO_HEAD_DELTA_INDEX_MANIFEST_PATH, "utf8"));
      if (delta?.version === HEAD_TO_HEAD_DELTA_INDEX_VERSION) {
        (Array.isArray(delta.eventIds) ? delta.eventIds : []).forEach((eventId) => eventIds.add(String(eventId)));
        Object.assign(eventSignatures, delta.eventSignatures || {});
        if (!generatedAt || String(delta.generatedAt || "") > String(generatedAt)) {
          generatedAt = delta.generatedAt || generatedAt;
        }
      }
    } catch {
      // The base index remains usable when the delta manifest is unavailable.
    }
  }

  return { eventIds, eventSignatures, generatedAt };
}

function readHeadToHeadPersistentIndexFromDisk(signature) {
  const candidates = [
    [HEAD_TO_HEAD_INDEX_MANIFEST_PATH, HEAD_TO_HEAD_PLAYER_INDEX_PATH, PLAYER_RECORD_MATCH_SHARDS_DIR, HEAD_TO_HEAD_PAIR_SHARDS_DIR],
    [BUNDLED_HEAD_TO_HEAD_INDEX_MANIFEST_PATH, BUNDLED_HEAD_TO_HEAD_PLAYER_INDEX_PATH, BUNDLED_PLAYER_RECORD_MATCH_SHARDS_DIR, BUNDLED_HEAD_TO_HEAD_PAIR_SHARDS_DIR],
  ];
  let staleIndex = null;

  for (const [manifestPath, playerIndexPath, playerRecordMatchShardsDir, pairShardsDir] of candidates) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest?.version !== HEAD_TO_HEAD_INDEX_VERSION) {
        continue;
      }
      const playerIndex = JSON.parse(fs.readFileSync(playerIndexPath, "utf8"));
      if (!playerIndex?.players || typeof playerIndex.players !== "object" || Array.isArray(playerIndex.players)) {
        continue;
      }
      const indexState = {
        signature: manifest.signature || null,
        currentSignature: signature,
        generatedAt: manifest.generatedAt || null,
        stale: manifest.signature !== signature,
        eventIds: Array.isArray(manifest.eventIds) ? manifest.eventIds.map(String) : [],
        eventSignatures: manifest.eventSignatures && typeof manifest.eventSignatures === "object"
          ? manifest.eventSignatures
          : {},
        index: {
          players: playerIndex.players,
          records: playerIndex.records && typeof playerIndex.records === "object" && !Array.isArray(playerIndex.records)
            ? playerIndex.records
            : {},
          pairs: playerIndex.pairs && typeof playerIndex.pairs === "object" && !Array.isArray(playerIndex.pairs)
            ? playerIndex.pairs
            : {},
          recordAliases: playerIndex.recordAliases && typeof playerIndex.recordAliases === "object" && !Array.isArray(playerIndex.recordAliases)
            ? playerIndex.recordAliases
            : {},
          playerRecordMatchShardsDir: manifest.playerRecordMatchShardIndex && fs.existsSync(playerRecordMatchShardsDir)
            ? playerRecordMatchShardsDir
            : null,
          playerRecordMatchShardCache: new Map(),
          pairShardsDir: manifest.pairRecordIndex &&
            manifest.pairRecordIndexVersion === HEAD_TO_HEAD_PAIR_INDEX_VERSION &&
            fs.existsSync(pairShardsDir)
            ? pairShardsDir
            : null,
          pairShardEventIds: manifest.pairRecordIndex && Array.isArray(manifest.eventIds)
            ? manifest.eventIds.map(String)
            : [],
          pairShardEventSignatures: manifest.pairRecordIndex && manifest.eventSignatures
            ? manifest.eventSignatures
            : {},
          pairShardCache: new Map(),
        },
      };
      applyHeadToHeadDeltaOverlay(indexState);
      if (manifest.signature === signature) {
        return indexState;
      }
      staleIndex = staleIndex || indexState;
    } catch {
      // Try the next index location.
    }
  }

  return staleIndex;
}

function mergeHeadToHeadIdMap(target, source) {
  Object.entries(source || {}).forEach(([key, values]) => {
    const merged = new Set([...(target[key] || []), ...(Array.isArray(values) ? values : [])].map(String));
    target[key] = [...merged].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  });
}

function applyHeadToHeadDeltaOverlay(indexState) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(HEAD_TO_HEAD_DELTA_INDEX_MANIFEST_PATH, "utf8"));
  } catch {
    return indexState;
  }
  if (manifest?.version !== HEAD_TO_HEAD_DELTA_INDEX_VERSION) {
    return indexState;
  }

  const overlayEventIds = Array.isArray(manifest.eventIds) ? manifest.eventIds.map(String) : [];
  overlayEventIds.forEach((eventId) => {
    try {
      const delta = JSON.parse(fs.readFileSync(path.join(HEAD_TO_HEAD_DELTA_INDEX_DIR, `${eventId}.json`), "utf8"));
      mergeHeadToHeadIdMap(indexState.index.players, delta.players);
      mergeHeadToHeadIdMap(indexState.index.pairs, delta.pairs);
    } catch {
      // Ignore a partially written overlay file.
    }
  });
  const eventIds = new Set((indexState.eventIds || []).map(String));
  overlayEventIds.forEach((eventId) => eventIds.add(eventId));
  indexState.eventIds = [...eventIds];
  indexState.eventSignatures = {
    ...(indexState.eventSignatures || {}),
    ...(manifest.eventSignatures || {}),
  };
  if (
    manifest.pairRecordIndex === true &&
    manifest.pairRecordIndexVersion === HEAD_TO_HEAD_PAIR_INDEX_VERSION &&
    fs.existsSync(HEAD_TO_HEAD_DELTA_PAIR_SHARDS_DIR)
  ) {
    indexState.index.pairDeltaShardsDir = HEAD_TO_HEAD_DELTA_PAIR_SHARDS_DIR;
    indexState.index.pairDeltaEventIds = overlayEventIds.filter((eventId) =>
      fs.existsSync(path.join(HEAD_TO_HEAD_DELTA_PAIR_SHARDS_DIR, eventId)),
    );
  }
  indexState.stale = true;
  return indexState;
}

function setHeadToHeadPersistentIndexState(indexState) {
  headToHeadPersistentIndexState.signature = indexState.signature;
  headToHeadPersistentIndexState.currentSignature = indexState.currentSignature;
  headToHeadPersistentIndexState.generatedAt = indexState.generatedAt;
  headToHeadPersistentIndexState.stale = Boolean(indexState.stale);
  headToHeadPersistentIndexState.eventIds = Array.isArray(indexState.eventIds) ? indexState.eventIds : [];
  headToHeadPersistentIndexState.eventSignatures = indexState.eventSignatures || {};
  headToHeadPersistentIndexState.index = indexState.index;
}

function getHeadToHeadPersistentIndex(signature) {
  if (
    headToHeadPersistentIndexState.currentSignature === signature &&
    headToHeadPersistentIndexState.index
  ) {
    return headToHeadPersistentIndexState;
  }

  const diskIndex = readHeadToHeadPersistentIndexFromDisk(signature);
  if (diskIndex) {
    setHeadToHeadPersistentIndexState(diskIndex);
    return headToHeadPersistentIndexState;
  }

  return null;
}

function getHeadToHeadPairShardName(pairKey) {
  return `${crypto.createHash("sha1").update(String(pairKey || "")).digest("hex").slice(0, 2)}.json`;
}

function getPlayerRecordMatchShardName(key) {
  return `${crypto.createHash("sha1").update(String(key || "")).digest("hex").slice(0, 2)}.jsonl`;
}

function createPlayerRecordMatchShardWriter(baseDir) {
  const tempDir = `${baseDir}.tmp-${process.pid}-${Date.now()}`;
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  return {
    write(key, file, eventMeta, matchEntry) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey || !matchEntry) {
        return;
      }
      const payload = {
        key: normalizedKey,
        event: {
          ...eventMeta,
          source: file.sourceLabel || "",
        },
        match: matchEntry,
      };
      fs.appendFileSync(path.join(tempDir, getPlayerRecordMatchShardName(normalizedKey)), `${JSON.stringify(payload)}\n`);
    },
    close() {
      fs.rmSync(baseDir, { recursive: true, force: true });
      fs.renameSync(tempDir, baseDir);
    },
    abort() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function getAvailableBytes(filePath) {
  try {
    const stat = fs.statfsSync(filePath);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return Infinity;
  }
}

function createHeadToHeadPairShardWriter(baseDir) {
  const tempDir = `${baseDir}.tmp-${process.pid}-${Date.now()}`;
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const fileHandles = new Map();
  let recordCount = 0;

  const closeHandles = () => {
    fileHandles.forEach((handle) => handle.closeSync());
    fileHandles.clear();
  };

  return {
    write(pairKey, payload) {
      if (!pairKey || !payload) {
        return;
      }
      if (recordCount % 128 === 0 && getAvailableBytes(tempDir) < HEAD_TO_HEAD_PAIR_INDEX_MIN_FREE_BYTES) {
        throw new Error(
          `H2H pair index stopped: available disk space is below ${HEAD_TO_HEAD_PAIR_INDEX_MIN_FREE_BYTES} bytes`,
        );
      }
      const shardName = getHeadToHeadPairShardName(pairKey);
      let handle = fileHandles.get(shardName);
      if (!handle) {
        const fd = fs.openSync(path.join(tempDir, shardName), "a");
        handle = {
          write: (text) => fs.writeSync(fd, text),
          closeSync: () => fs.closeSync(fd),
        };
        fileHandles.set(shardName, handle);
      }
      handle.write(`${JSON.stringify({ pairKey, ...payload })}\n`);
      recordCount += 1;
    },
    close() {
      closeHandles();
      fs.rmSync(baseDir, { recursive: true, force: true });
      fs.renameSync(tempDir, baseDir);
      return recordCount;
    },
    abort() {
      closeHandles();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function getHeadToHeadIndexedPairFromDir(index, dir, pairKey, cacheKey) {
  if (!dir || !index?.pairShardCache || !pairKey) {
    return [];
  }
  const shardName = getHeadToHeadPairShardName(pairKey);
  const key = `${cacheKey || "base"}:${shardName}`;
  if (!index.pairShardCache.has(key)) {
    try {
      const shardPath = path.join(dir, shardName);
      const lines = fs.readFileSync(shardPath, "utf8").split(/\n/).filter(Boolean);
      index.pairShardCache.set(key, lines);
    } catch {
      index.pairShardCache.set(key, []);
    }
    while (index.pairShardCache.size > 2) {
      const oldestKey = index.pairShardCache.keys().next().value;
      index.pairShardCache.delete(oldestKey);
    }
  }
  return index.pairShardCache.get(key)
    .map((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed?.pairKey === pairKey ? parsed : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getHeadToHeadIndexedPair(index, pairKey) {
  const base = getHeadToHeadIndexedPairFromDir(index, index?.pairShardsDir, pairKey, "base");
  const delta = (index?.pairDeltaEventIds || []).flatMap((eventId) =>
    getHeadToHeadIndexedPairFromDir(
      index,
      path.join(index.pairDeltaShardsDir || "", String(eventId)),
      pairKey,
      `delta:${eventId}`,
    ),
  );
  const replacedEventIds = new Set((index?.pairDeltaEventIds || []).map(String));
  return [
    ...base.filter((entry) => !replacedEventIds.has(String(entry?.event?.event || ""))),
    ...delta,
  ];
}

function getPlayerRecordShardLines(index, key) {
  if (!index?.playerRecordMatchShardsDir || !index?.playerRecordMatchShardCache) {
    return [];
  }
  const shardName = getPlayerRecordMatchShardName(key);
  if (!index.playerRecordMatchShardCache.has(shardName)) {
    try {
      const shardPath = path.join(index.playerRecordMatchShardsDir, shardName);
      const text = fs.readFileSync(shardPath, "utf8");
      index.playerRecordMatchShardCache.set(shardName, text.split(/\n/).filter(Boolean));
    } catch {
      index.playerRecordMatchShardCache.set(shardName, []);
    }
  }
  return index.playerRecordMatchShardCache.get(shardName) || [];
}

function getHeadToHeadCompetitorKeyValues(competitor, translations) {
  return Array.from(new Set(
    getPlayerRecordCandidateIndexNameValues(competitor, translations)
      .flatMap(buildPlayerNameSearchValues)
      .filter((value) => value.length >= 2),
  ));
}

function getHeadToHeadCanonicalKey(competitor, translations) {
  const preferredValues = getCompetitorNameCandidates(competitor)
    .flatMap(buildPlayerNameSearchValues)
    .filter((value) => /^[a-z0-9 ]+$/.test(value));
  const fallbackValues = getHeadToHeadCompetitorKeyValues(competitor, translations);
  return (preferredValues[0] || fallbackValues[0] || "").trim();
}

function addHeadToHeadPlayerKey(index, key, eventId) {
  if (!key) {
    return;
  }
  if (!index.players[key]) {
    index.players[key] = [];
  }
  const normalizedEventId = String(eventId || "");
  if (normalizedEventId && !index.players[key].includes(normalizedEventId)) {
    index.players[key].push(normalizedEventId);
  }
}

function getHeadToHeadPairKey(leftKey, rightKey) {
  const values = [String(leftKey || "").trim(), String(rightKey || "").trim()].filter(Boolean);
  if (values.length !== 2 || values[0] === values[1]) {
    return "";
  }
  return values.sort((left, right) => left.localeCompare(right, "en", { numeric: true })).join("|");
}

function addHeadToHeadPairEventId(index, leftKey, rightKey, eventId) {
  const pairKey = getHeadToHeadPairKey(leftKey, rightKey);
  const normalizedEventId = String(eventId || "");
  if (!pairKey || !normalizedEventId) {
    return false;
  }
  if (!index.pairs[pairKey]) {
    index.pairs[pairKey] = [];
  }
  if (!index.pairs[pairKey].includes(normalizedEventId)) {
    index.pairs[pairKey].push(normalizedEventId);
    return true;
  }
  return false;
}

function getPlayerRecordIndexMatchId(matchEntry) {
  return [
    matchEntry?.event || "",
    matchEntry?.categoryName || "",
    matchEntry?.roundLabel || "",
    matchEntry?.documentCode || "",
    matchEntry?.line || "",
  ].join("\u0001");
}

function normalizeHeadToHeadMatchValue(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function getHeadToHeadMatchDedupKey(matchEntry) {
  return [
    normalizeHeadToHeadMatchValue(matchEntry?.categoryName),
    normalizeHeadToHeadMatchValue(matchEntry?.roundLabel),
    normalizeHeadToHeadMatchValue(matchEntry?.line),
  ].join("\u0001");
}

function isSameHeadToHeadMatch(left, right) {
  if (
    normalizeHeadToHeadMatchValue(left?.categoryName) !==
      normalizeHeadToHeadMatchValue(right?.categoryName) ||
    normalizeHeadToHeadMatchValue(left?.roundLabel) !==
      normalizeHeadToHeadMatchValue(right?.roundLabel)
  ) {
    return false;
  }

  const leftDocumentCode = normalizeHeadToHeadMatchValue(left?.documentCode);
  const rightDocumentCode = normalizeHeadToHeadMatchValue(right?.documentCode);
  if (leftDocumentCode && rightDocumentCode && leftDocumentCode === rightDocumentCode) {
    return true;
  }
  return getHeadToHeadMatchDedupKey(left) === getHeadToHeadMatchDedupKey(right);
}

function dedupeHeadToHeadMatches(matches) {
  const uniqueMatches = [];
  for (const match of Array.isArray(matches) ? matches : []) {
    if (!uniqueMatches.some((existing) => isSameHeadToHeadMatch(existing, match))) {
      uniqueMatches.push(match);
    }
  }
  return uniqueMatches;
}

function countHeadToHeadWins(events) {
  return (Array.isArray(events) ? events : []).reduce(
    (counts, event) => {
      for (const match of event.matches || []) {
        if (match.winner === "a") counts.aWins += 1;
        if (match.winner === "b") counts.bWins += 1;
      }
      return counts;
    },
    { aWins: 0, bWins: 0 },
  );
}

function getHeadToHeadEventDedupKey(event) {
  const eventName = normalizeHeadToHeadMatchValue(event?.eventName);
  if (eventName && (event?.startDate || event?.endDate)) {
    return [eventName, event.startDate || "", event.endDate || ""].join("\u0001");
  }
  return `id\u0001${String(event?.event || "")}`;
}

function dedupeHeadToHeadEvents(events) {
  const eventsByKey = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const eventKey = getHeadToHeadEventDedupKey(event);
    const current = eventsByKey.get(eventKey) || {
      ...event,
      matches: [],
    };
    for (const match of event.matches || []) {
      if (!current.matches.some((existing) => isSameHeadToHeadMatch(existing, match))) {
        current.matches.push(match);
      }
    }
    eventsByKey.set(eventKey, current);
  }
  return [...eventsByKey.values()]
    .map((event) => {
      const uniqueMatches = dedupeHeadToHeadMatches(event.matches);
      const matchGroups = buildPlayerRecordMatchGroups(uniqueMatches);
      return {
        ...event,
        matches: matchGroups.flatMap((group) => group.matches),
        matchGroups,
      };
    })
    .filter((event) => event.matches.length > 0)
    .sort(comparePlayerRecordEvents);
}

function addPlayerRecordIndexedEntry(index, key, file, eventMeta, matchEntry) {
  if (!key || !matchEntry) {
    return false;
  }
  if (!index.records[key]) {
    index.records[key] = {};
  }
  const eventId = String(file.eventId || "");
  if (!eventId) {
    return false;
  }
  if (!index.records[key][eventId]) {
    index.records[key][eventId] = {
      ...eventMeta,
      source: file.sourceLabel || "",
      matches: [],
    };
  }
  const matches = index.records[key][eventId].matches;
  const matchId = getPlayerRecordIndexMatchId(matchEntry);
  if (matches.some((existing) => getPlayerRecordIndexMatchId(existing) === matchId)) {
    return false;
  }
  matches.push(matchEntry);
  return true;
}

function addPlayerRecordIndexedMatch(index, file, eventMeta, match, competitorIndex, translations, rules, roundContext, parentMatch = null, options = {}) {
  const competitors = Array.isArray(match?.competitors) ? match.competitors : [];
  const competitor = competitors[competitorIndex];
  const keys = getHeadToHeadCompetitorKeyValues(competitor, translations);
  if (keys.length === 0) {
    return 0;
  }
  const matchEntries = [];
  pushPlayerRecordMatch(matchEntries, match, competitorIndex, translations, rules, roundContext, parentMatch);
  const matchEntry = matchEntries[0];
  if (!matchEntry) {
    return 0;
  }

  let indexed = 0;
  const recordKey = getHeadToHeadCanonicalKey(competitor, translations) || keys[0];
  if (recordKey) {
    keys.forEach((key) => {
      index.recordAliases[key] = recordKey;
    });
  }
  keys.forEach((key) => {
    addHeadToHeadPlayerKey(index, key, file.eventId);
  });
  if (recordKey && options.shardWriter) {
    options.shardWriter.write(recordKey, file, eventMeta, matchEntry);
    indexed += 1;
  }
  if (recordKey && options.storeInlineRecords && addPlayerRecordIndexedEntry(index, recordKey, file, eventMeta, matchEntry)) {
    indexed += 1;
  }
  return indexed;
}

function getHeadToHeadIndexPlayerKeys(index, needles) {
  const keys = new Set();
  const players = index?.players || {};
  let matchCache = headToHeadPlayerKeyMatchCaches.get(players);
  if (!matchCache) {
    matchCache = new Map();
    headToHeadPlayerKeyMatchCaches.set(players, matchCache);
  }
  const playerKeys = Object.keys(players);
  needles.forEach((needle) => {
    const normalizedNeedle = normalizePlayerSearchText(needle);
    if (!normalizedNeedle) {
      return;
    }
    let matched = matchCache.get(normalizedNeedle);
    if (!matched) {
      matched = new Set();
      buildPlayerNameSearchValues(normalizedNeedle).forEach((candidate) => {
        if (players[candidate]) {
          matched.add(candidate);
        }
      });
      if (matched.size === 0) {
        playerKeys.forEach((key) => {
          if (playerRecordNameMatchesNeedle(key, normalizedNeedle)) {
            matched.add(key);
          }
        });
      }
      matchCache.set(normalizedNeedle, matched);
    }
    matched.forEach((key) => keys.add(key));
  });
  return keys;
}

function getHeadToHeadIndexEventIdsForPlayer(index, playerKeys) {
  const eventIds = new Set();
  playerKeys.forEach((playerKey) => {
    (index.players?.[playerKey] || []).forEach((eventId) => eventIds.add(String(eventId)));
  });
  return eventIds;
}

function getHeadToHeadCandidateEventIds(index, playerANeedles, playerBNeedles) {
  const playerAKeys = getHeadToHeadIndexPlayerKeys(index, playerANeedles);
  const playerBKeys = getHeadToHeadIndexPlayerKeys(index, playerBNeedles);
  if (playerAKeys.size === 0 || playerBKeys.size === 0) {
    return {
      eventIds: new Set(),
      playerAKeyCount: playerAKeys.size,
      playerBKeyCount: playerBKeys.size,
    };
  }

  const pairEventIds = new Set();
  const playerAEventIds = getHeadToHeadIndexEventIdsForPlayer(index, playerAKeys);
  const playerBEventIds = getHeadToHeadIndexEventIdsForPlayer(index, playerBKeys);
  const intersectionEventIds = new Set([...playerAEventIds].filter((eventId) => playerBEventIds.has(eventId)));
  if (index.pairs && typeof index.pairs === "object") {
    playerAKeys.forEach((playerAKey) => {
      playerBKeys.forEach((playerBKey) => {
        const pairKey = getHeadToHeadPairKey(playerAKey, playerBKey);
        (index.pairs[pairKey] || []).forEach((eventId) => pairEventIds.add(String(eventId)));
      });
    });
  }

  if (pairEventIds.size > 0) {
    return {
      eventIds: pairEventIds,
      liveEventIds: intersectionEventIds,
      playerAKeyCount: playerAKeys.size,
      playerBKeyCount: playerBKeys.size,
    };
  }

  return {
    eventIds: intersectionEventIds,
    liveEventIds: intersectionEventIds,
    playerAKeyCount: playerAKeys.size,
    playerBKeyCount: playerBKeys.size,
  };
}

function setsIntersect(left, right) {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

function compactHeadToHeadCompetitor(competitor) {
  return compactPlayerRecordCompetitor(competitor);
}

function buildHeadToHeadPairMatchPayload(match, parentMatch = null) {
  return {
    categoryName: match?.categoryName || "",
    roundKey: match?.roundKey || "",
    roundLabel: match?.roundLabel || "",
    documentCode: match?.documentCode || "",
    competitors: (Array.isArray(match?.competitors) ? match.competitors.slice(0, 2) : [])
      .map(compactHeadToHeadCompetitor),
    overallScore: match?.overallScore || "",
    resultStatus: match?.resultStatus || "",
    gameScores: Array.isArray(match?.gameScores) ? match.gameScores : [],
    parent: parentMatch ? {
      categoryName: parentMatch.categoryName || "",
      roundKey: parentMatch.roundKey || "",
      roundLabel: parentMatch.roundLabel || "",
      documentCode: parentMatch.documentCode || "",
    } : null,
  };
}

function addHeadToHeadIndexedMatch(index, file, eventMeta, match, playerAIndex, playerBIndex, translations, rules, roundContext, parentMatch = null, options = {}) {
  const winnerIndex = getWinnerIndexForRecord(match);
  if (winnerIndex !== playerAIndex && winnerIndex !== playerBIndex) {
    return false;
  }

  const competitors = Array.isArray(match?.competitors) ? match.competitors : [];
  const leftCompetitor = competitors[playerAIndex];
  const rightCompetitor = competitors[playerBIndex];
  const leftCanonical = getHeadToHeadCanonicalKey(leftCompetitor, translations);
  const rightCanonical = getHeadToHeadCanonicalKey(rightCompetitor, translations);
  if (!leftCanonical || !rightCanonical || leftCanonical === rightCanonical) {
    return false;
  }

  const orderedCanonicals = [leftCanonical, rightCanonical].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const leftKeys = getHeadToHeadCompetitorKeyValues(leftCompetitor, translations);
  const rightKeys = getHeadToHeadCompetitorKeyValues(rightCompetitor, translations);
  const leftPairIndex = orderedCanonicals.indexOf(leftCanonical);
  const rightPairIndex = orderedCanonicals.indexOf(rightCanonical);
  if (leftPairIndex < 0 || rightPairIndex < 0 || leftPairIndex === rightPairIndex) {
    return false;
  }

  [...leftKeys, ...rightKeys].forEach((key) => addHeadToHeadPlayerKey(index, key, file.eventId));
  const pairKey = getHeadToHeadPairKey(leftCanonical, rightCanonical);
  addHeadToHeadPairEventId(index, leftCanonical, rightCanonical, file.eventId);
  if (pairKey && options.pairShardWriter) {
    options.pairShardWriter.write(pairKey, {
      event: {
        ...eventMeta,
        source: file.sourceLabel || "",
      },
      match: buildHeadToHeadPairMatchPayload(match, parentMatch),
    });
  }
  return true;
}

function isSinglesHeadToHeadMatch(match) {
  const competitors = Array.isArray(match?.competitors) ? match.competitors : [];
  if (competitors.length < 2) {
    return false;
  }
  return competitors.slice(0, 2).every((competitor) => {
    const players = Array.isArray(competitor?.players) ? competitor.players.filter((player) => player?.name) : [];
    if (players.length > 1) {
      return false;
    }
    const type = String(competitor?.type || "").toLowerCase();
  return type !== "pair" && type !== "doubles";
  });
}

function archiveItemMightContainPlayerNeedles(item, needles) {
  if (!item || !Array.isArray(needles) || needles.length === 0) {
    return false;
  }
  const stack = [item];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || current === undefined) {
      continue;
    }
    if (typeof current === "string" || typeof current === "number") {
      const text = normalizePlayerSearchText(current);
      if (needles.some((needle) => playerRecordNameMatchesNeedle(text, needle))) {
        return true;
      }
      continue;
    }
    if (Array.isArray(current)) {
      current.forEach((value) => stack.push(value));
      continue;
    }
    if (typeof current === "object") {
      Object.values(current).forEach((value) => stack.push(value));
    }
  }
  return false;
}

function getParsedHeadToHeadArchive(file, playerANeedles, playerBNeedles) {
  if (Array.isArray(file?.liveNormalizedMatches)) {
    const allNormalizedMatches = file.liveNormalizedMatches.map(normalizeArchivedMatch).filter(Boolean);
    const normalizedMatches = allNormalizedMatches.filter((item) =>
        archiveItemMightContainPlayerNeedles(item, playerANeedles) &&
        archiveItemMightContainPlayerNeedles(item, playerBNeedles),
      );
    return {
      normalizedMatches,
      contextsByCategory: buildRoundContextsByCategory(allNormalizedMatches),
      fallbackRoundContext: buildJaRoundContext(allNormalizedMatches),
    };
  }

  const parsedArchive = getParsedPlayerRecordArchive(file);
  const normalizedMatches = [];
  for (const match of parsedArchive.normalizedMatches || []) {
    if (
      !archiveItemMightContainPlayerNeedles(match, playerANeedles) ||
      !archiveItemMightContainPlayerNeedles(match, playerBNeedles)
    ) {
      continue;
    }
    normalizedMatches.push(match);
  }

  return {
    normalizedMatches,
    contextsByCategory: parsedArchive.contextsByCategory,
    fallbackRoundContext: parsedArchive.fallbackRoundContext,
  };
}

function pushHeadToHeadMatch(matches, match, playerAIndex, playerBIndex, translations, rules, roundContext, parentMatch = null) {
  const winnerIndex = getWinnerIndexForRecord(match);
  if (winnerIndex !== playerAIndex && winnerIndex !== playerBIndex) {
    return;
  }

  const sourceMatch = parentMatch || match;
  matches.push({
    categoryName: sourceMatch.categoryName || match.categoryName || "",
    roundLabel: translateRoundJa(
      sourceMatch.roundKey || match.roundKey,
      sourceMatch.roundLabel || match.roundLabel,
      translations,
      rules,
      roundContext,
    ),
    line: buildHeadToHeadMatchLine(match, translations),
    documentCode: match.documentCode || sourceMatch.documentCode || "",
    winner: winnerIndex === playerAIndex ? "a" : "b",
  });
}

async function collectHeadToHeadMatches(snapshot, playerANeedles, playerBNeedles) {
  const translations = readTranslations(TRANSLATIONS_PATH);
  const rules = readRules(RULES_PATH);
  const searchIndex = readWttSearchIndex();
  const dateIndex = readWttDateIndex(WTT_DATE_INDEX_PATH);
  const archiveIndex = readWttArchiveIndex();
  const eventNames = getEventNamesMap();
  const events = [];
  let parsedEvents = 0;
  let scannedMatches = 0;

  for (const file of snapshot) {
    await yieldToEventLoop();
    const {
      normalizedMatches,
      contextsByCategory,
      fallbackRoundContext,
    } = getParsedHeadToHeadArchive(file, playerANeedles, playerBNeedles);
    if (!Array.isArray(normalizedMatches) || normalizedMatches.length === 0) {
      continue;
    }

    parsedEvents += 1;
    const matches = [];

    for (const match of normalizedMatches) {
      const matchRoundContext = contextsByCategory.get(getRoundContextKey(match)) || fallbackRoundContext;
      scannedMatches += 1;

      if (match.matchType === "individual") {
        if (match.discipline && match.discipline !== "singles") {
          continue;
        }
        if (!isSinglesHeadToHeadMatch(match)) {
          continue;
        }
        const playerAIndex = findPlayerCompetitorIndex(match, playerANeedles, translations);
        const playerBIndex = findPlayerCompetitorIndex(match, playerBNeedles, translations);
        if (playerAIndex >= 0 && playerBIndex >= 0 && playerAIndex !== playerBIndex) {
          pushHeadToHeadMatch(matches, match, playerAIndex, playerBIndex, translations, rules, matchRoundContext);
        }
        continue;
      }

      if (match.matchType !== "team") {
        continue;
      }

      (Array.isArray(match.singles) ? match.singles : []).forEach((single) => {
        scannedMatches += 1;
        if (!isSinglesHeadToHeadMatch(single)) {
          return;
        }
        const playerAIndex = findPlayerCompetitorIndex(single, playerANeedles, translations);
        const playerBIndex = findPlayerCompetitorIndex(single, playerBNeedles, translations);
        if (playerAIndex >= 0 && playerBIndex >= 0 && playerAIndex !== playerBIndex) {
          pushHeadToHeadMatch(matches, single, playerAIndex, playerBIndex, translations, rules, matchRoundContext, match);
        }
      });
    }

    if (matches.length === 0) {
      continue;
    }

    const uniqueMatches = dedupeHeadToHeadMatches(matches);
    const matchGroups = buildPlayerRecordMatchGroups(uniqueMatches);
    events.push({
      ...getEventRecordMeta(file.eventId, searchIndex, dateIndex, archiveIndex, eventNames),
      source: file.sourceLabel || "",
      matches: matchGroups.flatMap((group) => group.matches),
      matchGroups,
    });
  }

  const uniqueEvents = dedupeHeadToHeadEvents(events);
  const wins = countHeadToHeadWins(uniqueEvents);
  return {
    events: uniqueEvents,
    parsedEvents,
    scannedMatches,
    aWins: wins.aWins,
    bWins: wins.bWins,
  };
}

async function collectLiveHeadToHeadMatches(snapshot, playerANeedles, playerBNeedles, eventIds = null) {
  const searchIndex = readWttSearchIndex();
  const dateIndex = readWttDateIndex(WTT_DATE_INDEX_PATH);
  const archiveIndex = readWttArchiveIndex();
  const eventNames = getEventNamesMap();
  const liveSnapshot = [];
  const snapshotByEventId = new Map((Array.isArray(snapshot) ? snapshot : []).map((file) => [String(file.eventId), file]));
  const files = eventIds
    ? [...eventIds].map((eventId) => snapshotByEventId.get(String(eventId)) || {
        eventId: String(eventId),
        sourceLabel: "live",
      })
    : (Array.isArray(snapshot) ? snapshot : []);

  for (const file of files) {
    const meta = getEventRecordMeta(file.eventId, searchIndex, dateIndex, archiveIndex, eventNames);
    if (!shouldRefreshLiveEventMeta(meta)) {
      continue;
    }
    const liveFile = await getLiveEventSnapshot(file, meta);
    if (liveFile) {
      liveSnapshot.push(liveFile);
    }
  }

  if (liveSnapshot.length === 0) {
    return null;
  }

  const collected = await collectHeadToHeadMatches(liveSnapshot, playerANeedles, playerBNeedles);
  return {
    ...collected,
    candidateEventCount: liveSnapshot.length,
  };
}

async function buildHeadToHeadPersistentIndex(snapshot, signature, options = {}) {
  const translations = readTranslations(TRANSLATIONS_PATH);
  const rules = readRules(RULES_PATH);
  const searchIndex = readWttSearchIndex();
  const dateIndex = readWttDateIndex(WTT_DATE_INDEX_PATH);
  const archiveIndex = readWttArchiveIndex();
  const eventNames = getEventNamesMap();
  const playerRecordMatchIndexEventLimit = Number(process.env.PLAYER_RECORD_MATCH_INDEX_EVENT_LIMIT || 300);
  const buildPlayerRecordMatchIndex = snapshot.length <= playerRecordMatchIndexEventLimit;
  const buildPlayerRecordMatchShardIndex = process.env.PLAYER_RECORD_MATCH_SHARD_INDEX_DISABLED !== "1";
  const pairShardDir = options.pairShardDir || HEAD_TO_HEAD_PAIR_SHARDS_DIR;
  const buildHeadToHeadPairShardIndex =
    Boolean(pairShardDir) &&
    process.env.HEAD_TO_HEAD_PAIR_SHARD_INDEX_DISABLED !== "1" &&
    (options.persist !== false || Boolean(options.pairShardDir));
  const playerRecordMatchShardWriter = buildPlayerRecordMatchShardIndex
    ? createPlayerRecordMatchShardWriter(PLAYER_RECORD_MATCH_SHARDS_DIR)
    : null;
  const headToHeadPairShardWriter = buildHeadToHeadPairShardIndex
    ? createHeadToHeadPairShardWriter(pairShardDir)
    : null;
  const index = {
    players: {},
    pairs: {},
    records: {},
    recordAliases: {},
  };
  let parsedEvents = 0;
  let scannedMatches = 0;
  let indexedLinks = 0;
  let indexedPlayerRecordLinks = 0;

  try {
    for (let indexPosition = 0; indexPosition < snapshot.length; indexPosition += 1) {
    if (indexPosition % 20 === 0) {
      await yieldToEventLoop();
    }
    const file = snapshot[indexPosition];
    const eventStartedAt = Date.now();
    const scannedMatchesBeforeEvent = scannedMatches;
    const parsedEventsBeforeEvent = parsedEvents;
    const {
      normalizedMatches,
      contextsByCategory,
      fallbackRoundContext,
    } = getParsedPlayerRecordArchive(file);
    if (!Array.isArray(normalizedMatches) || normalizedMatches.length === 0) {
      if (typeof options.onEvent === "function") {
        options.onEvent({
          eventId: String(file.eventId),
          position: indexPosition + 1,
          total: snapshot.length,
          parsed: 0,
          matches: 0,
          durationMs: Date.now() - eventStartedAt,
        });
      }
      continue;
    }

    parsedEvents += 1;
    const eventMeta = getEventRecordMeta(file.eventId, searchIndex, dateIndex, archiveIndex, eventNames);

    for (const match of normalizedMatches) {
      const matchRoundContext = contextsByCategory.get(getRoundContextKey(match)) || fallbackRoundContext;
      scannedMatches += 1;

      if (match.matchType === "individual") {
        if (buildPlayerRecordMatchIndex || playerRecordMatchShardWriter) {
          (Array.isArray(match.competitors) ? match.competitors.slice(0, 2) : []).forEach((competitor, competitorIndex) => {
            indexedPlayerRecordLinks += addPlayerRecordIndexedMatch(
              index,
              file,
              eventMeta,
              match,
              competitorIndex,
              translations,
              rules,
              matchRoundContext,
              null,
              {
                shardWriter: playerRecordMatchShardWriter,
                storeInlineRecords: buildPlayerRecordMatchIndex,
              },
            );
          });
        }

        if (match.discipline && match.discipline !== "singles") {
          continue;
        }
        if (!isSinglesHeadToHeadMatch(match)) {
          continue;
        }
        if (addHeadToHeadIndexedMatch(index, file, eventMeta, match, 0, 1, translations, rules, matchRoundContext, null, {
          pairShardWriter: headToHeadPairShardWriter,
        })) {
          indexedLinks += 1;
        }
        continue;
      }

      if (match.matchType !== "team") {
        continue;
      }

      (Array.isArray(match.singles) ? match.singles : []).forEach((single) => {
        scannedMatches += 1;
        if (buildPlayerRecordMatchIndex || playerRecordMatchShardWriter) {
          (Array.isArray(single?.competitors) ? single.competitors.slice(0, 2) : []).forEach((competitor, competitorIndex) => {
            indexedPlayerRecordLinks += addPlayerRecordIndexedMatch(
              index,
              file,
              eventMeta,
              single,
              competitorIndex,
              translations,
              rules,
              matchRoundContext,
              match,
              {
                shardWriter: playerRecordMatchShardWriter,
                storeInlineRecords: buildPlayerRecordMatchIndex,
              },
            );
          });
        }
        if (!isSinglesHeadToHeadMatch(single)) {
          return;
        }
        if (addHeadToHeadIndexedMatch(index, file, eventMeta, single, 0, 1, translations, rules, matchRoundContext, match, {
          pairShardWriter: headToHeadPairShardWriter,
        })) {
          indexedLinks += 1;
        }
      });
    }

    if (typeof options.onEvent === "function") {
      options.onEvent({
        eventId: String(file.eventId),
        position: indexPosition + 1,
        total: snapshot.length,
        parsed: parsedEvents - parsedEventsBeforeEvent,
        matches: scannedMatches - scannedMatchesBeforeEvent,
        durationMs: Date.now() - eventStartedAt,
      });
    }
    }
  } catch (error) {
    playerRecordMatchShardWriter?.abort?.();
    headToHeadPairShardWriter?.abort?.();
    throw error;
  }

  Object.keys(index.players).forEach((key) => {
    index.players[key].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  });
  Object.keys(index.pairs).forEach((key) => {
    index.pairs[key].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  });
  if (buildPlayerRecordMatchIndex) {
    Object.values(index.records).forEach((eventsById) => {
      Object.values(eventsById || {}).forEach((event) => {
        event.matches = buildPlayerRecordMatchGroups(event.matches || []).flatMap((group) => group.matches);
      });
    });
  }
  if (playerRecordMatchShardWriter) {
    await playerRecordMatchShardWriter.close();
  }
  const pairRecordCount = headToHeadPairShardWriter ? headToHeadPairShardWriter.close() : 0;

  const generatedAt = new Date().toISOString();
  const manifest = {
    version: HEAD_TO_HEAD_INDEX_VERSION,
    generatedAt,
    signature,
    eventIds: snapshot.map((file) => String(file.eventId)),
    eventSignatures: Object.fromEntries(
      snapshot.map((file) => [String(file.eventId), getHeadToHeadEventFileSignature(file)]),
    ),
    eventCount: snapshot.length,
    parsedEvents,
    scannedMatches,
    indexedLinks,
    indexedPlayerRecordLinks,
    playerRecordMatchIndexSkipped: !buildPlayerRecordMatchIndex,
    playerRecordMatchShardIndex: buildPlayerRecordMatchShardIndex,
    playerRecordMatchIndexEventLimit,
    pairRecordIndex: buildHeadToHeadPairShardIndex,
    pairRecordIndexVersion: buildHeadToHeadPairShardIndex ? HEAD_TO_HEAD_PAIR_INDEX_VERSION : null,
    pairRecordIndexSignature: buildHeadToHeadPairShardIndex ? signature : null,
    pairRecordCount,
    pairRecordShardDir: buildHeadToHeadPairShardIndex ? pairShardDir : null,
    playerKeyCount: Object.keys(index.players).length,
    pairKeyCount: Object.keys(index.pairs).length,
    playerRecordKeyCount: Object.keys(index.records).length,
    playerRecordAliasKeyCount: Object.keys(index.recordAliases).length,
  };

  if (options.persist !== false) {
    writeJsonFileAtomic(HEAD_TO_HEAD_PLAYER_INDEX_PATH, {
      players: index.players,
      pairs: index.pairs,
      records: index.records,
      recordAliases: index.recordAliases,
    });
    writeJsonFileAtomic(HEAD_TO_HEAD_INDEX_MANIFEST_PATH, manifest);
  }
  return {
    signature,
    generatedAt,
    index: {
      players: index.players,
      pairs: index.pairs,
      records: index.records,
      recordAliases: index.recordAliases,
    },
    manifest,
  };
}

function mergeHeadToHeadIndexEventMap(targetMap, deltaMap, eventIds) {
  const removeIds = new Set(eventIds.map(String));
  Object.keys(targetMap).forEach((key) => {
    const remaining = Array.isArray(targetMap[key])
      ? targetMap[key].filter((eventId) => !removeIds.has(String(eventId)))
      : [];
    if (remaining.length > 0) {
      targetMap[key] = remaining;
    } else {
      delete targetMap[key];
    }
  });
  Object.entries(deltaMap || {}).forEach(([key, values]) => {
    const merged = new Set([...(targetMap[key] || []), ...(Array.isArray(values) ? values : [])].map(String));
    targetMap[key] = [...merged].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  });
}

function mergeHeadToHeadRecordMap(targetMap, deltaMap, eventIds) {
  const removeIds = new Set(eventIds.map(String));
  Object.values(targetMap).forEach((eventsById) => {
    removeIds.forEach((eventId) => delete eventsById[eventId]);
  });
  Object.keys(targetMap).forEach((key) => {
    if (!targetMap[key] || Object.keys(targetMap[key]).length === 0) {
      delete targetMap[key];
    }
  });
  Object.entries(deltaMap || {}).forEach(([key, eventsById]) => {
    const targetEvents = targetMap[key] || (targetMap[key] = {});
    Object.entries(eventsById || {}).forEach(([eventId, event]) => {
      const existing = targetEvents[eventId];
      const matches = [...(existing?.matches || []), ...(event?.matches || [])];
      const seen = new Set();
      targetEvents[eventId] = {
        ...(existing || {}),
        ...(event || {}),
        matches: matches.filter((match) => {
          const id = getPlayerRecordIndexMatchId(match);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        }),
      };
      targetEvents[eventId].matches = buildPlayerRecordMatchGroups(targetEvents[eventId].matches).flatMap((group) => group.matches);
    });
  });
}

async function runHeadToHeadIndexIncrementalCli() {
  ensureRuntimeFiles();
  const args = parsePlayerRecordEventIndexArgs(process.argv.slice(2));
  if (!args.eventIds || args.eventIds.size === 0) {
    throw new Error("Use --event ID[,ID] for incremental H2H updates.");
  }
  const allSnapshot = getWttRecordFileSnapshot();
  const eventIds = [...args.eventIds];
  const deltaSnapshot = allSnapshot.filter((file) => eventIds.includes(String(file.eventId)));
  if (deltaSnapshot.length !== eventIds.length) {
    const found = new Set(deltaSnapshot.map((file) => String(file.eventId)));
    throw new Error(`Missing event files: ${eventIds.filter((eventId) => !found.has(eventId)).join(",")}`);
  }
  const signature = getHeadToHeadPersistentIndexSignature(allSnapshot);
  if (!fs.existsSync(HEAD_TO_HEAD_INDEX_MANIFEST_PATH) || !fs.existsSync(HEAD_TO_HEAD_PLAYER_INDEX_PATH)) {
    throw new Error("Existing H2H index is unavailable; incremental update refused.");
  }
  ensureDir(HEAD_TO_HEAD_DELTA_INDEX_DIR);
  let deltaManifest = {};
  try {
    deltaManifest = JSON.parse(fs.readFileSync(HEAD_TO_HEAD_DELTA_INDEX_MANIFEST_PATH, "utf8"));
  } catch {
    deltaManifest = {};
  }
  const deltaEventIds = new Set(
    Array.isArray(deltaManifest.eventIds) ? deltaManifest.eventIds.map(String) : [],
  );
  const deltaEventSignatures = {
    ...(deltaManifest.eventSignatures || {}),
  };
  const previousShardSetting = process.env.PLAYER_RECORD_MATCH_SHARD_INDEX_DISABLED;
  process.env.PLAYER_RECORD_MATCH_SHARD_INDEX_DISABLED = "1";
  try {
    console.log(`[head-to-head-index] start ${eventIds.length} events: ${eventIds.join(",")}`);
    for (let indexPosition = 0; indexPosition < deltaSnapshot.length; indexPosition += 1) {
      const file = deltaSnapshot[indexPosition];
      const eventId = String(file.eventId);
      const eventStartedAt = Date.now();
      const eventPairShardDir = path.join(HEAD_TO_HEAD_DELTA_PAIR_SHARDS_DIR, eventId);
      const delta = await buildHeadToHeadPersistentIndex([file], signature, {
        persist: false,
        pairShardDir: eventPairShardDir,
      });
      writeCompactJsonFileAtomic(path.join(HEAD_TO_HEAD_DELTA_INDEX_DIR, `${eventId}.json`), {
        version: HEAD_TO_HEAD_DELTA_INDEX_VERSION,
        eventId,
        signature: getHeadToHeadEventFileSignature(file),
        generatedAt: new Date().toISOString(),
        players: delta.index.players,
        pairs: delta.index.pairs,
        pairRecordIndex: true,
        pairRecordIndexVersion: HEAD_TO_HEAD_PAIR_INDEX_VERSION,
        pairRecordShardDir: eventPairShardDir,
        pairRecordCount: delta.manifest.pairRecordCount || 0,
      });
      deltaEventIds.add(eventId);
      deltaEventSignatures[eventId] = getHeadToHeadEventFileSignature(file);
      writeCompactJsonFileAtomic(HEAD_TO_HEAD_DELTA_INDEX_MANIFEST_PATH, {
        version: HEAD_TO_HEAD_DELTA_INDEX_VERSION,
        generatedAt: new Date().toISOString(),
        eventIds: [...deltaEventIds],
        eventSignatures: deltaEventSignatures,
        pairRecordIndex: true,
        pairRecordIndexVersion: HEAD_TO_HEAD_PAIR_INDEX_VERSION,
      },
      );
      console.log(
        `[head-to-head-index] ${indexPosition + 1}/${deltaSnapshot.length} event=${eventId}`
        + ` parsed=${delta.manifest.parsedEvents} matches=${delta.manifest.scannedMatches}`
        + ` durationMs=${Date.now() - eventStartedAt} saved=1`,
      );
      await yieldToEventLoop();
    }
  } finally {
    if (previousShardSetting === undefined) delete process.env.PLAYER_RECORD_MATCH_SHARD_INDEX_DISABLED;
    else process.env.PLAYER_RECORD_MATCH_SHARD_INDEX_DISABLED = previousShardSetting;
  }
  const result = {
    ok: true,
    eventIds,
    deltaManifest: JSON.parse(fs.readFileSync(HEAD_TO_HEAD_DELTA_INDEX_MANIFEST_PATH, "utf8")),
    storage: HEAD_TO_HEAD_DELTA_INDEX_DIR,
  };
  writeHeadToHeadIndexStatus({ ok: true, status: "complete", signature, manifest: result.deltaManifest });
  console.log(JSON.stringify(result, null, 2));
}

async function collectHeadToHeadMatchesFromPersistentIndex(indexState, playerANeedles, playerBNeedles, snapshot) {
  const index = indexState?.index;
  if (!index?.players) {
    return null;
  }

  const currentEventIds = new Set((snapshot || []).map((file) => String(file.eventId)));
  const pairDeltaEventIds = new Set((index.pairDeltaEventIds || []).map(String));
  const pairIndexEventIds = new Set(
    (snapshot || [])
      .filter((file) => {
        const eventId = String(file.eventId);
        return pairDeltaEventIds.has(eventId) ||
          isHeadToHeadPairIndexEventCurrent(
            file,
            index.pairShardEventSignatures?.[eventId],
            indexState.generatedAt,
          );
      })
      .map((file) => String(file.eventId)),
  );
  if (index.pairShardsDir && pairIndexEventIds.size > 0) {
    const pairResult = collectHeadToHeadMatchesFromPairIndex(
      index,
      playerANeedles,
      playerBNeedles,
      pairIndexEventIds,
    );
    if (pairResult && pairIndexEventIds.size === currentEventIds.size) {
      return pairResult;
    }
    if (pairResult) {
      const candidate = getHeadToHeadCandidateEventIds(index, playerANeedles, playerBNeedles);
      const candidateEventIds = new Set(
        [...candidate.eventIds].filter((eventId) => !pairIndexEventIds.has(String(eventId))),
      );
      const candidateSnapshot = snapshot.filter((file) => candidateEventIds.has(String(file.eventId)));
      const collected = candidateSnapshot.length > 0
        ? await collectHeadToHeadMatches(candidateSnapshot, playerANeedles, playerBNeedles)
        : { events: [], parsedEvents: 0, scannedMatches: 0, aWins: 0, bWins: 0 };
      const merged = mergeHeadToHeadCollectedResults(pairResult, {
        ...collected,
        candidateEventCount: candidateSnapshot.length,
        pairCount: candidateEventIds.size,
        candidateEventIds: [...candidateEventIds],
        liveCandidateEventIds: [...candidate.eventIds],
        playerAKeyCount: candidate.playerAKeyCount,
        playerBKeyCount: candidate.playerBKeyCount,
      });
      return {
        ...merged,
        pairIndexEventCount: pairIndexEventIds.size,
        pairIndexCoversSnapshot: false,
      };
    }
  }

  const candidate = getHeadToHeadCandidateEventIds(index, playerANeedles, playerBNeedles);
  if (candidate.playerAKeyCount === 0 || candidate.playerBKeyCount === 0) {
    return {
      events: [],
      parsedEvents: 0,
      scannedMatches: 0,
      aWins: 0,
      bWins: 0,
      pairCount: 0,
      playerAKeyCount: candidate.playerAKeyCount,
      playerBKeyCount: candidate.playerBKeyCount,
    };
  }

  // Keep the exact pair intersection here. New or changed events are added
  // separately by the stale-delta path below; broadening this set to every
  // event shared by both players makes every stale index behave like a full
  // candidate scan.
  const candidateEventIds = new Set(candidate.eventIds);
  const candidateSnapshot = snapshot.filter((file) => candidateEventIds.has(String(file.eventId)));
  const collected = await collectHeadToHeadMatches(candidateSnapshot, playerANeedles, playerBNeedles);

  return {
    ...collected,
    candidateEventCount: candidateSnapshot.length,
    pairCount: candidateEventIds.size,
    candidateEventIds: [...candidateEventIds],
    liveCandidateEventIds: [...candidate.eventIds],
    playerAKeyCount: candidate.playerAKeyCount,
    playerBKeyCount: candidate.playerBKeyCount,
  };
}

function collectHeadToHeadMatchesFromPairIndex(index, playerANeedles, playerBNeedles, allowedEventIds = null) {
  const translations = readTranslations(TRANSLATIONS_PATH);
  const rules = readRules(RULES_PATH);
  const playerAKeys = getHeadToHeadIndexPlayerKeys(index, playerANeedles);
  const playerBKeys = getHeadToHeadIndexPlayerKeys(index, playerBNeedles);
  if (playerAKeys.size === 0 || playerBKeys.size === 0) {
    return null;
  }

  const pairKeys = new Set();
  playerAKeys.forEach((playerAKey) => {
    playerBKeys.forEach((playerBKey) => {
      const pairKey = getHeadToHeadPairKey(playerAKey, playerBKey);
      if (pairKey) {
        pairKeys.add(pairKey);
      }
    });
  });

  const eventsById = new Map();
  let scannedMatches = 0;
  let indexedRecords = 0;
  pairKeys.forEach((pairKey) => {
    getHeadToHeadIndexedPair(index, pairKey).forEach((entry) => {
      if (allowedEventIds && !allowedEventIds.has(String(entry?.event?.event || ""))) {
        return;
      }
      scannedMatches += 1;
      const payload = entry?.match;
      const competitors = Array.isArray(payload?.competitors) ? payload.competitors : [];
      if (competitors.length < 2) {
        return;
      }
      const match = {
        matchType: "individual",
        discipline: "singles",
        categoryName: payload.categoryName || "",
        roundKey: payload.roundKey || "",
        roundLabel: payload.roundLabel || "",
        documentCode: payload.documentCode || "",
        competitors,
        overallScore: payload.overallScore || "",
        resultStatus: payload.resultStatus || "",
        gameScores: Array.isArray(payload.gameScores) ? payload.gameScores : [],
      };
      const parent = payload.parent ? {
        categoryName: payload.parent.categoryName || "",
        roundKey: payload.parent.roundKey || "",
        roundLabel: payload.parent.roundLabel || "",
        documentCode: payload.parent.documentCode || "",
      } : null;
      const playerAIndex = findPlayerCompetitorIndex(match, playerANeedles, translations);
      const playerBIndex = findPlayerCompetitorIndex(match, playerBNeedles, translations);
      if (playerAIndex < 0 || playerBIndex < 0 || playerAIndex === playerBIndex) {
        return;
      }
      const winnerIndex = getWinnerIndexForRecord(match);
      if (winnerIndex !== playerAIndex && winnerIndex !== playerBIndex) {
        return;
      }
      const event = entry.event || {};
      const eventId = String(event.event || "");
      if (!eventId) {
        return;
      }
      if (!eventsById.has(eventId)) {
        eventsById.set(eventId, {
          ...event,
          matches: [],
        });
      }
      const output = [];
      pushHeadToHeadMatch(output, match, playerAIndex, playerBIndex, translations, rules, null, parent);
      if (output.length > 0) {
        eventsById.get(eventId).matches.push(output[0]);
        indexedRecords += 1;
      }
    });
  });

  const events = dedupeHeadToHeadEvents([...eventsById.values()]);
  return {
    events,
    parsedEvents: events.length,
    scannedMatches,
    indexedRecords,
    candidateEventCount: events.length,
    pairCount: pairKeys.size,
    playerAKeyCount: playerAKeys.size,
    playerBKeyCount: playerBKeys.size,
    candidateEventIds: events.map((event) => String(event.event || "")),
    liveCandidateEventIds: events.map((event) => String(event.event || "")),
    aWins: countHeadToHeadWins(events).aWins,
    bWins: countHeadToHeadWins(events).bWins,
  };
}

function mergeHeadToHeadCollectedResults(primary, extra) {
  if (!extra || !Array.isArray(extra.events) || extra.events.length === 0) {
    return primary;
  }
  const events = dedupeHeadToHeadEvents([...(primary.events || []), ...extra.events]);
  const wins = countHeadToHeadWins(events);
  return {
    ...primary,
    events,
    parsedEvents: (primary.parsedEvents || 0) + (extra.parsedEvents || 0),
    scannedMatches: (primary.scannedMatches || 0) + (extra.scannedMatches || 0),
    aWins: wins.aWins,
    bWins: wins.bWins,
  };
}

async function getHeadToHeadSearchResult(playerAName, playerATranslatedName, playerBName, playerBTranslatedName, playerANeedles, playerBNeedles) {
  const snapshot = getWttRecordFileSnapshot();
  const signature = getPlayerRecordCacheSignature(snapshot);
  const persistentIndexSignature = getHeadToHeadPersistentIndexSignature(snapshot);
  const cacheKey = [
    persistentIndexSignature,
    playerAName,
    playerATranslatedName,
    playerBName,
    playerBTranslatedName,
  ].join("::");
  const cached = headToHeadResultCache.get(cacheKey);
  if (cached && Date.now() - cached.builtAt < HEAD_TO_HEAD_RESULT_CACHE_TTL_MS) {
    return {
      ...cached,
      cacheHit: true,
    };
  }

  const playerATextNeedles = buildPlayerRecordTextNeedles(...playerANeedles);
  const playerBTextNeedles = buildPlayerRecordTextNeedles(...playerBNeedles);
  const persistentIndex = getHeadToHeadPersistentIndex(persistentIndexSignature);
  if (persistentIndex) {
    let indexed = await collectHeadToHeadMatchesFromPersistentIndex(persistentIndex, playerANeedles, playerBNeedles, snapshot);
    if (indexed) {
      let deltaEventCount = 0;
      let liveEventCount = 0;
      if (persistentIndex.stale && persistentIndex.eventIds.length > 0) {
        const indexedEventIds = new Set(persistentIndex.eventIds);
        const indexedEventSignatures = persistentIndex.eventSignatures || {};
        const hasIndexedEventSignatures = Object.keys(indexedEventSignatures).length > 0;
        const indexGeneratedAtMs = Date.parse(String(persistentIndex.generatedAt || ""));
        const staleDeltaCandidates = snapshot.filter((file) => {
          const eventId = String(file.eventId);
          if (!indexedEventIds.has(eventId)) {
            return true;
          }
          if (hasIndexedEventSignatures) {
            return !isHeadToHeadPairIndexEventCurrent(
              file,
              indexedEventSignatures[eventId],
              persistentIndex.generatedAt,
            );
          }
          return Number.isFinite(indexGeneratedAtMs) && Math.max(
            Number(file.mtimeMs || 0),
            Number(file.parseMtimeMs || 0),
          ) > indexGeneratedAtMs;
        });
        const grepDelta = await getHeadToHeadGrepCandidateSnapshot(
          staleDeltaCandidates,
          playerATextNeedles,
          playerBTextNeedles,
        );
        const deltaSnapshot = grepDelta
          ? grepDelta.snapshot
          : staleDeltaCandidates
              .sort((left, right) => Math.max(
                Number(right.mtimeMs || 0),
                Number(right.parseMtimeMs || 0),
              ) - Math.max(
                Number(left.mtimeMs || 0),
                Number(left.parseMtimeMs || 0),
              ))
              .slice(0, Math.max(1, HEAD_TO_HEAD_MAX_STALE_DELTA_EVENTS));
        deltaEventCount = deltaSnapshot.length;
        if (deltaSnapshot.length > 0) {
          const delta = await collectHeadToHeadMatches(deltaSnapshot, playerANeedles, playerBNeedles);
          indexed = mergeHeadToHeadCollectedResults(indexed, delta);
        }
      }
      const live = HEAD_TO_HEAD_LIVE_REFRESH_ENABLED
        ? await collectLiveHeadToHeadMatches(
            snapshot,
            playerANeedles,
            playerBNeedles,
            indexed.liveCandidateEventIds || indexed.candidateEventIds,
          )
        : null;
      if (live) {
        liveEventCount = live.candidateEventCount || 0;
        indexed = mergeHeadToHeadCollectedResults(indexed, live);
      }
      const result = {
        signature: persistentIndexSignature,
        builtAt: Date.now(),
        eventIndexSource: "head-to-head-index",
        candidateIndexSource: [
          persistentIndex.stale ? "head-to-head-index+delta" : "head-to-head-index",
          liveEventCount > 0 ? "live-refresh" : "",
        ].filter(Boolean).join("+"),
        candidateIndexGeneratedAt: persistentIndex.generatedAt,
        eventIndexGeneratedAt: null,
        scannedEvents: snapshot.length,
        candidateEvents: indexed.candidateEventCount ?? indexed.events.length,
        playerAEventCount: indexed.playerAKeyCount,
        playerBEventCount: indexed.playerBKeyCount,
        deltaEvents: deltaEventCount,
        liveEvents: liveEventCount,
        ...indexed,
        cacheHit: false,
      };
      setHeadToHeadResultCacheValue(cacheKey, result);
      return result;
    }
  }

  const indexedCandidate = await getHeadToHeadIndexedCandidateSnapshot(snapshot, playerATextNeedles, playerBTextNeedles, signature);
  let candidateSnapshot = indexedCandidate?.snapshot || null;
  let candidateIndexSource = indexedCandidate ? "candidate-index-intersection" : "";
  let candidateIndexGeneratedAt = indexedCandidate?.generatedAt || null;
  let playerAEventCount = indexedCandidate?.playerAEventCount || null;
  let playerBEventCount = indexedCandidate?.playerBEventCount || null;

  if (!candidateSnapshot) {
    const grepCandidate = await getHeadToHeadGrepCandidateSnapshot(snapshot, playerATextNeedles, playerBTextNeedles);
    if (grepCandidate) {
      candidateSnapshot = grepCandidate.snapshot;
      candidateIndexSource = "grep-prefilter-intersection";
      playerAEventCount = grepCandidate.playerAEventCount;
      playerBEventCount = grepCandidate.playerBEventCount;
    }
  }

  if (!candidateSnapshot) {
    candidateSnapshot = snapshot;
    candidateIndexSource = "all";
  }

  let collected = await collectHeadToHeadMatches(candidateSnapshot, playerANeedles, playerBNeedles);
  let liveEventCount = 0;
  const live = HEAD_TO_HEAD_LIVE_REFRESH_ENABLED
    ? await collectLiveHeadToHeadMatches(candidateSnapshot, playerANeedles, playerBNeedles)
    : null;
  if (live) {
    liveEventCount = live.candidateEventCount || 0;
    collected = mergeHeadToHeadCollectedResults(collected, live);
  }
  const result = {
    signature,
    builtAt: Date.now(),
    eventIndexSource: "wtt-records",
    candidateIndexSource: [
      candidateIndexSource,
      liveEventCount > 0 ? "live-refresh" : "",
    ].filter(Boolean).join("+"),
    candidateIndexGeneratedAt,
    eventIndexGeneratedAt: null,
    scannedEvents: snapshot.length,
    candidateEvents: candidateSnapshot.length,
    playerAEventCount,
    playerBEventCount,
    liveEvents: liveEventCount,
    ...collected,
    cacheHit: false,
  };
  setHeadToHeadResultCacheValue(cacheKey, result);
  return result;
}

async function handleHeadToHeadApi(requestUrl, response) {
  try {
    // H2H must not wait for the remote dictionary on every request.
    // Use the local snapshot now and refresh the shared copy in the background.
    syncTranslationsFromSharedSource().catch((error) => {
      console.warn("[head-to-head] background translations sync failed:", error?.message || error);
    });
    const playerAName = String(requestUrl.searchParams.get("playerA") || requestUrl.searchParams.get("nameA") || "").trim();
    const playerATranslatedName = String(requestUrl.searchParams.get("translatedA") || requestUrl.searchParams.get("translatedNameA") || "").trim();
    const playerBName = String(requestUrl.searchParams.get("playerB") || requestUrl.searchParams.get("nameB") || "").trim();
    const playerBTranslatedName = String(requestUrl.searchParams.get("translatedB") || requestUrl.searchParams.get("translatedNameB") || "").trim();
    const eventLimit = Math.min(Math.max(Number(requestUrl.searchParams.get("eventLimit") || 80) || 80, 1), 200);
    const matchLimit = Math.min(Math.max(Number(requestUrl.searchParams.get("matchLimit") || 500) || 500, 1), 2000);
    const translations = readTranslations(TRANSLATIONS_PATH);
    const playerANeedles = buildPlayerRecordNeedles(playerAName, playerATranslatedName, translations);
    const playerBNeedles = buildPlayerRecordNeedles(playerBName, playerBTranslatedName, translations);

    if (playerANeedles.length === 0 || playerBNeedles.length === 0) {
      sendJson(response, 200, {
        playerA: { name: playerAName, translatedName: playerATranslatedName },
        playerB: { name: playerBName, translatedName: playerBTranslatedName },
        summary: { playerAWins: 0, playerBWins: 0, totalMatches: 0 },
        events: [],
        meta: {
          cacheBuiltAt: null,
          scannedEvents: 0,
          candidateEvents: 0,
          parsedEvents: 0,
          scannedMatches: 0,
          returnedEvents: 0,
          returnedMatches: 0,
          candidateIndexSource: null,
          candidateIndexGeneratedAt: null,
          cacheHit: false,
          playerAEventCount: 0,
          playerBEventCount: 0,
          deltaEvents: 0,
        },
      });
      return;
    }

    const searchResult = await getHeadToHeadSearchResult(
      playerAName,
      playerATranslatedName,
      playerBName,
      playerBTranslatedName,
      playerANeedles,
      playerBNeedles,
    );
    let returnedMatches = 0;
    const limitedEvents = [];
    for (const event of searchResult.events) {
      if (limitedEvents.length >= eventLimit || returnedMatches >= matchLimit) {
        break;
      }
      const remainingMatches = matchLimit - returnedMatches;
      const matches = event.matches.slice(0, remainingMatches);
      if (matches.length === 0) {
        continue;
      }
      returnedMatches += matches.length;
      limitedEvents.push({
        ...event,
        matches,
      });
    }

    sendJson(response, 200, {
      playerA: { name: playerAName, translatedName: playerATranslatedName },
      playerB: { name: playerBName, translatedName: playerBTranslatedName },
      summary: {
        playerAWins: searchResult.aWins,
        playerBWins: searchResult.bWins,
        totalMatches: searchResult.aWins + searchResult.bWins,
      },
      events: limitedEvents,
      meta: {
        cacheBuiltAt: searchResult.builtAt,
        eventIndexSource: searchResult.eventIndexSource,
        eventIndexGeneratedAt: searchResult.eventIndexGeneratedAt,
        candidateIndexSource: searchResult.candidateIndexSource,
        candidateIndexGeneratedAt: searchResult.candidateIndexGeneratedAt,
        cacheHit: searchResult.cacheHit,
        scannedEvents: searchResult.scannedEvents,
        candidateEvents: searchResult.candidateEvents,
        playerAEventCount: searchResult.playerAEventCount,
        playerBEventCount: searchResult.playerBEventCount,
        deltaEvents: searchResult.deltaEvents || 0,
        parsedEvents: searchResult.parsedEvents,
        scannedMatches: searchResult.scannedMatches,
        returnedEvents: limitedEvents.length,
        returnedMatches,
      },
    });
  } catch (error) {
    sendJson(response, 500, {
      error: createFriendlyErrorMessage(error),
    });
  }
}

async function handlePlayerRecordsApi(requestUrl, response) {
  try {
    refreshTranslationsInBackground("player-records");
    const name = String(requestUrl.searchParams.get("name") || "").trim();
    const translatedName = String(requestUrl.searchParams.get("translatedName") || "").trim();
    const eventLimit = Math.min(Math.max(Number(requestUrl.searchParams.get("eventLimit") || 80) || 80, 1), 200);
    const matchLimit = Math.min(Math.max(Number(requestUrl.searchParams.get("matchLimit") || 500) || 500, 1), 2000);
    const translations = readTranslations(TRANSLATIONS_PATH);
    const needles = buildPlayerRecordNeedles(name, translatedName, translations);
    const orgFilter = buildPlayerRecordOrgFilter(translatedName, translations);
    if (needles.length === 0) {
      sendJson(response, 200, {
        name,
        translatedName,
        events: [],
        meta: {
          cacheBuiltAt: null,
          scannedEvents: 0,
          candidateEvents: 0,
          parsedEvents: 0,
          scannedMatches: 0,
          returnedEvents: 0,
          returnedMatches: 0,
          candidateIndexSource: null,
          candidateIndexGeneratedAt: null,
          playerKeyCount: 0,
          deltaEvents: 0,
        },
      });
      return;
    }
    const searchResult = await getPlayerRecordSearchResult(name, translatedName, needles, { eventLimit, matchLimit, orgFilter });
    const events = searchResult.events;
    let returnedMatches = 0;
    const limitedEvents = [];
    for (const event of events) {
      if (limitedEvents.length >= eventLimit || returnedMatches >= matchLimit) {
        break;
      }
      const remainingMatches = matchLimit - returnedMatches;
      const matches = event.matches.slice(0, remainingMatches);
      if (matches.length === 0) {
        continue;
      }
      returnedMatches += matches.length;
      limitedEvents.push({
        ...event,
        matches,
      });
    }

    sendJson(response, 200, {
      name,
      translatedName,
      events: limitedEvents,
      meta: {
        cacheBuiltAt: searchResult.builtAt,
        cacheHit: searchResult.cacheHit,
        eventIndexSource: searchResult.eventIndexSource,
        eventIndexGeneratedAt: searchResult.eventIndexGeneratedAt,
        candidateIndexSource: searchResult.candidateIndexSource,
        candidateIndexGeneratedAt: searchResult.candidateIndexGeneratedAt,
        playerKeyCount: searchResult.playerKeyCount || 0,
        deltaEvents: searchResult.deltaEvents || 0,
        scannedEvents: searchResult.scannedEvents,
        candidateEvents: searchResult.candidateEvents,
        parsedEvents: searchResult.parsedEvents,
        indexedEvents: searchResult.indexedEvents || 0,
        missingIndexedEvents: searchResult.missingIndexedEvents || 0,
        scannedMatches: searchResult.scannedMatches,
        returnedEvents: limitedEvents.length,
        returnedMatches,
      },
    });
  } catch (error) {
    sendJson(response, 500, {
      error: createFriendlyErrorMessage(error),
    });
  }
}

async function handleViewerLogin(request, response) {
  if (!VIEWER_PASSWORD) {
    sendText(response, 302, "", "text/plain; charset=utf-8", {
      location: "/",
    });
    return;
  }

  const rawBody = await readRequestBody(request);
  const formData = new URLSearchParams(rawBody);
  const password = formData.get("password") || "";

  if (password === VIEWER_PASSWORD) {
    sendText(response, 302, "", "text/plain; charset=utf-8", {
      location: "/",
      "set-cookie": createViewerCookie(),
    });
    return;
  }

  sendText(response, 401, getLoginPage("パスワードが違います。"), "text/html; charset=utf-8", {
    "set-cookie": clearViewerCookie(),
  });
}

function handleConfigGet(request, response, pathname) {
  if (pathname === "/api/admin/storage-status") {
    return handleAdminStorageStatus(request, response);
  }

  if (pathname === "/api/admin/export-data") {
    return handleAdminExportData(request, response);
  }

  if (pathname === "/api/admin/build-head-to-head-index") {
    return handleAdminBuildHeadToHeadIndex(request, response);
  }

  if (pathname === "/api/admin/head-to-head-index-status") {
    return handleAdminHeadToHeadIndexStatus(request, response);
  }

  if (pathname === "/api/admin/crawl-wtt-status") {
    return handleAdminWttCrawlStatus(request, response);
  }

  if (pathname === "/api/admin/backfill-5000-status") {
    return handleAdminBackfill5000Status(request, response);
  }

  if (pathname === "/api/admin/sync-manifest") {
    return handleAdminSyncManifest(request, response);
  }

  if (pathname === "/api/event-names") {
    const searchParams = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`).searchParams;
    const eventId = searchParams.get("event");
    const source = normalizeSource(searchParams.get("source") || "wtt");
    fetchEventMeta(eventId, source)
      .then((meta) => {
        sendJson(response, 200, {
          ...meta,
        });
      })
      .catch((error) => {
        sendJson(response, 500, {
          error: createFriendlyErrorMessage(error),
        });
      });
    return true;
  }

  if (pathname === "/api/config/translations") {
    if (!requireAuthorization(request, response)) {
      return true;
    }
    const data = readTranslations(TRANSLATIONS_PATH);
    refreshTranslationsInBackground("translations");
    sendJson(response, 200, {
      file: hasSharedTranslationsSource() ? `${TEAM_TRANSLATIONS_BASE_URL}/api/config/translations` : TRANSLATIONS_PATH,
      data,
      sharedSource: hasSharedTranslationsSource() ? TEAM_TRANSLATIONS_BASE_URL : null,
      sync: {
        source: "local",
        background: true,
      },
    });
    return true;
  }

  if (pathname === "/api/config/rules") {
    if (!requireAuthorization(request, response)) {
      return true;
    }
    sendJson(response, 200, {
      file: RULES_PATH,
      data: readRules(RULES_PATH),
    });
    return true;
  }

  return false;
}

async function handleConfigUpdate(request, response, pathname) {
  if (!requireAuthorization(request, response)) {
    return true;
  }

  try {
    const rawBody = await readRequestBody(request);
    const parsed = JSON.parse(rawBody || "{}");

    if (pathname === "/api/config/translations") {
      const validated = validateTranslationsPayload(parsed);
      if (hasSharedTranslationsSource()) {
        await saveSharedTranslations(validated);
      }
      writePrettyJson(TRANSLATIONS_PATH, validated);
      clearProcessedMatchesCache();
      clearPlayerRecordResultCache();
      clearHeadToHeadResultCache();
      clearPlayerRecordArchiveParseCache();
      sendJson(response, 200, {
        ok: true,
        file: hasSharedTranslationsSource() ? `${TEAM_TRANSLATIONS_BASE_URL}/api/config/translations` : TRANSLATIONS_PATH,
      });
      return true;
    }

    if (pathname === "/api/config/rules") {
      writePrettyJson(RULES_PATH, parsed);
      clearProcessedMatchesCache();
      clearPlayerRecordResultCache();
      clearHeadToHeadResultCache();
      clearPlayerRecordArchiveParseCache();
      sendJson(response, 200, {
        ok: true,
        file: RULES_PATH,
      });
      return true;
    }

    return false;
  } catch (error) {
    if (error.statusCode === 413) {
      sendJson(response, 413, {
        error: error.message,
      });
      return true;
    }
    sendJson(response, 400, {
      error: `Invalid JSON: ${error.message}`,
    });
    return true;
  }
}

function handleAdminPost(request, response, pathname) {
  if (pathname === "/api/admin/crawl-wtt") {
    return handleAdminWttCrawlStart(request, response);
  }
  if (pathname === "/api/admin/backfill-5000-records") {
    return handleAdminBackfill5000Start(request, response);
  }
  if (pathname === "/api/admin/sync-bundled-record") {
    return handleAdminSyncBundledRecord(request, response);
  }
  return false;
}

function startServer() {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, buildHealthPayload());
      return;
    }

    if (isRateLimited(request)) {
      sendJson(response, 429, {
        error: "Too many requests",
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/login") {
      handleViewerLogin(request, response).catch((error) => {
        sendText(response, error.statusCode || 500, error.message);
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/logout") {
      sendText(response, 302, "", "text/plain; charset=utf-8", {
        location: "/",
        "set-cookie": clearViewerCookie(),
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/favicon.svg") {
      serveFile(response, path.join(PUBLIC_DIR, "favicon.svg"));
      return;
    }

    const viewerAuthorized = isViewerAuthorized(request);

    if (!viewerAuthorized) {
      if (requestUrl.pathname.startsWith("/api/")) {
        sendJson(response, 401, {
          error: "Login required",
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/") {
        sendText(response, 200, getLoginPage(), "text/html; charset=utf-8");
        return;
      }

      sendText(response, 302, "", "text/plain; charset=utf-8", {
        location: "/",
      });
      return;
    }

    if (
      request.method === "GET" &&
      (
        requestUrl.pathname === "/api/individual-matches" ||
        requestUrl.pathname === "/api/categories" ||
        requestUrl.pathname === "/api/rounds" ||
        requestUrl.pathname === "/api/events/search" ||
        requestUrl.pathname === "/api/players/search" ||
        requestUrl.pathname === "/api/players/records" ||
        requestUrl.pathname === "/api/head-to-head"
      )
    ) {
      if (requestUrl.pathname === "/api/categories") {
        runHeavyApi(() => handleCategoriesApi(requestUrl, response), response);
      } else if (requestUrl.pathname === "/api/rounds") {
        runHeavyApi(() => handleRoundsApi(requestUrl, response), response);
      } else if (requestUrl.pathname === "/api/events/search") {
        handleEventSearchApi(requestUrl, response);
      } else if (requestUrl.pathname === "/api/players/search") {
        handlePlayerSearchApi(requestUrl, response);
      } else if (requestUrl.pathname === "/api/players/records") {
        runHeavyApi(() => handlePlayerRecordsApi(requestUrl, response), response);
      } else if (requestUrl.pathname === "/api/head-to-head") {
        runHeavyApi(() => handleHeadToHeadApi(requestUrl, response), response);
      } else {
        runHeavyApi(() => handleApi(requestUrl, response), response);
      }
      return;
    }

    if (request.method === "GET" && handleConfigGet(request, response, requestUrl.pathname)) {
      return;
    }

    if (request.method === "POST" && handleAdminPost(request, response, requestUrl.pathname)) {
      return;
    }

    if (request.method === "PUT") {
      handleConfigUpdate(request, response, requestUrl.pathname).then((handled) => {
        if (!handled) {
          sendJson(response, 404, { error: "Not found" });
        }
      });
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    const filePath = requestUrl.pathname === "/"
      ? path.join(PUBLIC_DIR, "index.html")
      : path.join(PUBLIC_DIR, requestUrl.pathname);
    serveFile(response, filePath);
  });

  ensureRuntimeFiles();

  server.listen(PORT, HOST, () => {
    console.log(`WTT Individual Match Formatter web server: http://${HOST}:${PORT}`);
    scheduleHeadToHeadIndexReconciliation();
  });
}

async function runHeadToHeadIndexBuildCli() {
  ensureRuntimeFiles();
  const snapshot = getWttRecordFileSnapshot();
  const signature = getHeadToHeadPersistentIndexSignature(snapshot);
  writeHeadToHeadIndexStatus({
    ok: true,
    status: "running",
    signature,
    eventCount: snapshot.length,
  });
  const result = await buildHeadToHeadPersistentIndex(snapshot, signature);
  writeHeadToHeadIndexStatus({
    ok: true,
    status: "complete",
    signature,
    manifest: result.manifest,
  });
  console.log(JSON.stringify({
    ok: true,
    players: HEAD_TO_HEAD_PLAYER_INDEX_PATH,
    pairShards: HEAD_TO_HEAD_PAIR_SHARDS_DIR,
    manifest: HEAD_TO_HEAD_INDEX_MANIFEST_PATH,
    ...result.manifest,
  }, null, 2));
}

function parsePlayerRecordEventIndexArgs(argv) {
  const args = {
    eventIds: null,
    force: false,
    limit: Infinity,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg === "--event" || arg === "--events") {
      const value = argv[index + 1] || "";
      index += 1;
      args.eventIds = new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean));
      continue;
    }
    if (arg.startsWith("--event=") || arg.startsWith("--events=")) {
      const value = arg.split("=").slice(1).join("=");
      args.eventIds = new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean));
      continue;
    }
    if (arg === "--limit") {
      args.limit = Math.max(0, Number(argv[index + 1] || 0) || 0) || Infinity;
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      args.limit = Math.max(0, Number(arg.split("=").slice(1).join("=")) || 0) || Infinity;
    }
  }
  return args;
}

function isPlayerRecordEventIndexCurrent(file) {
  try {
    const index = JSON.parse(fs.readFileSync(getPlayerRecordEventIndexPath(file.eventId), "utf8"));
    return (
      index?.version === PLAYER_RECORD_EVENT_INDEX_VERSION &&
      isPlayerRecordEventIndexForFile(index, file)
    );
  } catch {
    return false;
  }
}

async function runPlayerRecordEventIndexBuildCli() {
  ensureRuntimeFiles();
  const args = parsePlayerRecordEventIndexArgs(process.argv.slice(2));
  const allFiles = getWttRecordFileSnapshot();
  const files = allFiles
    .filter((file) => !args.eventIds || args.eventIds.has(String(file.eventId)))
    .filter((file) => args.force || !isPlayerRecordEventIndexCurrent(file))
    .slice(0, args.limit);
  const deps = {
    translations: readTranslations(TRANSLATIONS_PATH),
    rules: readRules(RULES_PATH),
    searchIndex: readWttSearchIndex(),
    dateIndex: readWttDateIndex(WTT_DATE_INDEX_PATH),
    archiveIndex: readWttArchiveIndex(),
    eventNames: getEventNamesMap(),
  };
  const startedAt = Date.now();
  let totalBytes = 0;
  let indexedMatches = 0;
  let indexedEntries = 0;
  let keyCount = 0;
  let built = 0;
  const failures = [];

  ensureDir(PLAYER_RECORD_EVENT_INDEX_DIR);
  for (const file of files) {
    try {
      const result = writePlayerRecordEventIndexForFile(file, deps);
      totalBytes += result.bytes;
      indexedMatches += result.indexedMatches;
      indexedEntries += result.indexedEntries;
      keyCount += result.keyCount;
      built += 1;
      console.log(`event ${built}/${files.length}: ${result.eventId} ${result.indexedMatches} matches ${result.keyCount} keys ${result.bytes} bytes`);
    } catch (error) {
      failures.push({
        eventId: String(file.eventId),
        error: error.message || String(error),
      });
      console.error(`failed ${file.eventId}: ${error.message || error}`);
    }
    await yieldToEventLoop();
  }

  const manifest = {
    version: PLAYER_RECORD_EVENT_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    eventCount: allFiles.length,
    builtEventCount: built,
    requestedEventCount: files.length,
    indexedMatches,
    indexedEntries,
    keyCount,
    bytes: totalBytes,
    durationMs: Date.now() - startedAt,
    failures,
  };
  writeCompactJsonFileAtomic(PLAYER_RECORD_EVENT_INDEX_MANIFEST_PATH, manifest);
  console.log(JSON.stringify({
    ok: failures.length === 0,
    dir: PLAYER_RECORD_EVENT_INDEX_DIR,
    manifest: PLAYER_RECORD_EVENT_INDEX_MANIFEST_PATH,
    ...manifest,
  }, null, 2));
}

if (process.argv.includes("--update-head-to-head-index")) {
  runHeadToHeadIndexIncrementalCli().catch((error) => {
    writeHeadToHeadIndexStatus({
      ok: false,
      status: "failed",
      error: error.stack || error.message || String(error),
    });
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
} else if (process.argv.includes("--build-head-to-head-index")) {
  runHeadToHeadIndexBuildCli().catch((error) => {
    writeHeadToHeadIndexStatus({
      ok: false,
      status: "failed",
      error: error.stack || error.message || String(error),
    });
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
} else if (process.argv.includes("--build-player-record-event-index")) {
  runPlayerRecordEventIndexBuildCli().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
} else {
  startServer();
}
