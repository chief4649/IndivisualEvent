"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  fetchEttuArchiveEvents,
  fetchEttuArchiveResults,
  fetchEttuArchiveYears,
  parseGames,
  parseRows,
  parseYears,
} = require("../ettu_archive_results");

const config = { eventId: "event-2008", eventName: "Verified European Championships 2008", year: "2008", type: "singles", startDate: null, endDate: null };
const individualRow = ({ id = "8964", year = "2008", games = "9:11 6:11 5:11 11:9 11:2 9:11 :", event = "Men's Singles" } = {}) => `
<tr id="list_14_com_fabrik_14_row_${id}">
<td class="vw_ec_indv___event">${event}</td><td class="vw_ec_indv___rnd">R256</td>
<td class="vw_ec_indv___player_id_a">BERARDI Mattia (SMR)</td><td class="vw_ec_indv___player_id_x">DUBROVIN Veniamin (MDA)</td>
<td class="vw_ec_indv___res_a">2</td><td class="vw_ec_indv___res_x">4</td>
<td class="vw_ec_indv___games">${games}</td><td class="vw_ec_indv___wo">-</td><td class="vw_ec_indv___yr">${year}</td>
</tr>`;
const page = (rows, total, listId = 14) => `<html><select data-filter-name="${listId === 29 ? "vw_ec_teams___yr" : "vw_ec_indv___yr"}"><option value="">All</option><option value="2008">2008</option><option value="2021">2021</option></select><div>Total: ${total}</div><table><tbody>${rows}</tbody></table></html>`;

function response(html) { return { ok: true, status: 200, text: async () => html }; }

test("discovers only listed years for all archive types", async () => {
  const yearsHtml = {
    singles: page("", 0),
    doubles: page("", 0),
    team: page("", 0, 29),
  };
  const years = await fetchEttuArchiveYears({ fetchImpl: async (url) => {
    const u = new URL(url);
    return response(yearsHtml[u.searchParams.get("listid")==="29" ? "team" : "singles"]);
  } });
  assert.deepEqual(years, { singles: ["2008", "2021"], doubles: ["2008", "2021"], team: ["2008", "2021"] });
  assert.deepEqual(parseYears(yearsHtml.singles, "singles"), ["2008", "2021"]);
});

test("fetches every advertised page sequentially and normalizes verified singles data", async () => {
  const urls = [];
  const raw = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    const start = Number(new URL(url).searchParams.get("limitstart14"));
    const rows = start === 0
      ? Array.from({ length: 100 }, (_, index) => individualRow({ id: String(8964 + index) })).join("")
      : individualRow({ id: "9064" });
    return response(page(rows, 101));
  };
  const records = await fetchEttuArchiveResults(config, { fetchImpl, onPage: (pageData) => raw.push(pageData) });
  assert.equal(urls.length, 2);
  assert.deepEqual(urls.map((url) => url.searchParams.get("limitstart14")), ["0", "100"]);
  assert.deepEqual(records[0].gameScores, ["9-11", "6-11", "5-11", "11-9", "11-2", "9-11"]);
  assert.equal(records[0].overallScore, "2-4");
  assert.equal(records[0].date, null);
  assert.equal(records[0].startDateLocal, null);
  assert.equal(records[0].recordYear, "2008");
  assert.equal(records[0].roundLabel, "Round of 256");
  assert.equal(records[0].roundKey, "round_of_256");
  assert.equal(records[0].competitors[0].players[0].orgCode, "SMR");
  assert.equal(records[0].documentCode, "ETTU-ARCHIVE-2008-singles-8964");
  assert.equal(records.length, 101);
  assert.deepEqual(records.counts, { advertised: 101, parsed: 101, unplayed: 0, rejected: 0, detailRowsObserved: 0 });
  assert.equal(records.errors.length, 0);
  assert.equal(({ ...records }).errors.length, 0);
  assert.equal(raw.length, 2);
  assert.match(raw[0].html, /Total: 101/);
});

