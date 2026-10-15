"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { supplementVerifiedWttResults, ASTANA_FINAL_CODE } = require("../wtt_verified_result_supplements");
const { formatJapanese, buildJaRoundContext } = require("../extract_individual_matches");

function semifinals() {
  return ["132992", "114715"].map((id, index) => ({
    eventId: "3254", categoryName: "Men Singles", startDateLocal: "09/20/2026 12:20:00",
    documentCode: `TTEMSINGLES-----------SFNL000${index + 1}00----------`, competitors: [{ id }],
  }));
}

test("3254 supplements only its verified missing final without changing existing records", () => {
  const input = semifinals();
  const before = JSON.stringify(input);
  const result = supplementVerifiedWttResults("3254", input);
  assert.equal(result.length, 3);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result[0], input[0]);
  const final = result.at(-1);
  assert.equal(final.documentCode, ASTANA_FINAL_CODE);
  assert.equal(final.overallScore, "4-2");
  assert.deepEqual(final.gameScores, ["6-11", "11-5", "5-11", "11-6", "11-6", "11-4"]);
  assert.match(final.sourceUrl, /artId=6620$/);
  assert.match(formatJapanese([final], require("../translations.ja.json"), require("../rules.json"), buildJaRoundContext([final])),
    /ダン・チウ（ドイツ）　4\(-6,5,-5,6,6,4\)2　A\.ルブラン（フランス）/);
  assert.equal(supplementVerifiedWttResults("3254", result), result);
});

test("supplement refuses another event, wrong dates, missing finalists, or an existing final", () => {
  for (const [event, input] of [["2609", semifinals()], ["3254", []],
    ["3254", semifinals().map(m => ({ ...m, startDateLocal: "09/20/2025" }))],
    ["3254", semifinals().map(m => ({ ...m, competitors: [{ id: "other" }] }))],
    ["3254", [...semifinals(), { documentCode: ASTANA_FINAL_CODE, overallScore: "original" }]]]) {
    assert.equal(supplementVerifiedWttResults(event, input), input);
  }
});
