#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(resolve(root, "src/lib/ollama-cloud-capabilities.ts"), "utf8");

const updatedAt = /updatedAt:\s*"(\d{4}-\d{2}-\d{2})"/.exec(source)?.[1];
if (!updatedAt) fail("Missing OLLAMA_CLOUD_CAPABILITY_REGISTRY.updatedAt.");

const registryDate = new Date(`${updatedAt}T00:00:00`);
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const ageDays = Math.floor((today.getTime() - registryDate.getTime()) / 86_400_000);
if (!Number.isFinite(ageDays) || ageDays < 0) fail(`Invalid registry updatedAt: ${updatedAt}`);
if (ageDays > 45) {
  fail(`Ollama Cloud capability registry is ${ageDays} days old. Refresh it before release.`);
}

for (const sentinel of ["deepseek-v4-flash:cloud", "gemma4:cloud"]) {
  if (!source.includes(`id: "${sentinel}"`)) {
    fail(`Missing sentinel model in Ollama Cloud registry: ${sentinel}`);
  }
}

if (!source.includes('input: ["text"]') || !source.includes('input: ["text", "image"')) {
  fail("Registry must include both text-only and vision-capable examples.");
}

console.log(`Ollama Cloud capability registry fresh (${updatedAt}, ${ageDays} days old).`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
