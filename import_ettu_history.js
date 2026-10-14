#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const zlib = require("zlib");
const { ETTU_HISTORY_EVENTS, getEttuHistoryEvent } = require("./ettu_history_registry");
const { getEttuHistoryImportPid } = require("./archive_maintenance");

async function fetchEttuHistoryResults(config, options = {}) {
  if (config.provider === "webgen") {
    return require("./ettu_webgen_results").fetchEttuWebgenResults(config, options);
  }
  if (config.provider === "stupa-team") {
    return require("./ettu_team_results").fetchEttuTeamOfficialResults(config, options);
  }
  if (config.provider !== "archive") throw new Error(`Unsupported verified ETTU provider: ${config.provider}`);
  const { fetchEttuArchiveResults } = require("./ettu_archive_results");
  const rawPages = [];
  const sourceOptions = { ...options, onPage: (page) => { if (options.retainRawPages !== false) rawPages.push(page); options.onPage?.(page); } };
  const types = config.type === "I" ? ["singles", "doubles"] : ["team"];
  const matches = [];
  const sourceErrors = [];
  const sourceWarnings = [];
  const categories = {};
  for (const type of types) {
    const records = await fetchEttuArchiveResults({ ...config, type }, sourceOptions);
    sourceErrors.push(...(records.errors || []));
    sourceWarnings.push(...(records.warnings || []));
    categories[type] = { ...records.counts, unplayed: (records.unplayed || []).length };
    matches.push(...records);
  }
  if (sourceErrors.length) {
    const error = new Error(`Official archive validation failed for ${config.eventId}: ${sourceErrors.length} row(s): ${JSON.stringify(sourceErrors.slice(0, 5))}`);
    error.sourceErrors = sourceErrors;
    error.sourceCounts = categories;
    throw error;
  }
  return { matches, rawPages, sourceWarnings, counts: { matches: matches.length, pages: rawPages.length, categories, warnings: sourceWarnings.length } };
}

function atomicJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const available = fs.statfsSync(path.dirname(filePath));
  if (available.bavail * available.bsize < 64 * 1024 * 1024) {
    throw new Error("Less than 64 MiB free; refusing further archive writes");
  }
  const temporary = `${filePath}.tmp-${process.pid}`;
  const json = JSON.stringify(data);
  fs.writeFileSync(temporary, filePath.endsWith(".gz") ? zlib.gzipSync(json) : json);
  fs.renameSync(temporary, filePath);
}

function runNode(args, dataDir) {
  const result = spawnSync(process.execPath, args, {
    cwd: __dirname, env: { ...process.env, DATA_DIR: dataDir }, stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Derived-index process failed (${result.status})`);
}

async function waitForExistingIndexWorkers() {
  if (process.env.RENDER !== "true") return;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15 * 60_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/health`, { signal: AbortSignal.timeout(10_000) });
      const health = await response.json();
      const operations = health.operations;
      if (health.ok && operations && !operations.playerRecordEventIndexAudit?.running &&
        !operations.wttCrawlRunning && !operations.headToHeadBuildRunning &&
        !(operations.derivedIndexBuilds?.length) && !health.heavyApi?.active && !health.heavyApi?.queued) return;
    } catch {}
    console.log("[ETTU] waiting for the existing index operation to finish");
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error("Existing index work did not finish within 15 minutes; no overlapping rebuild started");
}

