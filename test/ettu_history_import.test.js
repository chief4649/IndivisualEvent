"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { runNode, validatePayload, fetchEttuHistoryResults, verifyDerivedRecords } = require("../import_ettu_history");
const { getEttuHistoryEvent, getEttuHistoryMetadata } = require("../ettu_history_registry");

test("European history uses explicit identities, never numeric/TTE coincidence", () => {
  assert.equal(getEttuHistoryEvent("5440"), null);
  assert.equal(getEttuHistoryEvent("TTE2024"), null);
  assert.equal(getEttuHistoryEvent("ETTU2007I"), null);
  assert.equal(getEttuHistoryMetadata("ETTU2024I").eventUrl, "https://www.ttm.co.at/results/ec2024/");
  assert.equal(getEttuHistoryEvent("ETTU2008I").startDate, null);
  assert.equal(getEttuHistoryEvent("ETTU2023TQ1").endDate, "2023-03-29");
});

test("qualification periods spanning two years display both years", () => {
  for (const file of ["server.js", "build_player_records_index.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const start = source.indexOf("function formatDateRange(");
    const end = source.indexOf("\nfunction ", start + 1);
    const context = vm.createContext({});
    vm.runInContext(source.slice(start, end), context);
    assert.equal(context.formatDateRange("2022-10-01", "2023-03-29"), "2022/10/1-2023/3/29");
    assert.equal(context.formatDateRange("2023-09-10", "2023-09-17"), "2023/9/10-17");
  }
});

test("ETTU metadata is served from the verified registry without a WTT request", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = source.indexOf("async function fetchEventMeta(");
  const endMatch = /\n(?:async )?function /.exec(source.slice(start + 1));
  assert.ok(endMatch);
  const context = vm.createContext({
    normalizeSource: (value) => value, resolveEventId: (_source, id) => id,
    getEttuHistoryMetadata, getStoredArchivedEventIds: () => new Set(["ETTU2023TQ1"]),
    formatDateRange: (startDate, endDate) => `${startDate}/${endDate}`,
    resolveLifecycleStatus: () => "finished",
    fetchEventName: () => { throw new Error("Unexpected WTT lookup"); },
    getParaCalendar: () => { throw new Error("Unexpected calendar lookup"); },
  });
  vm.runInContext(source.slice(start, start + 1 + endMatch.index), context);
  const meta = await context.fetchEventMeta("ETTU2023TQ1", "wtt");
  assert.equal(meta.endDate, "2023-03-29");
  assert.equal(meta.archived, true);
  assert.equal(meta.eventUrl, "https://www.ttm.co.at/results/ec2023s1/");
});

test("archive row errors cannot disappear when the import combines categories", async () => {
  const cells = { event: "Men's Singles", rnd: "F", player_id_a: "A Player (GER)", player_id_x: "B Player (FRA)", res_a: "4", res_x: "0", games: "11:5 11:5 11:5 5:11", wo: "-", yr: "2008" };
  const html = `Total: 1<table><tr id="list_14_com_fabrik_14_row_1" class="fabrik_row">${Object.entries(cells).map(([key, value]) => `<td class="vw_ec_indv___${key}">${value}</td>`).join("")}</tr></table>`;
  await assert.rejects(fetchEttuHistoryResults(getEttuHistoryEvent("ETTU2008I"), {
    fetchImpl: async (url) => new Response(`<html>${new URL(url).searchParams.get("listid") === "14" ? html : "Total: 0"}</html>`, { status: 200, headers: { "content-type": "text/html" } }),
  }), (error) => error.sourceErrors?.length === 1 && /validation failed/.test(error.message));
});

test("empty, duplicate, mismatched and detail-free records cannot be promoted", () => {
  const config = getEttuHistoryEvent("ETTU2023T");
  const match = { eventId: config.eventId, documentCode: "official-1", matchType: "individual", competitors: [{ name: "A" }, { name: "B" }] };
  assert.deepEqual(validatePayload(config, [match]), [match]);
  for (const payload of [[], [match, match], [{ ...match, eventId: "5440" }], [{ ...match, matchType: "team", singles: [] }]]) {
    assert.throws(() => validatePayload(config, payload));
  }
  assert.equal(validatePayload(config, [{ ...match, matchType: "team", singles: [], resultStatus: "WO" }]).length, 1);
});

test("derived verification accepts slim null competitors and excludes unplayed team slots", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ettu-derived-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dataDir, "wtt-records-slim"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "player-records-index", "event-records"), { recursive: true });
  const child = {
    documentCode: "child-1", overallScore: "0-3", gameScores: ["0-11", "0-11", "0-11"], resultStatus: "WO",
    recordWinnerIndex: null, recordWinnerEvidence: null,
    competitors: [null, { name: "ELIA Iosif", orgCode: "ROU", players: [{ name: "ELIA Iosif", orgCode: "ROU" }] }],
  };
  const unplayed = { documentCode: "child-2", competitors: [] };
  const team = { documentCode: "team-1", matchType: "team", competitors: [], singles: [child, unplayed] };
  const slimChild = structuredClone(child);
  slimChild.competitors[0] = { players: [] };
  fs.writeFileSync(path.join(dataDir, "wtt-records-slim", "ETTU2023TQ1.json"), JSON.stringify([{ ...team, singles: [slimChild, unplayed] }]));
  const eventRecord = {
    documentCode: child.documentCode, overallScore: child.overallScore, gameScores: child.gameScores,
    leftIndex: 1, left: { name: "ELIA Iosif", participantDetailMissing: false },
    right: { name: "" },
    recordWinnerIndex: null, recordWinnerEvidence: null,
  };
  fs.writeFileSync(path.join(dataDir, "player-records-index", "event-records", "ETTU2023TQ1.json"), JSON.stringify({ matches: { one: { documentCode: child.documentCode, record: eventRecord } } }));
  assert.deepEqual(verifyDerivedRecords(dataDir, "ETTU2023TQ1", [team]), {
    slimMatches: 1, indexedMatchCount: 1, verifiedMatchCount: 1,
  });

  for (const mutated of [
    { ...child, competitors: [null, { ...child.competitors[1], players: [{ name: "Other player", orgCode: "GBR" }] }] },
    { ...child, recordWinnerIndex: 1 },
    { ...child, overallScore: "3-0" },
    { ...child, resultStatus: "" },
  ]) {
    assert.throws(() => verifyDerivedRecords(dataDir, "ETTU2023TQ1", [{ ...team, singles: [mutated, unplayed] }]), /RAW\/slim sporting records differ/);
  }

  for (const changedRecord of [
    { ...eventRecord, overallScore: "3-0" },
    { ...eventRecord, gameScores: ["0-11"] },
    { ...eventRecord, recordWinnerIndex: 0 },
  ]) {
    fs.writeFileSync(path.join(dataDir, "player-records-index", "event-records", "ETTU2023TQ1.json"), JSON.stringify({ matches: { one: { documentCode: child.documentCode, record: changedRecord } } }));
    assert.throws(() => verifyDerivedRecords(dataDir, "ETTU2023TQ1", [team]), /scores differ|winner evidence differs/);
  }

  const wrongOrientation = { ...eventRecord, right: { name: "unexpected" } };
  fs.writeFileSync(path.join(dataDir, "player-records-index", "event-records", "ETTU2023TQ1.json"), JSON.stringify({ matches: { one: { documentCode: child.documentCode, record: wrongOrientation } } }));
  assert.throws(() => verifyDerivedRecords(dataDir, "ETTU2023TQ1", [team]), /orientation differs/);
});

