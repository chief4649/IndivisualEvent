#!/usr/bin/env node

/*
 * ITTF/Bornan has a separate identifier namespace from WTT.  This command
 * deliberately accepts and stores only TTE#### IDs, so a numeric WTT event can
 * never overwrite an ITTF event with the same number.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  DEFAULT_DATA_DIR,
  fetchBornanEventMeta,
  fetchBornanOfficialResults,
  writeWttArchiveIfNotSmaller,
} = require("./extract_individual_matches");
const { updatePlayerRecordCandidateIndexForEvents } = require("./build_player_records_index");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const RAW_DIR = path.join(DATA_DIR, "ittf-records");
const SLIM_DIR = path.join(DATA_DIR, "ittf-records-slim");
const INDEX_DIR = path.join(DATA_DIR, "player-records-index", "event-records");
const H2H_MANIFEST = path.join(DATA_DIR, "player-records-index", "head-to-head-manifest.json");
const EVENT_INDEX_PATH = path.join(DATA_DIR, "ittf-event-index.json");
const WTT_SEARCH_INDEX_PATH = path.join(DATA_DIR, "wtt-search-index.json");

function readJson(filePath, fallback) {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

function normalizeTteId(value) {
  const text = String(value || "").trim().toUpperCase();
  if (/^TTE\d+$/.test(text)) return text;
  if (/^\d+$/.test(text)) return `TTE${text}`;
  throw new Error(`Invalid ITTF event id: ${value}. Use TTE####.`);
}

function parseArgs(argv) {
  const args = { events: [], limit: 20, delayMs: 1500, force: false, keepRaw: false, audit: false, discover: false, fromId: 2200, toId: 6000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--event" || arg === "-e") { args.events.push(...String(next || "").split(",")); i += 1; }
    else if (arg === "--limit") { args.limit = Math.max(1, Number(next) || args.limit); i += 1; }
    else if (arg === "--delay-ms") { args.delayMs = Math.max(0, Number(next) || 0); i += 1; }
    else if (arg === "--from-id") { args.fromId = Number(next); i += 1; }
    else if (arg === "--to-id") { args.toId = Number(next); i += 1; }
    else if (arg === "--force") args.force = true;
    else if (arg === "--keep-raw") args.keepRaw = true;
    else if (arg === "--audit") args.audit = true;
    else if (arg === "--discover") args.discover = true;
    else if (arg === "--help" || arg === "-h") return printHelp(0);
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else args.events.push(...arg.split(","));
  }
  return args;
}

function printHelp(code) {
  console.log([
    "Usage:",
    "  npm run crawl:ittf -- --event TTE2834,TTE2821 --force",
    "  npm run crawl:ittf -- --discover --from-id 2200 --to-id 6000 --limit 20",
    "  npm run audit:ittf",
    "",
    "--discover queries official Bornan champ.json metadata in the requested ID range.",
    "Downloaded records are stored under ittf-records/ and ittf-records-slim/.",
    "RAW is removed only after slim and event-index generation succeeds.",
  ].join("\n"));
  process.exit(code);
}

function loadCatalog() {
  const catalog = readJson(EVENT_INDEX_PATH, { version: 1, events: {} });
  const events = catalog.events && typeof catalog.events === "object" ? { ...catalog.events } : {};
  const searchIndex = readJson(WTT_SEARCH_INDEX_PATH, {});
  Object.entries(searchIndex).forEach(([id, entry]) => {
    if (/^TTE\d+$/i.test(id) || entry?.source === "ittf") {
      events[normalizeTteId(id)] = { ...entry, event: normalizeTteId(id), source: "ittf" };
    }
  });
  return { version: 1, events };
}

function saveCatalog(catalog) {
  writeJsonAtomic(EVENT_INDEX_PATH, { ...catalog, generatedAt: new Date().toISOString() });
}

function listLocalIds(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^TTE\d+\.json$/i.test(name)).map((name) => name.replace(/\.json$/i, "").toUpperCase());
}

async function discoverCatalog(args, catalog) {
  if (!args.discover) return;
  const ids = [];
  for (let number = args.fromId; number <= args.toId; number += 1) ids.push(`TTE${number}`);
  let checked = 0;
  for (const id of ids) {
    checked += 1;
    try {
      const meta = await fetchBornanEventMeta(id);
      if (meta?.title) {
        catalog.events[id] = { ...catalog.events[id], ...meta, event: id, source: "ittf" };
        console.log(`discovered ${checked}/${ids.length}: ${id} ${meta.title}`);
      }
    } catch {
      // Missing TTE IDs are normal; discovery continues.
    }
  }
  saveCatalog(catalog);
  console.log(`catalog: ${Object.keys(catalog.events).length} ITTF events`);
}

function runDerivedIndex(id, keepRaw) {
  const rawPath = path.join(RAW_DIR, `${id}.json`);
  const slimPath = path.join(SLIM_DIR, `${id}.json`);
  const eventIndexPath = path.join(INDEX_DIR, `${id}.json`);
  execFileSync(process.execPath, ["build_wtt_slim_records.js", rawPath], {
    cwd: __dirname,
    env: { ...process.env, DATA_DIR, ITTF_RECORDS_DIR: RAW_DIR, ITTF_SLIM_RECORDS_DIR: SLIM_DIR },
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (!fs.existsSync(slimPath) || fs.statSync(slimPath).size === 0) throw new Error(`slim missing: ${slimPath}`);
  execFileSync(process.execPath, ["-r", "./runtime_legacy_ittf_patch.js", "server.js", "--build-player-record-event-index", "--event", id, "--force"], {
    cwd: __dirname,
    env: { ...process.env, DATA_DIR },
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (!fs.existsSync(eventIndexPath) || fs.statSync(eventIndexPath).size === 0) throw new Error(`event index missing: ${eventIndexPath}`);
  const candidate = updatePlayerRecordCandidateIndexForEvents([id]);
  if (!keepRaw) fs.rmSync(rawPath, { force: true });
  return { slimBytes: fs.statSync(slimPath).size, eventIndexBytes: fs.statSync(eventIndexPath).size, candidate };
}

function updateH2h(id) {
  if (!fs.existsSync(H2H_MANIFEST)) return "skipped:no-existing-index";
  execFileSync(process.execPath, ["-r", "./runtime_legacy_ittf_patch.js", "server.js", "--update-head-to-head-index", "--event", id], {
    cwd: __dirname,
    env: { ...process.env, DATA_DIR },
    stdio: ["ignore", "inherit", "inherit"],
  });
  return "updated";
}

async function crawl(args, catalog) {
  const requested = args.events.map(normalizeTteId);
  const ids = requested.length ? requested : Object.keys(catalog.events).filter((id) => /^TTE\d+$/i.test(id)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))).slice(0, args.limit);
  const results = [];
  for (const [position, id] of ids.entries()) {
    const rawPath = path.join(RAW_DIR, `${id}.json`);
    const slimPath = path.join(SLIM_DIR, `${id}.json`);
    if (!args.force && fs.existsSync(slimPath)) { console.log(`skip ${position + 1}/${ids.length}: ${id} slim exists`); continue; }
    console.log(`fetching ${position + 1}/${ids.length}: ${id}`);
    try {
      const payload = await fetchBornanOfficialResults(id);
      if (!Array.isArray(payload) || payload.length === 0) throw new Error("official result payload is empty");
      fs.mkdirSync(RAW_DIR, { recursive: true });
      const write = writeWttArchiveIfNotSmaller(RAW_DIR, id, payload, { force: args.force });
      if (!write.written) throw new Error(`raw not written: ${write.reason}`);
      const meta = await fetchBornanEventMeta(id);
      catalog.events[id] = { ...catalog.events[id], ...meta, event: id, source: "ittf", archived: true, archiveMatchCount: payload.length, verifiedAt: new Date().toISOString() };
      saveCatalog(catalog);
      const derived = runDerivedIndex(id, args.keepRaw);
      console.log(`archived ${id}: ${payload.length} matches; slim=${derived.slimBytes}; h2h=${updateH2h(id)}`);
      results.push({ id, status: "archived", matches: payload.length });
    } catch (error) {
      console.error(`failed ${id}: ${error.message || error}`);
      results.push({ id, status: "failed", error: error.message || String(error) });
    }
    if (args.delayMs && position < ids.length - 1) await new Promise((resolve) => setTimeout(resolve, args.delayMs));
  }
  return results;
}

function audit(catalog) {
  const catalogIds = new Set(Object.keys(catalog.events).map(normalizeTteId));
  const raw = new Set(listLocalIds(RAW_DIR));
  const slim = new Set(listLocalIds(SLIM_DIR));
  const eventIndex = new Set(listLocalIds(INDEX_DIR));
  const missingDerived = [...raw].filter((id) => !slim.has(id) || !eventIndex.has(id));
  const localIds = new Set([...raw, ...slim, ...eventIndex]);
  const missingRecords = [...catalogIds].filter((id) => !localIds.has(id));
  const untracked = [...new Set([...raw, ...slim, ...eventIndex])].filter((id) => !catalogIds.has(id));
  const report = { catalogEvents: catalogIds.size, raw: raw.size, slim: slim.size, eventIndex: eventIndex.size, missingRecords, missingDerived, untracked };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog();
  if (args.audit) { audit(catalog); return; }
  await discoverCatalog(args, catalog);
  const results = await crawl(args, catalog);
  console.log(JSON.stringify({ ok: results.every((result) => result.status !== "failed"), results }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });
