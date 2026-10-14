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
