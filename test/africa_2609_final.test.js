"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyFilters, buildJaRoundContext, createArgs, formatEnglish, formatJapanese,
  normalizePreNormalizedMatch } = require("../extract_individual_matches");
const archive = require("../wtt-records-slim/2609.json");
const translations = require("../translations.ja.json");
const rules = require("../rules.json");

test("2609 all-category output survives order-only team slots and retains the complete men's final", () => {
  const before = JSON.stringify(archive);
  const matches = archive.map(normalizePreNormalizedMatch);
  const context = buildJaRoundContext(matches);
  const japanese = formatJapanese(matches, translations, rules, context);
  const english = formatEnglish(matches, context);
  assert.match(japanese, /▼男子シングルス決勝\nアルナ（ナイジェリア）　4\(-8,-9,8,-6,7,11,12\)3　O\.アサール（エジプト）/);
  assert.match(english, /Men's Singles Final[\s\S]*?ARUNA Quadri.*4\(-8,-9,8,-6,7,11,12\)3/);
  assert.equal(JSON.stringify(archive), before);
  const finals = applyFilters(matches, createArgs({ category: "Men Singles", round: "final" }), translations);
  assert.equal(finals.length, 1);
  assert.equal(finals[0].documentCode, "TTEMSINGLES-----------FNL-000100----------");
  assert.equal(finals[0].overallScore, "4-3");
  assert.deepEqual(finals[0].gameScores, ["8-11", "9-11", "11-8", "6-11", "11-7", "13-11", "14-12"]);
});

test("order-only slots are not rendered as invented games or opponent names", () => {
  const match = archive.find(m => m.matchType === "team" && m.singles.some(s => Object.keys(s).length === 1));
  const placeholderOnly = { ...match, singles: [{ order: 1 }, { order: 2 }] };
  const context = buildJaRoundContext([placeholderOnly]);
  const ja = formatJapanese([placeholderOnly], translations, rules, context);
  const en = formatEnglish([placeholderOnly], context);
  assert.doesNotMatch(ja, /undefined|NaN|\(\)|TBD/);
  assert.doesNotMatch(en, /undefined|NaN|\(\)|TBD/);
});
