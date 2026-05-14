const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "public", "index.html");
const updatedAt = (process.env.APP_UPDATED_AT || new Date().toISOString()).replace(/\.\d{3}Z$/, "Z");
let html = fs.readFileSync(indexPath, "utf8");

function insertOnce(marker, insertion, existsMarker = insertion.trim()) {
  if (html.includes(existsMarker)) {
    return;
  }
  if (!html.includes(marker)) {
    throw new Error(`Patch marker not found: ${marker.slice(0, 80)}`);
  }
  html = html.replace(marker, `${insertion}${marker}`);
}

insertOnce(
  "      .grid {",
  `      .version-info {
        display: inline-flex;
        margin: 14px 0 0;
        padding: 7px 11px;
        border-radius: 999px;
        background: rgba(15, 118, 110, 0.1);
        color: var(--accent-2);
        font-size: 0.82rem;
        line-height: 1.4;
      }

`,
  ".version-info {",
);

insertOnce(
  "      </section>\n\n      <section class=\"grid\">",
  `        <p class="version-info" id="version-info">最終更新: 確認中...</p>
`,
  "id=\"version-info\"",
);

insertOnce(
  "      const translationsEditor = document.getElementById(\"translations-editor\");",
  `      const versionInfo = document.getElementById("version-info");
`,
  "const versionInfo = document.getElementById(\"version-info\");",
);

if (html.includes("const APP_UPDATED_AT = ")) {
  html = html.replace(/const APP_UPDATED_AT = "[^"]+";/, `const APP_UPDATED_AT = "${updatedAt}";`);
} else {
  insertOnce(
    "      function normalizeChoiceValue(value) {",
    `      const APP_UPDATED_AT = "${updatedAt}";

`,
  );
}

insertOnce(
  "      function updateEventName() {",
  `      function formatJstDateTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          return "";
        }
        return new Intl.DateTimeFormat("ja-JP", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(date) + " JST";
      }

      function loadVersionInfo() {
        const formatted = formatJstDateTime(APP_UPDATED_AT);
        versionInfo.textContent = formatted ? "最終更新: " + formatted : "最終更新: 不明";
        versionInfo.title = "この表示は公開ファイル更新時の時刻です。";
      }

`,
  "function formatJstDateTime(value)",
);

insertOnce(
  "        loadConfig(\"translations\").catch(reportBackgroundAdminError);",
  "        loadVersionInfo();\n",
  "loadVersionInfo();",
);

fs.writeFileSync(indexPath, html);
