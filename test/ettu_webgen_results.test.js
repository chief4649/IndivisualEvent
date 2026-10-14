"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { fetchEttuWebgenResults } = require("../ettu_webgen_results");

const config = {
  eventId: "ec2023", eventName: "2023 European Championships",
  startDate: "2023-09-10", endDate: "2023-09-17",
  baseUrl: "https://www.ttm.co.at/results/ec2023/",
};

function side(sideName, player, assoc, winner = false) {
  return `<div class="${sideName}${winner ? " winner" : ""}"><div class="player"><span class="plnr">${player}</span><span class="name">Player ${player}</span><span class="assoc">${assoc}</span></div></div>`;
}

function scoredChild(id, leftId, rightId, winner = "left") {
  return `<tr class="individual collapse" data-webgen-match="${id}"><td class="name" colspan="7">${side("left", leftId, "AUT", winner === "left")}${side("right", rightId, "GER", winner === "right")}</td><td class="result"><div class="left">3</div><div class="right">0</div></td><td class="game"><div class="left winner">11</div><div class="right">8</div></td><td class="game"><div class="left winner">11</div><div class="right">9</div></td><td class="game"><div class="left winner">11</div><div class="right">7</div></td></tr>`;
}

function teamPage({ parentScore = "3-0", children = null } = {}) {
  const nested = children || [scoredChild("42", "1", "4"), scoredChild("42", "2", "5"), scoredChild("42", "3", "6")];
  const [left, right] = parentScore.split("-");
  const leftWon = Number(left) > Number(right);
  return `<table><tbody><tr class="header"><th><span class="event">MT</span><span class="group">Group A</span><span class="round" data-i18n="rr.format.short.round" data-i18n-options='{"round":"1"}'></span><span class="mttable" data-i18n-options='{"table":"2"}'></span></th></tr><tr class="match" data-bs-toggle="collapse" data-bs-target="[data-webgen-match=&quot;42&quot;]"><td class="name"><div class="left${leftWon ? " winner" : ""}"><div class="team"><span class="teamname name">Austria</span><span class="assoc">AUT</span></div></div><div class="right${leftWon ? "" : " winner"}"><div class="team"><span class="teamname name">Germany</span><span class="assoc">GER</span></div></div></td><td class="result"><div class="left">${left}</div><div class="right">${right}</div></td><td class="game" colspan="7"><br></td></tr>${nested.join("")}</tbody></table>`;
}

function individualPage(row) {
  return `<table><tbody><tr class="header"><th><span class="event">MS</span><span class="group">Main Draw</span><span class="round" data-i18n="ko.format.short.final"></span></th></tr>${row}</tbody></table>`;
}

function htmlFetch(pages, requests = []) {
  return async (url, init) => {
    requests.push({ url: String(url), init });
    const key = new URL(url).pathname.split("/").at(-1);
    if (!(key in pages)) throw new Error(`Unexpected URL ${url}`);
    return { ok: true, status: 200, text: async () => pages[key] };
  };
}

function pages(dateHtml, datePageHtml = teamPage()) {
  return {
    "events.html": '<a href="MT.html"><span>Men\'s Teams</span></a><a href="MS.html"><span>Men Singles</span></a>',
    "dates.html": dateHtml,
    "2023-09-10.html": datePageHtml,
  };
}

test("normalizes team parents with completed nested singles, stable Webgen identity, and raw provenance", async () => {
  const raw = pages('<a href="2023-09-10.html">Date</a>');
  const requests = [];
  const result = await fetchEttuWebgenResults(config, { fetchImpl: htmlFetch(raw, requests), timeoutMs: 1234 });
  assert.equal(result.matches.length, 1);
  const [team] = result.matches;
  assert.equal(team.matchType, "team");
  assert.equal(team.id, "ec2023-2023-09-10-webgen-42");
  assert.equal(team.overallScore, "3-0");
  assert.deepEqual(team.teams.map((entry) => entry.orgCode), ["AUT", "GER"]);
  assert.equal(team.singles.length, 3);
  assert.deepEqual(team.singles[0].gameScores, ["11-8", "11-9", "11-7"]);
  assert.equal(team.singles[0].categoryName, "Men Singles");
  assert.equal(team.singles[0].competitors[0].id, "WEBGEN:EC2023:1");
  assert.equal(team.singles[0].recordSource, "webgen");
  assert.equal(team.recordSource, "webgen");
  assert.equal(team.source, "wtt");
  assert.equal(result.rawPages.datePages[0].html, raw["2023-09-10.html"]);
  assert.equal(result.counts.teams, 1);
  assert.equal(result.counts.skippedUnplayedChildren, 0);
  assert(requests.every(({ init }) => init.signal instanceof AbortSignal));
  assert.deepEqual(requests.map(({ url }) => new URL(url).pathname.split("/").at(-1)), ["events.html", "dates.html", "2023-09-10.html"]);
});

