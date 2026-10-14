const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  formatEnglish,
  formatJapanese,
  formatList,
  formatText,
  normalizeOfficialResultItem,
} = require("../extract_individual_matches");
const translations = require("../translations.ja.json");
const rules = require("../rules.json");
const { resolveKnockoutOutcomes } = require("../record_knockout_outcome");

const legacyResultOnly = {
  matchType: "individual",
  id: "legacy-final",
  eventId: "legacy-event",
  categoryName: "Men Singles",
  subEventType: "Men Singles",
  discipline: "singles",
  gender: "men",
  roundLabel: "Finals",
  roundKey: "final",
  description: "Final",
  overallScore: "3-1",
  gameScores: [],
  scoreDetailMissing: true,
  competitors: [
    { type: "player", name: "Player One", org: "AAA", players: [] },
    { type: "player", name: "Player Two", org: "BBB", players: [] },
  ],
};

test("raw normalization retains explicit missing game-detail metadata", () => {
  const normalized = normalizeOfficialResultItem({
    id: "legacy-final",
    eventId: "legacy-event",
    subEventType: "Men Singles",
    scoreDetailMissing: true,
    match_card: {
      subEventDescription: "Final",
      overallScores: "3-1",
      gameScores: [],
      competitiors: [{ name: "Player One", org: "AAA" }, { name: "Player Two", org: "BBB" }],
    },
  });
  assert.equal(normalized.scoreDetailMissing, true);
  assert.equal(normalized.overallScore, "3-1");
  assert.deepEqual(normalized.gameScores, []);
});

test("missing score and participant fields render blank without changing unflagged output", () => {
  const ja = formatJapanese([legacyResultOnly], translations, rules, {});
  const en = formatEnglish([legacyResultOnly], {});
  assert.doesNotMatch(ja, /3-1|ゲーム得点不明/);
  assert.doesNotMatch(en, /3-1|game points unavailable/);
  assert.doesNotMatch(formatText([legacyResultOnly]), /games: -/);
  assert.match(formatText([{ ...legacyResultOnly, scoreDetailMissing: undefined }]), /games: -/);

  const ordinary = { ...legacyResultOnly, scoreDetailMissing: undefined };
  assert.doesNotMatch(formatJapanese([ordinary], translations, rules, {}), /ゲーム得点不明/);
  assert.doesNotMatch(formatEnglish([ordinary], {}), /game points unavailable/);
  const scored = { ...legacyResultOnly, gameScores: ["11-8", "8-11", "11-7", "11-6"] };
  assert.doesNotMatch(formatJapanese([scored], translations, rules, {}), /ゲーム得点不明/);
  assert.doesNotMatch(formatEnglish([scored], {}), /game points unavailable/);
  const unknownNames = { ...ordinary, competitors: [{ type: "player", name: "" }, { type: "player", name: "Player Two" }] };
  assert.match(formatText([unknownNames]), /TBD/);
  assert.match(formatList([unknownNames]), /TBD/);
  const missingName = { ...unknownNames, participantDetailMissing: true, competitors: [
    { type: "player", name: "Player One" },
    { type: "player", name: "", participantDetailMissing: true },
  ] };
  assert.match(formatText([missingName]), /Player One/);
  assert.doesNotMatch(formatText([missingName]), /TBD|不明/);
  assert.doesNotMatch(formatList([missingName]), /TBD|不明/);
});

test("slim pipeline preserves scoreDetailMissing on legacy records", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "score-detail-slim-"));
  const rawDir = path.join(tempDir, "wtt-records");
  const slimDir = path.join(tempDir, "wtt-records-slim");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, "5449.json"), JSON.stringify([legacyResultOnly]));
  try {
    execFileSync(process.execPath, [path.join(__dirname, "../build_wtt_slim_records.js")], {
      env: { ...process.env, WTT_RECORDS_DIR: rawDir, WTT_SLIM_RECORDS_DIR: slimDir },
      encoding: "utf8",
    });
    const slim = JSON.parse(fs.readFileSync(path.join(slimDir, "5449.json"), "utf8"));
    assert.equal(slim[0].scoreDetailMissing, true);
    assert.deepEqual(slim[0].gameScores, []);
    assert.equal(slim[0].overallScore, "3-1");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function loadFunction(sourcePath, functionName, nextFunctionName, context = {}) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const start = source.indexOf(`function ${functionName}(`);
  const end = source.indexOf(`\nfunction ${nextFunctionName}(`, start);
  assert.ok(start >= 0 && end > start, `${functionName} must exist in ${sourcePath}`);
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return context[functionName].bind(context);
}

