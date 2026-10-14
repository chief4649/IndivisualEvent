"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePayload, fetchEttuHistoryResults } = require("../import_ettu_history");
const { getEttuHistoryEvent, getEttuHistoryMetadata } = require("../ettu_history_registry");

test("European history uses explicit identities, never numeric/TTE coincidence", () => {
  assert.equal(getEttuHistoryEvent("5440"), null);
  assert.equal(getEttuHistoryEvent("TTE2024"), null);
  assert.equal(getEttuHistoryEvent("ETTU2007I"), null);
  assert.equal(getEttuHistoryMetadata("ETTU2024I").eventUrl, "https://www.ttm.co.at/results/ec2024/");
  assert.equal(getEttuHistoryEvent("ETTU2008I").startDate, null);
});

test("archive row errors cannot disappear when the import combines categories", async () => {
  const cells = { event: "Men's Singles", rnd: "F", player_id_a: "A Player (GER)", player_id_x: "B Player (FRA)", res_a: "4", res_x: "0", games: "", wo: "-", yr: "2008" };
  const html = `Total: 1<table><tr id="list_14_com_fabrik_14_row_1" class="fabrik_row">${Object.entries(cells).map(([key, value]) => `<td class="vw_ec_indv___${key}">${value}</td>`).join("")}</tr></table>`;
  await assert.rejects(fetchEttuHistoryResults(getEttuHistoryEvent("ETTU2008I"), {
    fetchImpl: async (url) => new Response(`<html>${new URL(url).searchParams.get("listid") === "14" ? html : "Total: 0"}</html>`, { status: 200, headers: { "content-type": "text/html" } }),
  }), (error) => error.sourceErrors?.length === 1 && /validation failed/.test(error.message));
});

test("empty, duplicate, mismatched and detail-free records cannot be promoted", () => {
  const config = getEttuHistoryEvent("ETTU2023T");
  const match = { eventId: config.eventId, documentCode: "official-1", matchType: "individual", competitors: [{ name: "A" }, { name: "B" }] };
  assert.deepEqual(validatePayload(config, [match]), [match]);
  for (const payload of [[], [match, match], [{ ...match, eventId: "5440" }], [{ ...match, matchType: "team", singles: [] }]]) {
    assert.throws(() => validatePayload(config, payload));
  }
  assert.equal(validatePayload(config, [{ ...match, matchType: "team", singles: [], resultStatus: "WO" }]).length, 1);
});
