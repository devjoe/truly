import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(repoRoot, 'docs/assets/cws');
const tmpDir = join(repoRoot, 'tmp/cws-assets');
const demoFrameDir = join(repoRoot, 'tmp/readme-demo-frames/balanced');
const screenshotW = 1280;
const screenshotH = 800;
const demoW = 1200;
const demoH = 760;
const promoW = 440;
const promoH = 280;
const wordmarkSvg = extractWordmarkSvg(readFileSync(join(repoRoot, 'docs/assets/brand/truly-readme-lockup.svg'), 'utf8'));

const screenshotCandidates = [
  {
    id: '01-feed-signal',
    frame: 60,
    label: 'Feed signal',
    crop: { x: 30, y: 30, w: 562, h: 342 },
  },
  {
    id: '02-expanded-context',
    frame: 60,
    label: 'Expanded context',
    crop: { x: 30, y: 388, w: 562, h: 342 },
  },
  {
    id: '03-side-panel-handoff',
    frame: 60,
    label: 'Side panel handoff',
    crop: { x: 608, y: 30, w: 562, h: 704 },
  },
];

const screenshotProfessionalCandidates = [
  {
    id: '01-feed-signal',
    label: 'Heads-up before you read',
    variant: 'signal',
  },
  {
    id: '02-expanded-context',
    label: 'Expand for context',
    variant: 'context',
  },
  {
    id: '03-side-panel-handoff',
    label: 'Read deeper in the side panel',
    variant: 'handoff',
  },
];

const promoCandidates = [
  { id: 'promo-og-image', label: 'Native 440x280 promo tile, 2x supersampled', renderScale: 2 },
];

rmSync(outDir, { recursive: true, force: true });
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

renderDemoFrames();

for (const item of screenshotCandidates) {
  const svgPath = join(tmpDir, `${item.id}.svg`);
  writeFileSync(svgPath, renderScreenshotSvg(item));
}

for (const item of screenshotProfessionalCandidates) {
  const svgPath = join(tmpDir, `professional-${item.id}.svg`);
  writeFileSync(svgPath, renderProfessionalScreenshotSvg(item));
}

for (const item of promoCandidates) {
  const svgPath = join(tmpDir, `${item.id}.svg`);
  writeFileSync(svgPath, renderPromoSvg(item));
  if (item.renderScale > 1) {
    writeFileSync(join(tmpDir, `${item.id}@${item.renderScale}x.svg`), renderPromoSvg(item, item.renderScale));
  }
}

writeFileSync(join(outDir, 'truly-cws-assets.html'), renderReviewHtml());
await renderPngs();

function renderDemoFrames() {
  execFileSync('node', ['scripts/render-readme-demo.mjs'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, TRULY_DEMO_VARIANTS: 'balanced' },
  });
}

