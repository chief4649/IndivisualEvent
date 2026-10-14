"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function loadEventUrlResolver() {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const urlsStart = source.indexOf("const WTT_EVENT_PUBLIC_URLS = {");
  const urlsEnd = source.indexOf("\n};", urlsStart) + 3;
  const resolverStart = source.indexOf("function getWttEventUrl(");
  const resolverEnd = source.indexOf("\n}\n\nfunction getStoredWttEventRecordType", resolverStart) + 2;
  assert.ok(urlsStart >= 0 && urlsEnd > urlsStart, "WTT public URL constant is present");
  assert.ok(resolverStart >= 0 && resolverEnd > resolverStart, "WTT event URL resolver is present");

  const context = {
    URL,
    Date,
    encodeURIComponent,
    getParaCalendar: () => ({ events: {} }),
    getStoredArchivedEventIds: () => new Set(),
    WTT_EVENT_ITTF_RESULT_IDS: {},
    getStoredWttEventRecordType: () => "",
    getStoredWttIndexedName: () => "",
    isWttTeamEventName: () => false,
    isWttHostedEventName: () => true,
    isIttfResultsPreferredEventName: () => false,
    getEventUrl: () => "https://www.worldtabletennis.com/",
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(urlsStart, urlsEnd)}\n${source.slice(resolverStart, resolverEnd)}`, context);
  return context.getWttEventUrl;
}

test("WTT event 5440 uses its ETTU public URL without changing TTE5440 or 5449", () => {
  const getWttEventUrl = loadEventUrlResolver();

  assert.equal(getWttEventUrl("5440", "wtt"), "https://www.ettu.tv/events/167/4/1/5/5");
  assert.equal(
    getWttEventUrl("TTE5440", "ittf"),
    "https://results.ittf.com/ittf-web-results/html/TTE5440/results.html#/results",
  );
  assert.equal(
    getWttEventUrl("5449", "wtt"),
    "https://results.santafe2026.org/#/discipline/TTE/results",
  );
});