test("H2H retains a source-verified unknown result without assigning either player a win", () => {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = source.indexOf("function pushHeadToHeadMatch(");
  const end = source.indexOf("\nasync function collectHeadToHeadMatches(", start);
  const context = vm.createContext({
    getWinnerIndexForRecord: () => null,
    translateRoundJa: (_key, label) => label,
    buildHeadToHeadMatchLine: () => "GIONIS　　KORBEL",
  });
  vm.runInContext(source.slice(start, end), context);
  const matches = [];
  context.pushHeadToHeadMatch(matches, { ...legacyResultOnly, overallScore: "0-0", resultOutcomeMissing: true }, 0, 1, {}, {}, null);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].winner, null);
  const countWins = loadFunction(path.join(__dirname, "../server.js"), "countHeadToHeadWins", "getHeadToHeadEventDedupKey");
  assert.equal(countWins([{ matches }]).aWins, 0);
  assert.equal(countWins([{ matches }]).bWins, 0);
});

test("career event records and H2H pair payloads retain scoreDetailMissing", () => {
  const serverPath = path.join(__dirname, "../server.js");
  const recordBuilder = loadFunction(serverPath, "buildPlayerRecordMatchRecord", "addPlayerRecordEventIndexMatch", {
    getWinnerIndexForRecord: () => 0,
    compactPlayerRecordCompetitor: (competitor) => competitor,
  });
  const indexedRecord = recordBuilder(legacyResultOnly, 0);
  assert.equal(indexedRecord.scoreDetailMissing, true);
  assert.equal(indexedRecord.overallScore, "3-1");
  assert.deepEqual(indexedRecord.gameScores, []);

  const pairPayloadBuilder = loadFunction(serverPath, "buildHeadToHeadPairMatchPayload", "addHeadToHeadIndexedMatch", {
    compactHeadToHeadCompetitor: (competitor) => competitor,
  });
  const pairPayload = pairPayloadBuilder(legacyResultOnly);
  assert.equal(pairPayload.scoreDetailMissing, true);
  assert.equal(pairPayload.overallScore, "3-1");
  assert.deepEqual(pairPayload.gameScores, []);
});

test("career index score renderers blank explicitly missing details and preserve unflagged results", () => {
  const builderPath = path.join(__dirname, "../build_player_records_index.js");
  const indexFormatter = loadFunction(builderPath, "formatGameScoresForRecord", "buildPlayerRecordLine");
  const serverPath = path.join(__dirname, "../server.js");
  const serverFormatter = loadFunction(serverPath, "formatGameScoresForRecord", "buildPlayerRecordLine");
  for (const formatter of [indexFormatter, serverFormatter]) {
    assert.equal(formatter({ ...legacyResultOnly, overallScore: "0-3" }, 1), "");
    assert.equal(formatter({ ...legacyResultOnly, overallScore: "0-3" }, 0), "");
    assert.equal(formatter({ ...legacyResultOnly, overallScore: "0-3", scoreDetailMissing: undefined }, 1), "0-3");
  }
});

function knockoutFixture({ winnerIndex = 0, nextScore = "3-4", ...overrides } = {}) {
  const names = ["GIONIS", "KORBEL"];
  const orgs = ["GRE", "CZE"];
  const make = (name, org) => ({ type: "player", name, org, players: [] });
  const source = {
    matchType: "individual", recordSource: "ettu", eventId: "ETTU2012I", recordEventId: "10636",
    documentCode: "R32-001", categoryName: "Men Singles", subEventType: "Men Singles",
    gender: "men", discipline: "singles", roundKey: "round_of_32", roundLabel: "Round of 32",
    overallScore: "0-0", gameScores: [], resultOutcomeMissing: true,
    competitors: [make(names[0], orgs[0]), make(names[1], orgs[1])], ...overrides,
  };
  const next = {
    ...source, documentCode: "R16-001", roundKey: "round_of_16", roundLabel: "Round of 16",
    resultOutcomeMissing: undefined, overallScore: nextScore, scoreDetailMissing: false,
    gameScores: [], competitors: [make(names[winnerIndex], orgs[winnerIndex]), make("Steger", "GER")],
  };
  return [source, next];
}

test("knockout advancement resolves only the missing match winner and leaves source scores intact", () => {
  const source = knockoutFixture();
  const resolved = resolveKnockoutOutcomes(source);
  assert.notEqual(resolved, source);
  assert.equal(source[0].recordWinnerIndex, undefined);
  assert.equal(resolved[0].recordWinnerIndex, 0);
  assert.deepEqual(resolved[0].recordWinnerEvidence, {
    method: "knockout-next-round", eventId: "ETTU2012I", sourceDocumentCode: "R32-001",
    nextDocumentCode: "R16-001", nextRoundKey: "round_of_16",
  });
  assert.equal(resolved[0].overallScore, "0-0");
  assert.equal(resolved[0].resultOutcomeMissing, true);
  assert.equal(resolved[0].gameScores.length, 0);

  const secondWinner = resolveKnockoutOutcomes(knockoutFixture({ winnerIndex: 1 }));
  assert.equal(secondWinner[0].recordWinnerIndex, 1);
  assert.equal(secondWinner[0].recordOutcomeMissing, undefined);
  assert.equal(secondWinner[0].resultOutcomeMissing, true);
});

