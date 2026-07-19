import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  installPrivateSemanticAuditNetworkGuard,
  sha256Text,
} from "./private-general-page-semantic-audit.mjs";

export const INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_TASK =
  "general_page_investigation_adapter_protocol_smoke";
export const INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_SAMPLE_COUNT = 30;
export const INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_CONCURRENCY = 2;
export const INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_TIMEOUT_MS = 120_000;
export const INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_CATEGORIES = ["synthetic-only"];
export const INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_ERROR_CODES = [
  "investigation_adapter_network_error",
  "investigation_adapter_timeout",
  "investigation_adapter_http_error",
  "investigation_adapter_truncated",
  "investigation_adapter_invalid_json",
  "investigation_adapter_invalid_schema",
  "investigation_adapter_source_quote_error",
];

const zhFixtures = [
  {
    fixtureKind: "prepared",
    groundingText: "青河市衛生局公告，清泉食品 A17 批次因花生標示缺漏，自 2026 年 7 月 18 日起停止販售。消費者可持發票辦理退貨。",
    candidateClaim: {
      c: "青河市衛生局公告清泉食品 A17 批次自 2026 年 7 月 18 日起停止販售。",
      why: "涉及食品過敏安全與產品召回。",
      need: "衛生局公告與召回批次清單。",
      q: "青河市衛生局是否公告清泉食品 A17 批次自 2026 年 7 月 18 日起停止販售？",
    },
  },
  {
    fixtureKind: "prepared",
    groundingText: "松嶺交通局公告，北港大橋將於 2026 年 8 月 2 日凌晨零時至上午六時封閉檢修。公車 18 路將改道行駛。",
    candidateClaim: {
      c: "松嶺交通局公告北港大橋將於 2026 年 8 月 2 日凌晨封閉檢修。",
      why: "影響公共交通與道路安全。",
      need: "交通局施工公告。",
      q: "松嶺交通局是否公告北港大橋將於 2026 年 8 月 2 日凌晨封閉檢修？",
    },
  },
  {
    fixtureKind: "prepared",
    groundingText: "北灣保險監理處命令遠帆保險退還 2,400 張保單多收的行政費，每張上限新台幣 320 元。退款作業預計九月底完成。",
    candidateClaim: {
      c: "北灣保險監理處命令遠帆保險退還 2,400 張保單多收的行政費。",
      why: "涉及消費者金錢權益。",
      need: "監理處命令與退款範圍。",
      q: "北灣保險監理處是否命令遠帆保險退還 2,400 張保單多收的行政費？",
    },
  },
  {
    fixtureKind: "abstain",
    groundingText: "作者覺得今年的城市燈節比去年漂亮，也認為藍色燈海最適合拍照。文章沒有提供票選或調查資料。",
    candidateClaim: {
      c: "今年的城市燈節比去年漂亮。",
      why: "這是作者的審美意見。",
      need: "沒有明確可查核證據。",
      q: "今年的城市燈節是否比去年漂亮？",
    },
  },
  {
    fixtureKind: "abstain",
    groundingText: "貼文只寫著有人說新計畫可能很重要，但沒有提到計畫名稱、主管機關、日期或具體措施。留言區也沒有補充來源。",
    candidateClaim: {
      c: "有人說新計畫可能很重要。",
      why: "缺乏可識別主體與事件。",
      need: "計畫名稱與正式資料。",
      q: "這個新計畫是否很重要？",
    },
  },
  {
    fixtureKind: "abstain",
    groundingText: "晨星樂團週末將在河畔舞台演出，主辦人形容這會是夏天最難忘的夜晚。現場另有餐車與紀念品攤位。",
    candidateClaim: {
      c: "晨星樂團的演出會是夏天最難忘的夜晚。",
      why: "屬於宣傳性評價。",
      need: "沒有外部查核必要。",
      q: "晨星樂團的演出是否會是夏天最難忘的夜晚？",
    },
  },
  {
    fixtureKind: "attributed",
    groundingText: "青河市衛生局表示，清泉食品 B12 批次含有未標示的花生成分。業者已通知三家通路下架。",
    candidateClaim: {
      c: "青河市衛生局表示，清泉食品 B12 批次含有未標示的花生成分。",
      why: "涉及食品過敏風險。",
      need: "衛生局檢驗公告。",
      q: "青河市衛生局是否表示清泉食品 B12 批次含有未標示的花生成分？",
    },
  },
  {
    fixtureKind: "attributed",
    groundingText: "北灣統計處估計，2026 年 5 月住宅租金中位數較去年同期上升 3.2%。這份估計採用 4,800 份租約樣本。",
    candidateClaim: {
      c: "北灣統計處估計，2026 年 5 月住宅租金中位數較去年同期上升 3.2%。",
      why: "涉及居住成本與公共政策。",
      need: "統計處估計方法與租金資料。",
      q: "北灣統計處是否估計 2026 年 5 月住宅租金中位數較去年同期上升 3.2%？",
    },
  },
  {
    fixtureKind: "attributed",
    groundingText: "南岬法院公告指出，海辰公司仍可在 2026 年 7 月 30 日前提出上訴。法院尚未對上訴理由作成判斷。",
    candidateClaim: {
      c: "南岬法院公告指出，海辰公司仍可在 2026 年 7 月 30 日前提出上訴。",
      why: "涉及法律程序與公司權利。",
      need: "法院公告與案件時程。",
      q: "南岬法院公告是否指出海辰公司仍可在 2026 年 7 月 30 日前提出上訴？",
    },
  },
  {
    fixtureKind: "compound",
    groundingText: "青河市政府宣布東區將於 2026 年 7 月 20 日停水八小時，並表示西區三所學校當天照常上課。兩項措施分屬不同單位執行。",
    candidateClaim: {
      c: "青河市政府宣布東區將停水八小時，西區三所學校仍照常上課。",
      why: "同時涉及民生供水與校務安排。",
      need: "市府停水與學校公告。",
      q: "青河市政府是否宣布東區停水八小時且西區三所學校照常上課？",
    },
  },
  {
    fixtureKind: "compound",
    groundingText: "北灣藥局召回 C9 批次止痛藥，並承諾在一週內完成全部門市盤點。召回原因是外盒保存期限印刷錯誤。",
    candidateClaim: {
      c: "北灣藥局召回 C9 批次止痛藥並承諾一週內完成門市盤點。",
      why: "包含召回與後續管理兩個主張。",
      need: "藥局召回通知與盤點紀錄。",
      q: "北灣藥局是否召回 C9 批次止痛藥並在一週內完成門市盤點？",
    },
  },
  {
    fixtureKind: "compound",
    groundingText: "松嶺教育局宣布海風國中停課兩天，並把全市英文會考延後到 2026 年 8 月 9 日。停課與考試調整原因不同。",
    candidateClaim: {
      c: "松嶺教育局宣布海風國中停課兩天並延後全市英文會考。",
      why: "包含兩項不同教育措施。",
      need: "教育局停課與考試公告。",
      q: "松嶺教育局是否宣布海風國中停課兩天並延後全市英文會考？",
    },
  },
  {
    fixtureKind: "low-risk",
    groundingText: "晴空鞋店本週推出薄荷綠慢跑鞋，門市提供三種鞋帶顏色。貼文鼓勵顧客週六到店試穿並分享照片。",
    candidateClaim: {
      c: "晴空鞋店本週推出薄荷綠慢跑鞋。",
      why: "一般商品上架資訊。",
      need: "店家商品頁。",
      q: "晴空鞋店本週是否推出薄荷綠慢跑鞋？",
    },
  },
  {
    fixtureKind: "low-risk",
    groundingText: "河岸咖啡館夏季菜單新增檸檬氣泡飲，內用杯附一片乾燥橙片。菜單價格與營業時間維持不變。",
    candidateClaim: {
      c: "河岸咖啡館夏季菜單新增檸檬氣泡飲。",
      why: "低風險菜單資訊。",
      need: "咖啡館菜單。",
      q: "河岸咖啡館夏季菜單是否新增檸檬氣泡飲？",
    },
  },
  {
    fixtureKind: "low-risk",
    groundingText: "星帆遊戲公告下週推出藍色飛船外觀，玩家可用活動代幣兌換。這項外觀不會改變角色能力。",
    candidateClaim: {
      c: "星帆遊戲下週推出藍色飛船外觀。",
      why: "低風險遊戲外觀資訊。",
      need: "遊戲活動公告。",
      q: "星帆遊戲下週是否推出藍色飛船外觀？",
    },
  },
];

