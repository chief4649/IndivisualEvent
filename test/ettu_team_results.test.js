"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchEttuTeamOfficialResults } = require("../ettu_team_results");

const config = {
  eventId: "ETTU2025T",
  eventName: "2025 European Team Championships",
  startDate: "2025-10-12",
  endDate: "2025-10-19",
  recordEventId: 71,
  recordUrl: "https://www.ettu.tv/events/71/50/2/5/5",
};

const categories = [
  { id: 297, event_id: 71, category_description: "Men's Teams" },
  { id: 298, event_id: 71, category_description: "Women's Teams" },
];
const stages = [
  { id: 1184, event_category_id: 297, format_id: 1, name: "Group Stage", is_published: true },
  { id: 1199, event_category_id: 298, format_id: 2, name: "Main Draw", is_published: true },
];

function team(id, name, abbr, setsWon) {
  return {
    participant_id: id,
    participant_name: name,
    sets_won: setsWon,
    selected_parents: [{ parent_role: "Member Association", parent_name: name, parent_abbr: abbr }],
    participant_details: [{ name: "Roster player", meta_data: { dob: "1990-01-01", email: "private@example.test" } }],
  };
}

function tableParticipant(teamId, teamName, abbr, player, licenseId, points, setsWon) {
  return {
    participant_id: teamId,
    participant_name: teamName,
    points,
    sets_won: setsWon,
    participant_details: [{ name: player, meta_data: { license_id: licenseId, dob: "1990-01-01", email: "private@example.test" } }],
    selected_parents: [{ parent_role: "Member Association", parent_name: teamName, parent_abbr: abbr }],
  };
}

function table(id, order, status, winner, a, b) {
  return {
    id,
    order,
    status,
    winner,
    participants: [a, b],
  };
}

function makeData(overrides = {}) {
  const groupTeams = [team(101, "Sweden", "SWE", 3), team(102, "Türkiye", "TUR", 1)];
  const groupChildren = [
    table(2001, 1, "SCORED", 101,
      tableParticipant(101, "Sweden", "SWE", "Player One", "LIC-1", [11, 8, 11, 11, 0], 3),
      tableParticipant(102, "Türkiye", "TUR", "Player Two", "LIC-2", [8, 11, 8, 8, 0], 1)),
    table(2002, 2, "SCORED", 102,
      tableParticipant(101, "Sweden", "SWE", "Player Three", "LIC-3", [9, 11, 8, 8, 0], 1),
      tableParticipant(102, "Türkiye", "TUR", "Player Four", "LIC-4", [11, 8, 11, 11, 0], 3)),
    table(2003, 3, "SCORED", 101,
      tableParticipant(101, "Sweden", "SWE", "Player Five", "LIC-5", [11, 11, 11, 0, 0], 3),
      tableParticipant(102, "Türkiye", "TUR", "Player Six", "LIC-6", [9, 9, 9, 0, 0], 0)),
    table(2004, 4, "SCORED", 101,
      tableParticipant(101, "Sweden", "SWE", "Player Seven", "LIC-7", [11, 11, 11, 0, 0], 3),
      tableParticipant(102, "Türkiye", "TUR", "Player Eight", "LIC-8", [6, 7, 8, 0, 0], 0)),
    table(2005, 5, "NOT_STARTED", null,
      tableParticipant(101, "Sweden", "SWE", "Player One", "LIC-1", [0, 0, 0, 0, 0], 0),
      tableParticipant(102, "Türkiye", "TUR", "Player Two", "LIC-2", [0, 0, 0, 0, 0], 0)),
  ];
  const groupParent = {
    id: 3001,
    status: "SCORED",
    score_published: true,
    winner: 101,
    participants: groupTeams,
    sub_matches: groupChildren,
    start_time: "2025-10-13T10:00:00",
    order: 1,
  };

  const koTeams = [team(201, "Romania", "ROU", 3), team(202, "Germany", "GER", 0)];
  const koChildren = [1, 2, 3].map((order) => table(
    2100 + order,
    order,
    "SCORED",
    201,
    tableParticipant(201, "Romania", "ROU", `Romanian ${order}`, `RO-${order}`, [11, 11, 11, 0, 0], 3),
    tableParticipant(202, "Germany", "GER", `German ${order}`, `DE-${order}`, [8, 8, 8, 0, 0], 0),
  ));
  const koDetail = {
    id: 3101,
    status: "SCORED",
    winner: 201,
    participants: koTeams,
    sub_matches: koChildren,
    start_time: "2025-10-18T16:00:00",
  };
  const koParent = {
    id: 3101,
    match_winner: 201,
    participants: koTeams,
    leg_details: [{ status: "SCORED", score_published: true, start_time: "2025-10-18T16:00:00" }],
  };
  const data = {
    events: [{ id: 71, name: config.eventName, event_start_date: config.startDate, event_end_date: config.endDate }],
    categories,
    stages,
    groups: [{ name: "Group A", matches: [groupParent] }],
    knockout: { main_bracket: [{ round_name: "Final", matches: [koParent] }], position_brackets: [] },
    koDetails: [{ name: "Knockout", matches: [koDetail] }],
  };
  return Object.assign(data, overrides);
}

