const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createHeadToHeadQueryJobStore } = require("../head_to_head_query_job_store");

function withStore(run, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "h2h-job-store-"));
  try {
    run(createHeadToHeadQueryJobStore({ ...options, directory }), directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("job records survive store reconstruction", () => {
  withStore((store, directory) => {
    const record = {
      id: "a".repeat(32),
      status: "complete",
      createdAt: new Date(1000).toISOString(),
      searchResult: { summary: { totalMatches: 3 } },
    };
    store.write(record);

    const restartedStore = createHeadToHeadQueryJobStore({ directory, now: () => 2000 });
    assert.deepEqual(restartedStore.read(record.id), record);
  });
});

test("prunes expired records but retains in-flight jobs", () => {
  withStore((store) => {
    const staleId = "a".repeat(32);
    const activeId = "b".repeat(32);
    store.write({ id: staleId, status: "complete", createdAt: new Date(0).toISOString() });
    store.write({ id: activeId, status: "processing", createdAt: new Date(9000).toISOString() });
    store.prune();

    assert.equal(store.read(staleId), null);
    assert.equal(store.read(activeId)?.status, "processing");
  }, { now: () => 10_001, ttlMs: 10_000, maxJobs: 1 });
});