function renderScreenshotSvg(item) {
  const href = toFileHref(join(demoFrameDir, frameName(item.frame, 'svg')));
  const cropAspect = item.crop.w / item.crop.h;
  const fitW = cropAspect > 1.1 ? 1180 : 690;
  const fitH = cropAspect > 1.1 ? Math.round(fitW / cropAspect) : 720;
  const x = Math.round((screenshotW - fitW) / 2);
  const y = Math.round((screenshotH - fitH) / 2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${screenshotW}" height="${screenshotH}" viewBox="0 0 ${screenshotW} ${screenshotH}">
  <defs>
    <radialGradient id="bgGlow" cx="50%" cy="44%" r="68%">
      <stop offset="0" stop-color="#162033"/>
      <stop offset="0.58" stop-color="#0c1118"/>
      <stop offset="1" stop-color="#090d12"/>
    </radialGradient>
    <filter id="shadow" x="-14%" y="-14%" width="128%" height="132%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000814" flood-opacity="0.42"/>
    </filter>
  </defs>
  <rect width="${screenshotW}" height="${screenshotH}" fill="url(#bgGlow)"/>
  <rect x="${x - 16}" y="${y - 16}" width="${fitW + 32}" height="${fitH + 32}" rx="26" fill="#111820" stroke="rgba(148,163,184,0.22)" filter="url(#shadow)"/>
  <svg x="${x}" y="${y}" width="${fitW}" height="${fitH}" viewBox="${item.crop.x} ${item.crop.y} ${item.crop.w} ${item.crop.h}" preserveAspectRatio="xMidYMid meet">
    <image href="${href}" x="0" y="0" width="${demoW}" height="${demoH}"/>
  </svg>
</svg>`;
}

function renderProfessionalScreenshotSvg(item) {
  const href = toFileHref(join(demoFrameDir, frameName(60, 'svg')));
  if (item.variant === 'signal') {
    const crop = { x: 30, y: 30, w: 562, h: 342 };
    const layout = screenshotLayout(crop, { fitW: 980, x: 54, y: 170 });
    const signalBox = { x: 56, y: 32, w: 164, h: 34 };
    const signalPoint = sourcePointToCanvas(crop, layout, { x: 218, y: 49 });
    return renderScreenshotFrame(`
      ${renderOriginalCrop(href, crop, layout)}
      ${renderProfessionalBracketFromSource(crop, layout, signalBox)}
      ${renderEditorialLabel(720, 110, 'Heads-up before', 'you read')}
      ${renderProfessionalConnector(`M704 146 L${signalPoint.x} ${signalPoint.y}`)}
    `);
  }

  if (item.variant === 'context') {
    const crop = { x: 30, y: 388, w: 562, h: 342 };
    const layout = screenshotLayout(crop, { fitW: 940, x: 58, y: 194 });
    const contextBox = { x: 70, y: 470, w: 482, h: 112 };
    const contextPoint = sourcePointToCanvas(crop, layout, { x: 250, y: 470 });
    return renderScreenshotFrame(`
      ${renderOriginalCrop(href, crop, layout)}
      ${renderProfessionalBracketFromSource(crop, layout, contextBox)}
      ${renderEditorialLabel(708, 112, 'Expand for', 'context')}
      ${renderProfessionalConnector(`M696 154 L${contextPoint.x} ${contextPoint.y}`)}
    `);
  }

  // Crop inside the side panel's clip region (x=758..1140) so neither the dimmed
  // feed sliver on the left nor the browser content on the right can leak in.
  // Include the "Selected post" header (y=110) down to just below the External
  // tools buttons (y=622).
  const crop = { x: 760, y: 88, w: 378, h: 554 };
  const layout = { x: 729, y: 40, fitW: 491, fitH: 720 };
  // Highlight "What to check" (the claims to verify) — the panel's distinctive
  // value, and not a repeat of 02's context box.
  const focusBox = { x: 766, y: 312, w: 370, h: 88 };
  const focusPoint = sourcePointToCanvas(crop, layout, { x: 766, y: 356 });
  return renderScreenshotFrame(`
    ${renderOriginalCrop(href, crop, layout)}
    ${renderProfessionalHighlightFromSource(crop, layout, focusBox)}
    ${renderEditorialBlock(96, 250, 'Read deeper in', 'the side panel')}
    ${professionalBodyText('Summary, context, claims to check,', 96, 352, 22)}
    ${professionalBodyText('and follow-up questions — then', 96, 382, 22)}
    ${professionalBodyText('hand off only when you choose.', 96, 412, 22)}
    ${renderProfessionalConnector(`M450 404 L${focusPoint.x} ${focusPoint.y}`)}
  `);
}

function renderScreenshotFrame(content) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${screenshotW}" height="${screenshotH}" viewBox="0 0 ${screenshotW} ${screenshotH}">
  <defs>
    <radialGradient id="bgGlow" cx="50%" cy="44%" r="68%">
      <stop offset="0" stop-color="#162033"/>
      <stop offset="0.58" stop-color="#0c1118"/>
      <stop offset="1" stop-color="#090d12"/>
    </radialGradient>
    <filter id="shadow" x="-14%" y="-14%" width="128%" height="132%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000814" flood-opacity="0.42"/>
    </filter>
    <marker id="arrowTip" markerWidth="16" markerHeight="16" refX="11" refY="5" orient="auto" markerUnits="strokeWidth">
      <path d="M1 1 L11 5 L1 9" fill="none" stroke="#5b9cff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>
  <rect width="${screenshotW}" height="${screenshotH}" fill="url(#bgGlow)"/>
  ${content}
</svg>`;
}

function screenshotLayout(crop, override = {}) {
  const cropAspect = crop.w / crop.h;
  const fitW = override.fitW ?? (cropAspect > 1.1 ? 1180 : 690);
  const fitH = override.fitH ?? (cropAspect > 1.1 ? Math.round(fitW / cropAspect) : 720);
  return {
    fitW,
    fitH,
    x: override.x ?? Math.round((screenshotW - fitW) / 2),
    y: override.y ?? Math.round((screenshotH - fitH) / 2),
  };
}

function renderOriginalCrop(href, crop, layout) {
  return `<rect x="${layout.x - 16}" y="${layout.y - 16}" width="${layout.fitW + 32}" height="${layout.fitH + 32}" rx="26" fill="#111820" stroke="rgba(148,163,184,0.22)" filter="url(#shadow)"/>
  ${renderSourceCrop(href, crop, layout.x, layout.y, layout.fitW, layout.fitH)}`;
}

function renderSourceCrop(href, crop, x, y, width, height, opacity = 1) {
  return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${crop.x} ${crop.y} ${crop.w} ${crop.h}" preserveAspectRatio="xMidYMid meet" opacity="${opacity}">
    <image href="${href}" x="0" y="0" width="${demoW}" height="${demoH}"/>
  </svg>`;
}

function sourceRectToCanvas(crop, layout, rect) {
  const scale = Math.min(layout.fitW / crop.w, layout.fitH / crop.h);
  const contentW = crop.w * scale;
  const contentH = crop.h * scale;
  const baseX = layout.x + (layout.fitW - contentW) / 2;
  const baseY = layout.y + (layout.fitH - contentH) / 2;
  return {
    x: Math.round(baseX + (rect.x - crop.x) * scale),
    y: Math.round(baseY + (rect.y - crop.y) * scale),
    width: Math.round(rect.w * scale),
    height: Math.round(rect.h * scale),
  };
}

function sourcePointToCanvas(crop, layout, point) {
  const box = sourceRectToCanvas(crop, layout, { x: point.x, y: point.y, w: 0, h: 0 });
  return { x: box.x, y: box.y };
}

function renderProfessionalCallout(x, y, width, height, label, lines = 1) {
  const parts = lines === 1 ? [label] : label.split(' ');
  const text = lines === 1
    ? professionalText(label, x + 28, y + 58, 32)
    : `${professionalText(parts.slice(0, 2).join(' '), x + 28, y + 54, 31)}
       ${professionalText(parts.slice(2).join(' '), x + 28, y + 92, 31)}`;
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="#07131A" fill-opacity="0.94" stroke="#5b9cff" stroke-opacity="0.58" stroke-width="1.5"/>
    <rect x="${x + 18}" y="${y + 20}" width="4" height="${height - 40}" rx="2" fill="#5b9cff"/>
    ${text}
  </g>`;
}

function renderEditorialLabel(x, y, lineOne, lineTwo = '') {
  return `<g>
    <line x1="${x}" y1="${y - 44}" x2="${x + 68}" y2="${y - 44}" stroke="#5b9cff" stroke-opacity="0.72" stroke-width="1.6" stroke-linecap="round"/>
    ${professionalText(lineOne, x, y, 38)}
    ${lineTwo ? professionalText(lineTwo, x, y + 46, 38) : ''}
  </g>`;
}

function renderEditorialBlock(x, y, lineOne, lineTwo) {
  return `<g>
    <line x1="${x}" y1="${y - 50}" x2="${x + 72}" y2="${y - 50}" stroke="#5b9cff" stroke-opacity="0.72" stroke-width="1.6" stroke-linecap="round"/>
    ${professionalText(lineOne, x, y, 40)}
    ${professionalText(lineTwo, x, y + 50, 40)}
  </g>`;
}

function professionalText(value, x, y, size) {
  return `<text x="${x}" y="${y}" fill="#F2E8D0" font-family="Avenir Next, Aptos, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${size}" font-weight="700" letter-spacing="0">${escapeHtml(value)}</text>`;
}

function professionalBodyText(value, x, y, size) {
  return `<text x="${x}" y="${y}" fill="#9FB0C8" font-family="Avenir Next, Aptos, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${size}" font-weight="600" letter-spacing="0">${escapeHtml(value)}</text>`;
}

function renderProfessionalHighlight(x, y, width, height) {
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="#5b9cff" fill-opacity="0.035" stroke="#5b9cff" stroke-opacity="0.56" stroke-width="1.6"/>
  </g>`;
}

function renderProfessionalHighlightFromSource(crop, layout, rect) {
  const box = sourceRectToCanvas(crop, layout, rect);
  return renderProfessionalHighlight(box.x, box.y, box.width, box.height);
}

function renderProfessionalBracket(x, y, width, height) {
  const l = 28;
  const color = '#5b9cff';
  return `<g fill="none" stroke="${color}" stroke-opacity="0.64" stroke-width="1.7" stroke-linecap="round">
    <path d="M${x + l} ${y} H${x} V${y + l}"/>
    <path d="M${x + width - l} ${y} H${x + width} V${y + l}"/>
    <path d="M${x + l} ${y + height} H${x} V${y + height - l}"/>
    <path d="M${x + width - l} ${y + height} H${x + width} V${y + height - l}"/>
  </g>`;
}

function renderProfessionalBracketFromSource(crop, layout, rect) {
  const box = sourceRectToCanvas(crop, layout, rect);
  return renderProfessionalBracket(box.x, box.y, box.width, box.height);
}

function renderProfessionalConnector(path) {
  return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${path}" stroke="#07131A" stroke-width="5" stroke-opacity="0.84"/>
    <path d="${path}" stroke="#5b9cff" stroke-opacity="0.68" stroke-width="1.7"/>
    <circle cx="${pathEndpoint(path).x}" cy="${pathEndpoint(path).y}" r="4" fill="#5b9cff" fill-opacity="0.84"/>
  </g>`;
}

function pathEndpoint(path) {
  const matches = [...path.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)];
  const last = matches.at(-1);
  return { x: Number(last[1]), y: Number(last[2]) };
}