test("imports team children as flat individual records with explicit team context", async () => {
  const teamRow = `<tr id="list_29_com_fabrik_29_row_2446"><td class="vw_ec_teams___event">Men's Teams</td><td class="vw_ec_teams___group_">E</td><td class="vw_ec_teams___stage">Challenge Division</td><td class="vw_ec_teams___rnd">1</td><td class="vw_ec_teams___assoc_a">CZE</td><td class="vw_ec_teams___assoc_x">LAT</td><td class="vw_ec_teams___res_team_a">3</td><td class="vw_ec_teams___res_team_x">0</td><td class="vw_ec_teams___yr">2008</td><td><a title="Individual Matches Results" href="/index.php?option=com_fabrik&amp;view=list&amp;listid=31&amp;vw_teams_indv_res___yr=2008&amp;vw_teams_indv_res___match_no=4920081&amp;resetfilters=1&amp;rowid=2446">Details</a></td></tr>`;
  const children = `<tr id="list_31_com_fabrik_31_row_2448"><td class="vw_teams_indv_res___name_a">SIMONCIK Josef (CZE)</td><td class="vw_teams_indv_res___name_b"></td><td class="vw_teams_indv_res___name_x">BURGIS Matiss (LAT)</td><td class="vw_teams_indv_res___name_y"></td><td class="vw_teams_indv_res___res_a">3</td><td class="vw_teams_indv_res___res_x">0</td><td class="vw_teams_indv_res___games">11:2 11:6 17:15 : :</td><td class="vw_teams_indv_res___wo_a">-</td><td class="vw_teams_indv_res___wo_x">-</td></tr><tr id="list_31_com_fabrik_31_row_2449"><td class="vw_teams_indv_res___name_a"></td><td class="vw_teams_indv_res___name_b"></td><td class="vw_teams_indv_res___name_x"></td><td class="vw_teams_indv_res___name_y"></td><td class="vw_teams_indv_res___res_a">0</td><td class="vw_teams_indv_res___res_x">0</td><td class="vw_teams_indv_res___games">0:0 0:0 : : :</td><td class="vw_teams_indv_res___wo_a">-</td><td class="vw_teams_indv_res___wo_x">-</td></tr>`;
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.searchParams.get("listid") === "29") return response(page(teamRow, 1, 29));
    assert.equal(u.searchParams.get("listid"), "31");
    return response(`<html><table><tbody>${children}</tbody></table></html>`);
  };
  const progress = [];
  const records = await fetchEttuArchiveResults({ ...config, eventId: "team-2008", type: "team" }, { fetchImpl, onProgress: (value) => progress.push(value) });
  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.matchType, "individual");
  assert.equal(record.discipline, "singles");
  assert.equal(record.roundLabel, "Challenge Division - Group E - Round 1");
  assert.equal(record.recordTeamContext.parentAggregateScore, "3-0");
  assert.equal(record.recordTeamContext.parentAggregateMissing, false);
  assert.equal(record.overallScore, "3-0");
  assert.deepEqual(record.gameScores, ["11-2", "11-6", "17-15"]);
  assert.equal(record.competitors[0].players[0].orgCode, "CZE");
  assert.equal(record.matchNumber, null);
  assert.deepEqual(progress.map((value) => [value.parentRowsCompleted, value.parentRowsTotal, value.verifiedMatches]), [[1, 1, 1]]);
  assert.equal(records.counts.advertised, 1);
  assert.equal(records.counts.detailRowsObserved, 2);
  assert.equal(records.counts.unplayed, 1);
  assert.equal(records.counts.rejected, 0);
  assert.equal(records.unplayed[0].sourceRowId, "2449");
  assert.deepEqual(records.unplayed[0].players, { left: [], right: [] });
});

test("fails closed on year mismatch, incomplete pagination, duplicate IDs, and invalid scores", async () => {
  await assert.rejects(fetchEttuArchiveResults(config, { fetchImpl: async () => response(page(individualRow({ year: "2009" }), 1)) }), /expected 2008/);
  await assert.rejects(fetchEttuArchiveResults(config, { fetchImpl: async (url) => {
    const start = Number(new URL(url).searchParams.get("limitstart14"));
    return response(page(start === 0 ? individualRow() : "", 101));
  } }), /pagination stopped/);
  await assert.rejects(fetchEttuArchiveResults(config, { fetchImpl: async () => response(page(individualRow() + individualRow(), 2)) }), /duplicate row id/);
  assert.throws(() => parseGames("11:9 12:11"), /invalid game score/);
  assert.deepEqual(parseRows("<tr id='list_14_com_fabrik_14_row_1'></tr>", 14, []), [{ id: "1", cells: {}, detailHref: null }]);
});