test("knockout inference rejects ambiguity, incomplete or ineligible matches", () => {
  const unchanged = (matches) => assert.equal(resolveKnockoutOutcomes(matches)[0].recordWinnerIndex, undefined);
  const bothAdvance = knockoutFixture();
  bothAdvance.push({ ...bothAdvance[1], documentCode: "R16-002", competitors: [bothAdvance[0].competitors[1], { name: "Other", org: "FRA", players: [] }] });
  unchanged(bothAdvance);
  const partialNext = knockoutFixture();
  partialNext.push({ ...partialNext[1], documentCode: "R16-partial", participantDetailMissing: true,
    competitors: [partialNext[0].competitors[1], { name: "", org: "FRA", participantDetailMissing: true }] });
  unchanged(partialNext);
  const formerlyResolved = resolveKnockoutOutcomes(knockoutFixture());
  formerlyResolved.push({ ...formerlyResolved[1], documentCode: "R16-new", competitors: [formerlyResolved[0].competitors[1], { name: "Other", org: "FRA", players: [] }] });
  unchanged(formerlyResolved);
  unchanged(knockoutFixture({ nextScore: "99-0" }));
  const unplayed = knockoutFixture({ nextScore: "0-0" });
  unchanged(unplayed);
  const walkover = knockoutFixture({ nextScore: "W-L", resultStatus: "WO" });
  unchanged(walkover);
  const wrongOrg = knockoutFixture();
  wrongOrg[1].competitors[0].org = "OTHER";
  unchanged(wrongOrg);
  const duplicate = knockoutFixture();
  duplicate.push({ ...duplicate[0], documentCode: "R32-duplicate" });
  unchanged(duplicate);
  for (const overrides of [
    { recordSource: "wtt" },
    { matchType: "team" },
    { recordTeamContext: { matchType: "team" } },
    { roundKey: "group" },
    { subEventType: "Men Singles Qualification" },
    { subEventType: "Men Singles Consolation" },
    { competitors: [{ name: "GIONIS", org: "GRE" }, { name: "", org: "CZE", participantDetailMissing: true }] },
  ]) {
    unchanged(knockoutFixture({ ...overrides }));
  }
});

test("verified winner metadata controls career and pair records without filling missing score", () => {
  const resolved = resolveKnockoutOutcomes(knockoutFixture())[0];
  const serverPath = path.join(__dirname, "../server.js");
  const winnerGetter = loadFunction(serverPath, "getWinnerIndexForRecord", "formatGameScoresForRecord", {
    getWinnerIndexFromOverallScore: () => null,
    getWinnerIndexFromGameScores: () => null,
  });
  assert.equal(winnerGetter(resolved), 0);
  assert.equal(winnerGetter({ ...resolved, recordWinnerEvidence: undefined }), null);
  assert.equal(winnerGetter({ ...resolved, recordWinnerEvidence: { ...resolved.recordWinnerEvidence, sourceDocumentCode: "other-match" } }), null);
  const resolvedForSecond = resolveKnockoutOutcomes(knockoutFixture({ winnerIndex: 1 }))[0];
  assert.equal(winnerGetter(resolvedForSecond), 1);
  const recordBuilder = loadFunction(serverPath, "buildPlayerRecordMatchRecord", "addPlayerRecordEventIndexMatch", {
    getWinnerIndexForRecord: winnerGetter,
    compactPlayerRecordCompetitor: (competitor) => competitor,
  });
  const record = recordBuilder(resolved, 0);
  assert.equal(record.leftIndex, 0);
  assert.equal(record.recordWinnerIndex, 0);
  assert.equal(record.recordWinnerEvidence.method, "knockout-next-round");
  assert.equal(record.overallScore, "0-0");

  const pairBuilder = loadFunction(serverPath, "buildHeadToHeadPairMatchPayload", "addHeadToHeadIndexedMatch", {
    compactHeadToHeadCompetitor: (competitor) => competitor,
  });
  const pair = pairBuilder(resolved);
  assert.equal(pair.recordWinnerIndex, 0);
  assert.equal(pair.recordWinnerEvidence.nextDocumentCode, "R16-001");
  assert.equal(pair.resultOutcomeMissing, true);
});

test("slim archive pipeline retains inferred winner evidence", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knockout-outcome-slim-"));
  const rawDir = path.join(tempDir, "raw");
  const slimDir = path.join(tempDir, "slim");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, "ETTU2012I.json"), JSON.stringify(knockoutFixture()));
  try {
    execFileSync(process.execPath, [path.join(__dirname, "../build_wtt_slim_records.js"), path.join(rawDir, "ETTU2012I.json")], {
      env: { ...process.env, WTT_RECORDS_DIR: rawDir, WTT_SLIM_RECORDS_DIR: slimDir },
      encoding: "utf8",
    });
    const slim = JSON.parse(fs.readFileSync(path.join(slimDir, "ETTU2012I.json"), "utf8"));
    assert.equal(slim[0].recordWinnerIndex, 0);
    assert.equal(slim[0].recordWinnerEvidence.method, "knockout-next-round");
    assert.equal(slim[0].overallScore, "0-0");
    assert.equal(slim[0].resultOutcomeMissing, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
