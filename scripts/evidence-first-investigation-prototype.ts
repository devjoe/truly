import fs from "node:fs";
import path from "node:path";

import fixture from "../tests/fixtures/claim-investigation/food-recall-contract.json";
import type { InvestigationBundle } from "../src/lib/claim-investigation-contract";
import { evidenceFirstInvestigationHtml } from "./lib/evidence-first-investigation-renderer";

const output = path.resolve(process.argv[2] ?? "tmp/evidence-first-investigation-prototype.html");
if (!output.startsWith(`${path.resolve("tmp")}${path.sep}`)) throw new Error("Prototype output must stay under tmp/");
const content = evidenceFirstInvestigationHtml(fixture as InvestigationBundle, "zh-TW");
const html = `<!doctype html>
<html lang="zh-TW" data-truly-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Truly evidence-first investigation prototype</title>
<style>
*{box-sizing:border-box} body{margin:0;padding:16px;background:#18191a;color:#e4e6eb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5}
.prototype-shell{width:min(430px,100%);margin:0 auto;padding:12px;border:1px solid #3e4042;border-radius:10px;background:#242526}
.evidence-first-investigation{display:grid;gap:18px}.investigation-subject{display:grid;gap:6px;padding:14px 16px;border-radius:8px;background:#18191a}
.investigation-eyebrow,.investigation-subject span,.investigation-ledger-meta,.investigation-evidence-meta,.investigation-evidence-duplicate,.investigation-evidence-empty{margin:0;color:#b0b3b8;font-size:12px}.investigation-eyebrow{font-weight:700;color:#4599ff}.investigation-subject h2{margin:0;font-size:16px;line-height:1.45}
.investigation-question-list{display:grid;gap:18px}.investigation-question-group{display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px 10px}.investigation-question-kicker{display:grid;place-items:center;width:22px;height:22px;border:1px solid #4b4c4f;border-radius:50%;color:#b0b3b8;font-size:11px;font-weight:700}.investigation-question-group h3{margin:0;font-size:14px;line-height:1.45}.investigation-question-evidence{grid-column:2;display:grid;gap:8px}
.investigation-evidence-card{display:grid;gap:6px;padding:10px 12px;border-left:2px solid #4599ff;background:#18191a}.investigation-evidence-meta{display:flex;flex-wrap:wrap;gap:0 5px}.investigation-evidence-card blockquote{margin:0;color:#e4e6eb}.investigation-evidence-duplicate{color:#f1c95c}.investigation-evidence-empty{padding:9px 11px;border:1px dashed #4b4c4f;border-radius:6px}
.investigation-sufficiency,.investigation-finding{display:grid;gap:5px;padding-top:14px;border-top:1px solid #3a3b3c}.investigation-sufficiency h3,.investigation-finding h3{margin:0;color:#b0b3b8;font-size:12px}.investigation-sufficiency p,.investigation-finding p{margin:0}.investigation-sufficiency[data-state="insufficient"] h3{color:#f1c95c}.investigation-finding{padding:12px;background:#18191a;border-top:0;border-radius:8px}
@media(max-width:360px){body{padding:8px}.prototype-shell{padding:10px}.investigation-question-group{grid-template-columns:20px minmax(0,1fr);gap:7px}.investigation-question-kicker{width:20px;height:20px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style>
</head>
<body><main class="prototype-shell">${content}</main></body>
</html>`;
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
console.log(output);
