import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  validateInvestigationTrustedLocatorCatalog,
  type InvestigationTrustedLocatorCatalog,
} from "../src/lib/investigation-source-aware-acquisition";

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
const requested = option("--catalog");
if (!requested) throw new Error("Missing --catalog");
const catalogPath = path.resolve(requested);
if (!catalogPath.includes(`${path.sep}private-data${path.sep}`)) throw new Error("catalog must stay under private-data");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as InvestigationTrustedLocatorCatalog;
const issues = validateInvestigationTrustedLocatorCatalog(catalog);
if (issues.length) throw new Error(issues.join("; "));
const active = catalog.entries.filter((entry) => entry.status === "active");
const counts = (values: string[]) => values.reduce<Record<string, number>>((result, value) => ({ ...result, [value]: (result[value] ?? 0) + 1 }), {});
console.log(JSON.stringify({
  result: "pass",
  version: catalog.version,
  entries: catalog.entries.length,
  active: active.length,
  suspended: catalog.entries.length - active.length,
  sourceFamilies: counts(active.map((entry) => entry.sourceFamily)),
  locatorKinds: counts(active.flatMap((entry) => entry.locators.map((locator) => locator.kind))),
  earliestReviewDueAt: active.map((entry) => entry.reviewDueAt).sort()[0] ?? null,
  catalog: "private-data/<private>",
}, null, 2));
