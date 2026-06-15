#!/usr/bin/env node

const endpoint = (process.env.OLLAMA_VISION_ENDPOINT || "http://localhost:11434").replace(/\/+$/, "");
const model = process.env.OLLAMA_VISION_MODEL || "gemma4:e4b-it-qat";
const url = `${endpoint.replace(/\/v1$/, "")}/v1/chat/completions`;
const imageUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQTf7/HwAEvwKHHvca0gAAAABJRU5ErkJggg==";

const body = {
  model,
  messages: [
    {
      role: "system",
      content: "You are a vision capability probe. Answer with one lowercase English color word only.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: "What is the dominant color of the attached image? Answer with one word only." },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ],
  temperature: 0,
  max_tokens: 8,
  chat_template_kwargs: { enable_thinking: false },
};

if (model.includes(":") && !model.includes("/")) {
  body.reasoning_effort = "none";
}

const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 15_000);
try {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 240)}`);
  }
  const data = await resp.json();
  const raw = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!/\b(blue|cyan)\b/i.test(raw)) {
    throw new Error(`Vision probe did not identify the blue image. Raw: ${raw || "(empty)"}`);
  }
  console.log(`Ollama vision smoke passed: ${model} at ${endpoint} -> ${raw}`);
} finally {
  clearTimeout(timer);
}
