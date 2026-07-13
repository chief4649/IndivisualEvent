"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function readText(filePath, fallback = "") {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return fallback; }
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(readText(filePath)); } catch { return fallback; }
}

function run(cmd, args, cwd, fallback = "") {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 20 * 1024 * 1024,
    }).trim();
  } catch {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${content.trimEnd()}\n`, "utf8");
}

function listFiles(root, options = {}) {
  const {
    maxDepth = 4,
    ignore = new Set([".git", "node_modules", ".DS_Store"]),
    includeDirs = false,
  } = options;
  const out = [];

  function walk(current, depth) {
    if (depth > maxDepth || !fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignore.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (includeDirs) out.push(`${rel}/`);
        walk(full, depth + 1);
      } else {
        out.push(rel);
      }
    }
  }

  walk(root, 0);
  return out.sort();
}

function mdTable(headers, rows) {
  if (!rows.length) return "該当なし";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((v) => String(v).replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

function replaceManagedSection(existing, name, content) {
  const start = `<!-- AUTO:${name}:START -->`;
  const end = `<!-- AUTO:${name}:END -->`;
  const block = `${start}\n${content.trim()}\n${end}`;
  const i = existing.indexOf(start);
  const j = existing.indexOf(end);
  if (i !== -1 && j !== -1 && j > i) {
    return `${existing.slice(0, i)}${block}${existing.slice(j + end.length)}`;
  }
  return `${existing.trimEnd()}\n\n${block}\n`;
}

function updateManagedFile(filePath, defaultContent, sections) {
  let text = fs.existsSync(filePath) ? readText(filePath) : defaultContent;
  for (const [name, content] of Object.entries(sections)) {
    text = replaceManagedSection(text, name, content);
  }
  writeText(filePath, text);
}

module.exports = {
  readText,
  readJson,
  run,
  writeText,
  listFiles,
  mdTable,
  updateManagedFile,
};