function renderPromoSvg(item, outputScale = 1) {
  const outputW = promoW * outputScale;
  const outputH = promoH * outputScale;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${outputW}" height="${outputH}" viewBox="0 0 ${promoW} ${promoH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0B1118"/>
      <stop offset="0.54" stop-color="#111820"/>
      <stop offset="1" stop-color="#18212D"/>
    </linearGradient>
    <radialGradient id="blueGlow" cx="24%" cy="18%" r="60%">
      <stop offset="0" stop-color="#2563FF" stop-opacity="0.3"/>
      <stop offset="0.42" stop-color="#2563FF" stop-opacity="0.09"/>
      <stop offset="1" stop-color="#2563FF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="panelGlow" cx="84%" cy="54%" r="62%">
      <stop offset="0" stop-color="#60A5FA" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#60A5FA" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${promoW}" height="${promoH}" fill="url(#bg)"/>
  <rect width="${promoW}" height="${promoH}" fill="url(#blueGlow)"/>
  <rect width="${promoW}" height="${promoH}" fill="url(#panelGlow)"/>
  ${renderPromoGrid()}
  <g transform="translate(26 30)">
    ${renderLogo(0, 0)}
    ${promoText('Reading help', 0, 105, 28, '#F7FAFC', 700)}
    ${promoText('beside the post', 0, 138, 28, '#F7FAFC', 700)}
  </g>
  <g transform="translate(252 38)">
    ${renderPromoMockup()}
  </g>
</svg>`;
}

function renderPromoGrid() {
  const vertical = Array.from({ length: 5 }, (_, i) => `<line x1="${60 + i * 88}" y1="0" x2="${60 + i * 88}" y2="${promoH}" stroke="#334155" stroke-opacity="0.06"/>`).join('');
  const horizontal = Array.from({ length: 3 }, (_, i) => `<line x1="0" y1="${64 + i * 72}" x2="${promoW}" y2="${64 + i * 72}" stroke="#334155" stroke-opacity="0.05"/>`).join('');
  return `<g>${vertical}${horizontal}</g>`;
}

function renderLogo(x, y) {
  return `<g transform="translate(${x} ${y})">
    <rect x="0" y="0" width="132" height="52" rx="13" fill="#EDF2F8" stroke="#C7D0DC" stroke-width="1"/>
    ${renderWordmark(15, 10, 98, 35)}
  </g>`;
}

function extractWordmarkSvg(source) {
  const match = source.match(/<svg\s+x="[^"]+"\s+y="[^"]+"\s+width="[^"]+"\s+height="[^"]+"[^>]*viewBox="77\.2 -33\.2 1765\.5 619\.3">[\s\S]*?<\/svg>/);
  if (!match) {
    throw new Error('Unable to extract Truly wordmark SVG from docs/assets/brand/truly-readme-lockup.svg');
  }
  return match[0]
    .replace(/x="[^"]+"\s+y="[^"]+"\s+width="[^"]+"\s+height="[^"]+"/, 'x="{x}" y="{y}" width="{width}" height="{height}"')
    .replace('id="trulyHalo"', 'id="{haloId}"')
    .replaceAll('url(#trulyHalo)', 'url(#{haloId})');
}

function renderWordmark(x, y, width, height) {
  return wordmarkSvg
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{width}', String(width))
    .replace('{height}', String(height))
    .replaceAll('{haloId}', `trulyHaloCws-${x}-${y}`);
}

function renderPromoMockup() {
  return `<g>
    <rect x="0" y="0" width="178" height="200" rx="24" fill="#0C131B" stroke="rgba(148,163,184,0.34)" stroke-width="1.4"/>
    <rect x="18" y="22" width="126" height="152" rx="18" fill="#161F2A" stroke="rgba(148,163,184,0.2)" stroke-width="1"/>

    <rect x="34" y="40" width="82" height="28" rx="14" fill="#101923" stroke="rgba(148,163,184,0.32)" stroke-width="1"/>
    <circle cx="50" cy="54" r="6" fill="#EAB308"/>
    <rect x="64" y="49" width="38" height="10" rx="5" fill="#E6ECF5"/>

    <circle cx="46" cy="92" r="14" fill="#334155"/>
    <rect x="68" y="82" width="50" height="8" rx="4" fill="#E6ECF5" opacity="0.86"/>
    <rect x="68" y="99" width="38" height="6" rx="3" fill="#8EA0B8"/>
    <rect x="34" y="126" width="86" height="7" rx="3.5" fill="#CBD5E1" opacity="0.58"/>
    <rect x="34" y="145" width="64" height="7" rx="3.5" fill="#CBD5E1" opacity="0.42"/>

    <path d="M112 86 C132 79 151 83 162 99" fill="none" stroke="#2563FF" stroke-width="3" stroke-linecap="round" opacity="0.76"/>
    <path d="M111 116 C132 126 150 124 164 111" fill="none" stroke="#5b9cff" stroke-width="3" stroke-linecap="round" opacity="0.78"/>

    <g transform="translate(88 76)">
      <rect x="0" y="0" width="80" height="106" rx="15" fill="#F8FAFC"/>
      <rect x="13" y="16" width="44" height="10" rx="5" fill="#E2E8F0"/>
      <rect x="13" y="42" width="4" height="42" rx="2" fill="#2563FF"/>
      <rect x="26" y="40" width="37" height="8" rx="4" fill="#1F2937"/>
      <rect x="26" y="58" width="30" height="6" rx="3" fill="#475569"/>
      <rect x="26" y="74" width="24" height="6" rx="3" fill="#94A3B8"/>
      <rect x="13" y="91" width="42" height="5" rx="2.5" fill="#334155" opacity="0.72"/>
    </g>
  </g>`;
}

function promoText(value, x, y, size, fill, weight = 700) {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Avenir Next, Aptos, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="0">${escapeHtml(value)}</text>`;
}

function cwsText(value, x, y, size, fill, weight = 700, anchor = 'start') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-family="Avenir Next, Aptos, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="0">${escapeHtml(value)}</text>`;
}

