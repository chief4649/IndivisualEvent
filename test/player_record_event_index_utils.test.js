const test = require("node:test");
const assert = require("node:assert/strict");

const { isPlayerRecordEventIndexForFile } = require("../player_record_event_index_utils");

test("accepts a current index when source size and mtime match", () => {
  assert.equal(
    isPlayerRecordEventIndexForFile(
      { sourceSize: 100, sourceMtimeMs: 200 },
      { size: 100, mtimeMs: 200 },
    ),
    true,
  );
});

test("rejects a same-size source file replaced after index generation", () => {
  assert.equal(
    isPlayerRecordEventIndexForFile(
      { sourceSize: 100, sourceMtimeMs: 200 },
      { size: 100, mtimeMs: 201 },
    ),
    false,
  );
});

test("rejects an index built from a different source size", () => {
  assert.equal(
    isPlayerRecordEventIndexForFile(
      { sourceSize: 99, sourceMtimeMs: 200 },
      { size: 100, mtimeMs: 200 },
    ),
    false,
  );
});

test("preserves compatibility with indexes that lack source metadata", () => {
  assert.equal(isPlayerRecordEventIndexForFile({}, { size: 100, mtimeMs: 200 }), true);
});
