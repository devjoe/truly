import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { buildInvestigationSpanCandidates } from "../src/lib/investigation-span-candidate";
import {
  buildTierBGeneralPageInvestigationSpanAdapterChatBody,
  callTierBGeneralPageInvestigationSpanAdapter,
  type TierBGeneralPageInvestigationSpanAdapterRequest,
} from "../src/lib/tier-b-client";
import type { Lang } from "../src/lib/types";
import {
  installInvestigationAdapterProtocolSmokeNetworkGuard,
  sha256CanonicalJson,
} from "./lib/private-general-page-investigation-adapter-smoke.mjs";
import { sha256Text } from "./lib/private-general-page-semantic-audit.mjs";

type StructuredOutputMode = "json_schema" | "json_object";
interface Fixture {
  sampleId: string;
  language: Lang;
  kind: "admission-sensitive" | "control";
  title: string;
  groundingText: string;
  expectedExactText: string | null;
}

const fixtures: Fixture[] = [
  { sampleId: "rank-admit-zh-related-abstain", language: "zh-TW", kind: "admission-sensitive", title: "週末散步隨筆", groundingText: "作者分享週末散步的個人感受，沒有提出具體外部事實。\n相關新聞\n青河市衛生局召回 232 項食品\n點此閱讀完整報導", expectedExactText: null },
  { sampleId: "rank-admit-en-related-abstain", language: "en", kind: "admission-sensitive", title: "A personal weekend walk", groundingText: "The writer shares a personal impression of a weekend walk without making a concrete external claim.\nRelated story\nThe Northbridge Health Office recalled 232 food products\nRead the full report", expectedExactText: null },
  { sampleId: "rank-admit-zh-preview-abstain", language: "zh-TW", kind: "admission-sensitive", title: "今天只分享一張照片", groundingText: "我今天只想分享一張照片，沒有其他主張。\n連結預覽\n食藥署公布 232 項下架產品名單\n開啟連結", expectedExactText: null },
  { sampleId: "rank-admit-en-preview-abstain", language: "en", kind: "admission-sensitive", title: "Just sharing a photo today", groundingText: "I only want to share a photograph today and make no other claim.\nLink preview\nThe Food Agency published a list of 232 recalled products\nOpen link", expectedExactText: null },
  { sampleId: "rank-admit-zh-central-over-preview", language: "zh-TW", kind: "admission-sensitive", title: "18 路公車八月二日改道", groundingText: "報導主文\n松嶺交通局宣布 18 路公車將於 2026 年 8 月 2 日改道\n相關新聞\n北灣保險監理處命令退還 2,400 張保單費用\n閱讀更多", expectedExactText: "松嶺交通局宣布 18 路公車將於 2026 年 8 月 2 日改道" },
  { sampleId: "rank-admit-en-central-over-preview", language: "en", kind: "admission-sensitive", title: "Route 18 detour on August 2", groundingText: "Main report\nThe Pine Coast Transit Agency will reroute bus 18 on August 2, 2026\nRelated story\nThe West Bay Insurance Office ordered refunds on 2,400 policies\nRead more", expectedExactText: "The Pine Coast Transit Agency will reroute bus 18 on August 2, 2026" },
  { sampleId: "rank-admit-zh-central-control", language: "zh-TW", kind: "control", title: "清泉食品 A17 批次下架", groundingText: "報導主文\n青河市衛生局公告清泉食品 A17 批次自 2026 年 7 月 18 日起停止販售\n消費者可持發票退貨", expectedExactText: "青河市衛生局公告清泉食品 A17 批次自 2026 年 7 月 18 日起停止販售" },
  { sampleId: "rank-admit-en-central-control", language: "en", kind: "control", title: "Harbor Foods lot A17 recall", groundingText: "Main report\nThe Northbridge Health Office recalled Harbor Foods lot A17 on July 18, 2026\nCustomers may return the product with a receipt", expectedExactText: "The Northbridge Health Office recalled Harbor Foods lot A17 on July 18, 2026" },
  { sampleId: "rank-admit-zh-social-control", language: "zh-TW", kind: "control", title: "海風國中停課公告", groundingText: "貼文內容\n松嶺教育局宣布海風國中停課兩天\n家長可至教育局網站查看最新通知", expectedExactText: "松嶺教育局宣布海風國中停課兩天" },
  { sampleId: "rank-admit-en-social-control", language: "en", kind: "control", title: "Seabreeze School closure notice", groundingText: "Post text\nThe Pine Coast Education Office closed Seabreeze School for two days\nFamilies can check the agency site for updates", expectedExactText: "The Pine Coast Education Office closed Seabreeze School for two days" },
  { sampleId: "rank-admit-zh-opinion-control", language: "zh-TW", kind: "control", title: "城市燈節觀後感", groundingText: "作者觀點\n今年的城市燈節比去年漂亮\n作者最喜歡藍色燈海", expectedExactText: null },
  { sampleId: "rank-admit-en-opinion-control", language: "en", kind: "control", title: "An opinion about the city light festival", groundingText: "Writer opinion\nThis year's city light festival is prettier than last year's event\nThe writer prefers the blue display", expectedExactText: null }
];

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function responseMode(): StructuredOutputMode {
  const value = option("--structured-output-mode") ?? "json_object";
  if (value !== "json_schema" && value !== "json_object") throw new Error("Invalid --structured-output-mode");
  return value;
}