function fetchFixture(data) {
  return async (url, init) => {
    assert.equal(init.headers.tenant, "ettu");
    assert.equal(init.headers.language, "en");
    assert.ok(init.signal instanceof AbortSignal);
    const parsed = new URL(url);
    let body;
    if (parsed.pathname.endsWith("get_events")) body = { data: data.events };
    else if (parsed.pathname.endsWith("get_events_categories")) body = { data: data.categories };
    else if (parsed.pathname.endsWith("get_stages")) body = { data: data.stages };
    else if (parsed.pathname.endsWith("get_group_matches")) {
      body = Number(parsed.searchParams.get("stage_id")) === 1184 ? { data: data.groups } : { data: data.koDetails };
    } else if (parsed.pathname.endsWith("get_knockout_matches")) body = { data: data.knockout };
    else throw new Error(`unexpected request ${parsed.pathname}`);
    return { ok: true, status: 200, json: async () => body };
  };
}

test("normalizes published team results with played singles and official association/player identities", async () => {
  const result = await fetchEttuTeamOfficialResults(config, { fetchImpl: fetchFixture(makeData()), timeoutMs: 1000 });
  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.counts, {
    publishedStages: 2,
    groupStages: 1,
    knockoutStages: 1,
    parentMatches: 2,
    publishedParentMatches: 2,
    completedParentMatches: 2,
    skippedUnpublished: 0,
    skippedUnplayed: 0,
    playedSubMatches: 7,
    skippedNotStartedSubMatches: 1,
  });

  const group = result.matches.find((match) => match.id === "3001");
  assert.equal(group.matchType, "team");
  assert.equal(group.eventId, "ETTU2025T");
  assert.equal(group.recordEventId, "71");
  assert.equal(group.recordEventName, config.eventName);
  assert.equal(group.recordUrl, config.recordUrl);
  assert.equal(group.categoryName, "Men Teams");
  assert.equal(group.gender, "men");
  assert.equal(group.roundLabel, "Group A");
  assert.equal(group.overallScore, "3-1");
  assert.deepEqual(group.teams.map((entry) => entry.orgCode), ["SWE", "TUR"]);
  assert.equal(group.singles.length, 4);
  assert.equal(group.singles[0].overallScore, "3-1");
  assert.deepEqual(group.singles[0].gameScores, ["11-8", "8-11", "11-8", "11-8"]);
  assert.equal(group.singles[0].competitors[0].players[0].id, "LIC-1");
  assert.equal(group.singles[0].competitors[0].org, "Sweden");

  const knockout = result.matches.find((match) => match.id === "3101");
  assert.equal(knockout.categoryName, "Women Teams");
  assert.equal(knockout.roundKey, "final");
  assert.equal(knockout.overallScore, "3-0");
  assert.equal(knockout.singles.length, 3);
  assert.ok(!JSON.stringify(result).includes("private@example.test"));
  assert.ok(!JSON.stringify(result).includes("dob"));
});

test("fails closed on event identity, missing categories, incomplete KO details, and position brackets", async () => {
  await assert.rejects(fetchEttuTeamOfficialResults(config, {
    fetchImpl: fetchFixture(makeData({ events: [{ id: 71, name: "Wrong event", event_start_date: config.startDate, event_end_date: config.endDate }] })),
  }), /event metadata did not match/);
  await assert.rejects(fetchEttuTeamOfficialResults(config, {
    fetchImpl: fetchFixture(makeData({ categories: categories.slice(0, 1) })),
  }), /missing men's or women's event category/);
  await assert.rejects(fetchEttuTeamOfficialResults(config, {
    fetchImpl: fetchFixture(makeData({ koDetails: [{ name: "Knockout", matches: [] }] })),
  }), /missing detailed sub-match data for KO match 3101/);
  await assert.rejects(fetchEttuTeamOfficialResults(config, {
    fetchImpl: fetchFixture(makeData({ knockout: { main_bracket: [], position_brackets: [{ id: "third-place" }] } })),
  }), /position brackets in stage 1199 are not supported yet/);
});

