const test = require("node:test");
const assert = require("node:assert/strict");

const {
  finishPlayerRecordEventIndexAuditBatch,
  getPlayerRecordEventIndexAuditQueue,
  getPlayerRecordEventIndexAuditSignature,
} = require("../player_record_event_index_audit");

test("snapshot signature changes when the selected archive changes", () => {
  const file = { eventId: "123", size: 100, mtimeMs: 10, parseSource: "slim", parseSize: 50, parseMtimeMs: 11 };
  assert.notEqual(
    getPlayerRecordEventIndexAuditSignature([file]),
    getPlayerRecordEventIndexAuditSignature([{ ...file, parseMtimeMs: 12 }]),
  );
});

test("audit queue resumes for the same snapshot and is rediscovered for a changed snapshot", () => {
  const existing = { version: 1, signature: "same", pendingEventIds: ["2", "2", "3"] };
  assert.deepEqual(getPlayerRecordEventIndexAuditQueue(existing, "same", ["9"]), ["2", "3"]);
  assert.deepEqual(getPlayerRecordEventIndexAuditQueue(existing, "changed", ["4", "4"]), ["4"]);
});

test("audit batch removes successes and moves failures behind remaining work", () => {
  assert.deepEqual(
    finishPlayerRecordEventIndexAuditBatch(["1", "2", "3", "4"], ["1", "2"], ["2"]),
    ["3", "4", "2"],
  );
});
