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
const frameCount = fps * duration;

const variants = [
  {
    name: 'balanced',
    title: 'Balanced',
    bg: ['#111820', '#0b0f15'],
    accent: '#3b82f6',
    feedShift: (p) => naturalFeedShift(p, 250),
    posts: [
      ['Personal note', 'Neighborhood Notes', 'Weekend market moved indoors. Booths and hours stay the same. Check the official page before forwarding older opening hours to another group or reposting the event details.', 'green'],
      ['Emotional', 'City Watch', 'Before sharing this policy claim, compare it with the original notice, date range, and the agency that published the chart. The caption may be reacting to only one part of the source.', 'yellow'],
      ['Needs source', 'Shared Update', 'A screenshot says a company changed its policy overnight, but the image does not show the source link, author, publication date, or whether the text was cropped from a longer thread.', 'red'],
    ],
    quote: 'This post may need the original notice before you share or react.',
    bullets: ['Emotion is present, but the claim needs source context.', 'Open deeper reading for background and follow-up questions.'],
    sideTitle: 'Reading context',
    sideBullets: ['Compare the claim with the original source.', 'Separate personal reaction from verifiable facts.'],
    questions: ['What did the notice actually say?', 'Who benefits from this framing?'],
    tools: ['Copy', 'Download', 'Ask Meta AI'],
  },
  {
    name: 'calm',
    title: 'Calm',
    bg: ['#121820', '#0e131a'],
    accent: '#60a5fa',
    feedShift: (p) => naturalFeedShift(p, 250),
    posts: [
      ['Low risk', 'Community Board', 'Library hours change this weekend. Check the official page before visiting, because the older schedule is still circulating in local groups and search snippets.', 'green'],
      ['Compare sources', 'Local Notes', 'A popular chart is missing the date range and original source. Read the caption before reacting or sharing it into another thread.', 'yellow'],
      ['Verify first', 'Forwarded Story', 'A cropped screenshot makes a strong claim without a link, author, publication date, or the surrounding context that would explain the original post.', 'red'],
    ],
    quote: 'Short signals help you decide when to slow down.',
    bullets: ['Most posts need only a light reminder.', 'Open details only when the claim deserves attention.'],
    sideTitle: 'Key points',
    sideBullets: ['Look for source, date, and missing context.', 'Use external tools only when you choose to.'],
    questions: ['What is the original source?', 'Is there newer context?'],
    tools: ['Copy', 'Download'],
  },
  {
    name: 'compact',
    title: 'Compact',
    bg: ['#10151d', '#090d13'],
    accent: '#2563ff',
    feedShift: (p) => naturalFeedShift(p, 250),
    posts: [
      ['Note', 'Daily Insight', 'Five points to check before trusting this trend summary, especially when the examples and dates are not shown together or the source list is incomplete.', 'green'],
      ['AI-like', 'Trend List', 'The structure is polished, but the sources are vague and should be checked before treating it as a verified summary or forwarding the conclusion.', 'yellow'],
      ['Missing proof', 'Shared Update', 'A claim appears as an image without links, dates, source context, or a path back to the original post where the claim first appeared.', 'red'],
    ],
    quote: 'Readable cues, short summary, and a path to deeper context.',
    bullets: ['Signal before reacting.', 'Ask better follow-up questions.'],
    sideTitle: 'Deeper reading',
    sideBullets: ['Claim, source, and missing evidence.', 'Questions for search or external tools.'],
    questions: ['What evidence is missing?', 'What should I verify?'],
    tools: ['Copy', 'Ask'],
  },
];

rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpRoot, { recursive: true });
mkdirSync(outDir, { recursive: true });

for (const variant of variants) {
  const frameDir = join(tmpRoot, variant.name);
  mkdirSync(frameDir, { recursive: true });
  for (let i = 0; i < frameCount; i += 1) {
    const progress = i / (frameCount - 1);
    writeFileSync(join(frameDir, `frame-${String(i).padStart(3, '0')}.svg`), renderFrame(variant, progress));
  }
}

await renderPngFrames();

for (const variant of variants) {
  const frameDir = join(tmpRoot, variant.name);

  const palette = join(frameDir, 'palette.png');
  const gif = join(outDir, `truly-demo-${variant.name}.gif`);
  runFfmpeg([
    '-y',
    '-framerate', String(fps),
    '-i', join(frameDir, 'frame-%03d.png'),
    '-vf', 'fps=12,scale=1120:-1:flags=lanczos,palettegen=stats_mode=diff',
    palette,
  ]);
  runFfmpeg([
    '-y',
    '-framerate', String(fps),
    '-i', join(frameDir, 'frame-%03d.png'),
    '-i', palette,
    '-lavfi', 'fps=12,scale=1120:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0',
    gif,
  ]);
  console.log(gif);
}

