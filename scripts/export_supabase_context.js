#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const https = require("https");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const OUTPUT_DIR = process.env.OUTPUT_DIR || "./data/supabase_export_prod";
const TABLES_ENV = process.env.SUPABASE_TABLES;
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 1000);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const DEFAULT_TABLES = [
  "organizations",
  "accounts",
  "accounts_memberships",
  "entities",
  "tags",
  "documents",
  "highlights",
  "highlight_comments",
  "highlights_entities_rel",
  "highlights_tags_rel",
  "trends",
  "trends_assets",
  "scenario",
  "scenario_remarks",
  "calendar_events",
  "calendar_events_entities_rel",
  "followups",
];

const TABLES = TABLES_ENV
  ? TABLES_ENV.split(",")
      .map((table) => table.trim())
      .filter(Boolean)
  : DEFAULT_TABLES;

const requestJson = (url, headers) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = data ? JSON.parse(data) : [];
              resolve({ data: parsed, headers: res.headers });
            } catch (error) {
              reject(error);
            }
          } else {
            reject(
              new Error(
                `Request failed: ${res.statusCode} ${res.statusMessage} ${data}`
              )
            );
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });

const exportTable = async (table) => {
  const outPath = path.join(OUTPUT_DIR, `${table}.jsonl`);
  const stream = fs.createWriteStream(outPath, { encoding: "utf8" });
  let offset = 0;

  while (true) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.set("select", "*");
    const rangeEnd = offset + PAGE_SIZE - 1;

    const { data } = await requestJson(url, {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Range: `${offset}-${rangeEnd}`,
      Prefer: "count=exact",
    });

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    for (const row of data) {
      stream.write(`${JSON.stringify(row)}\n`);
    }

    if (data.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }

  stream.end();
};

const main = async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Exporting to ${OUTPUT_DIR}`);

  for (const table of TABLES) {
    console.log(`Exporting table ${table}`);
    await exportTable(table);
  }

  console.log("Done.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
