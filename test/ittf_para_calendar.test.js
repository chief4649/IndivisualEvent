"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { execFileSync } = require("node:child_process");
const { normalizeRows, parseCalendarHtml, refreshParaCalendar } = require("../ittf_para_calendar");
const { selectCrawlCandidates, assertParaEventIdentity } = require("../crawl_wtt_archives");

test("para archive refuses old same-number results and missing official source dates", () => {
  const candidate = { eventId: "TTE3258", calendarSource: "https://www.ittf.com/2026-para-table-tennis-calendar/", startDate: "2026-11-13", endDate: "2026-11-19" };
  assert.doesNotThrow(() => assertParaEventIdentity(candidate, candidate));
  assert.throws(() => assertParaEventIdentity(candidate, { startDate: "2018-11-13", endDate: "2018-11-19" }), /para_source_date_mismatch/);
  assert.throws(() => assertParaEventIdentity(candidate, {}), /para_source_date_mismatch/);
});

test("persistent para backlog reserves regular nightly slots but fills unused capacity", () => {
  const para = Array.from({ length: 25 }, (_, i) => ({ eventId: `TTE${i}`, paraBacklog: true }));
  const regular = Array.from({ length: 20 }, (_, i) => ({ eventId: `${i}`, paraBacklog: false }));
  const selected = selectCrawlCandidates([...para, ...regular], { limit: 20 });
  assert.equal(selected.filter((entry) => entry.paraBacklog).length, 5);
  assert.equal(selected.filter((entry) => !entry.paraBacklog).length, 15);
  assert.equal(selectCrawlCandidates(para, { limit: 20 }).length, 20);
  assert.equal(selectCrawlCandidates([...para, ...regular], { limit: 2 }).filter((entry) => entry.paraBacklog).length, 1);
  assert.deepEqual(selectCrawlCandidates([...para, ...regular], { limit: 1 }), [regular[0]]);
});

test("para calendar namespaces IDs and handles cross-month ranges and cancellation", () => {
  const calendar = parseCalendarHtml('<li><a href="https://www.ittf.com/tournament/3431/test/">29 Apr &ndash; 2 May: ITTF World Para Challenger Podgorica 2026 (MNE)</a></li><li>29-31 May: ITTF World Para Future Lagos (NGR) - Cancelled</li><li>16-23 Oct: Asian Para Games Aichi-Nagoya 2026 (JPN)</li>', 2026);
  assert.equal(calendar.events.TTE3431.startDate, "2026-04-29");
  assert.equal(calendar.events.TTE3431.endDate, "2026-05-02");
  assert.equal(calendar.events[3431], undefined);
  assert.equal(calendar.unresolved[0].cancelled, true);
  assert.equal(calendar.unresolved[1].reason, "no-official-result-id");
});

test("rejects malformed dates, foreign links and empty challenge pages", () => {
  assert.throws(() => normalizeRows([{ text: "31-32 Feb: Para 2026", href: "https://www.ittf.com/tournament/1/test/" }], 2026));
  assert.throws(() => normalizeRows([{ text: "1-2 Feb: Para 2026", href: "https://other.com/tournament/1/test/" }], 2026));
  assert.throws(() => parseCalendarHtml("<html>Just a moment...</html>", 2026));
  assert.throws(() => normalizeRows([{ text: "1-2 Feb ITTF World Para Future 2026", href: "https://www.ittf.com/tournament/1/test/" }], 2026));
  assert.throws(() => normalizeRows([{ text: "1-2 Feb: ITTF World Para Future 2025", href: "https://www.ittf.com/tournament/1/test/" }], 2026));
});

test("blocked refresh keeps verified catalog, numeric IDs and archives unchanged and reports failure", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "para-calendar-"));
  try {
    fs.writeFileSync(path.join(dir, "wtt-date-index.json"), JSON.stringify({ 3447: { eventName: "WTT event", archived: true } }));
    const status = await refreshParaCalendar(dir, { year: 2026, fetch: async () => new Response("blocked", { status: 403 }) });
    assert.match(status.refreshError, /403/);
    assert.equal(Object.keys(status.events).length, 24);
    const dates = JSON.parse(fs.readFileSync(path.join(dir, "wtt-date-index.json")));
    assert.deepEqual(dates[3447], { eventName: "WTT event", archived: true });
    assert.equal(dates.TTE3447.startDate, "2026-09-12");
    assert.equal(status.verifiedAt, require("../ittf-para-calendar.json").verifiedAt);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolves only independently verified linkless events without guessing Asian Para Games IDs", () => {
  const catalog = normalizeRows([
    { text: "5-9 Jul: Parasuramerican Games 2026, Valledupar (COL)" },
    { text: "16-23 Oct: Asian Para Games Aichi-Nagoya 2026 (JPN)" },
  ], 2026);
  assert.equal(catalog.events.TTE3439.event, "TTE3439");
  assert.equal(catalog.events.TTE3439.endDate, "2026-07-09");
  assert.equal(catalog.events.TTE3439.resultEndDate, "2026-07-07");
  assert.equal(catalog.events.TTE3439.calendarEndDate, "2026-07-09");
  assert.doesNotThrow(() => assertParaEventIdentity(catalog.events.TTE3439, { startDate: "2026-07-05", endDate: "2026-07-07" }));
  assert.equal(catalog.unresolved.length, 1);
  assert.match(catalog.unresolved[0].eventName, /Asian Para Games/);
  const linked = normalizeRows([{ text: "5-9 Jul: Parasuramerican Games 2026, Valledupar (COL)", href: "https://www.ittf.com/tournament/9999/test/" }], 2026);
  assert.ok(linked.events.TTE9999);
  assert.equal(linked.events.TTE3439, undefined);
});

test("nightly backlog includes old missing para events but excludes cancelled and future events", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "para-backlog-"));
  try {
    const base = { source: "ittf", calendarSource: "https://www.ittf.com/2026-para-table-tennis-calendar/" };
    fs.writeFileSync(path.join(dir, "wtt-date-index.json"), JSON.stringify({
      TTE3418: { ...base, eventName: "Para Gold Coast 2026", startDate: "2026-02-16", endDate: "2026-02-18" },
      TTE3425: { ...base, eventName: "Para Cancelled 2026", startDate: "2026-02-16", endDate: "2026-02-18", cancelled: true },
      TTE9000: { ...base, eventName: "Para Future 2099", startDate: "2099-02-16", endDate: "2099-02-18" },
    }));
    const script = 'const c=require("./crawl_wtt_archives");console.log(JSON.stringify(c.buildCandidates(c.parseArgs(["--from","2026-08","--to","2026-11","--include-para-backlog"])).map(x=>x.eventId)))';
    const output = execFileSync(process.execPath, ["-e", script], { cwd: path.join(__dirname, ".."), env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
    assert.deepEqual(JSON.parse(output), ["TTE3418"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
