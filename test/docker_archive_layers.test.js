const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("deployment archive layers are independent of preceding application changes", () => {
  const root = path.join(__dirname, "..");
  const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
  assert.match(dockerfile, /^# syntax=docker\/dockerfile:1\n/);
  for (const source of ["zennihon-records", "wtt-records", "wtt-records-slim",
    "player-records-index/event-records", "player-records-index/event-records-manifest.json"]) {
    assert.ok(dockerfile.split("\n").includes(`COPY --link ${source} ./${source}`), source);
    assert.equal(fs.lstatSync(path.join(root, source)).isSymbolicLink(), false, source);
  }
});