function renderFrame(variant, p) {
  const panel = '#151a21';
  const panel2 = '#1d2430';
  const line = '#2d3440';
  const text = '#f2f5f9';
  const muted = '#a9b1bd';
  const subtle = '#748093';
  const shift = variant.feedShift(p);
  const fade1 = fade(p, 0.18, 0.36);
  const fade2 = fade(p, 0.3, 0.52);
  const fade3 = fade(p, 0.48, 0.72);
  const pulse = 1 + Math.sin(p * Math.PI * 2) * 0.025;
  const compact = variant.name === 'compact';
  const gap = compact ? 12 : 16;
  const inset = compact ? 24 : 30;
  const contentW = width - inset * 2 - gap;
  const leftW = Math.floor(contentW / 2);
  const rightW = contentW - leftW;
  const topH = Math.floor((height - inset * 2 - gap) / 2);
  const bottomH = height - inset * 2 - gap - topH;
  const leftX = inset;
  const rightX = inset + leftW + gap;
  const topY = inset;
  const bottomY = inset + topH + gap;

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
    <clipPath id="feedClip"><rect x="${leftX}" y="${topY}" width="${leftW}" height="${topH}"/></clipPath>
    <clipPath id="summaryClip"><rect x="${leftX}" y="${bottomY}" width="${leftW}" height="${bottomH}" rx="18"/></clipPath>
  </defs>
  <rect width="1200" height="760" fill="url(#bg)"/>
  <rect width="1200" height="760" fill="url(#glow)"/>
  ${panelRect(leftX, topY, leftW, topH, 18, '#202327')}
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

  function renderSideChrome(x, y, w, h) {
    return `<g>
      ${panelRect(x, y, w, h, 18, panel)}
      <rect x="${x}" y="${y}" width="${w}" height="48" rx="18" fill="#10151d"/>
      <rect x="${x}" y="${y + 30}" width="${w}" height="20" fill="#10151d"/>
      ${textSvg('Truly', x + 22, y + 31, 16, text, 850)}
      ${textSvg('Deeper reading', x + w - 150, y + 31, 13, '#93c5fd', 800)}
    </g>`;
  }

  function renderPost(x, y, w, h, [hint, author, body, color], progress, index) {
    const dot = color === 'green' ? '#35c267' : color === 'yellow' ? '#eab308' : '#ef4444';
    const breathe = (Math.sin(progress * Math.PI * 4 + index * 0.9) + 1) / 2;
    const haloRadius = 9 + breathe * 3;
    const haloOpacity = 0.08 + breathe * 0.12;
    return `<g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#24272c" stroke="rgba(148,163,184,0.2)" stroke-width="1"/>
      <rect x="${x}" y="${y}" width="${w}" height="30" rx="14" fill="#1e2228"/>
      <rect x="${x}" y="${y + 16}" width="${w}" height="16" fill="#1e2228"/>
      <circle cx="${x + 18}" cy="${y + 15}" r="${haloRadius.toFixed(1)}" fill="${dot}" opacity="${haloOpacity.toFixed(3)}"/>
      <circle cx="${x + 18}" cy="${y + 15}" r="5.5" fill="${dot}"/>
      ${textSvg(hint, x + 31, y + 21, 13, '#d6dbe4', 760)}
      ${textSvg('analysis ready', x + w - 116, y + 21, 11, subtle, 700)}
      <circle cx="${x + 27}" cy="${y + 53}" r="16" fill="#3a4352"/>
      <circle cx="${x + 27}" cy="${y + 53}" r="15" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
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
      ${renderCursor(buttonX + 64, buttonY + 25, cursorOpacity)}
    </g>`;
  }

  function renderInteractivePost(x, y, w, h, dot, buttonX, buttonY, detailReveal, v) {
    const push = ease(detailReveal) * 124;
    const detailOpacity = detailReveal.toFixed(3);
    const bottomMaskOpacity = Math.min(1, detailReveal * 1.35).toFixed(3);
    return `<g>
      <clipPath id="summaryPushedPostClip">
        <rect x="${x + 1}" y="${y + 66}" width="${w - 2}" height="${h - 67}" rx="13"/>
      </clipPath>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#24272c" stroke="rgba(148,163,184,0.2)" stroke-width="1"/>
      <rect x="${x}" y="${y}" width="${w}" height="42" rx="14" fill="#1e2228"/>
      <rect x="${x}" y="${y + 24}" width="${w}" height="20" fill="#1e2228"/>
      <circle cx="${x + 18}" cy="${y + 21}" r="6" fill="${dot}"/>
      ${textSvg('Needs context', x + 31, y + 27, 13, text, 780)}
      <rect x="${buttonX + 9}" y="${y + 8}" width="78" height="26" rx="13" fill="rgba(37,99,235,0.18)" stroke="rgba(96,165,250,0.5)" stroke-width="1"/>
      ${textSvg('Details', buttonX + 25, y + 26, 12, '#bfdbfe', 800)}
      <g opacity="${detailOpacity}">
        <rect x="${x + 20}" y="${y + 66}" width="${w - 40}" height="104" rx="12" fill="#141b24" stroke="rgba(96,165,250,0.32)" stroke-width="1"/>
        <rect x="${x + 34}" y="${y + 84}" width="4" height="68" fill="${v.accent ?? variant.accent}"/>
        ${wrapText(v.quote, x + 50, y + 100, w - 84, 13, '#d9dee6', 1.28, 2)}
        ${v.bullets.slice(0, 2).map((item, index) => `${textSvg('•', x + 50, y + 139 + index * 16, 12, muted, 700)}${wrapText(item, x + 66, y + 139 + index * 16, w - 98, 11, muted, 1.16, 1)}`).join('\n')}
      </g>
      <g clip-path="url(#summaryPushedPostClip)">
      <g transform="translate(0 ${push.toFixed(1)})">
        <circle cx="${x + 34}" cy="${y + 84}" r="16" fill="#3a4352"/>
        ${textSvg('Shared Update', x + 58, y + 82, 15, text, 830)}
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
        <rect x="${x + 1}" y="${y + h - 14}" width="${w - 2}" height="13" fill="#24272c"/>
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
    const previewX = x + 22;
    const previewY = y + 66;
    const openX = previewX + cardW - 94;
    const openY = previewY + 8;
    const imageGap = 12;
    const imageW = (cardW - 52) / 2;
    const leftImageX = x + 42;
    const rightImageX = leftImageX + imageW + imageGap;
    const rightTextX = rightImageX + 62;
    const rightTextW = imageW - 78;
    return `<g>
      <g opacity="${previewOpacity.toFixed(3)}" transform="translate(${(-fade(p, 0.32, 0.52) * 42).toFixed(1)} 0)">
        <rect x="${previewX}" y="${previewY}" width="${cardW}" height="${h - 112}" rx="14" fill="#202327" stroke="rgba(148,163,184,0.2)" stroke-width="1"/>
        <rect x="${previewX}" y="${previewY}" width="${cardW}" height="42" rx="14" fill="#1e2228"/>
        <rect x="${previewX}" y="${previewY + 24}" width="${cardW}" height="20" fill="#1e2228"/>
        <circle cx="${previewX + 18}" cy="${previewY + 21}" r="6" fill="#eab308"/>
        ${textSvg('Needs source', previewX + 31, previewY + 27, 13, '#d6dbe4', 780)}
        <rect x="${openX}" y="${openY}" width="72" height="30" rx="15" fill="rgba(37,99,235,0.2)" stroke="rgba(96,165,250,0.55)" stroke-width="1"/>
        ${textSvg('Open', openX + 21, openY + 20, 12, '#bfdbfe', 800)}
        <circle cx="${x + 58}" cy="${y + 156}" r="16" fill="#3a4352"/>
        <circle cx="${x + 58}" cy="${y + 156}" r="15" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
        ${textSvg('Selected post', x + 84, y + 152, 18, text, 850)}
        ${textSvg('Shared Update · 12 min', x + 84, y + 176, 12, subtle, 650)}
        ${wrapText('A forwarded post claims that a policy changed overnight after a private meeting. The caption asks people to repost quickly before the original page disappears.', x + 42, y + 224, cardW - 78, 14, '#d9dee6', 1.34, 3)}
        ${wrapText('Two images are attached, but source, date, author, and context are still missing.', x + 42, y + 304, cardW - 78, 14, '#d9dee6', 1.34, 2)}
        <rect x="${leftImageX}" y="${y + 374}" width="${imageW}" height="118" rx="12" fill="#111827" stroke="rgba(148,163,184,0.18)" stroke-width="1"/>
        <rect x="${leftImageX + 16}" y="${y + 394}" width="${imageW - 24}" height="12" rx="6" fill="#64748b" opacity="0.8"/>
        <rect x="${leftImageX + 16}" y="${y + 418}" width="${imageW - 46}" height="9" rx="4.5" fill="#475569"/>
        <rect x="${leftImageX + 16}" y="${y + 438}" width="${imageW - 34}" height="9" rx="4.5" fill="#475569"/>
        <rect x="${leftImageX + 16}" y="${y + 462}" width="${imageW - 64}" height="9" rx="4.5" fill="#334155"/>
        <rect x="${rightImageX}" y="${y + 374}" width="${imageW}" height="118" rx="12" fill="#111827" stroke="rgba(148,163,184,0.18)" stroke-width="1"/>
        <circle cx="${rightImageX + 32}" cy="${y + 416}" r="18" fill="#334155"/>
        <rect x="${rightTextX}" y="${y + 398}" width="${rightTextW}" height="10" rx="5" fill="#64748b" opacity="0.8"/>
        <rect x="${rightTextX}" y="${y + 422}" width="${rightTextW - 14}" height="9" rx="4.5" fill="#475569"/>
        <rect x="${rightTextX}" y="${y + 444}" width="${rightTextW - 28}" height="9" rx="4.5" fill="#334155"/>
        <g opacity="${sideClick.toFixed(3)}">
          <circle cx="${openX + 36}" cy="${openY + 15}" r="${(9 + sideClick * 18).toFixed(1)}" fill="none" stroke="rgba(147,197,253,0.75)" stroke-width="2"/>
          ${renderCursor(openX + 30, openY + 21, 1)}
        </g>
      </g>
      <g opacity="${reveal.toFixed(3)}" transform="translate(${panelOffset.toFixed(1)} 0)">
      <g opacity="${Math.max(0.42, opacity1).toFixed(3)}">
        <rect x="${x + 22}" y="${y + 66}" width="${cardW}" height="86" rx="14" fill="#0f141a"/>
        ${textSvg('Selected post', x + 42, y + 99, 15, text, 850)}
        ${textSvg('Includes post text and image/video', x + 42, y + 122, 12, muted, 650)}
      </g>
      <g opacity="${opacity1.toFixed(3)}">
        ${textSvg(v.sideTitle, x + 34, y + 186, 16, text, 850)}
        <rect x="${x + 34}" y="${y + 202}" width="4" height="58" fill="${v.accent ?? variant.accent}"/>
        ${wrapText(v.quote ?? 'One-sentence summary and context for slower reading.', x + 50, y + 220, cardW - 50, 14, '#d9dee6', 1.45, 2)}
      </g>
      <g opacity="${opacity1.toFixed(3)}">
        ${textSvg('Reading context', x + 34, y + 302, 14, text, 850)}
        ${v.sideBullets.map((item, index) => `${textSvg('•', x + 38, y + 330 + index * 28, 15, muted, 700)}${wrapText(item, x + 58, y + 330 + index * 28, cardW - 46, 13, muted, 1.35, 1)}`).join('\n')}
      </g>
      <g opacity="${opacity2.toFixed(3)}">
        ${textSvg('Follow-up questions', x + 34, y + 418, 14, text, 850)}
        ${v.questions.map((item, index) => {
          const rowY = y + 446 + index * 34;
          return `${wrapText(item, x + 34, rowY, w - 150, 13, '#dbe2ec', 1.2, 1)}${textSvg('Ask Gemini', x + w - 126, rowY, 12, '#60a5fa', 800)}`;
        }).join('\n')}
      </g>
      <g opacity="${opacity3.toFixed(3)}">
        ${textSvg('External tools', x + 34, y + 526, 14, text, 850)}
        ${v.tools.map((tool, index) => button(x + 34 + index * 104, y + 558, tool)).join('\n')}
      </g>
      </g>
    </g>`;

    function button(bx, by, label) {
      const bw = Math.max(76, 32 + label.length * 8);
      return `<rect x="${bx}" y="${by}" width="${bw}" height="38" rx="10" fill="rgba(255,255,255,0.035)" stroke="rgba(148,163,184,0.28)" stroke-width="1"/>
      ${textSvg(label, bx + 16, by + 25, 13, text, 800)}`;
    }
  }
}

function renderCursor(x, y, opacity = 1) {
  return `<g opacity="${opacity}">
    <path d="M0 0 L0 24 L7 18 L11 28 L16 26 L12 16 L21 16 Z" transform="translate(${x} ${y}) rotate(-8)" fill="#f8fafc" stroke="#0f172a" stroke-width="1.2"/>
  </g>`;
}

function textSvg(content, x, y, size, color, weight = 500, opacity = 1) {
  return `<text x="${x}" y="${y}" font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" opacity="${opacity.toFixed(3)}">${escapeXml(content)}</text>`;
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
    for (const variant of variants) {
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

    for (const variant of variants) {
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
  for (const variant of variants) {
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
