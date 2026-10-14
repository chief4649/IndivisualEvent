"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

function createElement() {
  const element = {
    children: [],
    textContent: "",
    className: "",
    appendChild(child) { this.children.push(child); },
  };
  Object.defineProperty(element, "innerHTML", {
    set(value) {
      this.children = [];
      this._innerHTML = value;
    },
    get() { return this._innerHTML || ""; },
  });
  return element;
}

test("successful career search clears shared error and hides empty opponent org parentheses", async () => {
  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const formatterStart = server.indexOf("function getCompetitorDisplayNameForRecord(");
  const formatterEnd = server.indexOf("\nfunction getWinnerIndexFromOverallScore(", formatterStart);
  assert.ok(formatterStart >= 0 && formatterEnd > formatterStart);
  const formatterContext = vm.createContext({
    translatePlayerWithOrg: (name) => name,
    translateOrg: (org) => org,
    getCompetitorNameCandidates: () => [],
    translatePlayerNameForRecord: (name) => name,
  });
  vm.runInContext(server.slice(formatterStart, formatterEnd), formatterContext);
  const scoreStart = server.indexOf("function formatGameScoresForRecord(");
  const scoreEnd = server.indexOf("\nfunction buildPlayerRecordLine(", scoreStart);
  const materializeStart = server.indexOf("function buildPlayerRecordLineFromRecord(");
  const materializeEnd = server.indexOf("\nfunction resolvePlayerRecordIndexedMatch(", materializeStart);
  assert.ok(scoreStart >= 0 && scoreEnd > scoreStart && materializeStart >= 0 && materializeEnd > materializeStart);
  vm.runInContext(`${server.slice(scoreStart, scoreEnd)}\n${server.slice(materializeStart, materializeEnd)}`, formatterContext);
  const missingOpponent = { name: "()", org: "", orgCode: "", players: [{ name: "()", orgCode: "" }] };
  assert.equal(formatterContext.formatCompetitorForRecord(missingOpponent, {}), "");
  assert.equal(formatterContext.formatCompetitorForRecord({ ...missingOpponent, name: "（）", players: [{ name: "（）" }] }, {}), "");
  const materialized = formatterContext.materializePlayerRecordMatch({ event: "5067", record: {
    left: { name: "GIONIS", org: "GRE", orgCode: "GRE", players: [{ name: "GIONIS", org: "GRE", orgCode: "GRE" }] },
    right: missingOpponent, overallScore: "3-0", gameScores: ["11-5"], leftIndex: 0,
  } }, {});
  const careerLine = materialized.line;
  assert.equal(careerLine, "GIONIS（GRE）　5　");

  const playerRecords = createElement();
  const statusMessages = [];
  const context = vm.createContext({
    URLSearchParams,
    playerRecords,
    document: { createElement },
    setStatus: (message) => statusMessages.push(message),
    fetchWithTimeout: async () => ({ status: 200, ok: true }),
    readJsonResponse: async () => ({ events: [{ eventName: "GIONIS2013", matches: [
      { roundLabel: "R32", line: careerLine },
      { roundLabel: "R16", line: "PLAYER (A)　1-3　OTHER" },
    ] }] }),
  });
  vm.runInContext(readInlineFunctions("function renderPlayerRecords", "async function loadPlayerRecords"), context);

  await context.loadPlayerRecords({ name: "GIONIS" });

  assert.deepEqual(statusMessages, [""]);
  const event = playerRecords.children[0];
  const group = event.children[1];
  const match = group.children[1];
  assert.equal(match.children[1].textContent, "GIONIS（GRE）　5");
  assert.doesNotMatch(match.children[1].textContent, /\(\s*\)/);
  assert.doesNotMatch(match.children[1].textContent, /TBD/);
  assert.match(match.children[1].textContent, /GIONIS.*5/);
  assert.equal(group.children[2].children[1].textContent, "PLAYER (A)　1-3　OTHER");
});
