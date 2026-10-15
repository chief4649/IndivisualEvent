"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function readInlineFunctions(...names) {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const scriptStart = html.indexOf("<script>");
  const scriptEnd = html.indexOf("</script>", scriptStart);
  const source = html.slice(scriptStart, scriptEnd);
  return names.map((name) => {
    const start = source.indexOf(`      ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    const nextFunction = source.slice(start + 1).search(/\n      (?:async )?function /);
    return source.slice(start, nextFunction < 0 ? undefined : start + 1 + nextFunction);
  }).join("\n");
}

test("initial URL query waits for categories and rounds without dropping filters or duplicating requests", async () => {
  const fields = {
    source: { value: "wtt" },
    event: { value: "" },
    category: { value: "" },
    gender: { value: "" },
    discipline: { value: "" },
  };
  const calls = [];
  let roundsLoaded = false;
  let queryRan = false;
  const context = vm.createContext({
    URLSearchParams,
    initialParams: new URLSearchParams("source=wtt&event=2609&category=Men+Singles&round=final"),
    form: { elements: { namedItem: (name) => fields[name] } },
    categorySelect: fields.category,
    genderField: fields.gender,
    disciplineField: fields.discipline,
    categoryRequestId: 0,
    roundRequestId: 0,
    pendingInitialCategoryValue: "Men Singles",
    pendingInitialRoundValues: new Set(["final"]),
    updateEventName() {},
    loadEventName: async () => {},
    reportBackgroundError(error) { throw error; },
    setCategoryOptions(options) {
      assert.deepEqual(Array.from(options, (option) => option.value), ["Men Singles"]);
    },
    setRoundOptions(options) {
      assert.deepEqual(Array.from(options, (option) => option.value), ["final"]);
      roundsLoaded = true;
    },
    readJsonResponse: async (_response, message) => {
      const url = calls.at(-1);
      if (url.startsWith("/api/categories?")) return { categories: [{ value: "Men Singles", label: "Men Singles" }] };
      if (url.startsWith("/api/rounds?")) return { rounds: [{ value: "final", label: "Final" }] };
      throw new Error(message);
    },
    fetch: async (url) => {
      calls.push(url);
      return { ok: true };
    },
    runQuery() {
      assert.equal(roundsLoaded, true, "round choices are installed before the initial query");
      assert.equal(fields.category.value, "Men Singles");
      assert.equal(context.pendingInitialRoundValues.has("final"), true);
      queryRan = true;
    },
  });
  context.setTimeout = setTimeout;
  vm.runInContext(readInlineFunctions(
    "async function loadCategories",
    "async function loadRounds",
    "function refreshEventDependentUi",
    "async function initializeFromUrl",
  ), context);

  await context.initializeFromUrl();

  assert.equal(queryRan, true);
  assert.equal(calls.length, 2);
  assert.equal(calls.filter((url) => url.startsWith("/api/categories?")).length, 1);
  assert.equal(calls.filter((url) => url.startsWith("/api/rounds?")).length, 1);
  assert.match(calls.find((url) => url.startsWith("/api/rounds?")), /category=Men\+Singles/);
});
