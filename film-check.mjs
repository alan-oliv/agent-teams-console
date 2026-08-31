// Visual verification for the film-theme work (task #13). The parts jsdom
// cannot answer: does the palette actually paint in a browser, and does the
// status bar overflow in the longest in-world team-name state — which bleeds
// rather than wraps, so it is silent unless measured.
import { chromium } from 'playwright';

const FILMS = [
  'inception', 'stranger', 'lotr', 'starwars', 'bttf',
  'pulp', 'godfather', 'dogs', 'matrix', 'breakingbad',
];

const browser = await chromium.launch();
const problems = [];

async function open(page, appearance) {
  await page.addInitScript((blob) => {
    window.localStorage.setItem('console.appearance', blob);
  }, JSON.stringify(appearance));
  await page.goto('http://localhost:5173/?view=wall', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1200);
}

// --- 1. every film paints its own ground, accent and semantic pair ---
console.log('=== palette lands on the root, in a real browser ===');
for (const film of FILMS) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await open(page, { theme: 'nocturne', movieTheme: film, filmPalette: true });

  const got = await page.evaluate(() => {
    const root = document.querySelector('.console');
    const s = getComputedStyle(root);
    const read = (n) => s.getPropertyValue(n).trim();
    return {
      bg: read('--color-bg'),
      accent: read('--color-accent'),
      warn: read('--warn'),
      fail: read('--fail'),
      n200: read('--color-neutral-200'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      portraits: document.querySelectorAll('[data-testid="portrait"]').length,
    };
  });
  const ok = got.bg && got.accent && got.warn && got.warn !== got.accent;
  console.log(
    `  ${film.padEnd(12)} bg ${got.bg.padEnd(8)} accent ${got.accent.padEnd(8)} ` +
      `warn ${got.warn.padEnd(8)} fail ${got.fail.padEnd(8)} portraits ${got.portraits} ${ok ? '' : ' <-- PROBLEM'}`,
  );
  if (!ok) problems.push(`${film}: palette did not land`);
  if (errs.length) problems.push(`${film}: console errors -> ${errs.slice(0, 2).join(' | ')}`);
  await page.close();
}

// --- 2. the status bar in the LONGEST team-name state ---
console.log('\n=== status bar, measured in every film state (bleeds, never wraps) ===');
for (const film of FILMS) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
  await open(page, { theme: 'nocturne', movieTheme: film, filmPalette: true });
  const bar = await page.evaluate(() => {
    const chip = document.querySelector('[data-testid="team-chip"]');
    const row = document.querySelector('[data-testid="status-bar"]') ?? chip?.closest('div')?.parentElement;
    if (!row) return null;
    return {
      chip: chip?.textContent ?? '(none)',
      scrollW: row.scrollWidth,
      clientW: row.clientWidth,
      height: Math.round(row.getBoundingClientRect().height),
    };
  });
  if (!bar) { problems.push(`${film}: no status bar found`); await page.close(); continue; }
  const overflow = bar.scrollW - bar.clientW;
  const flag = overflow > 1 ? ' <-- OVERFLOWS' : '';
  console.log(
    `  ${film.padEnd(12)} chip "${(bar.chip || '').padEnd(15)}" ` +
      `scroll ${String(bar.scrollW).padStart(5)} / client ${String(bar.clientW).padStart(5)} ` +
      `h=${bar.height}px${flag}`,
  );
  if (overflow > 1) problems.push(`${film}: status bar overflows by ${overflow}px`);
  await page.close();
}

// --- 3. narrow viewport, longest name: the state most likely to bleed ---
console.log('\n=== the fellowship at a narrow viewport ===');
for (const width of [1180, 1024, 900, 800]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await open(page, { theme: 'nocturne', movieTheme: 'lotr', filmPalette: true });
  const bar = await page.evaluate(() => {
    const chip = document.querySelector('[data-testid="team-chip"]');
    const row = chip?.closest('div')?.parentElement;
    return row ? { s: row.scrollWidth, c: row.clientWidth, h: Math.round(row.getBoundingClientRect().height) } : null;
  });
  if (bar) {
    const over = bar.s - bar.c;
    console.log(`  ${String(width).padStart(5)}px  scroll ${bar.s} / client ${bar.c}  h=${bar.h}px${over > 1 ? '  <-- OVERFLOWS by ' + over : ''}`);
    if (over > 1) problems.push(`lotr @${width}px: status bar overflows by ${over}px`);
  }
  await page.close();
}

// --- 4. palette OFF keeps the ground on the system theme ---
console.log('\n=== film palette off: ground stays on the system theme ===');
for (const theme of ['nocturne', 'organic', 'phosphor']) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
  await open(page, { theme, movieTheme: 'matrix', filmPalette: false });
  const got = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.console'));
    return { bg: s.getPropertyValue('--color-bg').trim(), warn: s.getPropertyValue('--warn').trim() };
  });
  console.log(`  system ${theme.padEnd(9)} -> bg ${got.bg}  warn ${got.warn}`);
  await page.close();
}

// --- 5. screenshots, for the eye ---
console.log('\n=== screenshots ===');
for (const [name, appearance, view] of [
  ['film-inception-wall', { movieTheme: 'inception', filmPalette: true }, 'wall'],
  ['film-pulp-wall', { movieTheme: 'pulp', filmPalette: true }, 'wall'],
  ['film-matrix-overview', { movieTheme: 'matrix', filmPalette: true }, 'overview'],
  ['film-lotr-rail', { movieTheme: 'lotr', filmPalette: true }, 'rail'],
  ['film-off-wall', { movieTheme: 'breakingbad', filmPalette: false }, 'wall'],
]) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
  await page.addInitScript((blob) => {
    window.localStorage.setItem('console.appearance', blob);
  }, JSON.stringify({ theme: 'nocturne', ...appearance }));
  await page.goto(`http://localhost:5173/?view=${view}`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `shot-${name}.png` });
  console.log(`  captured shot-${name}.png`);
  await page.close();
}

await browser.close();
console.log('\n=== PROBLEMS ===');
console.log(problems.length ? problems.join('\n') : '(none)');
