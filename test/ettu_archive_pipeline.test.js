const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const { isRecordArchiveFilename } = require("../record_archive_identity");

test("ETTU archive filenames are classified as WTT snapshot records", () => {
  const serverSource = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = serverSource.indexOf("function getRecordSourceFromFilename(");
  const end = serverSource.indexOf("\nfunction isVerifiedSpecialEventArchive", start);
  assert.ok(start >= 0 && end > start);

  const context = {};
  vm.createContext(context);
  vm.runInContext(serverSource.slice(start, end), context);

  for (const filename of ["ETTU2024I.json", "ETTU2025T.json", "ETTU2023TQ1.json"]) {
    assert.equal(isRecordArchiveFilename(filename), true, filename);
    assert.equal(context.getRecordSourceFromFilename(filename), "wtt", filename);
  }
  assert.equal(context.getRecordSourceFromFilename("TTE5277.json"), "ittf");
});

test("ETTU slim pipeline writes its output to the WTT slim archive", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ettu-wtt-slim-"));
  const sourceDir = path.join(tempDir, "wtt-records");
  const ittfSourceDir = path.join(tempDir, "ittf-records");
  const wttSlimDir = path.join(tempDir, "wtt-records-slim");
  const ittfSlimDir = path.join(tempDir, "ittf-records-slim");
  const filename = "ETTU2023TQ1.json";
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(ittfSourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, filename), "[]\n");

  try {
    execFileSync(process.execPath, [path.join(__dirname, "../build_wtt_slim_records.js")], {
      env: {
        ...process.env,
        WTT_RECORDS_DIR: sourceDir,
        ITTF_RECORDS_DIR: ittfSourceDir,
        WTT_SLIM_RECORDS_DIR: wttSlimDir,
        ITTF_SLIM_RECORDS_DIR: ittfSlimDir,
      },
      encoding: "utf8",
    });

    assert.equal(fs.existsSync(path.join(wttSlimDir, filename)), true);
    assert.equal(fs.existsSync(path.join(ittfSlimDir, filename)), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