const enFixtures = [
  {
    fixtureKind: "prepared",
    groundingText: "The Northbridge Health Office recalled Harbor Foods lot A17 on July 18, 2026, because the package omitted a peanut warning. Customers may return the product with a receipt.",
    candidateClaim: {
      c: "The Northbridge Health Office recalled Harbor Foods lot A17 on July 18, 2026.",
      why: "The recall concerns food-allergy safety.",
      need: "The health office recall notice and lot list.",
      q: "Did the Northbridge Health Office recall Harbor Foods lot A17 on July 18, 2026?",
    },
  },
  {
    fixtureKind: "prepared",
    groundingText: "The Pine Coast Transit Agency will close North Harbor Bridge from midnight to 6 a.m. on August 2, 2026, for safety inspections. Bus route 18 will use a detour.",
    candidateClaim: {
      c: "The Pine Coast Transit Agency will close North Harbor Bridge on August 2, 2026, for safety inspections.",
      why: "The closure affects public transport and road safety.",
      need: "The transit agency closure notice.",
      q: "Will the Pine Coast Transit Agency close North Harbor Bridge on August 2, 2026, for safety inspections?",
    },
  },
  {
    fixtureKind: "prepared",
    groundingText: "The West Bay Insurance Office ordered Far Sail Insurance to refund administrative fees charged on 2,400 policies. Each refund is capped at 11 dollars.",
    candidateClaim: {
      c: "The West Bay Insurance Office ordered Far Sail Insurance to refund fees charged on 2,400 policies.",
      why: "The order affects consumer finances.",
      need: "The regulator order and refund scope.",
      q: "Did the West Bay Insurance Office order Far Sail Insurance to refund fees charged on 2,400 policies?",
    },
  },
  {
    fixtureKind: "abstain",
    groundingText: "The writer says this year's city light festival looks prettier than last year's event and calls the blue display perfect for photographs. No poll or survey is cited.",
    candidateClaim: {
      c: "This year's city light festival is prettier than last year's event.",
      why: "This is the writer's aesthetic opinion.",
      need: "There is no concrete external evidence requirement.",
      q: "Is this year's city light festival prettier than last year's event?",
    },
  },
  {
    fixtureKind: "abstain",
    groundingText: "The post only says that someone thinks a new program could matter. It gives no program name, responsible organization, date, measure, or source.",
    candidateClaim: {
      c: "Someone thinks a new program could matter.",
      why: "The subject and event are not identifiable.",
      need: "The program name and official details.",
      q: "Does the new program matter?",
    },
  },
  {
    fixtureKind: "abstain",
    groundingText: "The Morning Star Band will play at the riverside stage this weekend, and the promoter calls it the most unforgettable night of summer. Food trucks will also attend.",
    candidateClaim: {
      c: "The Morning Star Band show will be the most unforgettable night of summer.",
      why: "This is promotional language.",
      need: "No external verification is necessary.",
      q: "Will the Morning Star Band show be the most unforgettable night of summer?",
    },
  },
  {
    fixtureKind: "attributed",
    groundingText: "The Northbridge Health Office stated that Harbor Foods lot B12 contained an undeclared peanut ingredient. The company notified three retailers to remove it.",
    candidateClaim: {
      c: "The Northbridge Health Office stated that Harbor Foods lot B12 contained an undeclared peanut ingredient.",
      why: "The statement concerns an allergy hazard.",
      need: "The health office laboratory notice.",
      q: "Did the Northbridge Health Office state that Harbor Foods lot B12 contained an undeclared peanut ingredient?",
    },
  },
  {
    fixtureKind: "attributed",
    groundingText: "The West Bay Statistics Office estimated that median residential rent rose 3.2 percent year over year in May 2026. The estimate used 4,800 lease records.",
    candidateClaim: {
      c: "The West Bay Statistics Office estimated that median residential rent rose 3.2 percent year over year in May 2026.",
      why: "The estimate concerns housing costs and public policy.",
      need: "The statistics office method and rent data.",
      q: "Did the West Bay Statistics Office estimate that median residential rent rose 3.2 percent year over year in May 2026?",
    },
  },
  {
    fixtureKind: "attributed",
    groundingText: "The South Cape Court notice said that Sea Morning Company may still appeal by July 30, 2026. The court has not ruled on the merits of an appeal.",
    candidateClaim: {
      c: "The South Cape Court notice said that Sea Morning Company may still appeal by July 30, 2026.",
      why: "The statement concerns a legal deadline and company rights.",
      need: "The court notice and case schedule.",
      q: "Did the South Cape Court notice say that Sea Morning Company may still appeal by July 30, 2026?",
    },
  },
  {
    fixtureKind: "compound",
    groundingText: "Northbridge City announced an eight-hour water outage in the east district on July 20, 2026, and said three west-district schools would remain open. Different agencies manage the two measures.",
    candidateClaim: {
      c: "Northbridge City announced an eight-hour water outage and said three schools would remain open.",
      why: "The sentence combines water service and school operations.",
      need: "The city water and school notices.",
      q: "Did Northbridge City announce an eight-hour water outage and keep three schools open?",
    },
  },
  {
    fixtureKind: "compound",
    groundingText: "West Bay Pharmacy recalled pain reliever lot C9 and promised to finish a store inventory within one week. A misprinted expiration date caused the recall.",
    candidateClaim: {
      c: "West Bay Pharmacy recalled pain reliever lot C9 and promised a store inventory within one week.",
      why: "The sentence combines a recall and a follow-up commitment.",
      need: "The recall notice and inventory record.",
      q: "Did West Bay Pharmacy recall pain reliever lot C9 and finish a store inventory within one week?",
    },
  },
  {
    fixtureKind: "compound",
    groundingText: "The Pine Coast Education Office closed Seabreeze School for two days and moved the citywide English exam to August 9, 2026. The two decisions had different causes.",
    candidateClaim: {
      c: "The Pine Coast Education Office closed Seabreeze School and moved the citywide English exam.",
      why: "The sentence combines two education measures.",
      need: "The closure and examination notices.",
      q: "Did the Pine Coast Education Office close Seabreeze School and move the citywide English exam?",
    },
  },
  {
    fixtureKind: "low-risk",
    groundingText: "Skyline Shoes introduced a mint-green running shoe this week and offers three lace colors in stores. The post invites customers to try it on Saturday.",
    candidateClaim: {
      c: "Skyline Shoes introduced a mint-green running shoe this week.",
      why: "This is ordinary product-availability information.",
      need: "The store product page.",
      q: "Did Skyline Shoes introduce a mint-green running shoe this week?",
    },
  },
  {
    fixtureKind: "low-risk",
    groundingText: "Riverside Cafe added lemon soda to its summer menu and serves it with a dried orange slice. Prices and business hours did not change.",
    candidateClaim: {
      c: "Riverside Cafe added lemon soda to its summer menu.",
      why: "This is low-risk menu information.",
      need: "The cafe menu.",
      q: "Did Riverside Cafe add lemon soda to its summer menu?",
    },
  },
  {
    fixtureKind: "low-risk",
    groundingText: "Star Sail Games will release a blue spaceship cosmetic next week, redeemable with event tokens. The cosmetic does not change character abilities.",
    candidateClaim: {
      c: "Star Sail Games will release a blue spaceship cosmetic next week.",
      why: "This is low-risk game-cosmetic information.",
      need: "The game event notice.",
      q: "Will Star Sail Games release a blue spaceship cosmetic next week?",
    },
  },
];