if (!process.argv.includes("--confirm-synthetic-model-send")) throw new Error("Missing --confirm-synthetic-model-send");
const outputPath = path.resolve(required("--output"));
const endpoint = required("--endpoint");
const model = required("--model");
const structuredOutputMode = responseMode();
if (!outputPath.includes(`${path.sep}tmp${path.sep}private-data${path.sep}runs${path.sep}`)) throw new Error("Ablation output must stay under tmp/private-data/runs");
if (fs.existsSync(outputPath)) throw new Error("Ablation output already exists");

const originalFetch = globalThis.fetch;
const guardedFetch = installInvestigationAdapterProtocolSmokeNetworkGuard(endpoint, originalFetch.bind(globalThis));
let modelRequests = 0;
globalThis.fetch = (async (input, init) => {
  modelRequests += 1;
  return guardedFetch(input, init);
}) as typeof fetch;

const startedAt = new Date().toISOString();
const rows = [];
let representativeBody: ReturnType<typeof buildTierBGeneralPageInvestigationSpanAdapterChatBody> | undefined;
try {
  for (const fixture of fixtures) {
    const candidates = buildInvestigationSpanCandidates(fixture.groundingText, { maxCandidates: 48, maxCharacters: 240 });
    const request: TierBGeneralPageInvestigationSpanAdapterRequest = {
      endpoint,
      model,
      structuredOutputMode,
      candidates,
      targetKind: "page",
      source: { title: fixture.title, sourceName: "Synthetic source" },
      sourceLang: fixture.language,
      outputLang: fixture.language,
      timeoutMs: 120_000,
    };
    representativeBody ??= buildTierBGeneralPageInvestigationSpanAdapterChatBody(request);
    const result = await callTierBGeneralPageInvestigationSpanAdapter(request);
    const exactClaim = result.value?.selections[0]?.exactClaim ?? null;
    rows.push({
      sampleId: fixture.sampleId,
      language: fixture.language,
      kind: fixture.kind,
      expectedDecision: fixture.expectedExactText ? "prepared" : "abstain",
      protocolOk: result.ok,
      exactClaim,
      correct: result.ok && exactClaim === fixture.expectedExactText,
      selectionCount: result.value?.selections.length ?? 0,
      attempts: result.attempts,
      finishReason: result.finishReason,
      usage: result.usage,
      raw: result.raw,
    });
  }
} finally {
  globalThis.fetch = originalFetch;
}
if (!representativeBody) throw new Error("No representative request body");
const responseSchema = representativeBody.response_format?.type === "json_schema"
  ? representativeBody.response_format.json_schema.schema
  : undefined;
const artifact = {
  schemaVersion: 1,
  task: "general_page_investigation_rank_admit_ablation",
  dataCategory: "synthetic-only",
  model: { endpoint, name: model, structuredOutputMode, temperature: 0, maxTokens: 96 },
  contract: {
    responseSchemaSha256: responseSchema ? sha256CanonicalJson(responseSchema) : undefined,
    systemPromptSha256: sha256Text(String(representativeBody.messages[0]?.content ?? "")),
    fixtureSetSha256: sha256CanonicalJson(fixtures),
  },
  counts: {
    rows: rows.length,
    protocol: rows.filter(({ protocolOk }) => protocolOk).length,
    correct: rows.filter(({ correct }) => correct).length,
    selected: rows.filter(({ selectionCount }) => selectionCount === 1).length,
    oneShot: rows.filter(({ attempts }) => attempts === 1).length,
  },
  networkBoundary: { modelRequests, publicSearchRequests: 0, actionsOpened: 0, redirects: "error" },
  startedAt,
  completedAt: new Date().toISOString(),
  rows,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ outputPath, counts: artifact.counts, contract: artifact.contract }, null, 2));