test("rejects child and parent score inconsistencies and non-member-association identities", async () => {
  const data = makeData();
  data.groups[0].matches[0].sub_matches[0].winner = 102;
  await assert.rejects(fetchEttuTeamOfficialResults(config, { fetchImpl: fetchFixture(data) }), /winner disagrees with game scores/);

  const noAssociation = makeData();
  noAssociation.groups[0].matches[0].participants[0].selected_parents = [{ parent_role: "Club", parent_name: "A club", parent_abbr: "CLB" }];
  await assert.rejects(fetchEttuTeamOfficialResults(config, { fetchImpl: fetchFixture(noAssociation) }), /no Member Association identity/);
});

test("rejects missing license identities, aggregate mismatches, and invalid dates", async () => {
  const missingLicense = makeData();
  delete missingLicense.groups[0].matches[0].sub_matches[0].participants[0].participant_details[0].meta_data.license_id;
  await assert.rejects(fetchEttuTeamOfficialResults(config, { fetchImpl: fetchFixture(missingLicense) }), /incomplete player\/license identity/);

  const aggregateMismatch = makeData();
  aggregateMismatch.groups[0].matches[0].participants[0].sets_won = 4;
  await assert.rejects(fetchEttuTeamOfficialResults(config, { fetchImpl: fetchFixture(aggregateMismatch) }), /team sets_won disagrees with played table matches/);

  const invalidDate = makeData();
  invalidDate.groups[0].matches[0].start_time = "2025-10-20T10:00:00";
  await assert.rejects(fetchEttuTeamOfficialResults(config, { fetchImpl: fetchFixture(invalidDate) }), /outside configured event dates/);
});

test("preserves table and team walkovers without fabricating point scores", async () => {
  const childWalkover = makeData();
  const tableMatch = childWalkover.groups[0].matches[0].sub_matches[3];
  tableMatch.status = "WO";
  tableMatch.participants[0].walkover = true;
  tableMatch.participants.forEach((participant) => { participant.points = [0, 0, 0, 0, 0]; });
  const withTableWalkover = await fetchEttuTeamOfficialResults(config, { fetchImpl: fetchFixture(childWalkover) });
  const woSingle = withTableWalkover.matches.find((match) => match.id === "3001").singles[3];
  assert.equal(woSingle.resultStatus, "WO");
  assert.equal(woSingle.overallScore, "W-L");
  assert.deepEqual(woSingle.gameScores, []);
  assert.equal(woSingle.competitors[1].irm, "WO");

  const teamWalkover = makeData();
  const parent = teamWalkover.groups[0].matches[0];
  parent.status = "WO";
  parent.winner = 101;
  parent.participants[0].walkover = true;
  parent.sub_matches = [];
  const withTeamWalkover = await fetchEttuTeamOfficialResults(config, { fetchImpl: fetchFixture(teamWalkover) });
  const woTeam = withTeamWalkover.matches.find((match) => match.id === "3001");
  assert.equal(woTeam.resultStatus, "WO");
  assert.equal(woTeam.overallScore, "W-L");
  assert.deepEqual(woTeam.singles, []);
});

test("validates config, HTTP failures, and per-request timeouts", async () => {
  await assert.rejects(fetchEttuTeamOfficialResults({ ...config, recordEventId: 72 }, { fetchImpl: fetchFixture(makeData()) }), /recordEventId must be 71/);
  await assert.rejects(fetchEttuTeamOfficialResults(config, { fetchImpl: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
  let signal;
  const fetchImpl = async (...args) => {
    signal = args[1].signal;
    return fetchFixture(makeData())(...args);
  };
  const result = await fetchEttuTeamOfficialResults(config, { fetchImpl, timeoutMs: 4321 });
  assert.equal(result.matches.length, 2);
  assert.equal(signal.aborted, false);
});
