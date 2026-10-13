"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  getCandidateConfigSignature,
  getCandidateEventSourceSignatures,
  isCandidateIndexCompleteForIncrementalUpdate,
} = require("../build_player_records_index");

const old = { eventId: "1", size: 100, mtimeMs: 1000, parseSource: "slim", filePath: "/tmp/1.json" };
const added = { ...old, eventId: "TTE3445", filePath: "/tmp/TTE3445.json" };
const manifest = () => ({ formatVersion: 2, complete: true, configSignature: getCandidateConfigSignature(),
  sourceFiles: getCandidateEventSourceSignatures([old]), eventMatchCounts: { 1: 3 } });

test("new explicitly requested events can be added incrementally without losing prior coverage", () => {
  assert.equal(isCandidateIndexCompleteForIncrementalUpdate(manifest(), [old, added], new Set(["TTE3445"])), true);
  assert.equal(isCandidateIndexCompleteForIncrementalUpdate(manifest(), [old, added], new Set()), false);
});

test("changed unrelated sources, incomplete coverage and changed dependencies require a rebuild", () => {
  assert.equal(isCandidateIndexCompleteForIncrementalUpdate(manifest(), [{ ...old, size: 101 }, added], new Set(["TTE3445"])), false);
  assert.equal(isCandidateIndexCompleteForIncrementalUpdate({ ...manifest(), eventMatchCounts: {} }, [old, added], new Set(["TTE3445"])), false);
  assert.equal(isCandidateIndexCompleteForIncrementalUpdate({ ...manifest(), configSignature: "old-config" }, [old, added], new Set(["TTE3445"])), false);
  assert.equal(isCandidateIndexCompleteForIncrementalUpdate(manifest(), [added], new Set(["TTE3445"])), false);
});

test("event metadata changes do not invalidate candidate keys but translation changes do", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-deps-"));
  try {
    fs.writeFileSync(path.join(dir, "translations.ja.json"), "{}");
    const script = `const fs=require("fs"),path=require("path");
      const {getCandidateConfigSignature:s}=require("./build_player_records_index");
      const before=s();fs.utimesSync(path.join(process.env.DATA_DIR,"translations.ja.json"),new Date(),new Date(Date.now()+10000));
      const touched=s();
      for(const f of ["wtt-date-index.json","wtt-search-index.json","wtt-archive-index.json","event-names.json"])
        fs.writeFileSync(path.join(process.env.DATA_DIR,f),JSON.stringify({changed:true}));
      const metadata=s();fs.writeFileSync(path.join(process.env.DATA_DIR,"translations.ja.json"),JSON.stringify({players:{new:"name"}}));
      console.log(JSON.stringify({touchUnchanged:before===touched,metadataUnchanged:before===metadata,translationChanged:metadata!==s()}));`;
    const output = execFileSync(process.execPath, ["-e", script], { cwd: path.join(__dirname, ".."), env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
    assert.deepEqual(JSON.parse(output), { touchUnchanged: true, metadataUnchanged: true, translationChanged: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