test("skips unplayed child rows without shifting later child identities", async () => {
  const children = [
    scoredChild("42", "1", "4"),
    '<tr class="individual collapse" data-webgen-match="42"><td class="result"><div class="left"></div><div class="right"></div></td></tr>',
    scoredChild("42", "3", "6"),
    scoredChild("42", "7", "8"),
  ];
  const result = await fetchEttuWebgenResults(config, { fetchImpl: htmlFetch(pages('<a href="2023-09-10.html">Date</a>', teamPage({ children }))) });
  assert.equal(result.matches[0].singles.length, 3);
  assert.deepEqual(result.matches[0].singles.map((entry) => entry.documentCode), [
    "WEBGEN-ec2023-2023-09-10-42-S1", "WEBGEN-ec2023-2023-09-10-42-S3", "WEBGEN-ec2023-2023-09-10-42-S4",
  ]);
  assert.equal(result.counts.skippedUnplayedChildren, 1);
});

test("normalizes individual matches and preserves walkover winner orientation", async () => {
  const regular = `<tr class="match"><td class="name">${side("left", "10", "AUT")}${side("right", "11", "GER", true)}</td><td class="result"><div class="left">1</div><div class="right">3</div></td><td class="game"><div class="left">8</div><div class="right winner">11</div></td><td class="game"><div class="left winner">11</div><div class="right">8</div></td><td class="game"><div class="left">9</div><div class="right winner">11</div></td><td class="game"><div class="left">7</div><div class="right winner">11</div></td></tr>`;
  const walkover = `<tr class="match"><td class="name">${side("left", "12", "AUT", true)}${side("right", "13", "GER")}</td><td class="result"><div class="left"></div><div class="right"></div></td><td class="game">W/O</td></tr>`;
  const reverseWalkover = `<tr class="match"><td class="name">${side("left", "14", "AUT")}${side("right", "15", "GER", true)}</td><td class="result"><div class="left"></div><div class="right"></div></td><td class="game">W/O</td></tr>`;
  const unplayed = '<tr class="match"><td class="name"></td><td class="result"><div class="left"></div><div class="right"></div></td></tr>';
  const html = individualPage(unplayed + regular + walkover + reverseWalkover);
  const result = await fetchEttuWebgenResults(config, { fetchImpl: htmlFetch(pages('<a href="2023-09-10.html">Date</a>', html)) });
  assert.equal(result.matches.length, 3);
  assert.equal(result.matches[0].overallScore, "1-3");
  assert.equal(result.matches[0].id, "ec2023-2023-09-10-row-2");
  assert.equal(result.matches[1].overallScore, "W-L");
  assert.equal(result.matches[1].id, "ec2023-2023-09-10-row-3");
  assert.equal(result.matches[1].resultStatus, "WO");
  assert.equal(result.matches[2].overallScore, "L-W");
});