function materializeLanguageFixtures(language, fixtures) {
  const languageSlug = language === "zh-TW" ? "zh" : "en";
  return fixtures.map((fixture, index) => ({
    schemaVersion: 1,
    sampleId: `synthetic-${languageSlug}-${String(index + 1).padStart(2, "0")}`,
    dataCategory: "synthetic-only",
    language,
    fixtureKind: fixture.fixtureKind,
    candidateClaim: fixture.candidateClaim,
    groundingText: fixture.groundingText,
    source: {
      title: language === "zh-TW" ? `合成測試頁面 ${index + 1}` : `Synthetic test page ${index + 1}`,
      sourceName: language === "zh-TW" ? "合成資料來源" : "Synthetic source",
      publishedAt: "2026-07-17",
      url: `https://synthetic.example.test/${languageSlug}/${String(index + 1).padStart(2, "0")}`,
    },
  }));
}

export function buildInvestigationAdapterProtocolSmokeFixtures() {
  const fixtures = [
    ...materializeLanguageFixtures("zh-TW", zhFixtures),
    ...materializeLanguageFixtures("en", enFixtures),
  ];
  assertInvestigationAdapterProtocolSmokeFixtures(fixtures);
  return fixtures;
}

export function assertInvestigationAdapterProtocolSmokeFixtures(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length !== INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_SAMPLE_COUNT) {
    throw new Error(`Synthetic protocol smoke requires exactly ${INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_SAMPLE_COUNT} fixtures`);
  }
  const ids = new Set();
  const languageCounts = { "zh-TW": 0, en: 0 };
  const kindCounts = { prepared: 0, abstain: 0, attributed: 0, compound: 0, "low-risk": 0 };
  for (const fixture of fixtures) {
    if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) throw new Error("Invalid synthetic fixture");
    if (fixture.dataCategory !== "synthetic-only") throw new Error("Synthetic protocol smoke accepts synthetic-only fixtures");
    if (!/^synthetic-(?:zh|en)-\d{2}$/.test(fixture.sampleId) || ids.has(fixture.sampleId)) {
      throw new Error("Synthetic fixture IDs must be unique and deterministic");
    }
    ids.add(fixture.sampleId);
    if (!(fixture.language in languageCounts)) throw new Error("Synthetic fixture language must be zh-TW or en");
    languageCounts[fixture.language] += 1;
    if (!(fixture.fixtureKind in kindCounts)) throw new Error("Unsupported synthetic fixture kind");
    kindCounts[fixture.fixtureKind] += 1;
    if (typeof fixture.groundingText !== "string" || fixture.groundingText.length < 40) {
      throw new Error("Synthetic fixture grounding text must be at least 40 characters");
    }
    if (!fixture.candidateClaim || typeof fixture.candidateClaim !== "object") {
      throw new Error("Synthetic fixture requires a candidate claim");
    }
    const sourceUrl = new URL(fixture.source?.url);
    if (sourceUrl.hostname !== "synthetic.example.test") throw new Error("Synthetic fixture URL must use synthetic.example.test");
  }
  if (languageCounts["zh-TW"] !== 15 || languageCounts.en !== 15) {
    throw new Error("Synthetic protocol smoke requires 15 zh-TW and 15 English fixtures");
  }
  if (Object.values(kindCounts).some((count) => count !== 6)) {
    throw new Error("Synthetic protocol smoke requires six fixtures for every fixture kind");
  }
  return { languageCounts, kindCounts };
}