async function renderPngs() {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: screenshotW, height: screenshotH }, deviceScaleFactor: 1 });
    for (const item of screenshotCandidates) {
      await page.setViewportSize({ width: screenshotW, height: screenshotH });
      await page.goto(toFileHref(join(tmpDir, `${item.id}.svg`)));
      await page.screenshot({ path: join(outDir, `truly-cws-screenshot-${item.id}.png`), clip: { x: 0, y: 0, width: screenshotW, height: screenshotH } });
    }
    for (const item of screenshotProfessionalCandidates) {
      await page.setViewportSize({ width: screenshotW, height: screenshotH });
      await page.goto(toFileHref(join(tmpDir, `professional-${item.id}.svg`)));
      await page.screenshot({ path: join(outDir, `truly-cws-professional-screenshot-${item.id}.png`), clip: { x: 0, y: 0, width: screenshotW, height: screenshotH } });
    }
    for (const item of promoCandidates) {
      const scale = item.renderScale ?? 1;
      if (scale > 1) {
        const highResPath = join(tmpDir, `${item.id}@${scale}x.svg`);
        await page.setViewportSize({ width: promoW * scale, height: promoH * scale });
        await page.goto(toFileHref(highResPath));
        const highResBuffer = await page.screenshot({ clip: { x: 0, y: 0, width: promoW * scale, height: promoH * scale } });
        const finalBuffer = await downsamplePngWithPlaywright(page, highResBuffer, promoW, promoH);
        writeFileSync(join(outDir, `truly-cws-${item.id}.png`), finalBuffer);
      } else {
        await page.setViewportSize({ width: promoW, height: promoH });
        await page.goto(toFileHref(join(tmpDir, `${item.id}.svg`)));
        await page.screenshot({ path: join(outDir, `truly-cws-${item.id}.png`), clip: { x: 0, y: 0, width: promoW, height: promoH } });
      }
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
  const profile = join(tmpDir, `chrome-profile-${Date.now()}`);
  rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  mkdirSync(profile, { recursive: true });
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${screenshotW},${screenshotH}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    await waitForCdp(port);
    for (const item of screenshotCandidates) {
      await captureCdp(port, join(tmpDir, `${item.id}.svg`), join(outDir, `truly-cws-screenshot-${item.id}.png`), screenshotW, screenshotH);
    }
    for (const item of screenshotProfessionalCandidates) {
      await captureCdp(port, join(tmpDir, `professional-${item.id}.svg`), join(outDir, `truly-cws-professional-screenshot-${item.id}.png`), screenshotW, screenshotH);
    }
    for (const item of promoCandidates) {
      const scale = item.renderScale ?? 1;
      if (scale > 1) {
        await captureSupersampledCdp(
          port,
          join(tmpDir, `${item.id}@${scale}x.svg`),
          join(outDir, `truly-cws-${item.id}.png`),
          promoW,
          promoH,
          scale,
        );
      } else {
        await captureCdp(port, join(tmpDir, `${item.id}.svg`), join(outDir, `truly-cws-${item.id}.png`), promoW, promoH);
      }
    }
  } finally {
    chrome.kill('SIGTERM');
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1500);
      chrome.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
}

