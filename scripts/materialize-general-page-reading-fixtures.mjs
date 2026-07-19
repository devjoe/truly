import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  throw new Error("usage: materialize-general-page-reading-fixtures <input.json> <output.jsonl>");
}

const rows = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
if (!Array.isArray(rows) || rows.length === 0) throw new Error("fixture array required");
const encoded = rows.map((row) => {
  const sourceSha256 = crypto.createHash("sha256").update(row.text, "utf8").digest("hex");
  return JSON.stringify({
    sampleId: `${row.surface === "facebook" ? "fb" : "news"}_${sourceSha256.slice(0, 32)}`,
    surface: row.surface,
    dataCategory: `${row.surface}-original`,
    language: row.language,
    sourceSha256,
    text: row.text,
  });
});
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.resolve(output), `${encoded.join("\n")}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ rows: rows.length, output: path.resolve(output) }, null, 2));