export function investigationAdapterProtocolSmokeFixtureSha256(fixtures) {
  assertInvestigationAdapterProtocolSmokeFixtures(fixtures);
  return sha256Text(JSON.stringify(fixtures));
}

export function assertInvestigationAdapterProtocolSmokeOutputPath(outputPath, publicRepoRoot) {
  const resolved = path.resolve(outputPath);
  const parts = resolved.split(path.sep).filter(Boolean);
  const privateDataIndex = parts.findIndex((part, index) => part === "private-data" && parts[index + 1] === "runs");
  if (privateDataIndex < 0) throw new Error("Protocol smoke output must be under private-data/runs");

  const repoRoot = path.resolve(publicRepoRoot);
  const repoPrefix = `${repoRoot}${path.sep}`;
  const tmpRoot = path.resolve(repoRoot, "tmp");
  const tmpPrefix = `${tmpRoot}${path.sep}`;
  if (resolved.startsWith(repoPrefix) && resolved !== tmpRoot && !resolved.startsWith(tmpPrefix)) {
    throw new Error("Protocol smoke output must stay outside the public repo or under tmp/");
  }
  return resolved;
}

export function installInvestigationAdapterProtocolSmokeNetworkGuard(endpoint, fetchImpl = globalThis.fetch) {
  return installPrivateSemanticAuditNetworkGuard(endpoint, fetchImpl);
}

