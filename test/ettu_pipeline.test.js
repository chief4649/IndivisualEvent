"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { applyWttEventMetadataOverride } = require("../wtt_event_metadata_overrides");

test("5440 metadata identifies ETTU independently of the TTE namespace", () => {
  const meta = applyWttEventMetadataOverride("5440", { eventName: "stale" });
  assert.equal(meta.resultSource, "ettu");
  assert.equal(meta.startDate, "2026-10-11");
  assert.equal(meta.endDate, "2026-10-18");
  assert.equal(applyWttEventMetadataOverride("TTE5440").resultSource, undefined);
});

test("5440 archive accepts only dated ETTU167 records", () => {
  const { isWttPayloadSourceCompatible } = require("../extract_individual_matches");
  const match = { eventId: "5440", recordSource: "ettu", recordEventId: "167", startDateLocal: "2026-10-12" };
  assert.equal(isWttPayloadSourceCompatible([match], "5440"), true);
  for (const change of [{ recordSource: "ittf" }, { eventId: "TTE5440" }, { recordEventId: "5440" }, { startDateLocal: null }]) {
    assert.equal(isWttPayloadSourceCompatible([{ ...match, ...change }], "5440"), false);
  }
  assert.equal(isWttPayloadSourceCompatible([], "5440"), false);
});

test("managed crawl forwards explicit events and active-event option", () => {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = source.indexOf("function buildWttCrawlArgs(");
  const end = source.indexOf("\nfunction handleAdminWttCrawlStatus", start);
  assert.ok(start > 0 && end > start);
  const context = { process: { env: {} }, getDefaultNightlyCrawlRange: () => ({ from: "2026-08", to: "2026-11" }), parseBoolean: (s) => s === "1" };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const args = Array.from(context.buildWttCrawlArgs(new URLSearchParams("event=5440&includeActive=1&keepRaw=1&force=1")));
  assert.equal(args[args.indexOf("--event") + 1], "5440");
  for (const arg of ["--include-active", "--keep-raw", "--force"]) assert.ok(args.includes(arg));
  assert.ok(!context.buildWttCrawlArgs(new URLSearchParams("event=5440;invalid")).includes("--event"));
});

test("nightly crawl includes ongoing ETTU results without enabling all active events", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ettu-crawl-"));
  try {
    fs.writeFileSync(path.join(dir, "wtt-date-index.json"), JSON.stringify({
      5440: { eventName: "ETTU", startDate: "2026-10-11", endDate: "2026-10-18" },
      9000: { eventName: "WTT ongoing", startDate: "2026-10-11", endDate: "2026-10-18" },
    }));
    const script = `const OriginalDate=Date;
      global.Date=class extends OriginalDate { constructor(...args){super(...(args.length?args:["2026-10-14T01:00:00Z"]));} };
      const c=require("./crawl_wtt_archives");
      console.log(JSON.stringify(c.buildCandidates(c.parseArgs(["--from","2026-10","--to","2026-10"])).map(x=>({id:x.eventId,active:x.activeOfficialResults}))));`;
    const output = execFileSync(process.execPath, ["-e", script], { cwd: path.join(__dirname, ".."), env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
    assert.deepEqual(JSON.parse(output), [{ id: "5440", active: true }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a partial archive is fetched again after the event finishes", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../crawl_wtt_archives.js"), "utf8");
  const start = source.indexOf("async function archiveEvent(");
  const end = source.indexOf("\nasync function main()", start);
  let request;
  const context = {
    applyWttEventMetadataOverride,
    getWttEventLifecycleMeta: async () => ({ isFinished: true }),
    isFinished: () => true,
    getProcessedMatches: async (options) => { request = options; return { normalized: [] }; },
    WTT_ARCHIVE_DIR: "raw", WTT_SLIM_ARCHIVE_DIR: "slim", ITTF_ARCHIVE_DIR: "ittf",
    ITTF_SLIM_ARCHIVE_DIR: "ittf-slim", WTT_ARCHIVE_INDEX_PATH: "index",
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  await context.archiveEvent({ eventId: "5440", partialArchive: true }, { take: 1200 });
  assert.equal(request.refreshCache, true);
});

test("record and H2H winner resolution preserves both walkover orientations", () => {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = source.indexOf("function getWinnerIndexFromOverallScore(");
  const end = source.indexOf("\nfunction getWinnerIndexFromGameScores", start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  assert.equal(context.getWinnerIndexFromOverallScore("W-L"), 0);
  assert.equal(context.getWinnerIndexFromOverallScore("L-W"), 1);
  assert.equal(context.getWinnerIndexFromOverallScore("3-2"), 0);
  assert.equal(context.getWinnerIndexFromOverallScore("2-3"), 1);
  assert.equal(context.getWinnerIndexFromOverallScore("0-0"), null);
});
