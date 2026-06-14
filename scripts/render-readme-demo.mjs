import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(repoRoot, 'docs/assets/demo');
const tmpRoot = join(repoRoot, 'tmp/readme-demo-frames');
const width = 1200;
const height = 760;
const fps = 12;
const duration = 5;
const holdDuration = 0.5;
const gifOutputWidth = 1200;
const animationFrameCount = fps * duration;
const holdFrameCount = Math.round(fps * holdDuration);
const frameCount = animationFrameCount + holdFrameCount;

const variants = [
  {
    name: 'balanced',
    title: 'Balanced',
    label: 'current',
    description: 'Current README default. Facebook-like feed, expanded hint, and side panel handoff.',
    style: 'balanced',
    bg: ['#111820', '#0b0f15'],
    accent: '#3b82f6',
    glow: { signal: true, detail: true },
    feedShift: (p) => naturalFeedShift(p, 210),
    posts: [
      ['Personal note', 'Neighborhood Notes', 'Weekend market moved indoors. Booths and hours stay the same. Check the official page before forwarding older opening hours to another group or reposting the event details.', 'green'],
      ['Needs context', 'City Watch', 'Before sharing this policy claim, compare it with the original notice, date range, and the agency that published the chart. The caption may be reacting to only one part of the source.', 'yellow'],
      ['Needs source', 'Forwarded Claim', 'A screenshot says a company changed its policy overnight, but the image does not show the source link, author, publication date, or whether the text was cropped from a longer thread.', 'red'],
    ],
    quote: 'This post may need the original notice before you share or react.',
    bullets: ['The tone is strong, but the claim still needs source context.', 'Open deeper reading for background and follow-up questions.'],
    sideTitle: 'Reading context',
    sideBullets: ['Check the original source before sharing.', 'Separate reaction from verifiable facts.'],
    questions: ['What did the notice actually say?', 'Who benefits from this framing?'],
    tools: ['Copy', 'Download', 'Ask Meta AI'],
  },
  {
    name: 'spotlight-rim',
    title: 'Spotlight · Rim Light',
    label: 'spotlight',
    description: 'Focuses attention with thin edge light around the active UI instead of covering content.',
    style: 'balanced',
    bg: ['#111820', '#0b0f15'],
    accent: '#3b82f6',
    spotlight: { mode: 'rim' },
    feedShift: (p) => naturalFeedShift(p, 250),
    posts: [
      ['Personal note', 'Neighborhood Notes', 'Weekend market moved indoors. Booths and hours stay the same. Check the official page before forwarding older opening hours to another group or reposting the event details.', 'green'],
      ['Needs context', 'City Watch', 'Before sharing this policy claim, compare it with the original notice, date range, and the agency that published the chart. The caption may be reacting to only one part of the source.', 'yellow'],
      ['Needs source', 'Forwarded Claim', 'A screenshot says a company changed its policy overnight, but the image does not show the source link, author, publication date, or whether the text was cropped from a longer thread.', 'red'],
    ],
    quote: 'This post may need the original notice before you share or react.',
    bullets: ['The tone is strong, but the claim still needs source context.', 'Open deeper reading for background and follow-up questions.'],
    sideTitle: 'Reading context',
    sideBullets: ['Check the original source before sharing.', 'Separate reaction from verifiable facts.'],
    questions: ['What did the notice actually say?', 'Who benefits from this framing?'],
    tools: ['Copy', 'Download', 'Ask Meta AI'],
  },
  {
    name: 'spotlight-aperture',
    title: 'Spotlight · Soft Aperture',
    label: 'spotlight',
    description: 'Quietly lowers surrounding contrast and leaves the opened hint at native brightness.',
    style: 'balanced',
    bg: ['#111820', '#0b0f15'],
    accent: '#3b82f6',
    spotlight: { mode: 'aperture' },
    feedShift: (p) => naturalFeedShift(p, 250),
    posts: [
      ['Personal note', 'Neighborhood Notes', 'Weekend market moved indoors. Booths and hours stay the same. Check the official page before forwarding older opening hours to another group or reposting the event details.', 'green'],
      ['Needs context', 'City Watch', 'Before sharing this policy claim, compare it with the original notice, date range, and the agency that published the chart. The caption may be reacting to only one part of the source.', 'yellow'],
      ['Needs source', 'Forwarded Claim', 'A screenshot says a company changed its policy overnight, but the image does not show the source link, author, publication date, or whether the text was cropped from a longer thread.', 'red'],
    ],
    quote: 'This post may need the original notice before you share or react.',
    bullets: ['The tone is strong, but the claim still needs source context.', 'Open deeper reading for background and follow-up questions.'],
    sideTitle: 'Reading context',
    sideBullets: ['Check the original source before sharing.', 'Separate reaction from verifiable facts.'],
    questions: ['What did the notice actually say?', 'Who benefits from this framing?'],
    tools: ['Copy', 'Download', 'Ask Meta AI'],
  },
  {
    name: 'spotlight-sweep',
    title: 'Spotlight · Guided Sweep',
    label: 'spotlight',
    description: 'Uses a narrow moving highlight to connect the clicked hint with deeper reading.',
    style: 'balanced',
    bg: ['#111820', '#0b0f15'],
    accent: '#3b82f6',
    spotlight: { mode: 'sweep' },
    feedShift: (p) => naturalFeedShift(p, 250),
    posts: [
      ['Personal note', 'Neighborhood Notes', 'Weekend market moved indoors. Booths and hours stay the same. Check the official page before forwarding older opening hours to another group or reposting the event details.', 'green'],
      ['Needs context', 'City Watch', 'Before sharing this policy claim, compare it with the original notice, date range, and the agency that published the chart. The caption may be reacting to only one part of the source.', 'yellow'],
      ['Needs source', 'Forwarded Claim', 'A screenshot says a company changed its policy overnight, but the image does not show the source link, author, publication date, or whether the text was cropped from a longer thread.', 'red'],
    ],
    quote: 'This post may need the original notice before you share or react.',
    bullets: ['The tone is strong, but the claim still needs source context.', 'Open deeper reading for background and follow-up questions.'],
    sideTitle: 'Reading context',
    sideBullets: ['Check the original source before sharing.', 'Separate reaction from verifiable facts.'],
    questions: ['What did the notice actually say?', 'Who benefits from this framing?'],
    tools: ['Copy', 'Download', 'Ask Meta AI'],
  },
  {
    name: 'glow-signal',
    title: 'Glow · Signal',
    label: 'glow',
    description: 'Lets the reading signal emit a small pulse without dimming the rest of the feed.',
    style: 'balanced',
    bg: ['#111820', '#0b0f15'],
    accent: '#3b82f6',
    glow: { signal: true },
    feedShift: (p) => naturalFeedShift(p, 250),
    posts: [
      ['Personal note', 'Neighborhood Notes', 'Weekend market moved indoors. Booths and hours stay the same. Check the official page before forwarding older opening hours to another group or reposting the event details.', 'green'],
      ['Needs context', 'City Watch', 'Before sharing this policy claim, compare it with the original notice, date range, and the agency that published the chart. The caption may be reacting to only one part of the source.', 'yellow'],
      ['Needs source', 'Forwarded Claim', 'A screenshot says a company changed its policy overnight, but the image does not show the source link, author, publication date, or whether the text was cropped from a longer thread.', 'red'],
    ],
    quote: 'This post may need the original notice before you share or react.',
    bullets: ['The tone is strong, but the claim still needs source context.', 'Open deeper reading for background and follow-up questions.'],
    sideTitle: 'Reading context',
    sideBullets: ['Check the original source before sharing.', 'Separate reaction from verifiable facts.'],
    questions: ['What did the notice actually say?', 'Who benefits from this framing?'],
    tools: ['Copy', 'Download', 'Ask Meta AI'],
  },
  {
    name: 'glow-detail',
    title: 'Glow · Detail',
    label: 'glow',
    description: 'Makes the expanded hint feel active with a soft outer bloom, while keeping post content unchanged.',
    style: 'balanced',
    bg: ['#111820', '#0b0f15'],
    accent: '#3b82f6',
    glow: { detail: true },
    feedShift: (p) => naturalFeedShift(p, 250),
    posts: [
      ['Personal note', 'Neighborhood Notes', 'Weekend market moved indoors. Booths and hours stay the same. Check the official page before forwarding older opening hours to another group or reposting the event details.', 'green'],
      ['Needs context', 'City Watch', 'Before sharing this policy claim, compare it with the original notice, date range, and the agency that published the chart. The caption may be reacting to only one part of the source.', 'yellow'],
      ['Needs source', 'Forwarded Claim', 'A screenshot says a company changed its policy overnight, but the image does not show the source link, author, publication date, or whether the text was cropped from a longer thread.', 'red'],
    ],
    quote: 'This post may need the original notice before you share or react.',
    bullets: ['The tone is strong, but the claim still needs source context.', 'Open deeper reading for background and follow-up questions.'],
    sideTitle: 'Reading context',
    sideBullets: ['Check the original source before sharing.', 'Separate reaction from verifiable facts.'],
    questions: ['What did the notice actually say?', 'Who benefits from this framing?'],
    tools: ['Copy', 'Download', 'Ask Meta AI'],
  },
];

