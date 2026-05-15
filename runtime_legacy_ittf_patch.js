"use strict";

const fs = require("fs");
const Module = require("module");
const path = require("path");

const rootDir = __dirname;
const extractPath = path.resolve(rootDir, "extract_individual_matches.js");
const serverPath = path.resolve(rootDir, "server.js");
const originalLoader = Module._extensions[".js"];

function patchExtractSource(source) {
  let patched = source;

  if (!patched.includes("function shouldAllowBornanFallback(eventId, meta = {})")) {
    const marker = [
      "function isLikelyBornanFallbackCandidate(eventId) {",
      "  return /^\\d+$/.test(String(eventId || \"\").trim());",
      "}",
    ].join("\n");
    const helper = [
      "function isWttHostedEventName(eventName) {",
      "  const name = String(eventName || \"\").trim().toLowerCase();",
      "  if (!name) {",
      "    return false;",
      "  }",
      "  return /\\bwtt\\b/.test(name) || /world (team )?table tennis championships finals/.test(name);",
      "}",
      "",
      "function isIttfResultsPreferredEventName(eventName) {",
      "  const name = String(eventName || \"\").trim().toLowerCase();",
      "  if (!name || isWttHostedEventName(name)) {",
      "    return false;",
      "  }",
      "  return (",
      "    /^ittf\\b/.test(name) ||",
      "    /\\bworld (team )?table tennis championships\\b/.test(name) ||",
      "    /\\bworld para\\b/.test(name) ||",
      "    /special event qualifier/.test(name) ||",
      "    /youth championships?/.test(name) ||",
      "    /youth cup/.test(name) ||",
      "    /para (future|open|event)/.test(name)",
      "  );",
      "}",
      "",
      "function shouldAllowBornanFallback(eventId, meta = {}) {",
      "  if (!isLikelyBornanFallbackCandidate(eventId)) {",
      "    return false;",
      "  }",
      "",
      "  const source = String(meta?.source || \"\").trim().toLowerCase();",
      "  if ([\"bornan\", \"ittf\", \"ittf_results\", \"ittf-results\", \"ittf-legacy\"].includes(source)) {",
      "    return true;",
      "  }",
      "",
      "  const title = String(meta?.title || meta?.eventName || \"\").trim();",
      "  if (isIttfResultsPreferredEventName(title)) {",
      "    return true;",
      "  }",
      "",
      "  return !(source === \"calendar\" || meta?.startDate || meta?.endDate);",
      "}",
    ].join("\n");
    patched = patched.replace(marker, `${marker}\n\n${helper}`);
  }

  patched = patched.replace(
    "if (Array.isArray(primaryPayload)) {",
    "if (Array.isArray(primaryPayload) && primaryPayload.length > 0) {",
  );
  patched = patched.replace(
    "allowBornanFallback: !(meta?.source === \"calendar\" || meta?.startDate || meta?.endDate),",
    "allowBornanFallback: shouldAllowBornanFallback(eventId, meta),",
  );

  return patched;
}

function patchServerSource(source) {
  return source
    .replace(
      "/world team table tennis championships finals/.test(name)",
      "/world (team )?table tennis championships finals/.test(name)",
    )
    .replace(
      "return (\n    /^ittf\\b/.test(name) ||\n    /\\bworld para\\b/.test(name) ||",
      "return (\n    /^ittf\\b/.test(name) ||\n    /\\bworld (team )?table tennis championships\\b/.test(name) ||\n    /\\bworld para\\b/.test(name) ||",
    );
}

Module._extensions[".js"] = function patchedLegacyIttfLoader(module, filename) {
  const resolved = path.resolve(filename);
  if (resolved === extractPath || resolved === serverPath) {
    const source = fs.readFileSync(filename, "utf8");
    const patched = resolved === extractPath ? patchExtractSource(source) : patchServerSource(source);
    module._compile(patched, filename);
    return;
  }
  return originalLoader(module, filename);
};
