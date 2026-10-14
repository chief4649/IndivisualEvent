const test = require("node:test");
const assert = require("node:assert/strict");
const { isRecordArchiveFilename, isRecordEventId } = require("../record_archive_identity");

test("accepts existing numeric and TTE record archive identities", () => {
  for (const value of ["2410", "TTE5277", "tte3410"]) {
    assert.equal(isRecordEventId(value), true, value);
    assert.equal(isRecordArchiveFilename(`${value}.json`), true, value);
  }
});

test("accepts explicit ETTU event identities and archive filenames", () => {
  for (const value of ["ETTU2024I", "ETTU2025T", "ETTU2008C", "ETTU2023TQ1", "ETTU2024TQ2C"]) {
    assert.equal(isRecordEventId(value), true, value);
    assert.equal(isRecordArchiveFilename(`${value}.json`), true, value);
  }
});

test("rejects paths, malformed archive names, and unknown event ID variants", () => {
  for (const value of ["../2410.json", "/tmp/TTE5277.json", "ETTU202I.json", "ETTU20244I.json", "ETTU2024X.json", "ETTU2024TQ3.json", "event-2410.json"]) {
    assert.equal(isRecordArchiveFilename(value), false, value);
  }
  for (const value of ["../2410", "ETTU202I", "ETTU20244I", "ETTU2024X", "ETTU2024TQ3", "event-2410"]) {
    assert.equal(isRecordEventId(value), false, value);
  }
});
