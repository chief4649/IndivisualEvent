const test = require("node:test");
const assert = require("node:assert/strict");
const { reconcileVerifiedCareerSources, getVerifiedUnplayedTeamSlots, isVerifiedUnplayedTeamSlot } = require("../player_record_verified_sources");

const match = (score = "3-1") => ({ categoryName: "Men Teams", documentCode: "old-1", line: "normal score", _sourceRecord: {
  left: { name: "GIONIS Panagiotis", orgCode: "GRE" },
  right: { name: "FREITAS Marcos", orgCode: "POR" }, overallScore: score,
  gameScores: ["11-7", "11-7", "10-12", "11-5"],
} });
const events = (a, b) => [
  { event: "5067", eventName: "LIEBHERR 2019 ITTF European Championships", matches: a },
  { event: "ETTU2019T", eventName: "2019 European Team Championships", matches: b },
];

test("verified cross-source career records merge only exact unambiguous scores", () => {
  const original = match(), alias = { ...match(), categoryName: "Men Singles", documentCode: "ettu-1" };
  const out = reconcileVerifiedCareerSources(events([original], [alias]));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].matches, [original]);
  assert.equal(reconcileVerifiedCareerSources(events([original], [match("3-2")]))[0].matches.length, 2);
  assert.equal(reconcileVerifiedCareerSources(events([original, original], [alias]))[0].matches.length, 3);
  assert.equal(reconcileVerifiedCareerSources(events([original], [alias, alias]))[0].matches.length, 3);
});

test("unknown and zero scores are preserved and unrelated event IDs are untouched", () => {
  const zero = match("0-0"), unknown = { ...match(), _sourceRecord: { ...match()._sourceRecord, resultOutcomeMissing: true } };
  assert.equal(reconcileVerifiedCareerSources(events([zero], [zero]))[0].matches.length, 2);
  assert.equal(reconcileVerifiedCareerSources(events([unknown], [unknown]))[0].matches.length, 2);
  const missingParticipant = { ...match(), _sourceRecord: { ...match()._sourceRecord, participantDetailMissing: true } };
  assert.equal(reconcileVerifiedCareerSources(events([match()], [missingParticipant]))[0].matches.length, 2);
  const input = events([match()], [match()]);
  input[1].event = "ETTU2023T";
  assert.strictEqual(reconcileVerifiedCareerSources(input), input);
});

test("reversed source orientation is matched without altering the retained record", () => {
  const original = match();
  const r = original._sourceRecord;
  const reversed = { ...original, _sourceRecord: { ...r, left: r.right, right: r.left,
    overallScore: "1-3", gameScores: r.gameScores.map(g => g.split("-").reverse().join("-")) } };
  assert.deepEqual(reconcileVerifiedCareerSources(events([original], [reversed]))[0].matches, [original]);
});

test("only proven post-clinch team slots are omitted, unknown outcomes stay", () => {
  const sides = [{ name: "GIONIS Panagiotis", orgCode: "GRE" }, { name: "GUNDUZ Ibrahim", orgCode: "TUR" }];
  const completed = () => ({ overallScore: "3-0", gameScores: ["11-5", "11-5", "11-5"], competitors: sides });
  const empty = () => ({ overallScore: "0-0", competitors: sides });
  const team = { matchType: "team", overallScore: "3-0", documentCode: "team-1", teams: sides,
    singles: [completed(), completed(), completed(), empty(), empty()] };
  const indexed = { documentCode: "team-1", record: { left: sides[0], right: sides[1], overallScore: "0-0", gameScores: [], resultStatus: "" } };
  const keys = getVerifiedUnplayedTeamSlots([team]);
  assert.equal(keys.size, 1);
  assert.equal(isVerifiedUnplayedTeamSlot(indexed, keys), true);
  assert.equal(isVerifiedUnplayedTeamSlot({ ...indexed, record: { ...indexed.record, resultOutcomeMissing: true } }, keys), false);
  assert.equal(getVerifiedUnplayedTeamSlots([{ ...team, overallScore: "3-1" }]).size, 0);
  assert.equal(getVerifiedUnplayedTeamSlots([{ ...team, singles: [completed(), empty(), completed(), empty(), empty()] }]).size, 0);
  assert.equal(getVerifiedUnplayedTeamSlots([{ ...team, singles: [completed(), completed(), completed(), { ...empty(), resultOutcomeMissing: true }, { ...empty(), resultStatus: "WO" }] }]).size, 0);
});
