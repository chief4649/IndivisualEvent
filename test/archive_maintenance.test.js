"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getEttuHistoryImportPid } = require("../archive_maintenance");

function state(lock, command = "node\0/app/import_ettu_history.js\0", dead = false) {
  return {
    fs: { existsSync: () => true, readFileSync: (file) => file.endsWith("cmdline") ? command : lock },
    probe: () => { if (dead) throw new Error("ESRCH"); },
  };
}

test("archive maintenance admits only a live import process", () => {
  assert.equal(getEttuHistoryImportPid("/data", state("321")), 321);
  assert.equal(getEttuHistoryImportPid("/data", state("321", undefined, true)), null);
  assert.equal(getEttuHistoryImportPid("/data", state("321", "node\0server.js\0--head-to-head-query-worker\0")), null);
  for (const lock of ["1", "0", "NaN", "321;something", "999999999999999999999"]) {
    assert.equal(getEttuHistoryImportPid("/data", state(lock)), null);
  }
});