function replayPublishedPages(dataDir, config) {
  const filePath = path.join(dataDir, "ettu-source-records", `${config.eventId}.json`);
  if (!fs.existsSync(filePath)) return fetch;
  const source = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (source.config?.eventId !== config.eventId) throw new Error("Original-page cache belongs to another event");
  const pages = source.rawPageRefs ? source.rawPageRefs.map((ref) => {
    if (!/^[a-f0-9]{64}\.json(?:\.gz)?$/.test(ref.fileName)) throw new Error("Invalid original-page reference");
    const bytes = fs.readFileSync(path.join(dataDir, "ettu-source-records", config.eventId, ref.fileName));
    return JSON.parse((ref.fileName.endsWith(".gz") ? zlib.gunzipSync(bytes) : bytes).toString("utf8"));
  }) : Array.isArray(source.rawPages) ? source.rawPages : [
    { url: new URL("events.html", config.baseUrl).toString(), html: source.rawPages?.eventsHtml },
    { url: new URL("dates.html", config.baseUrl).toString(), html: source.rawPages?.datesHtml },
    ...(source.rawPages?.datePages || []),
  ];
  const byUrl = new Map(pages.filter((page) => typeof page.html === "string").map((page) => [page.url, page.html]));
  return async (url, options) => byUrl.has(String(url))
    ? new Response(byUrl.get(String(url)), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
    : fetch(url, options);
}

function validatePayload(config, matches) {
  if (!Array.isArray(matches) || !matches.length) throw new Error(`No verified matches for ${config.eventId}`);
  const ids = new Set();
  for (const match of matches) {
    if (match.eventId !== config.eventId || !match.documentCode) throw new Error(`Wrong/missing event identity for ${config.eventId}`);
    if (ids.has(match.documentCode)) throw new Error(`Duplicate match identity: ${match.documentCode}`);
    ids.add(match.documentCode);
    if (match.matchType === "team") {
      if ((!Array.isArray(match.singles) || !match.singles.length) && match.resultStatus !== "WO") throw new Error(`Missing team details: ${match.documentCode}`);
    } else if (!Array.isArray(match.competitors) || match.competitors.length !== 2) {
      throw new Error(`Missing competitors: ${match.documentCode}`);
    }
  }
  return matches;
}

function sportingRecord(match) {
  return {
    documentCode: match.documentCode, overallScore: match.overallScore || "",
    gameScores: match.gameScores || [], resultStatus: match.resultStatus || "",
    scoreDetailMissing: match.scoreDetailMissing === true,
    resultOutcomeMissing: match.resultOutcomeMissing === true,
    participantDetailMissing: match.participantDetailMissing === true,
    recordWinnerIndex: match.recordWinnerIndex ?? null,
    recordWinnerEvidence: match.recordWinnerEvidence || null,
    competitors: (match.competitors || []).map((side) => ({
      name: side.name || "", orgCode: side.orgCode || "",
      participantDetailMissing: side.participantDetailMissing === true,
      players: (side.players || []).map((player) => ({ name: player.name || "", orgCode: player.orgCode || "" })),
    })),
    teams: (match.teams || []).map((side) => ({ name: side.name || "", orgCode: side.orgCode || "" })),
    singles: (match.singles || []).map(sportingRecord),
  };
}

function verifyDerivedRecords(dataDir, eventId, matches) {
  const slim = JSON.parse(fs.readFileSync(path.join(dataDir, "wtt-records-slim", `${eventId}.json`), "utf8"));
  if (JSON.stringify(matches.map(sportingRecord)) !== JSON.stringify(slim.map(sportingRecord))) {
    throw new Error(`RAW/slim sporting records differ for ${eventId}`);
  }
  const eventIndex = JSON.parse(fs.readFileSync(path.join(dataDir, "player-records-index", "event-records", `${eventId}.json`), "utf8"));
  const expected = matches.flatMap((match) => match.matchType === "team" ? match.singles : [match]);
  const stored = new Map(Object.values(eventIndex.matches || {}).map((entry) => [entry.documentCode, entry.record]));
  for (const match of expected) {
    const record = stored.get(match.documentCode);
    if (!record) throw new Error(`Event index omitted ${match.documentCode}`);
    if (record.overallScore !== (match.overallScore || "") || JSON.stringify(record.gameScores || []) !== JSON.stringify(match.gameScores || []) ||
      (record.scoreDetailMissing === true) !== (match.scoreDetailMissing === true) ||
      (record.resultOutcomeMissing === true) !== (match.resultOutcomeMissing === true) ||
      (record.participantDetailMissing === true) !== (match.participantDetailMissing === true)) {
      throw new Error(`Event index scores differ for ${match.documentCode}`);
    }
    if ((record.recordWinnerIndex ?? null) !== (match.recordWinnerIndex ?? null) ||
      JSON.stringify(record.recordWinnerEvidence || null) !== JSON.stringify(match.recordWinnerEvidence || null)) {
      throw new Error(`Event index winner evidence differs for ${match.documentCode}`);
    }
    const left = record.leftIndex === 1 ? 1 : 0;
    if (record.left?.name !== match.competitors[left]?.name || record.right?.name !== match.competitors[1 - left]?.name) {
      throw new Error(`Event index orientation differs for ${match.documentCode}`);
    }
    if ((record.left?.participantDetailMissing === true) !== (match.competitors[left]?.participantDetailMissing === true) ||
      (record.right?.participantDetailMissing === true) !== (match.competitors[1 - left]?.participantDetailMissing === true)) {
      throw new Error(`Event index missing-participant metadata differs for ${match.documentCode}`);
    }
  }
  return { slimMatches: slim.length, indexedMatchCount: stored.size, verifiedMatchCount: expected.length };
}

async function main(argv = process.argv.slice(2)) {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, ".cache", "ettu-history"));
  const eventsArg = argv.indexOf("--event");
  const requested = eventsArg >= 0 ? String(argv[eventsArg + 1] || "").split(",") : null;
  const archive = require("./ettu_archive_results");
  const discovered = await archive.fetchEttuArchiveYears();
  const configs = Object.values(ETTU_HISTORY_EVENTS);
  for (const type of ["I", "T"]) {
    const years = type === "I" ? discovered.singles : discovered.team;
    for (const year of years || []) {
      const config = getEttuHistoryEvent(`ETTU${year}${type}`);
      if (config && !configs.some((entry) => entry.eventId === config.eventId)) configs.push(config);
    }
  }
  const selected = requested ? requested.map((id) => {
    const config = getEttuHistoryEvent(id);
    if (!config) throw new Error(`Unverified ETTU event: ${id}`);
    return config;
  }) : configs;
  const reportPath = path.join(dataDir, "ettu-history-import-report.json");
  let report = { startedAt: new Date().toISOString(), events: {}, discovered };
  if (fs.existsSync(reportPath)) report = { ...JSON.parse(fs.readFileSync(reportPath, "utf8")), discovered };
  const lockPath = path.join(dataDir, "ettu-history-import.lock");
  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(lockPath) && !getEttuHistoryImportPid(dataDir)) fs.unlinkSync(lockPath);
  const lock = fs.openSync(lockPath, "wx");
  fs.writeFileSync(lock, String(process.pid));
  try {
    if (!argv.includes("--raw-only")) await waitForExistingIndexWorkers();
    for (let index = 0; index < selected.length; index++) {
      const config = selected[index];
      const rawPath = path.join(dataDir, "wtt-records", `${config.eventId}.json`);
      if (config.eventId === "ETTU2018I" && ["ittf-records", "ittf-records-slim", "wtt-records"].some((dir) =>
        fs.existsSync(path.join(dataDir, dir, "TTE2885.json")))) {
        // Do not publish a second copy of the already established 2018 identity.
        report.events[config.eventId] = {
          status: "existing-source-needs-comparison", canonicalEventId: "TTE2885",
          checkedAt: new Date().toISOString(),
        };
        atomicJson(reportPath, report);
        console.log(`[ETTU ${index + 1}/${selected.length}] retained TTE2885; duplicate import blocked`);
        continue;
      }
      if (!argv.includes("--refresh") && !argv.includes("--reparse") && ["complete", "raw-saved"].includes(report.events[config.eventId]?.status) &&
        (!report.events[config.eventId].rawOnly || argv.includes("--raw-only")) && fs.existsSync(rawPath)) {
        console.log(`[ETTU ${index + 1}/${selected.length}] current ${config.eventId}`);
        continue;
      }
      console.log(`[ETTU ${index + 1}/${selected.length}] fetching ${config.eventId} ${config.eventName}`);
      const rawPageRefs = new Map();
      try {
        const result = !argv.includes("--refresh") && !argv.includes("--reparse") && report.events[config.eventId]?.rawOnly &&
          !(report.events[config.eventId]?.sourceErrors?.length) && fs.existsSync(rawPath)
          ? { matches: JSON.parse(fs.readFileSync(rawPath, "utf8")), counts: report.events[config.eventId].counts, sourceWarnings: report.events[config.eventId].sourceWarnings || [] }
          : await fetchEttuHistoryResults(config, {
            retainRawPages: false,
            ...(argv.includes("--reparse") && config.provider !== "stupa-team" ? { fetchImpl: replayPublishedPages(dataDir, config) } : {}),
            onPage: (page) => {
              const key = crypto.createHash("sha256").update(page.url).digest("hex");
              const pagePath = path.join(dataDir, "ettu-source-records", config.eventId, `${key}.json.gz`);
              rawPageRefs.set(page.url, { url: page.url, fileName: `${key}.json.gz` });
              if (rawPageRefs.size % 25 === 0) console.log(`[ETTU ${index + 1}/${selected.length}] ${config.eventId}: ${rawPageRefs.size} source pages retained`);
              if (!argv.includes("--reparse") || !fs.existsSync(pagePath)) atomicJson(pagePath, {
                config, fetchedAt: new Date().toISOString(), ...page,
              });
            },
          });
        validatePayload(config, result.matches);
        const existing = fs.existsSync(rawPath) ? JSON.parse(fs.readFileSync(rawPath, "utf8")) : [];
        if (existing.length > result.matches.length) throw new Error(`Refusing smaller archive: ${result.matches.length} < ${existing.length}`);
        // Keep the original published pages separate from the searchable match array.
        if (rawPageRefs.size || result.rawPages) atomicJson(path.join(dataDir, "ettu-source-records", `${config.eventId}.json`), {
          config, normalizedAt: new Date().toISOString(),
          ...(rawPageRefs.size ? { rawPageRefs: [...rawPageRefs.values()] } : { rawPages: result.rawPages }), counts: result.counts,
        });
        atomicJson(rawPath, result.matches);
        const { updateWttArchiveIndexEntry } = require("./extract_individual_matches");
        updateWttArchiveIndexEntry(path.join(dataDir, "wtt-archive-index.json"), config.eventId, {
          archived: true, source: "wtt", title: config.eventName,
          startDate: config.startDate, endDate: config.endDate,
          eventUrl: config.recordUrl || config.baseUrl, archiveMatchCount: result.matches.length,
          sourceWarningCount: (result.sourceWarnings || []).length,
          archivedAt: new Date().toISOString(),
        });
        report.events[config.eventId] = { status: "raw-saved", matches: result.matches.length, counts: result.counts, sourceWarnings: result.sourceWarnings || [], sourceFieldsComplete: !(result.sourceWarnings || []).length, checkedAt: new Date().toISOString(), rawOnly: true };
        atomicJson(reportPath, report);
        if (!argv.includes("--raw-only")) {
          console.log(`[ETTU ${index + 1}/${selected.length}] deriving ${config.eventId}`);
          runNode(["update_wtt_event_indexes.js", "--event", config.eventId, "--keep-raw", "--skip-h2h-index"], dataDir);
          verifyDerivedRecords(dataDir, config.eventId, result.matches);
          runNode(["-r", "./runtime_legacy_ittf_patch.js", "server.js", "--update-head-to-head-index", "--event", config.eventId], dataDir);
        }
        report.events[config.eventId] = { status: argv.includes("--raw-only") ? "raw-saved" : "complete", matches: result.matches.length, counts: result.counts, sourceWarnings: result.sourceWarnings || [], sourceFieldsComplete: !(result.sourceWarnings || []).length, checkedAt: new Date().toISOString(), rawOnly: argv.includes("--raw-only") };
        console.log(`[ETTU ${index + 1}/${selected.length}] saved ${config.eventId}: ${result.matches.length} matches`);
      } catch (error) {
        const sourcePath = path.join(dataDir, "ettu-source-records", `${config.eventId}.json`);
        if (rawPageRefs.size && !fs.existsSync(sourcePath)) atomicJson(sourcePath, {
          config, normalizedAt: new Date().toISOString(), rawPageRefs: [...rawPageRefs.values()],
          sourceErrors: error.sourceErrors || [], sourceCounts: error.sourceCounts || null,
        });
        report.events[config.eventId] = { ...report.events[config.eventId], status: "failed", error: error.message, sourceErrors: error.sourceErrors || [], sourceCounts: error.sourceCounts || null, checkedAt: new Date().toISOString() };
        console.error(`[ETTU ${index + 1}/${selected.length}] failed ${config.eventId}: ${error.message}`);
      }
      atomicJson(reportPath, report);
    }
    report.finishedAt = new Date().toISOString();
    atomicJson(reportPath, report);
    if (selected.some((config) => report.events[config.eventId]?.status === "failed")) process.exitCode = 1;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { fetchEttuHistoryResults, validatePayload, verifyDerivedRecords, main };
