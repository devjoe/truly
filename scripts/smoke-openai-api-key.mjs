#!/usr/bin/env node

const endpointInput = process.env.TRULY_SMOKE_OPENAI_ENDPOINT?.trim();
const model = process.env.TRULY_SMOKE_OPENAI_MODEL?.trim();
const apiKey = process.env.TRULY_SMOKE_OPENAI_API_KEY?.trim();
const timeoutMs = Number(process.env.TRULY_SMOKE_OPENAI_TIMEOUT_MS || "15000");

if (!endpointInput || !model || !apiKey) {
  console.error([
    "Missing required environment variables.",
    "",
    "Usage:",
    "TRULY_SMOKE_OPENAI_ENDPOINT=http://host:8000/v1 \\",
    "TRULY_SMOKE_OPENAI_MODEL=model-name \\",
    "TRULY_SMOKE_OPENAI_API_KEY=secret \\",
    "npm run smoke:openai-api-key",
  ].join("\n"));
  process.exit(2);
}

const base = endpointInput
  .replace(/\/+$/, "")
  .replace(/\/v1$/, "");
const endpoint = `${base}/v1`;
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${apiKey}`,
};

async function fetchWithTimeout(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function assertOk(resp, label) {
  if (resp.ok) return;
  const text = await resp.text().catch(() => "");
  throw new Error(`${label} failed: HTTP ${resp.status}: ${text.slice(0, 240)}`);
}

const modelsResp = await fetchWithTimeout(`${endpoint}/models`, { headers });
await assertOk(modelsResp, "models probe");
const modelsData = await modelsResp.json().catch(() => ({}));
const modelIds = Array.isArray(modelsData?.data)
  ? modelsData.data.map((item) => item?.id).filter(Boolean)
  : [];
if (modelIds.length > 0 && !modelIds.includes(model)) {
  console.warn(`Model list did not include "${model}". Continuing with chat smoke.`);
}

const wrongKeyResp = await fetchWithTimeout(`${endpoint}/models`, {
  headers: {
    ...headers,
    Authorization: "Bearer truly-smoke-wrong-key",
  },
});
if (![401, 403].includes(wrongKeyResp.status)) {
  throw new Error(`wrong-key probe expected HTTP 401/403, got HTTP ${wrongKeyResp.status}`);
}

const completionsResp = await fetchWithTimeout(`${endpoint}/completions`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    model,
    prompt: "Endpoint smoke test. Generate a short response.\n",
    temperature: 0,
    max_tokens: 8,
  }),
});
let generationData;
if (completionsResp.ok) {
  generationData = await completionsResp.json();
} else {
  const chatResp = await fetchWithTimeout(`${endpoint}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: "Endpoint smoke test. Generate a short response.",
        },
      ],
      temperature: 0,
      max_tokens: 32,
    }),
  });
  await assertOk(chatResp, "generation probe");
  generationData = await chatResp.json();
}
if (!Array.isArray(generationData?.choices) || generationData.choices.length === 0) {
  throw new Error("generation probe returned no choices");
}

console.log(`OpenAI-compatible API-key smoke passed: ${model} at ${endpoint}`);
