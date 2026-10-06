import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { mkdir } from 'node:fs/promises';
let require = createRequire(import.meta.url), playwright;
try { playwright = require('playwright'); }
catch { require = createRequire(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/')); playwright = require('playwright'); }
const { chromium } = playwright;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined), headless: true });
const url = process.env.BASE_URL || 'http://127.0.0.1:4173';
const read = page => page.evaluate(() => JSON.parse(localStorage.getItem('ashfall.run.v1')));
const errors = [];
async function click(page, action, extra = '') {
  if (action === 'view' && !await page.locator(`[data-action="view"]${extra}:visible`).count()) await page.locator('.topbar [data-action="toggleLeft"]').click();
  const s = await read(page);
  await page.locator(`[data-action="${action}"]${extra}:visible`).first().click();
  if (action === 'resolveRound') await page.waitForFunction(revision => JSON.parse(localStorage.getItem('ashfall.run.v1')).revision > revision, s.revision);
}
async function audit(page, label) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${label}: overflow`);
  assert.deepEqual(await page.locator('button:visible').evaluateAll(elements => elements.filter(e => e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2).map(e => e.textContent)), [], `${label}: clipped buttons`);
  await page.screenshot({ path: `test-results/${label}.png`, fullPage: true });
}
try {
  await mkdir('test-results', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__audio = { contexts: [], oscillators: 0, gains: [] };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); window.__audio.contexts.push(this); }
      createOscillator() { window.__audio.oscillators++; return super.createOscillator(); }
      createGain() {
        const node = super.createGain(), setValue = node.gain.setValueAtTime.bind(node.gain);
        node.settings = [];
        node.gain.setValueAtTime = (value, time) => { node.settings.push(value); return setValue(value, time); };
        window.__audio.gains.push(node); return node;
      }
    };
  });
  await page.goto(url);
  assert.equal(await page.evaluate(() => __audio.contexts.length), 0, 'No autoplay before a user gesture');
  await click(page, 'selectClass', '[data-id="mage"]');
  await click(page, 'start');
  assert.ok(await page.locator('body').evaluate(el => el.classList.contains('left-collapsed') && el.classList.contains('right-collapsed')));
  assert.equal(await page.locator('.central-attributes > div').count(), 8);
  assert.equal(await page.locator('.dossier .attributes').count(), 0);
  assert.equal(await page.locator('.dossier').count(), 0);
  assert.ok(await page.evaluate(() => __audio.contexts[0].state === 'running' && __audio.oscillators > 0));
  await page.locator('.topbar [data-action="toggleRight"]').click(); assert.equal(await page.locator('.dossier').count(), 1);
  await audit(page, 'v2-right-open');
  await page.locator('.topbar [data-action="toggleRight"]').click();
  await page.locator('.topbar [data-action="toggleLeft"]').click();
  assert.ok(!await page.locator('body').evaluate(el => el.classList.contains('left-collapsed')));
  await click(page, 'view', '[data-id="skills"]'); await click(page, 'learn', '[data-id="barrier"]');
  await click(page, 'view', '[data-id="field"]');
  await page.locator('.topbar [data-action="toggleLeft"]').click();
  await page.reload();
  assert.ok(await page.locator('body').evaluate(el => el.classList.contains('left-collapsed') && el.classList.contains('right-collapsed')));
  await click(page, 'choose', '[data-id="accept"]'); await click(page, 'advance', '[data-route="risk"]');
  const initial = await read(page);
  await click(page, 'queue', '[data-kind="attack"]'); await click(page, 'queue', '[data-id="barrier"]');
  assert.equal((await read(page)).rng, initial.rng);
  assert.equal((await read(page)).player.hp, initial.player.hp);
  assert.ok(await page.locator('[data-action="queue"][data-kind="attack"]').isDisabled());
  await click(page, 'moveAction', '[data-index="1"][data-direction="-1"]');
  assert.equal((await read(page)).battle.plan[0].id, 'barrier');
  const queued = await read(page); await page.reload(); assert.deepEqual(await read(page), queued);
  await audit(page, 'v2-ordered-actions');
  await click(page, 'resolveRound');
  assert.equal((await read(page)).battle.round, 1); assert.equal((await read(page)).player.hp, 16);
  assert.equal((await read(page)).battle.plan.length, 0);
  await click(page, 'queue', '[data-kind="attack"]');
  await click(page, 'removeAction', '[data-index="0"]');
  assert.equal((await read(page)).battle.plan.length, 0);
  await click(page, 'queue', '[data-kind="attack"]'); await click(page, 'clearPlan');
  assert.equal((await read(page)).battle.plan.length, 0);
  const beforeDoubleClick = await read(page);
  await page.locator('[data-action="resolveRound"]').evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(revision => JSON.parse(localStorage.getItem('ashfall.run.v1')).revision > revision, beforeDoubleClick.revision);
  const afterDoubleClick = await read(page);
  assert.equal(afterDoubleClick.revision, beforeDoubleClick.revision + 1);
  assert.equal(afterDoubleClick.battle.round, beforeDoubleClick.battle.round + 1);
  console.log('PASS: auto-collapse, independent sidebar toggles, central attributes, AP queue, reorder, undo, reload and round execution');

  await click(page, 'view', '[data-id="bestiary"]');
  assert.equal(await page.locator('.codex-card').count(), 15);
  await page.locator('#codex-search').fill('失控巡逻员'); assert.equal(await page.locator('.codex-card').count(), 1);
  await click(page, 'enemyDetail', '[data-id="regular-0"]');
  assert.ok(await page.locator('dialog').innerText().then(t => t.includes('遭遇 1 次') && t.includes('生命')));
  await click(page, 'closeModal');
  await page.locator('#codex-search').fill(''); await page.locator('#codex-filter').selectOption('boss');
  assert.equal(await page.locator('.codex-card').count(), 9);
  await page.locator('#codex-filter').selectOption('seen'); assert.equal(await page.locator('.codex-card').count(), 1);
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('ashfall.bestiary.v1')));
  await page.reload(); assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('ashfall.bestiary.v1'))), seen);
  await click(page, 'view', '[data-id="bestiary"]'); await page.locator('#codex-filter').selectOption('all');
  await audit(page, 'v2-bestiary');

  await click(page, 'soundSettings');
  await page.locator('#sound-volume').fill('25');
  assert.equal(await page.locator('#volume-value').innerText(), '25%');
  await page.locator('#sound-enabled').uncheck();
  // Headless Windows may suspend the audio render clock; verify the scheduled gain here and rendered silence offline below.
  assert.equal(await page.evaluate(() => __audio.gains[0].settings.at(-1)), 0);
  const mutedCount = await page.evaluate(() => __audio.oscillators);
  await click(page, 'previewSound');
  assert.equal(await page.evaluate(() => __audio.oscillators), mutedCount, 'Muted preview creates no sound nodes');
  await page.locator('#sound-enabled').check();
  await click(page, 'previewSound');
  assert.ok(await page.evaluate(() => __audio.oscillators) > mutedCount);
  await audit(page, 'v2-sound-settings'); await click(page, 'closeModal'); await page.reload();
  await click(page, 'soundSettings'); assert.equal(await page.locator('#sound-volume').inputValue(), '25');
  await click(page, 'closeModal');
  const waveforms = await page.evaluate(async () => {
    const { SoundEffects } = await import('/src/audio.js');
    const results = [];
    for (const enabled of [true, false]) {
      const s = new SoundEffects(), ctx = new OfflineAudioContext(1, 22050, 44100);
      s.context = ctx; s.master = ctx.createGain(); s.master.connect(ctx.destination);
      s.configure(enabled, .5); s.tone(440, .2, 'sine', 0, 660, .4);
      const buffer = await ctx.startRendering();
      results.push(buffer.getChannelData(0).reduce((max, v) => Math.max(max, Math.abs(v)), 0));
    }
    return results;
  });
  assert.ok(waveforms[0] > .01, 'Synthesizer produces a non-silent waveform');
  assert.equal(waveforms[1], 0, 'Muted master produces silence even with a queued tone');
  console.log('PASS: bestiary catalog, search, filters, detail, idempotent counters, Web Audio activation, mute, volume persistence and non-silent waveform');

  await click(page, 'view', '[data-id="field"]');
  await page.locator('.topbar [data-action="new"]').click(); await click(page, 'confirmReset');
  await click(page, 'start');
  await click(page, 'view', '[data-id="bestiary"]'); await page.locator('#codex-filter').selectOption('seen');
  assert.equal(await page.locator('.codex-card').count(), 1, 'Bestiary survives new runs');
  await page.evaluate(async () => {
    const { newRun, dispatch } = await import('/src/engine.js');
    let s = newRun('rogue', 'theatre', 9999); s = dispatch(s, { type: 'choose', id: 'accept' }); s = dispatch(s, { type: 'advance', route: 'risk' });
    s.version = 1; delete s.enemyRecords; delete s.battle.plan; delete s.battle.maxAp; delete s.battle.enemy.definitionId;
    s.player.hp = 7;
    localStorage.setItem('ashfall.run.v1', JSON.stringify(s));
  });
  await page.reload(); const migrated = await read(page);
  assert.equal(migrated.version, 3); assert.equal(migrated.player.hp, 7); assert.equal(migrated.seed, 9999); assert.equal(migrated.battle.maxAp, 3);
  console.log('PASS: cross-run codex persistence and browser migration of an in-progress v1 save');

  for (const width of [320, 390, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message));
    await p.goto(url); await click(p, 'start');
    await click(p, 'choose', '[data-id="accept"]'); await click(p, 'advance', '[data-route="risk"]');
    await click(p, 'queue', '[data-kind="attack"]'); await click(p, 'queue', '[data-id="smash"]');
    await audit(p, `v2-queue-${width}`);
    const font = await p.locator('.narrative').evaluate(e => ({ size: parseFloat(getComputedStyle(e).fontSize), weight: Number(getComputedStyle(e).fontWeight) }));
    assert.ok(font.size >= 16 && font.weight >= 600);
    await click(p, 'view', '[data-id="bestiary"]'); await audit(p, `v2-bestiary-${width}`);
    await p.locator('.topbar [data-action="toggleRight"]').click(); await audit(p, `v2-drawer-${width}`);
    await p.locator('.dossier [data-action="toggleRight"]').click();
    await click(p, 'soundSettings'); await audit(p, `v2-audio-${width}`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: mobile queued actions, readable font size/weight, bestiary, drawers, audio settings; no clipping or browser errors');
} finally { await browser.close(); }