async function waitForCdp(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('Timed out waiting for Chrome CDP');
}

async function captureCdp(port, svgPath, pngPath, width, height) {
  const buffer = await captureCdpBuffer(port, svgPath, width, height);
  writeFileSync(pngPath, buffer);
}

async function captureSupersampledCdp(port, svgPath, pngPath, width, height, scale) {
  const highResBuffer = await captureCdpBuffer(port, svgPath, width * scale, height * scale);
  const finalBuffer = await downsamplePngCdp(port, highResBuffer, width, height);
  writeFileSync(pngPath, finalBuffer);
}

async function captureCdpBuffer(port, svgPath, width, height) {
  const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${toFileHref(svgPath)}`, { method: 'PUT' });
  const target = await targetResponse.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  const send = (method, params = {}) => {
    const messageId = ++id;
    socket.send(JSON.stringify({ id: messageId, method, params }));
    return new Promise((resolve) => pending.set(messageId, resolve));
  };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: toFileHref(svgPath) });
  await new Promise((resolve) => setTimeout(resolve, 350));
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  socket.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
  return Buffer.from(screenshot.result.data, 'base64');
}

async function downsamplePngCdp(port, sourceBuffer, width, height) {
  const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await targetResponse.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  const send = (method, params = {}) => {
    const messageId = ++id;
    socket.send(JSON.stringify({ id: messageId, method, params }));
    return new Promise((resolve) => pending.set(messageId, resolve));
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'about:blank' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const dataUrl = `data:image/png;base64,${sourceBuffer.toString('base64')}`;
  const expression = `(() => new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = ${width};
    canvas.height = ${height};
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const image = new Image();
    image.onload = () => {
      context.drawImage(image, 0, 0, ${width}, ${height});
      resolve(canvas.toDataURL('image/png').slice('data:image/png;base64,'.length));
    };
    image.onerror = () => reject(new Error('Unable to downsample PNG'));
    image.src = ${JSON.stringify(dataUrl)};
  }))()`;
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  socket.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
  return Buffer.from(result.result.result.value, 'base64');
}

async function downsamplePngWithPlaywright(page, sourceBuffer, width, height) {
  const dataUrl = `data:image/png;base64,${sourceBuffer.toString('base64')}`;
  const data = await page.evaluate(async ({ dataUrl, width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
  }, { dataUrl, width, height });
  return Buffer.from(data, 'base64');
}

function renderReviewHtml() {
  const screenshotItems = screenshotProfessionalCandidates.map((item) => `
    <article>
      <h2>${escapeHtml(item.id)} <span>${escapeHtml(item.label)}</span></h2>
      <img src="truly-cws-professional-screenshot-${item.id}.png" alt="${escapeHtml(item.label)}">
    </article>`).join('\n');
  const comparisonItems = screenshotProfessionalCandidates.map((item) => `
    <article>
      <h2>${escapeHtml(item.label)} <span>Original</span></h2>
      <img src="truly-cws-screenshot-${item.id}.png" alt="${escapeHtml(item.label)} original">
    </article>
    <article>
      <h2>${escapeHtml(item.label)} <span>Professional candidate</span></h2>
      <img src="truly-cws-professional-screenshot-${item.id}.png" alt="${escapeHtml(item.label)} professional candidate">
    </article>`).join('\n');
  const promoItems = promoCandidates.map((item) => `
    <article class="promo">
      <h2>${escapeHtml(item.id)} <span>${escapeHtml(item.label)}</span></h2>
      <img src="truly-cws-${item.id}.png" alt="${escapeHtml(item.label)}">
    </article>`).join('\n');
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Truly CWS asset candidates</title>
<style>
  :root { color-scheme: dark; background: #090d12; color: #e5edf8; font-family: Avenir Next, Aptos, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }
  body { margin: 0; padding: 32px; }
  h1 { margin: 0 0 8px; font-size: 28px; }
  p { margin: 0 0 24px; color: #9fb0c8; }
  h2 { margin: 0 0 10px; font-size: 14px; color: #dbeafe; }
  h2 span { color: #9fb0c8; font-weight: 500; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(520px, 1fr)); gap: 24px; }
  .compare { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  article { padding: 14px; border: 1px solid #263241; border-radius: 12px; background: #111820; }
  img { display: block; width: 100%; height: auto; border-radius: 8px; }
  .promo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; margin-top: 28px; }
  .promo img { max-width: 440px; }
  .section-title { margin: 34px 0 14px; font-size: 20px; color: #f7fafc; }
</style>
<body>
  <h1>Truly CWS asset candidates</h1>
  <p>Generated from the same balanced demo frames used for <code>docs/assets/demo/truly-demo-balanced.gif</code>.</p>
  <h2 class="section-title">Original vs professional</h2>
  <section class="grid compare">${comparisonItems}</section>
  <h2 class="section-title">Current selected set</h2>
  <section class="grid">${screenshotItems}</section>
  <section class="promo-grid">${promoItems}</section>
</body>
</html>`;
}

function frameName(index, extension = 'png') {
  return `frame-${String(index).padStart(3, '0')}.${extension}`;
}

function toFileHref(path) {
  return `file://${path}`;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
