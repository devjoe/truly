import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(repoRoot, 'docs/assets/social');
const tmpRoot = join(repoRoot, 'tmp/social-preview');
const width = 1280;
const height = 640;
const wordmarkSvg = extractWordmarkSvg(readFileSync(join(repoRoot, 'docs/assets/brand/truly-readme-lockup.svg'), 'utf8'));

const variants = [
  {
    id: 'en',
    file: 'truly-github-social-en',
    headline: 'Local-first reading clarity',
    subline: 'Calm reading for noisy pages.',
  },
  {
    id: 'bilingual',
    file: 'truly-github-social-bilingual',
    headline: 'Local-first reading clarity',
    subline: '在資訊混亂處，梳理脈絡',
  },
  {
    id: 'zh-tw',
    file: 'truly-github-social-zh-tw',
    headline: '注重隱私的閱讀幫手',
    subline: '在資訊混亂處，梳理脈絡。',
  },
];

rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpRoot, { recursive: true });
mkdirSync(outDir, { recursive: true });

for (const variant of variants) {
  writeFileSync(join(outDir, `${variant.file}.svg`), renderSvg(variant));
}

writeFileSync(join(outDir, 'truly-github-social.html'), renderReviewHtml());
await renderPngs();

for (const variant of variants) {
  console.log(join(outDir, `${variant.file}.png`));
}

function renderSvg(variant) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0B1118"/>
      <stop offset="0.54" stop-color="#111820"/>
      <stop offset="1" stop-color="#18212D"/>
    </linearGradient>
    <radialGradient id="blueGlow" cx="26%" cy="18%" r="58%">
      <stop offset="0" stop-color="#2563FF" stop-opacity="0.28"/>
      <stop offset="0.42" stop-color="#2563FF" stop-opacity="0.09"/>
      <stop offset="1" stop-color="#2563FF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="panelGlow" cx="84%" cy="50%" r="58%">
      <stop offset="0" stop-color="#60A5FA" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#60A5FA" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#020617" flood-opacity="0.38"/>
    </filter>
    <filter id="softBlue" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="7"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#blueGlow)"/>
  <rect width="${width}" height="${height}" fill="url(#panelGlow)"/>
  ${renderGrid()}

  <g transform="translate(78 100)">
    ${renderLogo(0, 0, { showSubtitle: variant.id !== 'en' })}
    ${renderHeadline(variant.headline, 8, 204, variant.id)}
    ${text(variant.subline, 10, variant.id === 'zh-tw' ? 330 : 370, 30, '#CBD5E1', 600)}
  </g>

  <g transform="translate(604 68)" filter="url(#shadow)">
    ${renderBrowserMockup(variant.id)}
  </g>
