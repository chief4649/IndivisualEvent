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
  buildJaRoundContext,
  fetchOfficialResultsCached,
  getWttEventLifecycleMeta,
  getProcessedMatches,
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
const WTT_ARCHIVE_INDEX_PATH = path.join(DATA_DIR, "wtt-archive-index.json");
const WTT_DATE_INDEX_PATH = path.join(DATA_DIR, "wtt-date-index.json");
const WTT_SEARCH_INDEX_PATH = path.join(DATA_DIR, "wtt-search-index.json");
const EVENT_NAMES_PATH = path.join(DATA_DIR, "event-names.json");
const WTT_CALENDAR_API_URL = "https://wtt-website-api-prod-3-frontdoor-bddnb2haduafdze9.a01.azurefd.net/api/eventcalendar";
const WTT_EVENT_ID_ALIASES = {
  "5524": "3500",
};
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const VIEWER_PASSWORD = process.env.VIEWER_PASSWORD || "";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 60);
const VIEWER_COOKIE_NAME = "ttreport_individual_viewer_auth";
const TEAM_TRANSLATIONS_BASE_URL = String(process.env.TEAM_TRANSLATIONS_BASE_URL || "").trim().replace(/\/+$/, "");
const TEAM_TRANSLATIONS_ADMIN_TOKEN = process.env.TEAM_TRANSLATIONS_ADMIN_TOKEN || "";
const TEAM_TRANSLATIONS_VIEWER_PASSWORD = process.env.TEAM_TRANSLATIONS_VIEWER_PASSWORD || "";
const rateLimitStore = new Map();
const eventNameCache = new Map();
const EVENT_NAME_API_KEY = "S_WTT_882jjh7basdj91834783mds8j2jsd81";
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

