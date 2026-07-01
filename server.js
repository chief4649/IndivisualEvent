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
const PLAYER_SEARCH_ARCHIVE_NAME_INDEX_VERSION = 1;
const PLAYER_SEARCH_ARCHIVE_NAME_INDEX_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "player-search-names.json");
const PLAYER_SEARCH_ARCHIVE_NAME_INDEX_MANIFEST_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "player-search-names-manifest.json");
const HEAD_TO_HEAD_INDEX_VERSION = 4;
const HEAD_TO_HEAD_PLAYER_INDEX_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "head-to-head-players.json");
const HEAD_TO_HEAD_PAIR_SHARDS_DIR = path.join(PLAYER_RECORDS_INDEX_DIR, "head-to-head-pairs");
const PLAYER_RECORD_MATCH_SHARDS_DIR = path.join(PLAYER_RECORDS_INDEX_DIR, "player-record-matches");
const HEAD_TO_HEAD_INDEX_MANIFEST_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "head-to-head-manifest.json");
const HEAD_TO_HEAD_INDEX_STATUS_PATH = path.join(PLAYER_RECORDS_INDEX_DIR, "head-to-head-status.json");
const BUNDLED_HEAD_TO_HEAD_PLAYER_INDEX_PATH = path.join(BUNDLED_PLAYER_RECORDS_INDEX_DIR, "head-to-head-players.json");
const BUNDLED_HEAD_TO_HEAD_PAIR_SHARDS_DIR = path.join(BUNDLED_PLAYER_RECORDS_INDEX_DIR, "head-to-head-pairs");
const BUNDLED_PLAYER_RECORD_MATCH_SHARDS_DIR = path.join(BUNDLED_PLAYER_RECORDS_INDEX_DIR, "player-record-matches");
const BUNDLED_HEAD_TO_HEAD_INDEX_MANIFEST_PATH = path.join(BUNDLED_PLAYER_RECORDS_INDEX_DIR, "head-to-head-manifest.json");
const WTT_CALENDAR_API_URL = "https://wtt-website-api-prod-3-frontdoor-bddnb2haduafdze9.a01.azurefd.net/api/eventcalendar";
const WTT_EVENT_ID_ALIASES = {
  "3487": "34031",
  "5524": "3500",
  "5513": "2755",
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
const SKIP_RUNTIME_ARCHIVE_SYNC = process.env.SKIP_RUNTIME_ARCHIVE_SYNC === "1" || process.env.RENDER === "true";
const VIEWER_COOKIE_NAME = "ttreport_individual_viewer_auth";
const TEAM_TRANSLATIONS_BASE_URL = String(process.env.TEAM_TRANSLATIONS_BASE_URL || "").trim().replace(/\/+$/, "");
const TEAM_TRANSLATIONS_ADMIN_TOKEN = process.env.TEAM_TRANSLATIONS_ADMIN_TOKEN || "";
const TEAM_TRANSLATIONS_VIEWER_PASSWORD = process.env.TEAM_TRANSLATIONS_VIEWER_PASSWORD || "";
const SHARED_TRANSLATIONS_TIMEOUT_MS = Number(process.env.SHARED_TRANSLATIONS_TIMEOUT_MS || 8000);
const EVENT_NAME_CACHE_MAX_ENTRIES = Number(process.env.EVENT_NAME_CACHE_MAX_ENTRIES || 500);
const PROCESSED_MATCHES_CACHE_MAX_ENTRIES = Number(process.env.PROCESSED_MATCHES_CACHE_MAX_ENTRIES || 3);
const REQUEST_BODY_MAX_BYTES = Number(process.env.REQUEST_BODY_MAX_BYTES || 1_048_576);
const rateLimitStore = new Map();
const eventNameCache = new Map();
const processedMatchesCache = new Map();
let headToHeadIndexBuildProcess = null;
let backfill5000Promise = null;
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
  if (!force && translationsSyncPromise) {
    await translationsSyncPromise;
    return { synced: true, source: "shared" };
  }
  translationsSyncPromise = (async () => {
    const translations = await fetchSharedTranslations();
    if (translations) {
      writePrettyJson(TRANSLATIONS_PATH, translations);
    }
    return { synced: Boolean(translations), source: "shared" };
  })();
  try {
    return await translationsSyncPromise;
  } catch (error) {
    console.error(`[translations sync] ${error.message}`);
    return {
      synced: false,
      source: "local",
      reason: error.message,
    };
  } finally {
    translationsSyncPromise = null;
  }
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
  return {
    requestedEventId: normalizedId,
    exists: meta.exists,
    path: meta.path,
    size: meta.size,
    mtime: meta.mtime,
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
    zennihonRecordsDir: ZENNIHON_ARCHIVE_DIR,
    files: Object.fromEntries(
      STORAGE_MANAGED_FILES.map(([name, filePath]) => [name, getFileMeta(filePath)]),
    ),
    wttRecords: listRecordFiles(WTT_ARCHIVE_DIR, limit),
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
  if (!/^\d+$/.test(normalizedId) || !String(indexedName || "").trim()) {
    return false;
  }

  // Historical ITTF/Bornan numeric IDs can collide with newer WTT event-name API IDs.
  // If we already have an indexed name for old IDs, it is more reliable than GetEventName.
  return Number(normalizedId) < 3000;
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
    if (!shouldDisplayWttSearchEntry(name)) {
      return;
    }
    if (
      matchesSearchQuery(eventId, name, query, [
        ...buildDateSearchValues(mergedEntry?.startDate, mergedEntry?.endDate, dateLabel),
      ])
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
        governingBody: classifyWttGoverningBody(name),
      });
    }
  });

  return results
    .sort(compareSearchEvents)
    .slice(0, 50);
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
    bundledWttArchiveDir: BUNDLED_WTT_ARCHIVE_DIR,
    wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
    refreshCache: parseBoolean(searchParams.get("refreshCache")),
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
    if (match.isParaClass) {
      continue;
    }
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
    if (!match || match.isParaClass) {
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
      bundledWttArchiveDir: BUNDLED_WTT_ARCHIVE_DIR,
      wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
      refreshCache: options.refreshCache,
    });

    sendJson(response, 200, {
      source: options.source,
      event: options.event,
      categories: summarizeCategories(result.filtered),
    });
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
      bundledWttArchiveDir: BUNDLED_WTT_ARCHIVE_DIR,
      wttArchiveIndexPath: WTT_ARCHIVE_INDEX_PATH,
      refreshCache: options.refreshCache,
    });

    sendJson(response, 200, {
      source: options.source,
      event: options.event,
      rounds: summarizeRoundOptions(result.filtered, result.rules, result.translations),
    });
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

