const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getCandidateIndexCoverageFallbackEventIds,
  getPlayerRecordTruncation,
  isDuplicatePlayerRecordIndexEntryId,
  getPlayerRecordEventIdentity,
  getPlayerRecordEventMatchIdentity,
  mergePlayerRecordEventMatches,
} = require("../player_record_candidate_index_utils");

const files = [
  { eventId: "100", size: 500, mtimeMs: 9000, parseSize: 120, parseMtimeMs: 1000, parseSource: "slim" },
  { eventId: "101", size: 240, mtimeMs: 2000, parseSize: 240, parseMtimeMs: 2000, parseSource: "raw" },
];

function manifest(overrides = {}) {
  return {
    formatVersion: 2,
    complete: true,
    eventCount: 2,
    sourceFiles: {
      100: "120:1000:runtime-slim:/data/100.json",
      101: "240:2000:bundled-raw:/app/101.json",
    },
    eventMatchCounts: { 100: 5, 101: 6 },
    ...overrides,
  };
}

test("accepts complete candidate coverage across raw and slim source labels", () => {
  assert.deepEqual(getCandidateIndexCoverageFallbackEventIds(manifest(), files), []);
});

test("returns only added or changed source events for fallback", () => {
  const changed = [
    files[0],
    { ...files[1], parseMtimeMs: 3000 },
    { eventId: "102", size: 80, mtimeMs: 500, parseSize: 60, parseMtimeMs: 700, parseSource: "slim" },
  ];
  assert.deepEqual(
    getCandidateIndexCoverageFallbackEventIds(manifest(), changed),
    ["101", "102"],
  );
});

test("falls back across the snapshot when coverage metadata is incomplete", () => {
  assert.deepEqual(
    getCandidateIndexCoverageFallbackEventIds(manifest({ complete: false }), files),
    ["100", "101"],
  );
});

test("includes a current event missing from candidate coverage", () => {
  const current = [...files, { eventId: "102", size: 90, mtimeMs: 3000, parseSize: 70, parseMtimeMs: 3500, parseSource: "slim" }];
  assert.deepEqual(getCandidateIndexCoverageFallbackEventIds(manifest(), current), ["102"]);
});

test("does not invalidate event coverage solely because the translation config changed", () => {
  assert.deepEqual(getCandidateIndexCoverageFallbackEventIds(manifest(), files), []);
});

test("detects event and match result truncation independently", () => {
  const events = [
    { matches: [{}, {}] },
    { matches: [{}, {}] },
  ];
  assert.deepEqual(getPlayerRecordTruncation(events, 1, 10), {
    truncatedByEventLimit: true,
    truncatedByMatchLimit: false,
  });
  assert.deepEqual(getPlayerRecordTruncation(events, 10, 3), {
    truncatedByEventLimit: false,
    truncatedByMatchLimit: true,
  });
  assert.deepEqual(getPlayerRecordTruncation(events, 2, 4), {
    truncatedByEventLimit: false,
    truncatedByMatchLimit: false,
  });
});

test("skips repeated string IDs shared by alternate player-name keys", () => {
  const seen = new Set();
  assert.equal(isDuplicatePlayerRecordIndexEntryId("match-a", seen), false);
  assert.equal(isDuplicatePlayerRecordIndexEntryId("match-a", seen), true);
  assert.equal(isDuplicatePlayerRecordIndexEntryId({ match: "match-a" }, seen), false);
});

test("treats alternate event IDs as one event only when title and dates agree", () => {
  const wttEvent = {
    event: "5014",
    eventName: "Seamaster 2019 ITTF Challenge Plus Portugal Open",
    startDate: "2019-02-13",
    endDate: "2019-02-17",
  };
  const ittfAlias = { ...wttEvent, event: "TTE5014" };
  const alternateId = { ...wttEvent, event: "9999" };

  assert.equal(getPlayerRecordEventIdentity(wttEvent), getPlayerRecordEventIdentity(ittfAlias));
  assert.equal(getPlayerRecordEventIdentity(wttEvent), getPlayerRecordEventIdentity(alternateId));
  assert.notEqual(
    getPlayerRecordEventIdentity(wttEvent),
    getPlayerRecordEventIdentity({ ...ittfAlias, eventName: "Different event" }),
  );
  assert.notEqual(
    getPlayerRecordEventIdentity(wttEvent),
    getPlayerRecordEventIdentity({ ...ittfAlias, startDate: "2019-02-14" }),
  );
});

test("deduplicates the same match across alternate event IDs", () => {
  const match = {
    categoryName: "Men Singles",
    roundLabel: "Round 1",
    documentCode: "M.SINGLES-R32",
    line: "Player A - Player B",
  };
  const aliasMatch = { ...match, line: "Player A  -  Player B" };

  assert.equal(
    getPlayerRecordEventMatchIdentity(match, getPlayerRecordEventIdentity({
      event: "5014",
      eventName: "Portugal Open",
      startDate: "2019-02-13",
      endDate: "2019-02-17",
    })),
    getPlayerRecordEventMatchIdentity(aliasMatch, getPlayerRecordEventIdentity({
      event: "TTE5014",
      eventName: "Portugal Open",
      startDate: "2019-02-13",
      endDate: "2019-02-17",
    })),
  );
  const identity = getPlayerRecordEventIdentity({
    event: "5014",
    eventName: "Portugal Open",
    startDate: "2019-02-13",
    endDate: "2019-02-17",
  });
  assert.equal(mergePlayerRecordEventMatches([match], [aliasMatch], identity).length, 1);
  assert.equal(mergePlayerRecordEventMatches([match], [{ ...match, roundLabel: "Round 2" }], identity).length, 2);
});
