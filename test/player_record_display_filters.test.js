const test = require("node:test");
const assert = require("node:assert/strict");

const { isPlayerRecordDoublesMatch } = require("../player_record_display_filters");

test("recognizes English and Japanese doubles categories only", () => {
  for (const categoryName of ["Men Doubles", "Women's Doubles", "Mixed Doubles", "男子ダブルス"]) {
    assert.equal(isPlayerRecordDoublesMatch({ categoryName }), true, categoryName);
  }
  for (const categoryName of ["Men Singles", "Mixed Teams", "男子団体"]) {
    assert.equal(isPlayerRecordDoublesMatch({ categoryName }), false, categoryName);
  }
});