function getPlayerSearchIdentityKey(name) {
  const canonicalName = getCanonicalPlayerSearchNameKey(name);
  return canonicalName ? `name:${canonicalName}` : "";
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
  const playerKey = getPlayerSearchIdentityKey(item.name, item.translatedName);
  if (!playerKey) {
    return;
  }
  const existing = resultByPlayerKey.get(playerKey);
  resultByPlayerKey.set(playerKey, mergePlayerSearchResultCandidate(existing, item));
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
    await syncTranslationsFromSharedSource();
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
          const item = {
            name,
            translatedName: String(translatedName || "").trim() || "未登録",
            registered: Boolean(String(translatedName || "").trim()),
            score: getPlayerSearchScore(query, name, translatedName),
          };
          const playerKey = getPlayerSearchIdentityKey(name, translatedName);
          const existing = resultByPlayerKey.get(playerKey);
          resultByPlayerKey.set(playerKey, mergePlayerSearchResultCandidate(existing, item));
        }
      });
    }

    const archiveResults = tokens.length > 0
      ? await collectPlayerSearchArchiveCandidates(query, translations, limit)
      : [];
    archiveResults.forEach((item) => {
      const playerKey = getPlayerSearchIdentityKey(item.name, item.translatedName);
      const existing = resultByPlayerKey.get(playerKey);
      resultByPlayerKey.set(playerKey, mergePlayerSearchResultCandidate(existing, item));
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
    return 1;
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
const PLAYER_RECORD_RESULT_CACHE_MAX = 10;
const PLAYER_RECORD_RESULT_CACHE_TTL_MS = Number(process.env.PLAYER_RECORD_RESULT_CACHE_TTL_MS || 60_000);
const headToHeadResultCache = new Map();
const HEAD_TO_HEAD_RESULT_CACHE_MAX = Number(process.env.HEAD_TO_HEAD_RESULT_CACHE_MAX || 20);
const HEAD_TO_HEAD_RESULT_CACHE_TTL_MS = Number(process.env.HEAD_TO_HEAD_RESULT_CACHE_TTL_MS || 60_000);
const playerRecordArchiveParseCache = new Map();
const PLAYER_RECORD_ARCHIVE_PARSE_CACHE_MAX = Number(process.env.PLAYER_RECORD_ARCHIVE_PARSE_CACHE_MAX || 12);

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
    const stat = fs.statSync(slimFilePath);
    if (!stat.isFile() || stat.size <= 0) {
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

function getWttRecordFileSnapshot() {
  const recordsByEventId = new Map();

  const addDirectory = (dirPath, slimDirPath, sourcePriority, sourceLabel) => {
    try {
      if (!dirPath || !fs.existsSync(dirPath)) {
        return;
      }

      fs.readdirSync(dirPath)
        .filter((fileName) => /^\d+\.json$/.test(fileName))
        .forEach((fileName) => {
          const eventId = fileName.replace(/\.json$/, "");
          const filePath = path.join(dirPath, fileName);
          const stat = fs.statSync(filePath);
          const slimFile = getSlimWttRecordFile(filePath, slimDirPath);
          const next = {
            eventId,
            filePath,
            parseFilePath: slimFile?.filePath || filePath,
            parseSize: slimFile?.size || stat.size,
            parseMtimeMs: slimFile?.mtimeMs || Math.trunc(stat.mtimeMs),
            parseSource: slimFile ? "slim" : "raw",
            size: stat.size,
            mtimeMs: Math.trunc(stat.mtimeMs),
            sourcePriority,
            sourceLabel,
          };

          const current = recordsByEventId.get(eventId);
          if (!current) {
            recordsByEventId.set(eventId, next);
            return;
          }

          // Runtime DATA_DIR can contain stale persistent files on Render.
          // Bundled repo files can contain newer deployed records.
          // Prefer larger/newer files; if tied, prefer bundled deployment data.
          if (
            next.size > current.size ||
            (next.size === current.size && next.mtimeMs > current.mtimeMs) ||
            (
              next.size === current.size &&
              next.mtimeMs === current.mtimeMs &&
              next.sourcePriority > current.sourcePriority
            )
          ) {
            recordsByEventId.set(eventId, next);
          }
        });
    } catch {
      // Ignore unreadable archive directories.
    }
  };

  addDirectory(WTT_ARCHIVE_DIR, WTT_SLIM_ARCHIVE_DIR, 1, "runtime");
  addDirectory(BUNDLED_WTT_ARCHIVE_DIR, BUNDLED_WTT_SLIM_ARCHIVE_DIR, 2, "bundled");

  return [...recordsByEventId.values()]
    .map(({ sourcePriority, ...file }) => file)
    .sort((left, right) => String(left.eventId).localeCompare(String(right.eventId), "en", { numeric: true }));
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
    .filter(([, translated]) => normalizePlayerSearchText(translated) === normalized)
    .map(([rawName]) => rawName);
}

function buildPlayerRecordNeedles(name, translatedName, translations) {
  const aliasNames = [
    ...getPlayerTranslationAliasNames(name, translations),
    ...getPlayerTranslationAliasNames(translatedName, translations),
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

function playerMatchesCompetitor(competitor, needles, translations) {
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
    ]) : []),
  ].filter(Boolean);

  const expandedValues = values.flatMap((value) => [
    value,
    translatePlayerNameForRecord(value, translations),
    ...buildPlayerNameSearchValues(value),
  ]).filter(Boolean);

  return expandedValues.some((value) =>
    needles.some((needle) => playerRecordNameMatchesNeedle(value, needle)),
  );
}

function findPlayerCompetitorIndex(match, needles, translations) {
  const competitors = Array.isArray(match?.competitors) ? match.competitors : [];
  return competitors.findIndex((competitor) => playerMatchesCompetitor(competitor, needles, translations));
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

function translatePlayer(value, translations) {
  const candidates = getNameTranslationCandidates(value);

  for (const candidate of candidates) {
    if (translations.players?.[candidate]) {
      return translations.players[candidate];
    }
  }

  return compactJapaneseName(value);
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

function translatePlayerNameForRecord(name, translations) {
  const raw = String(name || "").trim();
  if (!raw) {
    return "";
  }

  const parts = raw.split(/\s*(?:\/|／|\+|&| and )\s*/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    return parts.map((part) => translatePlayer(part, translations)).filter(Boolean).join("／");
  }

  return translatePlayer(raw, translations);
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
      name: translatePlayer(player?.name || "", translations),
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
    const name = translatePlayerNameForRecord(candidate, translations);
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
      snapshot,
      source: "all",
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

  const candidatePaths = await getPlayerRecordGrepCandidatePaths(snapshot, textNeedles);
  if (!candidatePaths) {
    return {
      snapshot,
      source: "all",
      generatedAt: null,
    };
  }

  return {
    snapshot: snapshot.filter((file) => candidatePaths.has(file.parseFilePath || file.filePath)),
    source: "grep-prefilter",
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
  return String(left?.documentCode || "").localeCompare(String(right?.documentCode || ""), "en", { numeric: true });
}

function buildPlayerRecordMatchGroups(matches) {
  const grouped = new Map();

  // Keep the original match order within each category.
  // The source order is used by the existing record output, where later rounds
  // such as finals appear above earlier rounds.
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
      matches: groupMatches,
    }));
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function collectPlayerRecordEvents(snapshot, needles, textNeedles) {
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
        const competitorIndex = findPlayerCompetitorIndex(match, needles, translations);
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
        const competitorIndex = findPlayerCompetitorIndex(single, needles, translations);
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
    events.push({
      ...getEventRecordMeta(file.eventId, searchIndex, dateIndex, archiveIndex, eventNames),
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
  if (!index?.players || !index?.recordShardsDir) {
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
  const wantedKeys = new Set(playerKeys);
  const shardNames = new Set([...playerKeys].map(getPlayerRecordMatchShardName));
  shardNames.forEach((shardName) => {
    let lines = [];
    try {
      lines = fs.readFileSync(path.join(index.recordShardsDir, shardName), "utf8").split(/\n/).filter(Boolean);
    } catch {
      lines = [];
    }
    lines.forEach((line) => {
      let row = null;
      try {
        row = JSON.parse(line);
      } catch {
        row = null;
      }
      if (!row || !wantedKeys.has(row.key) || !row.eventId || !row.event || !row.match) {
        return;
      }
      if (!eventsById.has(row.eventId)) {
        eventsById.set(row.eventId, {
          ...row.event,
          matches: [],
        });
      }
      const target = eventsById.get(row.eventId);
      const seen = new Set(target.matches.map(getPlayerRecordIndexMatchId));
      const matchId = getPlayerRecordIndexMatchId(row.match);
      if (!seen.has(matchId)) {
        target.matches.push(row.match);
        seen.add(matchId);
      }
    });
  });

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

async function getPlayerRecordSearchResult(name, translatedName, needles) {
  const snapshot = getWttRecordFileSnapshot();
  const signature = getPlayerRecordCacheSignature(snapshot);
  const persistentIndexSignature = getHeadToHeadPersistentIndexSignature(snapshot);
  const cacheKey = `${signature}::${needles.join("|")}`;
  const cached = playerRecordResultCache.get(cacheKey);
  if (cached && Date.now() - cached.builtAt < PLAYER_RECORD_RESULT_CACHE_TTL_MS) {
    return {
      ...cached,
      cacheHit: true,
    };
  }

  const persistentIndex = getHeadToHeadPersistentIndex(persistentIndexSignature);
  if (persistentIndex) {
    let indexed = collectPlayerRecordEventsFromPersistentIndex(persistentIndex, needles);
    if (indexed) {
      let deltaEventCount = 0;
      if (persistentIndex.stale && persistentIndex.eventIds.length > 0) {
        const indexedEventIds = new Set(persistentIndex.eventIds);
        const deltaSnapshot = snapshot.filter((file) => !indexedEventIds.has(String(file.eventId)));
        deltaEventCount = deltaSnapshot.length;
        if (deltaSnapshot.length > 0) {
          const delta = await collectPlayerRecordEvents(deltaSnapshot, needles, []);
          indexed = mergeHeadToHeadCollectedResults(indexed, delta);
        }
      }
      const result = {
        signature: persistentIndexSignature,
        builtAt: Date.now(),
        eventIndexSource: "player-record-match-index",
        candidateIndexSource: persistentIndex.stale ? "player-record-match-index+delta" : "player-record-match-index",
        candidateIndexGeneratedAt: persistentIndex.generatedAt,
        eventIndexGeneratedAt: null,
        scannedEvents: snapshot.length,
        candidateEvents: indexed.candidateEventCount ?? indexed.events.length,
        playerKeyCount: indexed.playerKeyCount,
        deltaEvents: deltaEventCount,
        ...indexed,
      };
      setPlayerRecordResultCacheValue(cacheKey, result);
      return {
        ...result,
        cacheHit: false,
      };
    }
  }

  const textNeedles = buildPlayerRecordTextNeedles(...needles);
  const candidateResult = await getPlayerRecordCandidateSnapshot(snapshot, textNeedles, signature);
  const candidateSnapshot = candidateResult.snapshot;
  const collected = await collectPlayerRecordEvents(candidateSnapshot, needles, []);
  const result = {
    signature,
    builtAt: Date.now(),
    eventIndexSource: "wtt-records",
    candidateIndexSource: candidateResult.source,
    candidateIndexGeneratedAt: candidateResult.generatedAt,
    eventIndexGeneratedAt: null,
    scannedEvents: snapshot.length,
    candidateEvents: candidateSnapshot.length,
    ...collected,
  };
  setPlayerRecordResultCacheValue(cacheKey, result);
  if (candidateResult.source !== "candidate-index") {
    startPlayerRecordCandidateIndexBuild(snapshot, signature);
  }
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
  index: null,
};

function getHeadToHeadPersistentIndexSignature(snapshot) {
  const dataSignature = snapshot.map((file) => [
    file.eventId,
    file.size,
    file.parseSource || "raw",
    file.parseSize || file.size,
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

function readHeadToHeadPersistentIndexFromDisk(signature) {
  const candidates = [
    [HEAD_TO_HEAD_INDEX_MANIFEST_PATH, HEAD_TO_HEAD_PLAYER_INDEX_PATH, PLAYER_RECORD_MATCH_SHARDS_DIR],
    [BUNDLED_HEAD_TO_HEAD_INDEX_MANIFEST_PATH, BUNDLED_HEAD_TO_HEAD_PLAYER_INDEX_PATH, BUNDLED_PLAYER_RECORD_MATCH_SHARDS_DIR],
  ];
  let staleIndex = null;

  for (const [manifestPath, playerIndexPath, recordShardsDir] of candidates) {
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
        index: {
          players: playerIndex.players,
          recordShardsDir: fs.existsSync(recordShardsDir) ? recordShardsDir : null,
        },
      };
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

function setHeadToHeadPersistentIndexState(indexState) {
  headToHeadPersistentIndexState.signature = indexState.signature;
  headToHeadPersistentIndexState.currentSignature = indexState.currentSignature;
  headToHeadPersistentIndexState.generatedAt = indexState.generatedAt;
  headToHeadPersistentIndexState.stale = Boolean(indexState.stale);
  headToHeadPersistentIndexState.eventIds = Array.isArray(indexState.eventIds) ? indexState.eventIds : [];
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

function getHeadToHeadIndexedPair(index, pairKey) {
  if (!index?.pairShardsDir || !index?.pairShardCache) {
    return null;
  }
  const shardName = getHeadToHeadPairShardName(pairKey);
  if (!index.pairShardCache.has(shardName)) {
    try {
      const shardPath = path.join(index.pairShardsDir, shardName);
      const shard = JSON.parse(fs.readFileSync(shardPath, "utf8"));
      index.pairShardCache.set(shardName, shard && typeof shard === "object" && !Array.isArray(shard) ? shard : {});
    } catch {
      index.pairShardCache.set(shardName, {});
    }
  }
  return index.pairShardCache.get(shardName)?.[pairKey] || null;
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

function getPlayerRecordIndexMatchId(matchEntry) {
  return [
    matchEntry?.event || "",
    matchEntry?.categoryName || "",
    matchEntry?.roundLabel || "",
    matchEntry?.documentCode || "",
    matchEntry?.line || "",
  ].join("\u0001");
}

function getPlayerRecordMatchShardName(key) {
  return `${crypto.createHash("sha1").update(String(key || "")).digest("hex").slice(0, 2)}.jsonl`;
}

function createPlayerRecordMatchShardWriter(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  ensureDir(dirPath);
  const buffers = new Map();
  const maxBufferLength = 8192;
  const flush = (shardName) => {
    const buffer = buffers.get(shardName);
    if (!buffer) {
      return;
    }
    fs.appendFileSync(path.join(dirPath, shardName), buffer, "utf8");
    buffers.set(shardName, "");
  };
  return {
    append(key, file, eventMeta, matchEntry) {
      const shardName = getPlayerRecordMatchShardName(key);
      const line = `${JSON.stringify({
        key,
        eventId: String(file.eventId || ""),
        event: {
          ...eventMeta,
          source: file.sourceLabel || "",
        },
        match: matchEntry,
      })}\n`;
      const next = `${buffers.get(shardName) || ""}${line}`;
      buffers.set(shardName, next);
      if (next.length >= maxBufferLength) {
        flush(shardName);
      }
    },
    close() {
      [...buffers.keys()].forEach(flush);
    },
  };
}

function addPlayerRecordIndexedEntry(writer, key, file, eventMeta, matchEntry) {
  if (!key || !matchEntry) {
    return false;
  }
  const eventId = String(file.eventId || "");
  if (!eventId) {
    return false;
  }
  writer.append(key, file, eventMeta, matchEntry);
  return true;
}

function addPlayerRecordIndexedMatch(index, writer, file, eventMeta, match, competitorIndex, translations, rules, roundContext, parentMatch = null) {
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
  keys.forEach((key) => {
    addHeadToHeadPlayerKey(index, key, file.eventId);
    if (addPlayerRecordIndexedEntry(writer, key, file, eventMeta, matchEntry)) {
      indexed += 1;
    }
  });
  return indexed;
}

function getHeadToHeadIndexPlayerKeys(index, needles) {
  const keys = new Set();
  const players = index?.players || {};
  const playerKeys = Object.keys(players);
  needles.forEach((needle) => {
    const normalizedNeedle = normalizePlayerSearchText(needle);
    if (!normalizedNeedle) {
      return;
    }
    if (players[normalizedNeedle]) {
      keys.add(normalizedNeedle);
      return;
    }
    playerKeys.forEach((key) => {
      if (playerRecordNameMatchesNeedle(key, normalizedNeedle)) {
        keys.add(key);
      }
    });
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

function setsIntersect(left, right) {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

function addHeadToHeadIndexedMatch(index, file, eventMeta, match, playerAIndex, playerBIndex, translations, rules, roundContext, parentMatch = null) {
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
  const parseFilePath = file.parseFilePath || file.filePath;
  const text = readTextFile(parseFilePath);
  const payload = parseJsonArrayFromText(text);
  if (!Array.isArray(payload) || payload.length === 0) {
    return getParsedPlayerRecordArchive(file, text);
  }

  const normalizedMatches = [];
  for (const item of payload) {
    if (
      !archiveItemMightContainPlayerNeedles(item, playerANeedles) ||
      !archiveItemMightContainPlayerNeedles(item, playerBNeedles)
    ) {
      continue;
    }
    const match = normalizeArchivedMatch(item);
    if (match) {
      normalizedMatches.push(match);
    }
  }

  return {
    normalizedMatches,
    contextsByCategory: buildRoundContextsByCategory(normalizedMatches),
    fallbackRoundContext: buildJaRoundContext(normalizedMatches),
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
  let aWins = 0;
  let bWins = 0;

  for (const file of snapshot) {
    await yieldToEventLoop();
    const {
      normalizedMatches,
      contextsByCategory,
      fallbackRoundContext,
    } = getParsedPlayerRecordArchive(file);
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
          const before = matches.length;
          pushHeadToHeadMatch(matches, match, playerAIndex, playerBIndex, translations, rules, matchRoundContext);
          if (matches.length > before) {
            if (matches[matches.length - 1].winner === "a") {
              aWins += 1;
            } else {
              bWins += 1;
            }
          }
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
          const before = matches.length;
          pushHeadToHeadMatch(matches, single, playerAIndex, playerBIndex, translations, rules, matchRoundContext, match);
          if (matches.length > before) {
            if (matches[matches.length - 1].winner === "a") {
              aWins += 1;
            } else {
              bWins += 1;
            }
          }
        }
      });
    }

    if (matches.length === 0) {
      continue;
    }

    const matchGroups = buildPlayerRecordMatchGroups(matches);
    events.push({
      ...getEventRecordMeta(file.eventId, searchIndex, dateIndex, archiveIndex, eventNames),
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
    aWins,
    bWins,
  };
}

async function buildHeadToHeadPersistentIndex(snapshot, signature) {
  const translations = readTranslations(TRANSLATIONS_PATH);
  const rules = readRules(RULES_PATH);
  const searchIndex = readWttSearchIndex();
  const dateIndex = readWttDateIndex(WTT_DATE_INDEX_PATH);
  const archiveIndex = readWttArchiveIndex();
  const eventNames = getEventNamesMap();
  const index = {
    players: {},
  };
  const recordShardWriter = createPlayerRecordMatchShardWriter(PLAYER_RECORD_MATCH_SHARDS_DIR);
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
      const {
        normalizedMatches,
        contextsByCategory,
        fallbackRoundContext,
      } = getParsedPlayerRecordArchive(file);
      if (!Array.isArray(normalizedMatches) || normalizedMatches.length === 0) {
        continue;
      }

      parsedEvents += 1;
      const eventMeta = getEventRecordMeta(file.eventId, searchIndex, dateIndex, archiveIndex, eventNames);

      for (const match of normalizedMatches) {
        const matchRoundContext = contextsByCategory.get(getRoundContextKey(match)) || fallbackRoundContext;
        scannedMatches += 1;

        if (match.matchType === "individual") {
          (Array.isArray(match.competitors) ? match.competitors.slice(0, 2) : []).forEach((competitor, competitorIndex) => {
            indexedPlayerRecordLinks += addPlayerRecordIndexedMatch(
              index,
              recordShardWriter,
              file,
              eventMeta,
              match,
              competitorIndex,
              translations,
              rules,
              matchRoundContext,
            );
          });

          if (match.discipline && match.discipline !== "singles") {
            continue;
          }
          if (!isSinglesHeadToHeadMatch(match)) {
            continue;
          }
          if (addHeadToHeadIndexedMatch(index, file, eventMeta, match, 0, 1, translations, rules, matchRoundContext)) {
            indexedLinks += 1;
          }
          continue;
        }

        if (match.matchType !== "team") {
          continue;
        }

        (Array.isArray(match.singles) ? match.singles : []).forEach((single) => {
          scannedMatches += 1;
          (Array.isArray(single?.competitors) ? single.competitors.slice(0, 2) : []).forEach((competitor, competitorIndex) => {
            indexedPlayerRecordLinks += addPlayerRecordIndexedMatch(
              index,
              recordShardWriter,
              file,
              eventMeta,
              single,
              competitorIndex,
              translations,
              rules,
              matchRoundContext,
              match,
            );
          });
          if (!isSinglesHeadToHeadMatch(single)) {
            return;
          }
          if (addHeadToHeadIndexedMatch(index, file, eventMeta, single, 0, 1, translations, rules, matchRoundContext, match)) {
            indexedLinks += 1;
          }
        });
      }
      clearPlayerRecordArchiveParseCache();
    }
  } finally {
    recordShardWriter.close();
  }

  Object.keys(index.players).forEach((key) => {
    index.players[key].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  });

  const generatedAt = new Date().toISOString();
  const manifest = {
    version: HEAD_TO_HEAD_INDEX_VERSION,
    generatedAt,
    signature,
    eventIds: snapshot.map((file) => String(file.eventId)),
    eventCount: snapshot.length,
    parsedEvents,
    scannedMatches,
    indexedLinks,
    indexedPlayerRecordLinks,
    playerKeyCount: Object.keys(index.players).length,
    playerRecordShardCount: fs.readdirSync(PLAYER_RECORD_MATCH_SHARDS_DIR).filter((fileName) => fileName.endsWith(".jsonl")).length,
  };

  writeJsonFileAtomic(HEAD_TO_HEAD_PLAYER_INDEX_PATH, { players: index.players });
  writeJsonFileAtomic(HEAD_TO_HEAD_INDEX_MANIFEST_PATH, manifest);
  return {
    signature,
    generatedAt,
    index: {
      players: index.players,
      recordShardsDir: PLAYER_RECORD_MATCH_SHARDS_DIR,
    },
    manifest,
  };
}

async function collectHeadToHeadMatchesFromPersistentIndex(indexState, playerANeedles, playerBNeedles, snapshot) {
  const index = indexState?.index;
  if (!index?.players) {
    return null;
  }

  const playerAKeys = getHeadToHeadIndexPlayerKeys(index, playerANeedles);
  const playerBKeys = getHeadToHeadIndexPlayerKeys(index, playerBNeedles);
  if (playerAKeys.size === 0 || playerBKeys.size === 0) {
    return {
      events: [],
      parsedEvents: 0,
      scannedMatches: 0,
      aWins: 0,
      bWins: 0,
      pairCount: 0,
      playerAKeyCount: playerAKeys.size,
      playerBKeyCount: playerBKeys.size,
    };
  }

  const playerAEventIds = getHeadToHeadIndexEventIdsForPlayer(index, playerAKeys);
  const playerBEventIds = getHeadToHeadIndexEventIdsForPlayer(index, playerBKeys);
  const candidateEventIds = new Set([...playerAEventIds].filter((eventId) => playerBEventIds.has(eventId)));
  const candidateSnapshot = snapshot.filter((file) => candidateEventIds.has(String(file.eventId)));
  const collected = await collectHeadToHeadMatches(candidateSnapshot, playerANeedles, playerBNeedles);

  return {
    ...collected,
    candidateEventCount: candidateSnapshot.length,
    pairCount: candidateEventIds.size,
    playerAKeyCount: playerAKeys.size,
    playerBKeyCount: playerBKeys.size,
  };
}

function mergeHeadToHeadCollectedResults(primary, extra) {
  if (!extra || !Array.isArray(extra.events) || extra.events.length === 0) {
    return primary;
  }
  const eventsById = new Map();
  [...(primary.events || []), ...extra.events].forEach((event) => {
    const current = eventsById.get(event.event) || {
      ...event,
      matches: [],
    };
    current.matches.push(...(event.matches || []));
    eventsById.set(event.event, current);
  });
  const events = [...eventsById.values()].map((event) => {
    const matchGroups = buildPlayerRecordMatchGroups(event.matches);
    return {
      ...event,
      matches: matchGroups.flatMap((group) => group.matches),
      matchGroups,
    };
  }).sort(comparePlayerRecordEvents);
  return {
    ...primary,
    events,
    parsedEvents: (primary.parsedEvents || 0) + (extra.parsedEvents || 0),
    scannedMatches: (primary.scannedMatches || 0) + (extra.scannedMatches || 0),
    aWins: (primary.aWins || 0) + (extra.aWins || 0),
    bWins: (primary.bWins || 0) + (extra.bWins || 0),
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

  const persistentIndex = getHeadToHeadPersistentIndex(persistentIndexSignature);
  if (persistentIndex) {
    let indexed = await collectHeadToHeadMatchesFromPersistentIndex(persistentIndex, playerANeedles, playerBNeedles, snapshot);
    if (indexed) {
      let deltaEventCount = 0;
      if (persistentIndex.stale && persistentIndex.eventIds.length > 0) {
        const indexedEventIds = new Set(persistentIndex.eventIds);
        const deltaSnapshot = snapshot.filter((file) => !indexedEventIds.has(String(file.eventId)));
        deltaEventCount = deltaSnapshot.length;
        if (deltaSnapshot.length > 0) {
          const delta = await collectHeadToHeadMatches(deltaSnapshot, playerANeedles, playerBNeedles);
          indexed = mergeHeadToHeadCollectedResults(indexed, delta);
        }
      }
      const result = {
        signature: persistentIndexSignature,
        builtAt: Date.now(),
        eventIndexSource: "head-to-head-index",
        candidateIndexSource: persistentIndex.stale ? "head-to-head-index+delta" : "head-to-head-index",
        candidateIndexGeneratedAt: persistentIndex.generatedAt,
        eventIndexGeneratedAt: null,
        scannedEvents: snapshot.length,
        candidateEvents: indexed.candidateEventCount ?? indexed.events.length,
        playerAEventCount: indexed.playerAKeyCount,
        playerBEventCount: indexed.playerBKeyCount,
        deltaEvents: deltaEventCount,
        ...indexed,
        cacheHit: false,
      };
      setHeadToHeadResultCacheValue(cacheKey, result);
      return result;
    }
  }

  const playerATextNeedles = buildPlayerRecordTextNeedles(...playerANeedles);
  const playerBTextNeedles = buildPlayerRecordTextNeedles(...playerBNeedles);
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

  const collected = await collectHeadToHeadMatches(candidateSnapshot, playerANeedles, playerBNeedles);
  const result = {
    signature,
    builtAt: Date.now(),
    eventIndexSource: "wtt-records",
    candidateIndexSource,
    candidateIndexGeneratedAt,
    eventIndexGeneratedAt: null,
    scannedEvents: snapshot.length,
    candidateEvents: candidateSnapshot.length,
    playerAEventCount,
    playerBEventCount,
    ...collected,
    cacheHit: false,
  };
  setHeadToHeadResultCacheValue(cacheKey, result);
  return result;
}

async function handleHeadToHeadApi(requestUrl, response) {
  try {
    await syncTranslationsFromSharedSource();
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
    await syncTranslationsFromSharedSource();
    const name = String(requestUrl.searchParams.get("name") || "").trim();
    const translatedName = String(requestUrl.searchParams.get("translatedName") || "").trim();
    const eventLimit = Math.min(Math.max(Number(requestUrl.searchParams.get("eventLimit") || 80) || 80, 1), 200);
    const matchLimit = Math.min(Math.max(Number(requestUrl.searchParams.get("matchLimit") || 500) || 500, 1), 2000);
    const translations = readTranslations(TRANSLATIONS_PATH);
    const needles = buildPlayerRecordNeedles(name, translatedName, translations);
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
    const searchResult = await getPlayerRecordSearchResult(name, translatedName, needles);
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
    syncTranslationsFromSharedSource()
      .then((syncMeta) => {
        sendJson(response, 200, {
          file: hasSharedTranslationsSource() ? `${TEAM_TRANSLATIONS_BASE_URL}/api/config/translations` : TRANSLATIONS_PATH,
          data: readTranslations(TRANSLATIONS_PATH),
          sharedSource: hasSharedTranslationsSource() ? TEAM_TRANSLATIONS_BASE_URL : null,
          sync: syncMeta || null,
        });
      })
      .catch((error) => {
        sendJson(response, 500, {
          error: createFriendlyErrorMessage(error),
        });
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
  if (pathname === "/api/admin/backfill-5000-records") {
    return handleAdminBackfill5000Start(request, response);
  }
  return false;
}

function startServer() {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);

    if (isRateLimited(request)) {
      sendJson(response, 429, {
        error: "Too many requests",
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        adminProtected: Boolean(ADMIN_TOKEN),
        viewerProtected: Boolean(VIEWER_PASSWORD),
        runtimeArchiveSyncSkipped: SKIP_RUNTIME_ARCHIVE_SYNC,
        playerRecords: {
          source: "wtt-records",
          archiveMode: "runtime+bundled",
          parseMode: process.env.WTT_SLIM_RECORDS_DISABLED === "1" ? "raw" : "slim-preferred",
          candidateMode: "candidate-index+grep-fallback",
          displayMode: "player-record-org-v4-category-groups-keep-round-order",
          runtimeArchiveDirExists: fs.existsSync(WTT_ARCHIVE_DIR),
          bundledArchiveDirExists: fs.existsSync(BUNDLED_WTT_ARCHIVE_DIR),
          cacheTtlMs: PLAYER_RECORD_RESULT_CACHE_TTL_MS,
        },
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
        handleCategoriesApi(requestUrl, response);
      } else if (requestUrl.pathname === "/api/rounds") {
        handleRoundsApi(requestUrl, response);
      } else if (requestUrl.pathname === "/api/events/search") {
        handleEventSearchApi(requestUrl, response);
      } else if (requestUrl.pathname === "/api/players/search") {
        handlePlayerSearchApi(requestUrl, response);
      } else if (requestUrl.pathname === "/api/players/records") {
        handlePlayerRecordsApi(requestUrl, response);
      } else if (requestUrl.pathname === "/api/head-to-head") {
        handleHeadToHeadApi(requestUrl, response);
      } else {
        handleApi(requestUrl, response);
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

if (process.argv.includes("--build-head-to-head-index")) {
  runHeadToHeadIndexBuildCli().catch((error) => {
    writeHeadToHeadIndexStatus({
      ok: false,
      status: "failed",
      error: error.stack || error.message || String(error),
    });
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
} else {
  startServer();
}