test("preserves injury retirements and source-verified missing-player walkovers without inventing players", async () => {
  const injury = `<tr class="match"><td class="name">${side("left", "192", "DEN")}${side("right", "137", "GER", true)}</td><td class="result"><div class="left">0</div><div class="right">4</div></td><td class="game" colspan="7">Inj.</td></tr>`;
  const injuryResult = await fetchEttuWebgenResults(config, { fetchImpl: htmlFetch(pages('<a href="2023-09-10.html">Date</a>', individualPage(injury))) });
  const retired = injuryResult.matches[0];
  assert.equal(retired.overallScore, "0-4");
  assert.equal(retired.resultStatus, "RET");
  assert.deepEqual(retired.gameScores, []);
  assert.equal(retired.competitors[0].irm, "RET");

  const disqualified = `<tr class="match"><td class="name">${side("left", "20", "AUT")}${side("right", "21", "GER", true)}</td><td class="result"><div class="left">1</div><div class="right">4</div></td><td class="game"><div class="left">5</div><div class="right">2</div></td><td class="game" colspan="6">Disqu.</td></tr>`;
  const dqResult = await fetchEttuWebgenResults(config, { fetchImpl: htmlFetch(pages('<a href="2023-09-10.html">Date</a>', individualPage(disqualified))) });
  assert.equal(dqResult.matches[0].resultStatus, "DQ");
  assert.equal(dqResult.matches[0].overallScore, "1-4");
  assert.deepEqual(dqResult.matches[0].gameScores, ["5-2"]);
  assert.deepEqual(dqResult.matches[0].partialPoints, [{ gameNumber: 1, left: 5, right: 2 }]);
  assert.equal(dqResult.matches[0].competitors[0].irm, "DQ");

  const rightWinner = (leftId, rightId) => `<tr class="individual collapse" data-webgen-match="42"><td class="name"><div class="left"><div class="player"><span class="plnr">${leftId}</span><span class="name">Left ${leftId}</span><span class="assoc">AUT</span></div></div><div class="right winner"><div class="player"><span class="plnr">${rightId}</span><span class="name">Right ${rightId}</span><span class="assoc">GER</span></div></div><td class="result"><div class="left">0</div><div class="right">3</div></td><td class="game"><div class="left">8</div><div class="right winner">11</div></td><td class="game"><div class="left">9</div><div class="right winner">11</div></td><td class="game"><div class="left">7</div><div class="right winner">11</div></td></tr>`;
  const missingLeft = `<tr class="individual collapse" data-webgen-match="42"><td class="name"><div class="left"><br></div><div class="right winner"><div class="player"><span class="plnr">15</span><span class="name">Winner</span><span class="assoc">GER</span></div></div><td class="result"><div class="left">0</div><div class="right">3</div></td><td class="game"><div class="left">0</div><div class="right winner">11</div></td><td class="game"><div class="left">0</div><div class="right winner">11</div></td><td class="game"><div class="left">0</div><div class="right winner">11</div></td></tr>`;
  const unplayedZero = '<tr class="individual collapse" data-webgen-match="42"><td class="name"><div class="left"><br></div><div class="right"><br></div><td class="result"><div class="left">0</div><div class="right">0</div></td><td class="game empty"><br></td></tr>';
  const teamHtml = teamPage({ parentScore: "0-3", children: [rightWinner("1", "4"), rightWinner("2", "5"), missingLeft, unplayedZero] });
  const result = await fetchEttuWebgenResults({ ...config, eventId: "ETTU2023T" }, { fetchImpl: htmlFetch(pages('<a href="2023-09-10.html">Date</a>', teamHtml)) });
  const team = result.matches[0];
  assert.equal(team.singles.length, 3);
  assert.deepEqual(team.singles[2].competitors.map((competitor) => competitor?.name || null), [null, "Winner"]);
  assert.equal(team.singles[2].overallScore, "0-3");
  assert.equal(team.singles[2].resultStatus, "WO");
  assert.deepEqual(team.singles[2].gameScores, ["0-11", "0-11", "0-11"]);
  assert.equal(team.singles[2].participantDetailMissing, true);
  assert.deepEqual(result.sourceWarnings.map((warning) => warning.documentCode), [team.singles[2].documentCode]);
  const { normalizePreNormalizedMatch } = require("../extract_individual_matches");
  for (const missing of [null, { players: [] }]) {
    const archive = structuredClone(team);
    archive.singles[2].competitors[0] = missing;
    const normalized = normalizePreNormalizedMatch(archive);
    assert.deepEqual(normalized.singles[2].competitors, archive.singles[2].competitors);
    assert.equal(normalized.singles[2].categoryName, "Men Singles");
    assert.equal(normalized.singles[2].participantDetailMissing, true);
    assert.equal(normalized.singles[2].overallScore, "0-3");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webgen-slim-singles-"));
  try {
    const rawDir = path.join(dir, "wtt-records");
    const slimDir = path.join(dir, "wtt-records-slim");
    fs.mkdirSync(rawDir);
    fs.writeFileSync(path.join(rawDir, "ETTU2023T.json"), JSON.stringify([team]));
    execFileSync(process.execPath, [path.join(__dirname, "../build_wtt_slim_records.js")], {
      env: { ...process.env, WTT_RECORDS_DIR: rawDir, ITTF_RECORDS_DIR: path.join(dir, "ittf"),
        WTT_SLIM_RECORDS_DIR: slimDir, ITTF_SLIM_RECORDS_DIR: path.join(dir, "ittf-slim") },
      stdio: "pipe",
    });
    const [slim] = JSON.parse(fs.readFileSync(path.join(slimDir, "ETTU2023T.json")));
    const normalized = normalizePreNormalizedMatch(slim);
    const child = normalized.singles[2];
    assert.equal(child.discipline, "singles");
    assert.equal(child.categoryName, "Men Singles");
    assert.equal(child.participantDetailMissing, true);
    assert.deepEqual(child.competitors.map((side) => side?.name || ""), ["", "Winner"]);
    assert.equal(child.overallScore, "0-3");
    assert.deepEqual(child.gameScores, ["0-11", "0-11", "0-11"]);
    execFileSync(process.execPath, ["-r", "./runtime_legacy_ittf_patch.js", "server.js",
      "--build-player-record-event-index", "--event", "ETTU2023T", "--force"], {
      cwd: path.join(__dirname, ".."), env: { ...process.env, DATA_DIR: dir, SKIP_RUNTIME_ARCHIVE_SYNC: "1" },
      stdio: "pipe",
    });
    const { verifyDerivedRecords } = require("../import_ettu_history");
    assert.equal(verifyDerivedRecords(dir, "ETTU2023T", [team]).verifiedMatchCount, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(result.counts.skippedUnplayedChildren, 1);
});

test("allows an official team walkover with no individual detail rows", async () => {
  const html = `<table><tbody><tr class="header"><th><span class="event">MT</span><span class="group">Group A</span></th></tr><tr class="match" data-bs-target="[data-webgen-match=&quot;73&quot;]"><td class="name"><div class="left"><div class="team"><span class="teamname name">Austria</span><span class="assoc">AUT</span></div></div><div class="right winner"><div class="team"><span class="teamname name">Germany</span><span class="assoc">GER</span></div></div></td><td class="result"><div class="left"></div><div class="right"></div></td><td class="game" colspan="7">W/O</td></tr></tbody></table>`;
  const result = await fetchEttuWebgenResults(config, { fetchImpl: htmlFetch(pages('<a href="2023-09-10.html">Date</a>', html)) });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].matchType, "team");
  assert.equal(result.matches[0].overallScore, "L-W");
  assert.equal(result.matches[0].resultStatus, "WO");
  assert.deepEqual(result.matches[0].singles, []);
});

test("calls onPage in fetch order before parsing so source pages can be checkpointed on parser errors", async () => {
  const observed = [];
  const malformed = pages('<a href="2023-09-10.html">Date</a>', '<tbody><tr class="header"><th><span class="event">UNKNOWN</span></th></tr></tbody>');
  await assert.rejects(fetchEttuWebgenResults(config, {
    fetchImpl: htmlFetch(malformed),
    onPage: async (page) => observed.push({ name: new URL(page.url).pathname.split("/").at(-1), html: page.html }),
  }), /unknown event code/);
  assert.deepEqual(observed.map((page) => page.name), ["events.html", "dates.html", "2023-09-10.html"]);
  assert.equal(observed[2].html, '<tbody><tr class="header"><th><span class="event">UNKNOWN</span></th></tr></tbody>');
});

test("can stream full source pages to onPage without retaining them in the result", async () => {
  const raw = pages('<a href="2023-09-10.html">Date</a>');
  const observed = [];
  const result = await fetchEttuWebgenResults(config, {
    fetchImpl: htmlFetch(raw),
    retainRawPages: false,
    onPage: async (page) => observed.push(page),
  });
  assert.deepEqual(result.rawPages, { eventsHtml: "", datesHtml: "", datePages: [] });
  assert.deepEqual(observed.map((page) => new URL(page.url).pathname.split("/").at(-1)), [
    "events.html", "dates.html", "2023-09-10.html",
  ]);
  assert.deepEqual(observed.map((page) => page.html), [raw["events.html"], raw["dates.html"], raw["2023-09-10.html"]]);
  assert.equal(result.matches.length, 1);
});

test("namespaces Webgen player numbers by event to prevent cross-year ID collisions", async () => {
  const match = `<tr class="match"><td class="name">${side("left", "192", "DEN")}${side("right", "137", "GER", true)}</td><td class="result"><div class="left">0</div><div class="right">3</div></td><td class="game"><div class="left">8</div><div class="right winner">11</div></td><td class="game"><div class="left">8</div><div class="right winner">11</div></td><td class="game"><div class="left">8</div><div class="right winner">11</div></td></tr>`;
  const html = individualPage(match);
  const current = await fetchEttuWebgenResults(config, { fetchImpl: htmlFetch(pages('<a href="2023-09-10.html">Date</a>', html)) });
  const prior = await fetchEttuWebgenResults({ ...config, eventId: "ec2022" }, { fetchImpl: htmlFetch(pages('<a href="2023-09-10.html">Date</a>', html)) });
  const currentId = current.matches[0].competitors[0].players[0].id;
  const priorId = prior.matches[0].competitors[0].players[0].id;
  assert.equal(currentId, "WEBGEN:EC2023:192");
  assert.equal(priorId, "WEBGEN:EC2022:192");
  assert.notEqual(currentId, priorId);
  assert.match(current.rawPages.datePages[0].html, /<span class="plnr">192<\/span>/);
});

test("validates source match dates separately from unchanged event calendar metadata", async () => {
  const date = "2023-03-29";
  const historyConfig = {
    ...config, startDate: "2022-10-01", endDate: "2023-02-15",
    matchEndDate: "2023-03-29",
  };
  const rawPages = pages(`<a href="${date}.html">Date</a>`);
  rawPages[`${date}.html`] = teamPage();
  const result = await fetchEttuWebgenResults(historyConfig, { fetchImpl: htmlFetch(rawPages) });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].startDateLocal, date);
  assert.equal(result.matches[0].recordStartDate, "2022-10-01");
  assert.equal(result.matches[0].recordEndDate, "2023-02-15");
  await assert.rejects(fetchEttuWebgenResults({ ...historyConfig, matchStartDate: "2023-03-30" }, { fetchImpl: htmlFetch(rawPages) }), /source match date range must be valid/);

  const beyondWindow = pages('<a href="2023-03-30.html">Date</a>');
  beyondWindow["2023-03-30.html"] = teamPage();
  await assert.rejects(fetchEttuWebgenResults(historyConfig, { fetchImpl: htmlFetch(beyondWindow) }), /outside source match dates/);
});