test("requires verified event metadata and rejects a bad archive year menu", async () => {
  const invalid = await fetchEttuArchiveEvents([{ ...config, eventName: "" }]);
  assert.equal(invalid.errors[0].error.includes("eventName is required"), true);
  assert.throws(() => parseYears("<html><select></select></html>", "singles"), /year filter/);
});

test("validates declared game wins and continues processing later configured events after errors", async () => {
  const resultBad = await fetchEttuArchiveResults(config, {
    fetchImpl: async () => response(page(individualRow({ games: "11:9 11:9 11:9" }), 1)),
  });
  assert.equal(resultBad.length, 0);
  assert.match(resultBad.errors[0].error, /disagree with declared result/);
  assert.deepEqual(resultBad.errors[0].players, { left: ["BERARDI Mattia (SMR)"], right: ["DUBROVIN Veniamin (MDA)"] });
  assert.equal(resultBad.errors[0].declaredSetScore, "2-4");
  assert.equal(resultBad.errors[0].officialStatus, "-");
  assert.equal(({ ...resultBad }).counts.rejected, 1);

  const events = await fetchEttuArchiveEvents([
    { ...config, year: "2008" },
    { ...config, eventId: "event-2009", year: "2009" },
  ], {
    fetchImpl: async (url) => {
      const year = new URL(url).searchParams.get("vw_ec_indv___yr[value]");
      return response(page(year === "2008" ? individualRow() : individualRow({ year: "2008" }), 1));
    },
  });
  assert.equal(events.results.length, 2);
  assert.equal(events.results[0].matches.length, 1);
  assert.equal(events.results[1].matches.length, 0);
  assert.equal(events.errors.length, 1);
  assert.equal(events.errors[0].year, "2009");
});

test("keeps an official retirement and its partial final score without treating it as a completed game", () => {
  const retirement = individualRow({ games: "11:7 9:11 2:3" }).replace('<td class="vw_ec_indv___wo">-</td>', '<td class="vw_ec_indv___wo">RET</td>');
  const records = require("../ettu_archive_results").normalizeIndividualRow(
    { id: "ret-1", cells: parseRows(retirement, 14, [])[0].cells },
    config,
  );
  assert.equal(records.resultStatus, "RET");
  assert.deepEqual(records.gameScores, ["11-7", "9-11"]);
  assert.deepEqual(records.partialGameScores, ["2-3"]);
});

test("removes placeholder scores for explicit walkovers and preserves the declared winner orientation", () => {
  const woRow = individualRow({ games: "0:11 0:11 0:11 : :" }).replace('<td class="vw_ec_indv___wo">-</td>', '<td class="vw_ec_indv___wo">W/O</td>');
  const record = require("../ettu_archive_results").normalizeIndividualRow(
    { id: "wo-1", cells: parseRows(woRow, 14, [])[0].cells },
    config,
  );
  assert.equal(record.resultStatus, "WO");
  assert.equal(record.overallScore, "L-W");
  assert.deepEqual(record.gameScores, []);
  assert.equal(record.competitors[0].irm, "WO");
  assert.equal(record.competitors[1].irm, null);
});

test("canonicalizes ETTU knockout round abbreviations", () => {
  const { normalizeRound } = require("../ettu_archive_results");
  for (const [code, key] of [["R256", "round_of_256"], ["R128", "round_of_128"], ["R64", "round_of_64"], ["R32", "round_of_32"], ["R16", "round_of_16"], ["QF", "quarterfinal"], ["SF", "semifinal"], ["F", "final"]]) {
    assert.equal(normalizeRound(code).roundKey, key);
  }
});
