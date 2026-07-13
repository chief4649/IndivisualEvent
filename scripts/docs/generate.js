"use strict";

const fs = require("fs");
const path = require("path");
const {
  readText,
  readJson,
  run,
  writeText,
  listFiles,
  mdTable,
  updateManagedFile,
} = require("./lib/utils");

const ROOT = path.resolve(__dirname, "../..");
const pkg = readJson(path.join(ROOT, "package.json"), {});
const now = new Date().toISOString();

function git(args, fallback = "不明") {
  return run("git", args, ROOT, fallback);
}

function scriptRows() {
  return Object.entries(pkg.scripts || {}).map(([name, command]) => [
    name === "start" ? "`npm start`" : `\`npm run ${name}\``,
    `\`${command}\``,
  ]);
}

function topLevelStructure() {
  const files = listFiles(ROOT, { maxDepth: 1, includeDirs: true });
  return files.map((f) => `- \`${f}\``).join("\n") || "- 該当なし";
}

function detectRoutes() {
  const serverPath = path.join(ROOT, "server.js");
  if (!fs.existsSync(serverPath)) return [];
  const text = readText(serverPath);
  const routes = [];
  const re = /\b(?:app|router)\.(get|post|put|patch|delete|options|head|use)\s*\(\s*(["'`])([^"'`]+)\2/g;
  let match;
  while ((match = re.exec(text))) routes.push([match[1].toUpperCase(), match[3], "server.js"]);
  return routes;
}

function jsonKind(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function inferSchema(value, depth = 0) {
  if (depth > 5) return { type: jsonKind(value) };
  if (Array.isArray(value)) {
    const samples = value.slice(0, 20);
    const types = [...new Set(samples.map(jsonKind))];
    return {
      type: "array",
      lengthSample: value.length,
      itemTypes: types,
      items: samples.length ? inferSchema(samples[0], depth + 1) : null,
    };
  }
  if (value && typeof value === "object") {
    const properties = {};
    for (const [key, child] of Object.entries(value).slice(0, 100)) {
      properties[key] = inferSchema(child, depth + 1);
    }
    return { type: "object", properties };
  }
  return { type: typeof value, example: value };
}

function schemaToMarkdown(schema, level = 0, name = "root") {
  const rows = [];
  function walk(node, key, pathParts) {
    const p = pathParts.join(".");
    let detail = "";
    if (node.type === "array") detail = `sample length: ${node.lengthSample ?? 0}; item types: ${(node.itemTypes || []).join(", ")}`;
    else if (Object.prototype.hasOwnProperty.call(node, "example")) detail = `example: ${JSON.stringify(node.example).slice(0, 100)}`;
    rows.push([`\`${p || key}\``, node.type, detail]);
    if (node.type === "object" && node.properties) {
      for (const [childKey, child] of Object.entries(node.properties)) walk(child, childKey, [...pathParts, childKey]);
    } else if (node.type === "array" && node.items) {
      walk(node.items, "[]", [...pathParts, "[]"]);
    }
  }
  walk(schema, name, [name]);
  return mdTable(["Path", "Type", "Notes"], rows.slice(0, 300));
}

function selectJsonSamples() {
  const candidates = [
    "player-record-event-index.json",
    "wtt-archive-index.json",
    "player-records-index/manifest.json",
    "player-records-index/head-to-head-manifest.json",
    "player-records-index/head-to-head-status.json",
    "player-records-index/player-search-names-manifest.json",
    "player-records-index/candidate-manifest.json",
  ];
  const wttDir = path.join(ROOT, "wtt-records");
  if (fs.existsSync(wttDir)) {
    const first = fs.readdirSync(wttDir).find((n) => n.endsWith(".json"));
    if (first) candidates.push(`wtt-records/${first}`);
  }
  return candidates.filter((p) => fs.existsSync(path.join(ROOT, p)));
}

function generateReadme() {
  const auto = [
    `最終生成: ${now}`,
    "",
    "## 現在の実行環境",
    "",
    `- Package: \`${pkg.name || "不明"}\``,
    `- Version: \`${pkg.version || "不明"}\``,
    `- Node.js: \`${pkg.engines?.node || "指定なし"}\``,
    `- Branch: \`${git(["branch", "--show-current"])}\``,
    `- Commit: \`${git(["rev-parse", "--short", "HEAD"])}\``,
    "",
    "## npm scripts",
    "",
    mdTable(["Command", "Implementation"], scriptRows()),
    "",
    "## トップレベル構成",
    "",
    topLevelStructure(),
  ].join("\n");
  updateManagedFile(
    path.join(ROOT, "README.md"),
    "# IndivisualEvent\n\nWTTなどの卓球大会データを取得・整理・表示するWebアプリケーション。\n",
    { PROJECT_INFO: auto }
  );
}

function generateProjectContext() {
  const tracked = git(["ls-files"], "").split("\n").filter(Boolean);
  const relevant = tracked.filter((f) => /(^package\.json$|^server\.js$|\.js$|\.json$|^public\/)/.test(f)).slice(0, 250);
  const auto = [
    `最終生成: ${now}`,
    "",
    "## Git・実行環境",
    "",
    `- Branch: \`${git(["branch", "--show-current"])}\``,
    `- Commit: \`${git(["rev-parse", "--short", "HEAD"])}\``,
    `- Node.js: \`${pkg.engines?.node || "指定なし"}\``,
    `- Start: \`${pkg.scripts?.start || "未設定"}\``,
    "",
    "## npm scripts",
    "",
    mdTable(["Command", "Implementation"], scriptRows()),
    "",
    "## Git管理対象の主要ファイル",
    "",
    relevant.map((f) => `- \`${f}\``).join("\n") || "- 該当なし",
  ].join("\n");
  updateManagedFile(
    path.join(ROOT, "PROJECT_CONTEXT.md"),
    "# IndivisualEvent Project Context\n\n## プロジェクト概要\n\n設計思想、運用上の判断、注意事項を手動で記載する。\n",
    { CURRENT_STATE: auto }
  );
}

function generateChangelog() {
  const log = git(["log", "--date=short", "--pretty=format:%ad%x09%h%x09%s", "-200"], "");
  const grouped = new Map();
  for (const line of log.split("\n").filter(Boolean)) {
    const [date, hash, ...rest] = line.split("\t");
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(`- ${rest.join("\t")} (\`${hash}\`)`);
  }
  const body = [...grouped.entries()].map(([date, items]) => `## ${date}\n\n${items.join("\n")}`).join("\n\n");
  writeText(path.join(ROOT, "CHANGELOG.md"), `# Changelog\n\nGitコミット履歴から自動生成。\n\n生成日時: ${now}\n\n${body || "履歴を取得できませんでした。"}`);
}

function generateArchitecture() {
  const routes = detectRoutes();
  const content = [
    "# Architecture",
    "",
    `生成日時: ${now}`,
    "",
    "## 推定データフロー",
    "",
    "```text",
    "WTT / 外部データ",
    "  -> 取得・クロールスクリプト",
    "  -> wtt-records/*.json",
    "  -> 各種インデックス生成",
    "  -> player-records-index/・アーカイブJSON",
    "  -> server.js",
    "  -> public/index.html",
    "```",
    "",
    "## 検出したHTTPルート",
    "",
    mdTable(["Method", "Path", "Source"], routes),
    "",
    "## 注意",
    "",
    "この文書のルート一覧は正規表現による静的検出であり、動的に組み立てられたルートは含まれない場合がある。",
  ].join("\n");
  writeText(path.join(ROOT, "docs/ARCHITECTURE.md"), content);
}

function generateJsonSchemas() {
  const parts = ["# JSON Structure Reference", "", `生成日時: ${now}`, "", "実データの先頭サンプルから構造を推定している。正式なJSON Schemaではない。"];
  for (const rel of selectJsonSamples()) {
    const value = readJson(path.join(ROOT, rel), null);
    parts.push("", `## \`${rel}\``, "", value === null ? "解析できませんでした。" : schemaToMarkdown(inferSchema(value)));
  }
  writeText(path.join(ROOT, "docs/JSON_STRUCTURE.md"), parts.join("\n"));
}

function generateDataFlow() {
  const jsFiles = listFiles(ROOT, { maxDepth: 1 }).filter((f) => f.endsWith(".js"));
  const rows = [];
  for (const file of jsFiles) {
    const text = readText(path.join(ROOT, file));
    const refs = [...new Set([...text.matchAll(/["'`]([^"'`]+\.json)["'`]/g)].map((m) => m[1]))].slice(0, 20);
    if (refs.length) rows.push([`\`${file}\``, refs.map((r) => `\`${r}\``).join("<br>")]);
  }
  writeText(path.join(ROOT, "docs/DATA_FLOW.md"), [
    "# Data Flow",
    "",
    `生成日時: ${now}`,
    "",
    "## JavaScriptファイルから検出したJSON参照",
    "",
    mdTable(["Script", "Referenced JSON"], rows),
    "",
    "## 注意",
    "",
    "文字列リテラルとして記述されたJSONパスのみを検出する。動的パスは含まれない場合がある。",
  ].join("\n"));
}

function generateApi() {
  const routes = detectRoutes();
  writeText(path.join(ROOT, "docs/API.md"), [
    "# API Reference",
    "",
    `生成日時: ${now}`,
    "",
    mdTable(["Method", "Path", "Source"], routes),
    "",
    "## 注意",
    "",
    "静的検出結果。リクエスト・レスポンス形式はコードまたは実行時確認が必要。",
  ].join("\n"));
}

function generateTroubleshooting() {
  const defaultText = `# Troubleshooting\n\nこのファイルは手動管理する。障害、原因、解決手順を追記する。\n\n## テンプレート\n\n### 症状\n\n### 原因\n\n### 確認コマンド\n\n### 解決手順\n`;
  if (!fs.existsSync(path.join(ROOT, "docs/TROUBLESHOOTING.md"))) writeText(path.join(ROOT, "docs/TROUBLESHOOTING.md"), defaultText);
}

function generateTodo() {
  const defaultText = `# TODO\n\n## Backlog\n\n- [ ] Head-to-Head関連生成処理の確認\n- [ ] candidate-events関連の用途確認\n- [ ] player-record-match-shardsの生成単位確認\n- [ ] manifest更新タイミングの明文化\n- [ ] Renderタイムアウト要因の整理\n`;
  if (!fs.existsSync(path.join(ROOT, "docs/TODO.md"))) writeText(path.join(ROOT, "docs/TODO.md"), defaultText);
}

function main() {
  generateReadme();
  generateProjectContext();
  generateChangelog();
  generateArchitecture();
  generateJsonSchemas();
  generateDataFlow();
  generateApi();
  generateTroubleshooting();
  generateTodo();
  console.log("Generated README.md, PROJECT_CONTEXT.md, CHANGELOG.md and docs/*.md");
}

main();