function ensureRuntimeFiles() {
  ensureDir(DATA_DIR);
  ensureDir(CACHE_DIR);
  ensureDirectoryFilesFromDefault(ZENNIHON_ARCHIVE_DIR, path.join(__dirname, "zennihon-records"));
  ensureDirectoryFilesFromDefault(WTT_ARCHIVE_DIR, path.join(__dirname, "wtt-records"));
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

async function fetchSharedTranslations() {
  const response = await fetch(`${TEAM_TRANSLATIONS_BASE_URL}/api/config/translations`, {
    headers: getSharedTranslationsHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch shared translations: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return payload?.data || null;
}

async function saveSharedTranslations(payload) {
  const response = await fetch(`${TEAM_TRANSLATIONS_BASE_URL}/api/config/translations`, {
    method: "PUT",
    headers: {
      ...getSharedTranslationsHeaders(),
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to save shared translations: ${response.status} ${errorText || response.statusText}`);
  }
}

async function syncTranslationsFromSharedSource(force = false) {
  if (!hasSharedTranslationsSource()) {
    return;
  }
  if (!force && translationsSyncPromise) {
    await translationsSyncPromise;
    return;
  }
  translationsSyncPromise = (async () => {
    const translations = await fetchSharedTranslations();
    if (translations) {
      writePrettyJson(TRANSLATIONS_PATH, translations);
    }
  })();
  try {
    await translationsSyncPromise;
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
  response.end(JSON.stringify(payload, null, 2));
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
    rateLimitStore.set(ip, { count: 1, startedAt: now });
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
    error: "Unauthorized",
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
    request.on("data", (chunk) => chunks.push(chunk));
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
    sha256: includeSha256 ? computeFileSha256(normalizedPath) : null,
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

function getWttEventUrl(eventId, sourceHint = "") {
  const normalizedId = String(eventId || "").trim();
  if (!normalizedId) {
    return "";
  }
  if (/^\d+$/.test(normalizedId) && Number(normalizedId) < 3000) {
    return `https://results.ittf.com/ittf-web-results/html/${encodeURIComponent(normalizedId)}/results.html#/results`;
  }
  const sourceText = String(sourceHint || "").trim().toLowerCase();
  if (["bornan", "ittf", "ittf_results", "ittf-results"].includes(sourceText)) {
    return `https://results.ittf.com/ittf-web-results/html/TTE${encodeURIComponent(normalizedId)}/results.html#/results`;
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

function getMergedWttSearchEntry(eventId, entry, dateIndex) {
  const dateEntry = dateIndex[String(eventId || "").trim()] || {};
  const merged = {
    ...(entry || {}),
    ...(dateEntry || {}),
  };
  if (entry?.source) {
    merged.source = entry.source;
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

  const payload = await response.json();
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
        eventUrl: getWttEventUrl(normalizedId, lifecycle?.source),
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

function buildDateSearchValues(startDate, endDate, dateLabel) {
  const values = [startDate, endDate, dateLabel].filter(Boolean).map((value) => String(value));
  const addParts = (rawDate) => {
    const match = String(rawDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return;
    }
    const [, year, month, day] = match;
    const monthNum = String(Number(month));
    const dayNum = String(Number(day));
    values.push(`${year}/${monthNum}`);
    values.push(`${year}-${monthNum}`);
    values.push(`${year} ${monthNum}`);
    values.push(`${year}/${monthNum}/${dayNum}`);
    values.push(`${year}-${monthNum}-${dayNum}`);
    values.push(`${year} ${monthNum} ${dayNum}`);
  };

  addParts(startDate);
  addParts(endDate);
  return values;
}

function matchesSearchQuery(eventId, eventName, query, extraValues = []) {
  const rawQuery = String(query || "").trim();
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const normalizedEventId = String(eventId || "").trim().toLowerCase();
  const normalizedName = normalizeSearchText(eventName);
  const normalizedExtras = extraValues
    .map((value) => normalizeSearchText(value))
    .filter(Boolean)
    .join(" ");
  const haystack = `${normalizedEventId} ${normalizedName} ${normalizedExtras}`.trim();
  if (haystack.includes(normalizedQuery)) {
    return true;
  }

  const isDateLikeQuery = /^\d{4}\s*[\/-]\s*\d{1,2}(?:\s*[\/-]\s*\d{1,2})?$/.test(rawQuery);
  if (isDateLikeQuery) {
    return false;
  }

  const haystackTokens = new Set(haystack.split(/\s+/).filter(Boolean));
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const isDirectEventIdQuery = /^\d+$/.test(normalizedQuery);
  if (queryTokens.length === 0) {
    return true;
  }

  return queryTokens.every((token) => {
    if (isDirectEventIdQuery && /^\d+$/.test(token)) {
      return normalizedEventId.includes(token) || haystackTokens.has(token);
    }
    return haystackTokens.has(token);
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
  Object.entries(searchIndex).forEach(([eventId, entry]) => {
    const mergedEntry = getMergedWttSearchEntry(eventId, entry, dateIndex);
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
        eventUrl: getWttEventUrl(eventId, mergedEntry?.source),
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
    eventUrl: meta?.eventUrl || getEventUrl("wtt", normalizedId),
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
      eventNameCache.set(cacheKey, storedName);
      return storedName;
    }
    const eventName = normalizedSource === "zennihon"
      ? await fetchZennihonEventName(normalizedId)
      : "";
    eventNameCache.set(cacheKey, eventName);
    return eventName;
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
        eventNameCache.set(cacheKey, fallbackName);
        return fallbackName;
      }
      throw new Error(`Failed to fetch event name: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const eventName = Array.isArray(payload)
      ? String(payload[0]?.eventName || "")
      : String(payload?.eventName || "") || storedName || indexedName;
    eventNameCache.set(cacheKey, eventName);
    return eventName;
  } catch (error) {
    const fallbackName = storedName || indexedName;
    if (fallbackName) {
      eventNameCache.set(cacheKey, fallbackName);
      return fallbackName;
    }
    throw error;
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
  if (["ja", "list", "json", "text"].includes(format)) {
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
    translations: TRANSLATIONS_PATH,
    rules: RULES_PATH,
    cacheDir: CACHE_DIR,
    zennihonArchiveDir: ZENNIHON_ARCHIVE_DIR,
    wttArchiveDir: WTT_ARCHIVE_DIR,
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

function summarizeRounds(matches) {
  return [...new Set(matches.map((match) => match.roundLabel).filter(Boolean))];
}

function getRoundOptionSortValue(match, context) {
  const knockoutRoundMatch = String(match.roundKey || "").match(/^knockout_round_(\d+)$/);
  if (knockoutRoundMatch) {
    return Number(knockoutRoundMatch[1]);
  }

  const groupMatch = String(match.roundLabel || "").match(/^Group\s+(\d+)$/i);
  if (groupMatch) {
    return Number(groupMatch[1]);
  }

  const qualifyingMatch = String(match.roundKey || "").match(/^qualifying_round_(\d+)$/);
  if (qualifyingMatch) {
    return Number(qualifyingMatch[1]);
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

function summarizeRoundOptions(matches, rules, translations) {
  const context = buildJaRoundContext(matches);
  const seen = new Set();
  const options = [];

  for (const match of matches) {
    const value = String(match.roundLabel || "").trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    const translatedLabel = String(
      translateRoundJa(match.roundKey, match.roundLabel, translations, rules, context) || match.roundLabel || value,
    );
    options.push({
      value,
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

  const youthMatch = text.match(/^U\s*(\d+)\s+(Boys|Girls|Mixed)\s*'?s?\s+(Singles|Doubles|Teams)$/i);
  if (youthMatch) {
    const [, age, division, eventType] = youthMatch;
    const divisionJa =
      /^boys$/i.test(division) ? "男子" : /^girls$/i.test(division) ? "女子" : "混合";
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
  if (/^Junior Boys Singles$/i.test(value)) {
    return [0, 0, -18, 0, value.toLowerCase()];
  }
  if (/^Junior Girls Singles$/i.test(value)) {
    return [0, 0, -18, 1, value.toLowerCase()];
  }
  const youthMatch = value.match(/^U\s*(\d+)\s+(Boys|Girls|Mixed)\s*'?s?\s+(Singles|Doubles|Teams)$/i);

  if (youthMatch) {
    const [, ageRaw, division, eventType] = youthMatch;
    const age = Number(ageRaw);
    const disciplineOrder = /^singles$/i.test(eventType) ? 0 : /^teams$/i.test(eventType) ? 1 : 2;
    const divisionOrder = /^boys$/i.test(division) ? 0 : /^girls$/i.test(division) ? 1 : 2;
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

    const result = await getProcessedMatches(options);
    const output = renderOutput(result);
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
      },
      output,
      matches: result.filtered,
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

    const result = await getProcessedMatches({
      source: options.source,
      event: options.event,
      take: options.take,
      translations: TRANSLATIONS_PATH,
      rules: RULES_PATH,
      cacheDir: CACHE_DIR,
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

    const result = await getProcessedMatches({
      source: options.source,
      event: options.event,
      category: options.category,
      gender: options.gender,
      discipline: options.discipline,
      take: options.take,
      translations: TRANSLATIONS_PATH,
      rules: RULES_PATH,
      cacheDir: CACHE_DIR,
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
      .then(() => {
        sendJson(response, 200, {
          file: hasSharedTranslationsSource() ? `${TEAM_TRANSLATIONS_BASE_URL}/api/config/translations` : TRANSLATIONS_PATH,
          data: readTranslations(TRANSLATIONS_PATH),
          sharedSource: hasSharedTranslationsSource() ? TEAM_TRANSLATIONS_BASE_URL : null,
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
      sendJson(response, 200, {
        ok: true,
        file: hasSharedTranslationsSource() ? `${TEAM_TRANSLATIONS_BASE_URL}/api/config/translations` : TRANSLATIONS_PATH,
      });
      return true;
    }

    if (pathname === "/api/config/rules") {
      writePrettyJson(RULES_PATH, parsed);
      sendJson(response, 200, {
        ok: true,
        file: RULES_PATH,
      });
      return true;
    }

    return false;
  } catch (error) {
    sendJson(response, 400, {
      error: `Invalid JSON: ${error.message}`,
    });
    return true;
  }
}

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
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/login") {
    handleViewerLogin(request, response).catch((error) => {
      sendText(response, 500, error.message);
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
      requestUrl.pathname === "/api/events/search"
    )
  ) {
    if (requestUrl.pathname === "/api/categories") {
      handleCategoriesApi(requestUrl, response);
    } else if (requestUrl.pathname === "/api/rounds") {
      handleRoundsApi(requestUrl, response);
    } else if (requestUrl.pathname === "/api/events/search") {
      handleEventSearchApi(requestUrl, response);
    } else {
      handleApi(requestUrl, response);
    }
    return;
  }

  if (request.method === "GET" && handleConfigGet(request, response, requestUrl.pathname)) {
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