test("archive category counts remain available for source reconciliation", async () => {
  const cells = { event: "Men's Singles", rnd: "F", player_id_a: "A Player (GER)", player_id_x: "B Player (FRA)", res_a: "4", res_x: "0", games: "", wo: "-", yr: "2008" };
  const html = `Total: 1<table><tr id="list_14_com_fabrik_14_row_1" class="fabrik_row">${Object.entries(cells).map(([key, value]) => `<td class="vw_ec_indv___${key}">${value}</td>`).join("")}</tr></table>`;
  const result = await fetchEttuHistoryResults(getEttuHistoryEvent("ETTU2008I"), {
    fetchImpl: async (url) => new Response(`<html>${new URL(url).searchParams.get("listid") === "14" ? html : "Total: 0"}</html>`, { status: 200, headers: { "content-type": "text/html" } }),
  });
  assert.deepEqual(result.counts.categories.singles, { advertised: 1, parsed: 1, unplayed: 0, rejected: 0, detailRowsObserved: 0, warnings: 1 });
  assert.equal(result.sourceWarnings.length, 1);
  assert.equal(result.counts.categories.doubles.advertised, 0);
  assert.equal(result.matches[0].scoreDetailMissing, true);
});

test("derived child output is logged without replaying large success output, and the log fd closes", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ettu-run-node-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const opened = fs.openSync;
  let logFd;
  fs.openSync = function (...args) {
    logFd = opened.apply(this, args);
    return logFd;
  };
  t.after(() => { fs.openSync = opened; });
  const originalWrite = process.stdout.write;
  let terminalOutput = "";
  process.stdout.write = function (chunk, ...args) {
    terminalOutput += chunk.toString();
    return true;
  };
  try {
    runNode(["-e", "process.stdout.write('x'.repeat(1024 * 1024))"], dataDir);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(terminalOutput, "");
  assert.throws(() => fs.fstatSync(logFd), { code: "EBADF" });
  const [logName] = fs.readdirSync(dataDir);
  assert.match(logName, /^ettu-derived-.*\.log$/);
  assert.equal(fs.statSync(path.join(dataDir, logName)).size, 1024 * 1024);
});

test("derived child failure includes its exit code and only a bounded output tail", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ettu-run-node-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  assert.throws(() => runNode(["-e", "process.stderr.write('a'.repeat(20000) + 'FINAL-DETAIL'); process.exit(7)"], dataDir), (error) => {
    assert.match(error.message, /failed \(7\)/);
    assert.match(error.message, /FINAL-DETAIL/);
    assert.ok(Buffer.byteLength(error.message) < 9000);
    return true;
  });
  const [logName] = fs.readdirSync(dataDir);
  assert.equal(fs.statSync(path.join(dataDir, logName)).size, 20012);
});
