"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const vm = require("node:vm");

test("production main and H2H heaps have separate bounded budgets", () => {
  const docker = fs.readFileSync(path.join(__dirname, "../Dockerfile"), "utf8");
  const cmd = JSON.parse(docker.split("\n").find(line => line.startsWith("CMD ")).slice(4));
  assert.equal(cmd[0], "node");
  assert.ok(cmd.includes("--max-old-space-size=160"));
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const worker = source.slice(source.indexOf("function getHeadToHeadQueryWorker()"), source.indexOf("function getHeadToHeadQueryWorker()") + 650);
  assert.match(worker, /spawn\(process\.execPath, \[[\s\S]*?"--max-old-space-size=128"/);
  const expression = source.match(/const HEAD_TO_HEAD_QUERY_WORKER_WARMUP = ([\s\S]*?);/)[1];
  const evaluate = (limit, setting) => vm.runInNewContext(expression, {
    process: { env: { HEAD_TO_HEAD_QUERY_WORKER_WARMUP: setting, RENDER_GIT_COMMIT: "commit" } },
    require: () => ({ getHeapStatistics: () => ({ heap_size_limit: limit * 1024 * 1024 }) }),
  });
  assert.equal(evaluate(208, "1"), false);
  assert.equal(evaluate(256, "0"), false);
  assert.equal(evaluate(256, undefined), false);
  assert.equal(evaluate(256, "1"), true);
  for (const budget of [128, 160]) {
    const heapLimit = Number(execFileSync(process.execPath, [`--max-old-space-size=${budget}`, "-e",
      "process.stdout.write(String(require('v8').getHeapStatistics().heap_size_limit))"], { encoding: "utf8" }));
    assert.ok(heapLimit <= (budget + 64) * 1024 * 1024);
  }
});
