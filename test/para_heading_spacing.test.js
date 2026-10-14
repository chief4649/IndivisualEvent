"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { formatJapanese } = require("../extract_individual_matches");
const translations = require("../translations.ja.json");
const rules = require("../rules.json");

function formatHeader(categoryName, discipline = "singles", gender = "men") {
  const match = {
    matchType: "individual",
    categoryName,
    discipline,
    gender,
    roundKey: "round_of_32",
    roundLabel: "Round of 32",
    overallScore: "3-0",
    gameScores: ["11-5", "11-6", "11-7"],
    competitors: [
      { type: "player", name: "Player One", org: "AAA", players: [] },
      { type: "player", name: "Player Two", org: "BBB", players: [] },
    ],
  };

  return formatJapanese([match], translations, rules, {}).split("\n")[0];
}

test("Japanese para class headings separate the class and round with an ASCII space", () => {
  assert.equal(formatHeader("Men Singles Class 3"), "▼男子シングルスクラス3 1回戦");
  assert.equal(formatHeader("Men Singles Classes 4-5"), "▼男子シングルスクラス4-5 1回戦");
  assert.equal(formatHeader("Men Doubles Class MD14", "doubles"), "▼男子ダブルスクラスMD14 1回戦");
});

test("Japanese non-para headings keep the existing category and round concatenation", () => {
  assert.equal(formatHeader("Men Singles"), "▼男子シングルス1回戦");
});