</svg>`;
}

function renderLogo(x, y, { showSubtitle = true } = {}) {
  const subtitle = showSubtitle ? `
    ${text('梳 理', 300, 69, 36, '#C7CFDA', 560)}` : '';
  return `<g transform="translate(${x} ${y})">
    <rect x="0" y="0" width="258" height="100" rx="21" fill="#EDF2F8" stroke="#C7D0DC" stroke-width="1.4"/>
    ${renderWordmark(25, 20, 194, 69)}${subtitle}
  </g>`;
}

function extractWordmarkSvg(source) {
  const match = source.match(/<svg x="18" y="19" width="150" height="53"[^>]*viewBox="77\.2 -33\.2 1765\.5 619\.3">[\s\S]*?<\/svg>/);
  if (!match) {
    throw new Error('Unable to extract Truly wordmark SVG from docs/assets/brand/truly-readme-lockup.svg');
  }
  return match[0]
    .replace('x="18" y="19" width="150" height="53"', 'x="{x}" y="{y}" width="{width}" height="{height}"')
    .replace('id="trulyHalo"', 'id="{haloId}"')
    .replaceAll('url(#trulyHalo)', 'url(#{haloId})');
}

function renderWordmark(x, y, width, height) {
  return wordmarkSvg
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{width}', String(width))
    .replace('{height}', String(height))
    .replaceAll('{haloId}', `trulyHaloSocial-${x}-${y}`);
}

function renderBrowserMockup(locale) {
  const selectedPost = locale === 'zh-tw' ? '選中的貼文' : 'Selected post';
  const readingContext = locale === 'zh-tw' ? '閱讀脈絡' : 'Reading context';
  const questionTitle = locale === 'zh-tw' ? '延伸問題' : 'Follow-up questions';
  const askGemini = locale === 'zh-tw' ? '問 Gemini' : 'Ask Gemini';
  const postContains = locale === 'zh-tw' ? '包含貼文文字與圖片/影片' : 'Includes text and image/video';
  const sideText = locale === 'zh-tw'
    ? '先分辨情緒、來源與可查證線索。'
    : 'Separate reaction from verifiable context.';

  return `<g>
    <rect x="0" y="0" width="604" height="492" rx="28" fill="#0D141C" stroke="rgba(148,163,184,0.25)" stroke-width="1.4"/>
    <rect x="0" y="0" width="604" height="52" rx="28" fill="#111A24"/>
    <rect x="0" y="30" width="604" height="24" fill="#111A24"/>
    <circle cx="31" cy="26" r="6" fill="#EF4444" opacity="0.62"/>
    <circle cx="51" cy="26" r="6" fill="#F59E0B" opacity="0.62"/>
    <circle cx="71" cy="26" r="6" fill="#22C55E" opacity="0.62"/>
    <rect x="104" y="16" width="356" height="20" rx="10" fill="#07111A" opacity="0.8"/>

    <g transform="translate(28 78)">
      <rect x="0" y="0" width="252" height="356" rx="18" fill="#1F252D" stroke="rgba(148,163,184,0.18)"/>
      <rect x="16" y="18" width="220" height="42" rx="21" fill="#171D24" stroke="rgba(148,163,184,0.2)"/>
      <circle cx="37" cy="39" r="7" fill="#EAB308"/>
      ${text(locale === 'zh-tw' ? '需要脈絡' : 'Needs context', 55, 45, 14, '#E6ECF5', 760)}
      <circle cx="32" cy="96" r="17" fill="#344155"/>
      <rect x="60" y="82" width="132" height="12" rx="6" fill="#DCE4EF" opacity="0.9"/>
      <rect x="60" y="105" width="82" height="8" rx="4" fill="#7C8A9C"/>
      <rect x="26" y="145" width="196" height="10" rx="5" fill="#D6DEE9" opacity="0.68"/>
      <rect x="26" y="169" width="182" height="10" rx="5" fill="#D6DEE9" opacity="0.54"/>
      <rect x="26" y="193" width="150" height="10" rx="5" fill="#D6DEE9" opacity="0.42"/>
      <rect x="26" y="247" width="88" height="10" rx="5" fill="#66758A"/>
      <rect x="130" y="247" width="82" height="10" rx="5" fill="#66758A"/>
    </g>

    <g transform="translate(310 78)">
      <rect x="0" y="0" width="252" height="356" rx="18" fill="#F8FAFC"/>
      <rect x="0" y="0" width="252" height="356" rx="18" fill="none" stroke="rgba(148,163,184,0.28)"/>
      <rect x="18" y="18" width="216" height="58" rx="12" fill="#EEF2F7"/>
      ${text(selectedPost, 36, 45, 15, '#111827', 820)}
      ${text(postContains, 36, 64, 10, '#64748B', 680)}

      ${text(readingContext, 18, 112, 16, '#1F2937', 820)}
      <rect x="18" y="130" width="4" height="58" fill="#2563FF"/>
      ${wrap(sideText, 34, 146, 176, 13, '#263241', 1.26, 2)}
      <rect x="34" y="198" width="156" height="7" rx="3.5" fill="#CBD5E1"/>
      <rect x="34" y="216" width="118" height="7" rx="3.5" fill="#CBD5E1"/>

      ${text(questionTitle, 18, 263, 15, '#334155', 820)}
      ${text(locale === 'zh-tw' ? '來源怎麼查？' : 'What source confirms it?', 18, 292, 12, '#475569', 700)}
      ${text(askGemini, 178, 292, 10, '#2563FF', 800)}
      ${text(locale === 'zh-tw' ? '還缺什麼脈絡？' : 'What context is missing?', 18, 318, 12, '#475569', 700)}
      ${text(askGemini, 178, 318, 10, '#2563FF', 800)}
    </g>
  </g>`;
}

function renderHeadline(value, x, y, locale) {
  if (locale === 'zh-tw') {
    return text(value, x, y + 42, 52, '#F7FAFC', 700);
  }
  const [first, ...rest] = value.split(' ');
  const line1 = [first, rest.shift()].filter(Boolean).join(' ');
  const line2 = rest.join(' ');
  return [
    text(line1, x, y + 42, 53, '#F7FAFC', 700),
    text(line2, x, y + 100, 53, '#F7FAFC', 700),
  ].join('');
}

function renderGrid() {
  const vertical = Array.from({ length: 10 }, (_, i) => {
    const x = 80 + i * 124;
    return `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#334155" stroke-opacity="0.065"/>`;
  }).join('');
  const horizontal = Array.from({ length: 5 }, (_, i) => {
    const y = 88 + i * 104;
    return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#334155" stroke-opacity="0.055"/>`;
  }).join('');
  return `<g>${vertical}${horizontal}</g>`;
}

