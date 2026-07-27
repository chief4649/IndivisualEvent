#!/usr/bin/env node

const baseUrl = String(process.env.WTT_CRAWL_BASE_URL || process.env.PUBLIC_BASE_URL || "https://ttreport-individual.onrender.com").replace(/\/+$/, "");
const adminToken = process.env.WTT_CRAWL_ADMIN_TOKEN || process.env.ADMIN_TOKEN || "";

if (!adminToken) {
  console.error("WTT_CRAWL_ADMIN_TOKEN or ADMIN_TOKEN is required.");
  process.exit(1);
}

const params = new URLSearchParams();
[
  ["from", process.env.WTT_CRAWL_FROM],
  ["to", process.env.WTT_CRAWL_TO],
  ["limit", process.env.WTT_CRAWL_LIMIT],
  ["delayMs", process.env.WTT_CRAWL_DELAY_MS],
  ["take", process.env.WTT_CRAWL_TAKE],
  ["force", process.env.WTT_CRAWL_FORCE],
  ["keepRaw", process.env.WTT_CRAWL_KEEP_RAW],
  ["skipH2hIndex", process.env.WTT_CRAWL_SKIP_H2H_INDEX],
].forEach(([key, value]) => {
  if (value !== undefined && value !== "") {
    params.set(key, value);
  }
});

const url = `${baseUrl}/api/admin/crawl-wtt${params.size ? `?${params}` : ""}`;

fetch(url, {
  method: "POST",
  headers: {
    authorization: `Bearer ${adminToken}`,
  },
})
  .then(async (response) => {
    const text = await response.text();
    console.log(text);
    if (!response.ok) {
      throw new Error(`crawl trigger failed: ${response.status}`);
    }
  })
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