test("rejects out-of-event dates, empty date lists, invalid score details, and team-total mismatches", async () => {
  await assert.rejects(fetchEttuWebgenResults(config, { fetchImpl: htmlFetch(pages('<a href="2023-09-18.html">Date</a>')) }), /outside source match dates/);
  await assert.rejects(fetchEttuWebgenResults(config, { fetchImpl: htmlFetch(pages('<a href="2023-09-31.html">Date</a>')) }), /invalid date link/);
  await assert.rejects(fetchEttuWebgenResults(config, { fetchImpl: htmlFetch(pages("")) }), /no date links/);
  const malformed = `<tr class="match"><td class="name">${side("left", "1", "AUT")}${side("right", "2", "GER")}</td><td class="result"><div class="left">3</div><div class="right">0</div></td><td class="game empty"><br></td></tr>`;
  await assert.rejects(fetchEttuWebgenResults(config, { fetchImpl: htmlFetch(pages('<a href="2023-09-10.html">Date</a>', individualPage(malformed))) }), /no valid game details/);
  await assert.rejects(fetchEttuWebgenResults(config, { fetchImpl: htmlFetch(pages('<a href="2023-09-10.html">Date</a>', teamPage({ parentScore: "3-1" }))) }), /disagrees with completed singles/);
});
