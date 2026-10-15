"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

test("version patch runs on current initializer and is idempotent", (t) => {
  const root = path.join(__dirname, "..");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-version-info-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(tempDir, "public"));
  fs.copyFileSync(path.join(root, "patch_version_info.js"), path.join(tempDir, "patch_version_info.js"));
  fs.copyFileSync(path.join(root, "public", "index.html"), path.join(tempDir, "public", "index.html"));

  const patch = path.join(tempDir, "patch_version_info.js");
  const htmlPath = path.join(tempDir, "public", "index.html");
  const env = { ...process.env, APP_UPDATED_AT: "2026-10-15T00:00:00Z" };
  execFileSync(process.execPath, [patch], { env, stdio: "pipe" });
  const patched = fs.readFileSync(htmlPath, "utf8");

  assert.match(patched, /function loadVersionInfo\(\)/);
  assert.equal((patched.match(/loadVersionInfo\(\);/g) || []).length, 1);
  assert.match(patched, /loadVersionInfo\(\);\s*initializeFromUrl\(\);/);
  assert.match(patched, /await refreshEventDependentUi\(\);\s*if \(params\.get\("event"\)\) \{\s*runQuery\(\);/);

  execFileSync(process.execPath, [patch], { env, stdio: "pipe" });
  assert.equal(fs.readFileSync(htmlPath, "utf8"), patched);
});
