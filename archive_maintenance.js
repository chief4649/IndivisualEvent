"use strict";

const fs = require("fs");
const path = require("path");

function getEttuHistoryImportPid(dataDir, options = {}) {
  const files = options.fs || fs;
  const probe = options.probe || ((pid) => process.kill(pid, 0));
  try {
    const text = files.readFileSync(path.join(dataDir, "ettu-history-import.lock"), "utf8").trim();
    if (!/^\d+$/.test(text)) return null;
    const pid = Number(text);
    if (!Number.isSafeInteger(pid) || pid <= 1) return null;
    probe(pid);
    if (files.existsSync("/proc")) {
      const args = files.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
      if (!args.some((arg) => path.basename(arg) === "import_ettu_history.js")) return null;
    }
    return pid;
  } catch {
    return null;
  }
}

module.exports = { getEttuHistoryImportPid };
