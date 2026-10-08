"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { test } = require("node:test");
const { fetchOfficialResultsCached, isWttPayloadSourceCompatible, formatJapanese, formatEnglish } = require("../extract_individual_matches");

test("2026 game-total team ties never invent unplayed traditional team cards", () => {
  const final = require("../wtt-records/5449.json").find((match) =>
    match.categoryName === "Men Teams" && match.roundLabel === "Finals");
  assert.ok(final);
  for (const formatter of [formatJapanese, formatEnglish]) {
    const output = formatter([final], require("../translations.ja.json"), require("../rules.json"), {});
    assert.equal(output.split("\n").length, 2 + final.singles.length);
    assert.match(output, /8-2/);
  }
});

test("5449 rejects undated historical archives while TTE5449 remains independent", () => {
  const historical = [{ eventId: "5449", documentCode: "M.SINGLES.R64", source: "wtt" }];
  assert.equal(isWttPayloadSourceCompatible(historical, "5449"), false);
  assert.equal(isWttPayloadSourceCompatible(historical, "TTE5449"), true);
  assert.equal(isWttPayloadSourceCompatible([{
    ...historical[0], recordSource: "south-american-games-2026", recordEventId: "JSUD2026",
  }], "5449"), false);
});

test("5449 uses the 2026 official API, preserves provenance, and treats doubles as individual matches", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "santa-fe-source-"));
  const originalFetch = global.fetch;
  const urls = [];
  const side = (name, org, result, scores) => ({ Name: name, Org: org, Result: result,
    Splits: scores.map((score) => ({ Result: score })), Members: [] });
  global.fetch = async (url) => {
    urls.push(String(url));
    const payload = String(url).endsWith("/disc/data")
      ? { Days: [{ raw: "2026-09-26" }], Events: [{ EvKey: "M.DOUBLES-----------", Desc: "Men's Double" }] }
      : [{ Key: "M.DOUBLES-----------.FNL-.00010000", Event: "M.DOUBLES-----------",
        EventDesc: "Men's Double", PhaseDescA: "Finals", UnitDescA: "Match 1", Type: "T",
        Status: "OFFICIAL", DateTimeRaw: "2026-09-26T12:00:00-03:00",
        Home: side("CIFUENTES / LORENZO", "ARG", "3", [11, 12, 11]),
        Away: side("BURGOS / GOMEZ", "CHI", "0", [5, 10, 8]) }];
    const compressed = zlib.deflateSync(Buffer.from(JSON.stringify(payload)));
    const encoded = Array.from(compressed, (byte) => String.fromCharCode(byte)).join("");
    return new Response(encoded, { status: 200 });
  };
  try {
    const result = await fetchOfficialResultsCached("wtt", "5449", 1200, dir, true, {
      skipWttArchiveWrite: true, wttArchiveDir: dir, wttArchiveIndexPath: path.join(dir, "index.json"),
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].matchType, "individual");
    assert.equal(result[0].categoryName, "Men Doubles");
    assert.equal(result[0].recordEventId, "JSUD2026");
    assert.equal(result[0].recordSource, "south-american-games-2026");
    assert.equal(result[0].startDateLocal, "2026-09-26T12:00:00-03:00");
    assert.ok(urls.every((url) => url.startsWith("https://back.results.santafe2026.org/s/JSUD2026/")));
    assert.equal(isWttPayloadSourceCompatible(result, "5449"), true);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