function text(value, x, y, size, fill, weight = 700) {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Avenir Next, Aptos, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="0">${escapeXml(value)}</text>`;
}

function wrap(value, x, y, maxWidth, size, fill, lineHeight = 1.3, maxLines = 2) {
  const approx = size * 0.55;
  const words = value.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length * approx > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  return lines.map((line, i) => text(line, x, y + i * size * lineHeight, size, fill, 700)).join('');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderReviewHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Truly GitHub Social Preview</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #080b10;
        color: #f8fafc;
        font-family: "Avenir Next", Aptos, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }
      main {
        width: min(1380px, calc(100vw - 48px));
        margin: 32px auto 56px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
        line-height: 1.2;
      }
      p {
        margin: 0 0 22px;
        color: #a9b1bd;
        font-size: 14px;
      }
      .grid {
        display: grid;
        gap: 24px;
      }
      article {
        border: 1px solid #2d3440;
        border-radius: 18px;
        background: #11161d;
        padding: 16px;
      }
      article h2 {
        margin: 0 0 12px;
        color: #dce4ef;
        font-size: 17px;
      }
      img {
        display: block;
        width: 100%;
        height: auto;
        border: 1px solid #303846;
        border-radius: 14px;
        background: #0b1118;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Truly GitHub Social Preview</h1>
      <p>1280x640 source previews. Use one final image in GitHub repository settings.</p>
      <section class="grid">
        ${variants.map((variant) => `<article>
          <h2>${escapeXml(variant.id)}</h2>
          <img src="${variant.file}.svg" alt="Truly GitHub social preview ${escapeXml(variant.id)}">
        </article>`).join('')}
      </section>
    </main>
  </body>
</html>`;
}

async function renderPngs() {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    for (const variant of variants) {
      await page.goto(`file://${join(outDir, `${variant.file}.svg`)}`);
      await page.screenshot({
        path: join(outDir, `${variant.file}.png`),
        clip: { x: 0, y: 0, width, height },
      });
    }
    await browser.close();
    return;
  } catch (error) {
    console.warn(`Playwright unavailable, falling back to Chrome CDP: ${error.message}`);
  }

  await renderWithChromeCdp();
}

async function renderWithChromeCdp() {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const port = 9234;
  const profile = join(tmpRoot, 'chrome-profile');
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    await waitForChrome(port);
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const pageTarget = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error('Chrome CDP page target not found');
    const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
    const cdp = createCdpClient(socket);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    for (const variant of variants) {
      await cdp.navigate(`file://${join(outDir, `${variant.file}.svg`)}`);
      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true,
      });
      writeFileSync(join(outDir, `${variant.file}.png`), Buffer.from(screenshot.data, 'base64'));
    }
    socket.close();
  } finally {
    chrome.kill('SIGTERM');
  }
}

function createCdpClient(socket) {
  let id = 0;
  const pending = new Map();
  const waiters = new Map();
  const client = {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    }),
    send(method, params = {}) {
      const messageId = ++id;
      const promise = new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
      });
      socket.send(JSON.stringify({ id: messageId, method, params }));
      return promise;
    },
    waitFor(method) {
      return new Promise((resolve) => {
        const list = waiters.get(method) ?? [];
        list.push(resolve);
        waiters.set(method, list);
      });
    },
    async navigate(url) {
      const loaded = client.waitFor('Page.loadEventFired');
      await client.send('Page.navigate', { url });
      await loaded;
    },
  };

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) reject(new Error(payload.error.message));
      else resolve(payload.result ?? {});
      return;
    }
    if (payload.method && waiters.has(payload.method)) {
      const list = waiters.get(payload.method);
      waiters.delete(payload.method);
      for (const resolve of list) resolve(payload.params ?? {});
    }
  });

  return client;
}

async function waitForChrome(port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    try {
      await fetchJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Timed out waiting for Chrome CDP');
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}
