#!/usr/bin/env node

const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const {
  DEFAULT_CACHE_DIR,
  DEFAULT_RULES_PATH,
  DEFAULT_TRANSLATIONS_PATH,
  getProcessedMatches,
  readRules,
  readTranslations,
  renderOutput,
} = require("./extract_individual_matches");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const TRANSLATIONS_PATH = path.join(DATA_DIR, "translations.ja.json");
const RULES_PATH = path.join(DATA_DIR, "rules.json");
const CACHE_DIR = path.join(DATA_DIR, ".cache");
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
let translationsSyncPromise = null;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFileFromDefault(targetPath, sourcePath) {
  if (fs.existsSync(targetPath)) {
    return;
  }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function ensureRuntimeFiles() {
  ensureDir(DATA_DIR);
  ensureDir(CACHE_DIR);
  ensureFileFromDefault(TRANSLATIONS_PATH, DEFAULT_TRANSLATIONS_PATH);
  ensureFileFromDefault(RULES_PATH, DEFAULT_RULES_PATH);
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

async function fetchEventName(eventId) {
  const normalizedId = String(eventId || "").trim();
  if (!normalizedId) {
    return "";
  }

  if (eventNameCache.has(normalizedId)) {
    return eventNameCache.get(normalizedId);
  }

  const response = await fetch(`https://liveeventsapi.worldtabletennis.com/api/cms/GetEventName/${encodeURIComponent(normalizedId)}`, {
    headers: {
      accept: "application/json, text/plain, */*",
      referer: "https://www.worldtabletennis.com/",
      "user-agent": "Mozilla/5.0 (compatible; Codex/1.0)",
      secapimkey: EVENT_NAME_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch event name: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const eventName = Array.isArray(payload) ? String(payload[0]?.eventName || "") : String(payload?.eventName || "");
  eventNameCache.set(normalizedId, eventName);
  return eventName;
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

  return {
    event: searchParams.get("event"),
    category: searchParams.get("category") || null,
    gender: searchParams.get("gender") || null,
    discipline: searchParams.get("discipline") || null,
    round: searchParams.get("round") || null,
    team: searchParams.get("team") || null,
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
    refreshCache: parseBoolean(searchParams.get("refreshCache")),
    omitSetCounts: parseBoolean(searchParams.get("omitSetCounts")),
  };
}

function createFriendlyErrorMessage(error) {
  const message = String(error?.message || "Unknown error");
  if (message.includes("fetch failed")) {
    return "WTT API への接続に失敗しました。少し待って再試行してください。";
  }
  if (message.includes("400 Bad Request")) {
    return "WTT API がこの条件を受け付けませんでした。eventId や取得時期を確認してください。";
  }
  return message;
}

function summarizeRounds(matches) {
  return [...new Set(matches.map((match) => match.roundLabel).filter(Boolean))];
}

function formatCategoryLabel(categoryName, gender, discipline) {
  const text = String(categoryName || "").trim();
  const genericLabels = {
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

  const youthMatch = text.match(/^U\s*(\d+)\s+(Boys|Girls|Mixed)\s*'?s?\s+(Singles|Doubles)$/i);
  if (youthMatch) {
    const [, age, division, eventType] = youthMatch;
    const divisionJa =
      /^boys$/i.test(division) ? "男子" : /^girls$/i.test(division) ? "女子" : "混合";
    const eventTypeJa = /^singles$/i.test(eventType) ? "シングルス" : "ダブルス";
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
  const youthMatch = value.match(/^U\s*(\d+)\s+(Boys|Girls|Mixed)\s*'?s?\s+(Singles|Doubles)$/i);

  if (youthMatch) {
    const [, ageRaw, division, eventType] = youthMatch;
    const age = Number(ageRaw);
    const disciplineOrder = /^singles$/i.test(eventType) ? 0 : 1;
    const divisionOrder = /^boys$/i.test(division) ? 0 : /^girls$/i.test(division) ? 1 : 2;
    return [0, disciplineOrder, -age, divisionOrder, value.toLowerCase()];
  }

  const seniorMatch = label.match(/^(男子|女子|混合)(シングルス|ダブルス)$/);
  if (seniorMatch) {
    const [, divisionJa, eventTypeJa] = seniorMatch;
    const disciplineOrder = eventTypeJa === "シングルス" ? 0 : 1;
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
        event: options.event,
        category: options.category,
        gender: options.gender,
        discipline: options.discipline,
        round: options.round,
        team: options.team,
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
      event: options.event,
      take: options.take,
      translations: TRANSLATIONS_PATH,
      rules: RULES_PATH,
      cacheDir: CACHE_DIR,
      refreshCache: options.refreshCache,
    });

    sendJson(response, 200, {
      event: options.event,
      categories: summarizeCategories(result.normalized),
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
  if (pathname === "/api/event-names") {
    const eventId = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`).searchParams.get("event");
    fetchEventName(eventId)
      .then((eventName) => {
        sendJson(response, 200, {
          event: eventId,
          eventName,
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
      if (hasSharedTranslationsSource()) {
        await saveSharedTranslations(parsed);
      }
      writePrettyJson(TRANSLATIONS_PATH, parsed);
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
      requestUrl.pathname === "/api/categories"
    )
  ) {
    if (requestUrl.pathname === "/api/categories") {
      handleCategoriesApi(requestUrl, response);
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