export function writeInvestigationAdapterProtocolSmokeMeta(outputPath, manifest) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

export function assertInvestigationAdapterProtocolErrorCounts(counts, protocolFailed) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    throw new Error("Protocol error counts must be an object");
  }
  const known = new Set(INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_ERROR_CODES);
  let total = 0;
  for (const [error, count] of Object.entries(counts)) {
    if (!known.has(error)) throw new Error(`Unknown protocol error code: ${error}`);
    if (!Number.isInteger(count) || count <= 0) throw new Error("Protocol error counts must be positive integers");
    total += count;
  }
  if (total !== protocolFailed) throw new Error("Protocol error counts must sum to protocolFailed");
  return counts;
}

export function investigationAdapterProtocolErrorCounts(outcomes) {
  const counts = {};
  for (const outcome of outcomes) {
    if (outcome.ok && outcome.decision) continue;
    const error = outcome.error;
    if (!INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_ERROR_CODES.includes(error)) {
      throw new Error(`Unknown protocol error code: ${String(error)}`);
    }
    counts[error] = (counts[error] ?? 0) + 1;
  }
  return counts;
}

export function buildInvestigationAdapterProtocolSmokeManifest(input) {
  const fixtures = input.fixtures;
  assertInvestigationAdapterProtocolSmokeFixtures(fixtures);
  const outcomes = input.outcomes;
  if (!Array.isArray(outcomes) || outcomes.length !== fixtures.length) {
    throw new Error("Protocol smoke outcomes must match the fixed fixture count");
  }
  const protocolSucceeded = outcomes.filter((outcome) => outcome.ok && outcome.decision).length;
  const protocolFailed = outcomes.length - protocolSucceeded;
  const prepared = outcomes.filter((outcome) => outcome.ok && outcome.decision === "prepared").length;
  const abstained = outcomes.filter((outcome) => outcome.ok && outcome.decision === "abstain").length;
  if (prepared + abstained !== protocolSucceeded) throw new Error("Protocol smoke decision counts are inconsistent");
  const protocolErrorCounts = investigationAdapterProtocolErrorCounts(outcomes);
  assertInvestigationAdapterProtocolErrorCounts(protocolErrorCounts, protocolFailed);

  return {
    schemaVersion: 1,
    task: INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_TASK,
    runId: input.runId,
    datasetVersion: input.datasetVersion,
    split: "dev",
    candidate: input.candidate,
    prompts: input.prompts,
    model: input.model,
    adapter: {
      repairMode: "none",
      runtimeParity: true,
      schemaSha256: input.schemaSha256,
    },
    data: {
      syntheticOnly: true,
      sampleCount: fixtures.length,
      declaredCategories: [...INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_CATEGORIES],
    },
    counts: {
      protocolSucceeded,
      protocolFailed,
      prepared,
      abstained,
      protocolErrorCounts,
    },
    networkBoundary: {
      allowedCompletionsUrl: input.allowedCompletionsUrl,
      redirects: "error",
      modelRequests: input.modelRequests,
      publicSearchRequests: 0,
      actionsOpened: 0,
    },
    artifacts: {
      fixtureSetSha256: investigationAdapterProtocolSmokeFixtureSha256(fixtures),
      inputSha256: sha256CanonicalJson(fixtures.map((fixture) => ({
        candidateClaim: fixture.candidateClaim,
        groundingText: fixture.groundingText,
        source: fixture.source,
        outputLang: fixture.language,
      }))),
      resultSha256: sha256CanonicalJson(outcomes),
    },
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
}

export function sha256CanonicalJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