const selectedVariantNames = new Set(
  (process.env.TRULY_DEMO_VARIANTS ?? 'balanced')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);
const renderVariants = selectedVariantNames.has('all')
  ? variants
  : variants.filter((variant) => selectedVariantNames.has(variant.name));

if (renderVariants.length === 0) {
  throw new Error(`No matching README demo variants for TRULY_DEMO_VARIANTS=${process.env.TRULY_DEMO_VARIANTS ?? 'balanced'}`);
}

rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpRoot, { recursive: true });
mkdirSync(outDir, { recursive: true });

for (const variant of renderVariants) {
  const frameDir = join(tmpRoot, variant.name);
  mkdirSync(frameDir, { recursive: true });
  for (let i = 0; i < frameCount; i += 1) {
    const progress = Math.min(i, animationFrameCount - 1) / (animationFrameCount - 1);
    writeFileSync(join(frameDir, `frame-${String(i).padStart(3, '0')}.svg`), renderFrame(variant, progress));
  }
}

await renderPngFrames();

for (const variant of renderVariants) {
  const frameDir = join(tmpRoot, variant.name);

  const palette = join(frameDir, 'palette.png');
  const gif = join(outDir, `truly-demo-${variant.name}.gif`);
  runFfmpeg([
    '-y',
    '-framerate', String(fps),
    '-i', join(frameDir, 'frame-%03d.png'),
    '-vf', `fps=${fps},scale=${gifOutputWidth}:-1:flags=lanczos,palettegen=stats_mode=diff`,
    palette,
  ]);
  runFfmpeg([
    '-y',
    '-framerate', String(fps),
    '-i', join(frameDir, 'frame-%03d.png'),
    '-i', palette,
    '-lavfi', `fps=${fps},scale=${gifOutputWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
    '-loop', '0',
    gif,
  ]);
  console.log(gif);
}

function getTheme(variant) {
  const base = {
    panel: '#151a21',
    feedPanel: '#202327',
    chrome: '#10151d',
    line: '#2d3440',
    text: '#f2f5f9',
    muted: '#a9b1bd',
    subtle: '#748093',
    link: '#93c5fd',
    post: '#24272c',
    postHeader: '#1e2228',
    postStroke: 'rgba(148,163,184,0.2)',
    avatar: '#3a4352',
    detail: '#141b24',
    detailStroke: 'rgba(96,165,250,0.32)',
    image: '#111827',
    imageLine: '#64748b',
    imageLineDim: '#475569',
  };

  if (variant.style === 'signal') {
    return {
      ...base,
      panel: '#0b171d',
      feedPanel: '#102027',
      chrome: '#08131a',
      line: '#1f4d5c',
      link: '#67e8f9',
      post: '#12242b',
      postHeader: '#0d1d24',
      postStroke: 'rgba(34,211,238,0.22)',
      avatar: '#244857',
      detail: '#071a21',
      detailStroke: 'rgba(34,211,238,0.36)',
      image: '#081821',
      imageLine: '#5eead4',
      imageLineDim: '#2dd4bf',
    };
  }

  if (variant.style === 'editorial') {
    return {
      ...base,
      panel: '#1c1714',
      feedPanel: '#28211d',
      chrome: '#140f0d',
      line: '#4a3730',
      link: '#fbbf24',
      post: '#2a211d',
      postHeader: '#1f1714',
      postStroke: 'rgba(245,158,11,0.18)',
      avatar: '#594539',
      detail: '#201711',
      detailStroke: 'rgba(245,158,11,0.34)',
      image: '#1f1714',
      imageLine: '#d6a85f',
      imageLineDim: '#8f6a3f',
    };
  }

  if (variant.style === 'console') {
    return {
      ...base,
      panel: '#07100c',
      feedPanel: '#0b1710',
      chrome: '#040a07',
      line: '#1f4b36',
      link: '#86efac',
      post: '#0c1711',
      postHeader: '#07110b',
      postStroke: 'rgba(52,211,153,0.22)',
      avatar: '#1f4634',
      detail: '#06130d',
      detailStroke: 'rgba(52,211,153,0.34)',
      image: '#07120d',
      imageLine: '#6ee7b7',
      imageLineDim: '#34d399',
    };
  }

  return base;
}

function renderFrame(variant, p) {
  const theme = getTheme(variant);
  const panel = theme.panel;
  const line = theme.line;
  const text = theme.text;
  const muted = theme.muted;
  const subtle = theme.subtle;
  const shift = variant.feedShift(p);
  const fade1 = fade(p, 0.18, 0.36);
  const fade2 = fade(p, 0.3, 0.52);
  const fade3 = fade(p, 0.48, 0.72);
  const pulse = 1 + Math.sin(p * Math.PI * 2) * 0.025;
  const compact = variant.style === 'console';
  const gap = compact ? 14 : 16;
  const inset = compact ? 28 : 30;
  const contentW = width - inset * 2 - gap;
  const leftW = Math.floor(contentW / 2);
  const rightW = contentW - leftW;
  const topH = Math.floor((height - inset * 2 - gap) / 2);
  const bottomH = height - inset * 2 - gap - topH;
  const leftX = inset;
  const rightX = inset + leftW + gap;
  const topY = inset;
  const bottomY = inset + topH + gap;
  const spotlightMode = variant.spotlight?.mode ?? 'none';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${variant.bg[0]}"/>
      <stop offset="1" stop-color="${variant.bg[1]}"/>
    </linearGradient>
    <radialGradient id="glow" cx="18%" cy="8%" r="42%">
      <stop offset="0" stop-color="${variant.accent}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${variant.accent}" stop-opacity="0"/>
    </radialGradient>
    <filter id="softGlow" x="-60%" y="-80%" width="220%" height="260%">
      <feGaussianBlur stdDeviation="9"/>
    </filter>
    <filter id="wideGlow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
    <clipPath id="feedClip"><rect x="${leftX}" y="${topY}" width="${leftW}" height="${topH}"/></clipPath>
    <clipPath id="summaryClip"><rect x="${leftX}" y="${bottomY}" width="${leftW}" height="${bottomH}" rx="18"/></clipPath>
  </defs>
  <rect width="1200" height="760" fill="url(#bg)"/>
  <rect width="1200" height="760" fill="url(#glow)"/>
  ${renderAtmosphere(variant, p)}
  ${panelRect(leftX, topY, leftW, topH, 18, theme.feedPanel)}
  ${panelRect(leftX, bottomY, leftW, bottomH, 18, panel)}
  ${renderSideChrome(rightX, topY, rightW, topH + gap + bottomH)}
  <g clip-path="url(#feedClip)">
    <g transform="translate(0 ${-shift.toFixed(2)})">
      ${variant.posts.map((post, index) => renderPost(leftX + 22, topY + 20 + index * 192, leftW - 44, compact ? 168 : 176, post, p, index)).join('\n')}
    </g>
  </g>
  <g clip-path="url(#summaryClip)">
    ${renderSummary(leftX, bottomY, leftW, bottomH, variant, p, fade1, fade2, pulse)}
  </g>
  ${renderSidePanel(rightX, topY, rightW, topH + gap + bottomH, variant, p, fade1, fade2, fade3)}
</svg>`;

  function panelRect(x, y, w, h, r, fill) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${line}" stroke-width="1.4"/>`;
  }

  function renderAtmosphere(v, progress) {
    if (v.style === 'signal') {
      const drift = (progress * 28).toFixed(1);
      return `<g opacity="0.42">
        <path d="M-80 ${180 + drift} C160 ${120 + drift} 280 ${260 + drift} 520 ${170 + drift} S900 ${120 + drift} 1280 ${210 + drift}" fill="none" stroke="#22d3ee" stroke-opacity="0.16" stroke-width="2"/>
        <path d="M-80 ${520 - drift} C180 ${460 - drift} 360 ${580 - drift} 620 ${500 - drift} S960 ${430 - drift} 1280 ${540 - drift}" fill="none" stroke="#35c267" stroke-opacity="0.12" stroke-width="2"/>
        ${Array.from({ length: 10 }, (_, i) => `<line x1="${80 + i * 112}" y1="0" x2="${80 + i * 112}" y2="760" stroke="#164e63" stroke-opacity="0.08"/>`).join('')}
      </g>`;
    }
    if (v.style === 'editorial') {
      return `<g opacity="0.46">
        <rect x="36" y="34" width="1128" height="692" rx="28" fill="none" stroke="#f59e0b" stroke-opacity="0.08" stroke-width="18"/>
        <circle cx="1010" cy="138" r="180" fill="#f59e0b" opacity="0.055"/>
        <circle cx="214" cy="640" r="210" fill="#fb7185" opacity="0.045"/>
      </g>`;
    }
    if (v.style === 'console') {
      return `<g opacity="0.34">
        ${Array.from({ length: 18 }, (_, i) => `<line x1="0" y1="${28 + i * 42}" x2="1200" y2="${28 + i * 42}" stroke="#14532d" stroke-opacity="0.16"/>`).join('')}
        <rect x="38" y="38" width="1124" height="684" rx="18" fill="none" stroke="#34d399" stroke-opacity="0.08" stroke-width="2"/>
      </g>`;
    }
    return '';
  }

  function renderSideChrome(x, y, w, h) {
    return `<g>
      ${panelRect(x, y, w, h, 18, panel)}
    </g>`;
  }

  function renderPost(x, y, w, h, [hint, author, body, color], progress, index) {
    const dot = color === 'green' ? '#35c267' : color === 'yellow' ? '#eab308' : '#ef4444';
    const breathe = (Math.sin(progress * Math.PI * 4 + index * 0.9) + 1) / 2;
    const haloRadius = 9 + breathe * 3;
    const haloOpacity = 0.08 + breathe * 0.12;
    const glowSignal = variant.glow?.signal === true;
    const signalRingOpacity = spotlightMode === 'none' ? 0 : 0.13 + breathe * 0.08;
    const signalRing = spotlightMode !== 'none'
      ? `<rect x="${x + 8}" y="${y + 6}" width="138" height="19" rx="9.5" fill="none" stroke="${dot}" stroke-opacity="${signalRingOpacity.toFixed(3)}" stroke-width="1.1"/>`
      : '';
    const signalGlow = glowSignal
      ? `<ellipse cx="${x + 76}" cy="${y + 16}" rx="84" ry="20" fill="${dot}" opacity="${(0.07 + breathe * 0.08).toFixed(3)}" filter="url(#softGlow)"/>
        <rect x="${x + 7}" y="${y + 5}" width="152" height="22" rx="11" fill="none" stroke="${dot}" stroke-opacity="${(0.18 + breathe * 0.14).toFixed(3)}" stroke-width="1.2"/>`
      : '';
    return `<g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${theme.post}" stroke="${theme.postStroke}" stroke-width="1"/>
      <rect x="${x}" y="${y}" width="${w}" height="30" rx="14" fill="${theme.postHeader}"/>
      <rect x="${x}" y="${y + 16}" width="${w}" height="16" fill="${theme.postHeader}"/>
      ${signalGlow}
      ${signalRing}
      <circle cx="${x + 18}" cy="${y + 15}" r="${haloRadius.toFixed(1)}" fill="${dot}" opacity="${haloOpacity.toFixed(3)}"/>
      <circle cx="${x + 18}" cy="${y + 15}" r="5.5" fill="${dot}"/>
      ${textSvg(hint, x + 31, y + 21, 13, '#d6dbe4', 760)}
      <rect x="${x + w - 64}" y="${y + 14}" width="24" height="3" rx="1.5" fill="${subtle}" opacity="0.34"/>
      <rect x="${x + w - 34}" y="${y + 14}" width="12" height="3" rx="1.5" fill="${subtle}" opacity="0.22"/>
      ${renderAvatar(x + 27, y + 53, 16, index)}
      ${textSvg(author, x + 54, y + 49, 15, text, 820)}
      ${textSvg('12 min · Public', x + 54, y + 70, 11, subtle, 650)}
      <circle cx="${x + w - 34}" cy="${y + 50}" r="3" fill="#aeb6c2"/>
      <circle cx="${x + w - 23}" cy="${y + 50}" r="3" fill="#aeb6c2"/>
      <circle cx="${x + w - 12}" cy="${y + 50}" r="3" fill="#aeb6c2"/>
      ${wrapText(body, x + 20, y + 100, w - 40, 12, '#d9dee6', 1.24, 4)}
    </g>`;
  }

  function renderSummary(x, y, w, h, v, p, opacity1, opacity2, scale) {
    const dot = v.name === 'calm' ? '#35c267' : '#eab308';
    const click = fade(p, 0.16, 0.28) * (1 - fade(p, 0.34, 0.44));
    const detailReveal = fade(p, 0.34, 0.56);
    const cursorOpacity = (1 - fade(p, 0.43, 0.58)).toFixed(3);
    const buttonX = x + w - 148;
    const buttonY = y + 36;
    return `<g>
      ${renderInteractivePost(x + 24, y + 20, w - 48, h - 40, dot, buttonX, buttonY, detailReveal, v)}
      <g opacity="${click.toFixed(3)}">
        <circle cx="${buttonX + 71}" cy="${buttonY + 18}" r="${(10 + click * 18).toFixed(1)}" fill="none" stroke="rgba(147,197,253,0.72)" stroke-width="2"/>
      </g>
      ${renderCursor(buttonX + (v.name === 'balanced' ? 69 : 64), buttonY + (v.name === 'balanced' ? 22 : 25), cursorOpacity)}
    </g>`;
  }

  function renderInteractivePost(x, y, w, h, dot, buttonX, buttonY, detailReveal, v) {
    const push = ease(detailReveal) * 136;
    const detailOpacity = fade(detailReveal, 0.28, 1).toFixed(3);
    const bottomMaskOpacity = Math.min(1, detailReveal * 1.35).toFixed(3);
    const active = ease(fade(detailReveal, 0.18, 1));
    const accent = v.accent ?? variant.accent;
    const glowDetail = v.glow?.detail === true;
    const detailRing = spotlightMode === 'rim'
      ? `<rect x="${x + 18}" y="${y + 64}" width="${w - 36}" height="108" rx="13" fill="none" stroke="${accent}" stroke-opacity="${(active * 0.34).toFixed(3)}" stroke-width="1.2"/>`
      : '';
    const detailGlow = glowDetail
      ? `<g opacity="${active.toFixed(3)}">
        <rect x="${x + 22}" y="${y + 70}" width="${w - 44}" height="96" rx="12" fill="${accent}" opacity="0.055"/>
        <rect x="${x + 20}" y="${y + 66}" width="${w - 40}" height="104" rx="12" fill="none" stroke="${accent}" stroke-opacity="0.2" stroke-width="7" filter="url(#wideGlow)"/>
        <rect x="${x + 20}" y="${y + 66}" width="${w - 40}" height="104" rx="12" fill="none" stroke="${accent}" stroke-opacity="0.28" stroke-width="1"/>
      </g>`
      : '';
    const detailAperture = spotlightMode === 'aperture'
      ? `<g opacity="${(active * 0.72).toFixed(3)}">
        <rect x="${x + 2}" y="${y + 44}" width="${w - 4}" height="20" fill="#020617" opacity="0.16"/>
        <rect x="${x + 2}" y="${y + 172}" width="${w - 4}" height="${Math.max(0, h - 173)}" fill="#020617" opacity="0.18"/>
      </g>`
      : '';
    const detailSweepX = x + 34 + fade(detailReveal, 0.12, 1) * (w - 110);
    const detailSweep = spotlightMode === 'sweep'
      ? `<line x1="${detailSweepX.toFixed(1)}" y1="${y + 66}" x2="${(detailSweepX + 46).toFixed(1)}" y2="${y + 66}" stroke="${accent}" stroke-opacity="${(active * 0.42).toFixed(3)}" stroke-width="2" stroke-linecap="round"/>`
      : '';
    return `<g>
      <clipPath id="summaryPushedPostClip">
        <rect x="${x + 1}" y="${y + 66}" width="${w - 2}" height="${h - 67}" rx="13"/>
      </clipPath>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${theme.post}" stroke="${theme.postStroke}" stroke-width="1"/>
      <rect x="${x}" y="${y}" width="${w}" height="42" rx="14" fill="${theme.postHeader}"/>
      <rect x="${x}" y="${y + 24}" width="${w}" height="20" fill="${theme.postHeader}"/>
      <circle cx="${x + 18}" cy="${y + 21}" r="6" fill="${dot}"/>
      ${textSvg('Needs context', x + 31, y + 27, 13, text, 780)}
      <rect x="${buttonX + 9}" y="${y + 8}" width="78" height="26" rx="13" fill="rgba(37,99,235,0.18)" stroke="rgba(96,165,250,0.5)" stroke-width="1"/>
      ${textSvg('Details', buttonX + 25, y + 26, 12, '#bfdbfe', 800)}
      ${detailAperture}
      <g opacity="${detailOpacity}">
        ${detailGlow}
        <rect x="${x + 20}" y="${y + 66}" width="${w - 40}" height="104" rx="12" fill="${theme.detail}" stroke="${theme.detailStroke}" stroke-width="1"/>
        ${detailRing}
        ${detailSweep}
        <rect x="${x + 34}" y="${y + 84}" width="4" height="68" fill="${v.accent ?? variant.accent}"/>
        ${wrapText(v.quote, x + 50, y + 100, w - 84, 13, '#d9dee6', 1.28, 2)}
        ${v.bullets.slice(0, 2).map((item, index) => `${textSvg('•', x + 50, y + 139 + index * 16, 12, muted, 700)}${wrapText(item, x + 66, y + 139 + index * 16, w - 98, 11, muted, 1.16, 1)}`).join('\n')}
      </g>
      <g clip-path="url(#summaryPushedPostClip)">
      <g transform="translate(0 ${push.toFixed(1)})">
        ${renderAvatar(x + 34, y + 84, 16, 2)}
        ${textSvg('Forwarded Claim', x + 58, y + 82, 15, text, 830)}
        ${textSvg('12 min · Public', x + 58, y + 103, 11, subtle, 650)}
        ${wrapText('A cropped screenshot is moving through several group chats with a strong claim about a policy change.', x + 20, y + 132, w - 40, 14, '#d9dee6', 1.32, 2)}
        ${wrapText('The image sounds urgent, but it does not include a source link, author name, publication date, or enough surrounding context to tell what was actually said.', x + 20, y + 178, w - 40, 14, '#d9dee6', 1.32, 3)}
        <g>
          <line x1="${x + 20}" y1="${y + 244}" x2="${x + w - 20}" y2="${y + 244}" stroke="rgba(148,163,184,0.14)" stroke-width="1"/>
          ${textSvg('Like', x + 24, y + 262, 10, subtle, 700)}
          ${textSvg('Comment', x + 94, y + 262, 10, subtle, 700)}
          ${textSvg('Share', x + 184, y + 262, 10, subtle, 700)}
        </g>
      </g>
      </g>
      <g opacity="${bottomMaskOpacity}">
        <rect x="${x + 1}" y="${y + h - 14}" width="${w - 2}" height="13" fill="${theme.post}"/>
        <line x1="${x + 1}" y1="${y + h - 1}" x2="${x + w - 1}" y2="${y + h - 1}" stroke="rgba(148,163,184,0.2)" stroke-width="1"/>
      </g>
    </g>`;
  }

  function renderSidePanel(x, y, w, h, v, p, opacity1, opacity2, opacity3) {
    const cardW = w - 44;
    const sideClick = fade(p, 0.18, 0.3) * (1 - fade(p, 0.34, 0.46));
    const reveal = fade(p, 0.42, 0.64);
    const previewOpacity = 1 - fade(p, 0.32, 0.52);
    const panelOffset = (1 - reveal) * 46;
    const browserX = x + 16;
    const browserY = y + 22;
    const browserW = w - 32;
    const browserH = h - 44;
    const previewX = browserX + 14;
    const previewY = browserY + 16;
    const previewW = browserW - 28;
    const openX = v.name === 'balanced'
      ? previewX + previewW - 112
      : browserX + browserW - 102;
    const openY = v.name === 'balanced'
      ? previewY + 42
      : browserY + 46;
    const feedSliverW = 116;
    const sideX = browserX + feedSliverW + 18;
    const sideW = browserW - feedSliverW - 32;
    const sideClipX = sideX;
    const sideClipW = sideW;
    const imageGap = 12;
    const imageW = (previewW - 32) / 2;
    const leftImageX = previewX + 14;
    const rightImageX = leftImageX + imageW + imageGap;
    const rightTextX = rightImageX + 62;
    const rightTextW = imageW - 78;
    const previewMediaY = previewY + 322;
    const previewFooterLineY = previewY + 470;
    const previewFooterTextY = previewY + 488;
    const accent = v.accent ?? variant.accent;
    const panelRing = spotlightMode === 'rim'
      ? `<rect x="${sideX - 10}" y="${browserY + 86}" width="${sideW + 12}" height="250" rx="16" fill="none" stroke="${accent}" stroke-opacity="${(reveal * 0.15).toFixed(3)}" stroke-width="1"/>`
      : '';
    const panelAperture = spotlightMode === 'aperture'
      ? `<g opacity="${(reveal * 0.38).toFixed(3)}">
        <rect x="${sideX - 10}" y="${browserY + 38}" width="${sideW + 18}" height="78" fill="#020617" opacity="0.16"/>
        <rect x="${sideX - 10}" y="${browserY + 400}" width="${sideW + 18}" height="${Math.max(0, browserH - 408)}" fill="#020617" opacity="0.12"/>
      </g>`
      : '';
    const panelSweepY = browserY + 132 + fade(p, 0.48, 0.72) * 132;
    const panelSweep = spotlightMode === 'sweep'
      ? `<line x1="${sideX - 2}" y1="${panelSweepY.toFixed(1)}" x2="${sideX - 2}" y2="${(panelSweepY + 46).toFixed(1)}" stroke="${accent}" stroke-opacity="${(reveal * 0.44).toFixed(3)}" stroke-width="2.3" stroke-linecap="round"/>`
      : '';
    const selectedOpacity = fade(p, 0.42, 0.58);
    const contextOpacity = fade(p, 0.52, 0.68);
    const checkOpacity = fade(p, 0.61, 0.76);
    const questionOpacity = fade(p, 0.7, 0.84);
    const toolOpacity = fade(p, 0.78, 0.92);
    const feedPush = ease(reveal) * -148;
    const feedOpacity = (1 - reveal * 0.42).toFixed(3);
    const sideSlide = (1 - reveal) * 94;
    const previewFooter = v.name === 'balanced'
      ? `<line x1="${previewX + 20}" y1="${previewFooterLineY}" x2="${previewX + previewW - 20}" y2="${previewFooterLineY}" stroke="rgba(148,163,184,0.14)" stroke-width="1"/>
        ${textSvg('Like', previewX + 24, previewFooterTextY, 10, subtle, 700)}
        ${textSvg('Comment', previewX + 94, previewFooterTextY, 10, subtle, 700)}
        ${textSvg('Share', previewX + 184, previewFooterTextY, 10, subtle, 700)}`
      : '';
    return `<g>
      <clipPath id="sideBrowserClip"><rect x="${browserX}" y="${browserY}" width="${browserW}" height="${browserH}" rx="15"/></clipPath>
      <clipPath id="sidePanelClip"><rect x="${sideClipX}" y="${browserY}" width="${sideClipW}" height="${browserH}"/></clipPath>
      <rect x="${browserX}" y="${browserY}" width="${browserW}" height="${browserH}" rx="15" fill="#0d1218" stroke="rgba(148,163,184,0.2)" stroke-width="1"/>
      <rect x="${browserX}" y="${browserY}" width="${browserW}" height="34" rx="15" fill="#121923"/>
      <rect x="${browserX}" y="${browserY + 22}" width="${browserW}" height="14" fill="#121923"/>
      <circle cx="${browserX + 20}" cy="${browserY + 17}" r="4" fill="#ef4444" opacity="0.55"/>
      <circle cx="${browserX + 34}" cy="${browserY + 17}" r="4" fill="#f59e0b" opacity="0.55"/>
      <circle cx="${browserX + 48}" cy="${browserY + 17}" r="4" fill="#22c55e" opacity="0.55"/>
      <rect x="${browserX + 72}" y="${browserY + 9}" width="${browserW - 160}" height="16" rx="8" fill="#0b1118" opacity="0.72"/>
      <g clip-path="url(#sideBrowserClip)">
      <g opacity="${feedOpacity}" transform="translate(${feedPush.toFixed(1)} 0)">
        <rect x="${previewX}" y="${previewY + 34}" width="${previewW}" height="${browserH - 62}" rx="14" fill="#202327" stroke="rgba(148,163,184,0.2)" stroke-width="1"/>
        <rect x="${previewX}" y="${previewY + 34}" width="${previewW}" height="42" rx="14" fill="#1e2228"/>
        <rect x="${previewX}" y="${previewY + 58}" width="${previewW}" height="20" fill="#1e2228"/>
        <circle cx="${previewX + 18}" cy="${previewY + 55}" r="6" fill="#eab308"/>
        ${textSvg('Needs source', previewX + 31, previewY + 61, 13, '#d6dbe4', 780)}
        <rect x="${openX}" y="${openY}" width="72" height="30" rx="15" fill="rgba(37,99,235,0.2)" stroke="rgba(96,165,250,0.55)" stroke-width="1"/>
        ${textSvg('Open', openX + 21, openY + 20, 12, '#bfdbfe', 800)}
        ${renderAvatar(previewX + 32, previewY + 122, 16, 2)}
        ${textSvg('Selected post', previewX + 58, previewY + 118, 18, text, 850)}
        ${textSvg('Forwarded Claim · 12 min', previewX + 58, previewY + 142, 12, subtle, 650)}
        ${wrapText('A forwarded post claims that a policy changed overnight after a private meeting. The caption asks people to repost quickly before the original page disappears.', previewX + 20, previewY + 190, previewW - 40, 14, '#d9dee6', 1.34, 3)}
        ${wrapText('Two images are attached, but source, date, author, and context are still missing.', previewX + 20, previewY + 270, previewW - 40, 14, '#d9dee6', 1.34, 2)}
        <rect x="${leftImageX}" y="${previewMediaY}" width="${imageW}" height="116" rx="12" fill="#111827" stroke="rgba(148,163,184,0.18)" stroke-width="1"/>
        <rect x="${leftImageX + 16}" y="${previewMediaY + 20}" width="${imageW - 24}" height="12" rx="6" fill="#64748b" opacity="0.8"/>
        <rect x="${leftImageX + 16}" y="${previewMediaY + 44}" width="${imageW - 46}" height="9" rx="4.5" fill="#475569"/>
        <rect x="${leftImageX + 16}" y="${previewMediaY + 64}" width="${imageW - 34}" height="9" rx="4.5" fill="#475569"/>
        <rect x="${leftImageX + 16}" y="${previewMediaY + 88}" width="${imageW - 64}" height="9" rx="4.5" fill="#334155"/>
        <rect x="${rightImageX}" y="${previewMediaY}" width="${imageW}" height="116" rx="12" fill="#111827" stroke="rgba(148,163,184,0.18)" stroke-width="1"/>
        <circle cx="${rightImageX + 32}" cy="${previewMediaY + 42}" r="18" fill="#334155"/>
        <rect x="${rightTextX}" y="${previewMediaY + 24}" width="${rightTextW}" height="10" rx="5" fill="#64748b" opacity="0.8"/>
        <rect x="${rightTextX}" y="${previewMediaY + 48}" width="${rightTextW - 14}" height="9" rx="4.5" fill="#475569"/>
        <rect x="${rightTextX}" y="${previewMediaY + 70}" width="${rightTextW - 28}" height="9" rx="4.5" fill="#334155"/>
        ${previewFooter}
        <g opacity="${sideClick.toFixed(3)}">
          <circle cx="${openX + 36}" cy="${openY + 15}" r="${(9 + sideClick * 18).toFixed(1)}" fill="none" stroke="rgba(147,197,253,0.75)" stroke-width="2"/>
          ${renderCursor(openX + 30, openY + 21, 1)}
        </g>
      </g>
      <rect x="${browserX}" y="${browserY + 34}" width="${feedSliverW}" height="${browserH - 34}" fill="#111820" opacity="${(reveal * 0.78).toFixed(3)}"/>
      <line x1="${browserX + feedSliverW}" y1="${browserY + 34}" x2="${browserX + feedSliverW}" y2="${browserY + browserH}" stroke="rgba(148,163,184,0.18)" stroke-width="1" opacity="${reveal.toFixed(3)}"/>
      <g clip-path="url(#sidePanelClip)" opacity="${reveal.toFixed(3)}" transform="translate(${sideSlide.toFixed(1)} 0)">
      ${panelAperture}
      ${panelRing}
      <rect x="${sideX - 2}" y="${browserY + 34}" width="${sideW + 12}" height="${browserH - 34}" fill="#0b1118"/>
      <g opacity="${selectedOpacity.toFixed(3)}">
        <rect x="${sideX + 8}" y="${browserY + 58}" width="${sideW - 8}" height="66" rx="12" fill="#0f141a" opacity="0.82"/>
        ${textSvg('Selected post', sideX + 26, browserY + 85, 12, muted, 800)}
        ${textSvg('Includes post text and image/video', sideX + 26, browserY + 105, 10, subtle, 650)}
      </g>
      <g opacity="${contextOpacity.toFixed(3)}">
        ${textSvg(v.sideTitle, sideX + 16, browserY + 164, 17, text, 860)}
        ${panelSweep}
        <rect x="${sideX + 16}" y="${browserY + 180}" width="4" height="54" fill="${v.accent ?? variant.accent}"/>
        ${wrapText(v.quote ?? 'One-sentence summary and context for slower reading.', sideX + 32, browserY + 198, sideW - 48, 13, '#d9dee6', 1.42, 2)}
      </g>
      <g opacity="${checkOpacity.toFixed(3)}">
        ${textSvg('What to check', sideX + 16, browserY + 276, 12, muted, 800)}
        ${v.sideBullets.map((item, index) => `${textSvg('•', sideX + 20, browserY + 304 + index * 26, 14, muted, 700)}${wrapText(item, sideX + 39, browserY + 304 + index * 26, sideW - 44, 12, muted, 1.35, 1)}`).join('\n')}
      </g>
      <g opacity="${questionOpacity.toFixed(3)}">
        ${textSvg('Follow-up questions', sideX + 16, browserY + 396, 15, text, 860)}
        ${v.questions.map((item, index) => {
          const rowY = browserY + 424 + index * 32;
          return `${wrapText(item, sideX + 16, rowY, sideW - 122, 12, '#dbe2ec', 1.2, 1)}${textSvg('Ask Gemini', sideX + sideW - 86, rowY, 11, '#60a5fa', 800)}`;
        }).join('\n')}
      </g>
      <g opacity="${toolOpacity.toFixed(3)}">
        ${textSvg('External tools', sideX + 16, browserY + 502, 13, text, 850)}
        ${button(sideX + 16, browserY + 532, 'Copy', 70)}
        ${button(sideX + 108, browserY + 532, 'Download', 94)}
        ${button(sideX + 224, browserY + 532, 'Ask Meta AI', 118)}
      </g>
      </g>
      </g>
    </g>`;

    function button(bx, by, label, bw) {
      return `<rect x="${bx}" y="${by}" width="${bw}" height="38" rx="10" fill="rgba(255,255,255,0.035)" stroke="rgba(148,163,184,0.28)" stroke-width="1"/>
      ${textSvg(label, bx + 16, by + 25, 13, text, 800)}`;
    }
  }

  function renderAvatar(cx, cy, radius) {
    return `<g>
      <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${theme.avatar}"/>
      <circle cx="${cx}" cy="${cy}" r="${radius - 1}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
      <circle cx="${cx}" cy="${cy - 4}" r="${(radius * 0.28).toFixed(1)}" fill="rgba(241,245,249,0.64)"/>
      <path d="M${(cx - radius * 0.48).toFixed(1)} ${(cy + radius * 0.54).toFixed(1)}
        C${(cx - radius * 0.42).toFixed(1)} ${(cy + radius * 0.12).toFixed(1)}
        ${(cx - radius * 0.16).toFixed(1)} ${(cy + radius * 0.02).toFixed(1)}
        ${cx} ${(cy + radius * 0.02).toFixed(1)}
        C${(cx + radius * 0.16).toFixed(1)} ${(cy + radius * 0.02).toFixed(1)}
        ${(cx + radius * 0.42).toFixed(1)} ${(cy + radius * 0.12).toFixed(1)}
        ${(cx + radius * 0.48).toFixed(1)} ${(cy + radius * 0.54).toFixed(1)} Z"
        fill="rgba(241,245,249,0.42)"/>
    </g>`;
  }
}

function renderCursor(x, y, opacity = 1) {
  return `<g opacity="${opacity}">
    <path d="M0 0 L0 24 L7 18 L11 28 L16 26 L12 16 L21 16 Z" transform="translate(${x} ${y}) rotate(-8)" fill="#f8fafc" stroke="#0f172a" stroke-width="1.2"/>
  </g>`;
}

function textSvg(content, x, y, size, color, weight = 500, opacity = 1) {
  return `<text x="${x}" y="${y}" font-family="Avenir Next, Aptos, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" opacity="${opacity.toFixed(3)}">${escapeXml(content)}</text>`;
}

function wrapText(content, x, y, maxWidth, size, color, lineHeight, maxLines) {
  const avg = size * 0.56;
  const maxChars = Math.max(12, Math.floor(maxWidth / avg));
  const words = content.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines.map((item, index) => textSvg(item, x, y + index * size * lineHeight, size, color)).join('\n');
}

function ease(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function naturalFeedShift(progress, distance) {
  const t = fade(progress, 0.14, 0.84);
  const eased = t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
  return eased * distance;
}

function fade(progress, start, end) {
  return ease((progress - start) / (end - start));
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function renderPngFrames() {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    for (const variant of renderVariants) {
      const frameDir = join(tmpRoot, variant.name);
      for (let i = 0; i < frameCount; i += 1) {
        const name = `frame-${String(i).padStart(3, '0')}`;
        await page.goto(`file://${join(frameDir, `${name}.svg`)}`);
        await page.screenshot({ path: join(frameDir, `${name}.png`), clip: { x: 0, y: 0, width, height } });
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
  const port = 9233;
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

    for (const variant of renderVariants) {
      const frameDir = join(tmpRoot, variant.name);
      for (let i = 0; i < frameCount; i += 1) {
        const name = `frame-${String(i).padStart(3, '0')}`;
        await cdp.navigate(`file://${join(frameDir, `${name}.svg`)}`);
        const screenshot = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
          fromSurface: true,
        });
        writeFileSync(join(frameDir, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
      }
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

function renderWithChromeCliForDebugOnly() {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  for (const variant of renderVariants) {
    const frameDir = join(tmpRoot, variant.name);
    for (let i = 0; i < frameCount; i += 1) {
      const name = `frame-${String(i).padStart(3, '0')}`;
      const result = spawnSync(chromePath, [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        `--window-size=${width},${height}`,
        `--screenshot=${join(frameDir, `${name}.png`)}`,
        `file://${join(frameDir, `${name}.svg`)}`,
      ], { stdio: 'pipe', encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(`Chrome screenshot failed:\n${result.stderr}`);
      }
    }
  }
}

function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', args, { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed:\n${result.stderr}`);
  }
}
