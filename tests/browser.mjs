import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { builds, choosePlan } from './simulate.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let require = createRequire(import.meta.url), playwright;
try { playwright = require('playwright'); }
catch {
  require = createRequire(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/'));
  playwright = require('playwright');
}
const executablePath = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const browser = await playwright.chromium.launch({ headless: true, executablePath });
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const results = path.join(root, 'test-results');
await mkdir(results, { recursive: true });
const errors = [];
const read = page => page.evaluate(() => JSON.parse(localStorage.getItem('ashfall.run.v1')));
async function click(page, action, extra = '') {
  if (action === 'view' && !await page.locator(`[data-action="view"]${extra}:visible`).count()) await page.locator('.topbar [data-action="toggleLeft"]').click();
  const previous = await read(page);
  await page.locator(`[data-action="${action}"]${extra}:visible`).first().click();
  if (action === 'resolveRound') await page.waitForFunction(revision => JSON.parse(localStorage.getItem('ashfall.run.v1')).revision > revision, previous.revision);
}
async function audit(page, name) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, images: [...document.images].every(i => i.complete && i.naturalWidth > 0) }));
  assert.equal(dimensions.width, dimensions.viewport, `${name}: horizontal overflow`);
  assert.ok(dimensions.images, `${name}: missing images`);
  const clipped = await page.locator('button:visible').evaluateAll(buttons => buttons.filter(b => b.scrollWidth > b.clientWidth + 2 || b.scrollHeight > b.clientHeight + 2).map(b => b.innerText));
  assert.deepEqual(clipped, [], `${name}: clipped button content`);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(results, `${name}.png`), fullPage: true });
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(baseURL);
  await audit(page, 'desktop-registration');
  const scene = await page.locator('.scene').screenshot();
  const sharp = require('sharp');
  const stats = await sharp(scene).stats();
  assert.ok(stats.entropy > 3, 'Scene must contain rendered game artwork');
  for (const [i, classId] of ['warrior', 'rogue', 'mage'].entries()) {
    if (i) await click(page, 'new');
    await click(page, 'selectClass', `[data-id="${classId}"]`);
    await click(page, 'selectCampaign', `[data-id="${['cult', 'oracle', 'theatre'][i]}"]`);
    await click(page, 'start');
    let steps = 0, captured = false;
    while ((await read(page)).status === 'active' && steps++ < 300) {
      let s = await read(page);
      if (s.player.skillPoints && (!s.battle || s.encounter.resolved)) {
        await click(page, 'view', '[data-id="skills"]');
        for (const id of builds[classId]) {
          const learn = page.locator(`[data-action="learn"][data-id="${id}"]`);
          if (await learn.count() && await learn.isEnabled()) await learn.click();
        }
        if (s.player.level === 4) await audit(page, `skills-${classId}`);
        await click(page, 'view', '[data-id="field"]');
        s = await read(page);
      }
      if (s.pendingGrowth) { await click(page, 'grow', '[data-choice="health"]'); await click(page, 'view', '[data-id="field"]'); continue; }
      if (s.encounter.resolved) { await click(page, 'advance'); continue; }
      if (s.battle) {
        if (s.stance !== 'guard') { await click(page, 'stance', '[data-id="guard"]'); continue; }
        if (!captured) {
          await audit(page, `combat-${classId}`);
          const before = await read(page); await page.reload(); assert.deepEqual(await read(page), before, 'Reload must preserve entire battle and RNG');
          captured = true;
        }
        for (const action of choosePlan(s)) await click(page, 'queue', `[data-kind="${action.kind}"]${action.id ? `[data-id="${action.id}"]` : ''}`);
        await click(page, 'resolveRound');
      } else if (s.encounter.type === 'intro') await click(page, 'choose', '[data-id="accept"]');
      else if (s.encounter.type === 'event') await click(page, 'choose', '[data-id="class"]');
      else if (s.encounter.type === 'camp') await click(page, 'rest', '[data-choice="heal"]');
      else if (s.encounter.type === 'shop') {
        if (s.player.gold >= 14 && (s.player.armorBuys || 0) < 3 && !s.encounter.purchases.armor) await click(page, 'buy', '[data-id="armor"]');
        else if (s.player.gold >= 8 && (s.encounter.purchases.potion || 0) < 2 && s.player.inventory.potion < 4) await click(page, 'buy', '[data-id="potion"]');
        else await click(page, 'leaveShop');
      }
    }
    const s = await read(page);
    assert.equal(s.status, 'won', `${classId} complete run`);
    assert.equal(s.completed.length, 21);
    assert.equal(s.player.level, 4);
    assert.ok(s.player.skills.length >= 7);
    await audit(page, `ending-${classId}`);
    console.log(`PASS: ${classId} / ${s.campaignId}, 21 nodes, Lv.4, ${steps} UI decisions`);
  }
  await click(page, 'view', '[data-id="archive"]');
  assert.equal(await page.locator('.archive-row').count(), 3);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.top-actions [data-action="export"]').click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^ashfall-.+\.json$/);
  await click(page, 'new'); await click(page, 'start');
  await page.locator('.top-actions [data-action="new"]').click();
  assert.ok(await page.locator('dialog').isVisible());
  await click(page, 'closeModal');
  assert.equal((await read(page)).status, 'active');
  // A deliberate low-health fixture verifies the actual death UI and reload behavior.
  await page.evaluate(async () => {
    const { dispatch } = await import('/src/engine.js');
    let s = JSON.parse(localStorage.getItem('ashfall.run.v1'));
    s = dispatch(s, { type: 'choose', id: 'accept' }); s = dispatch(s, { type: 'advance', route: 'risk' });
    s.player.hp = 1; s.battle.enemy.attack = 100; s.battle.enemy.speed = 100;
    s.rng = 999999;
    localStorage.setItem('ashfall.run.v1', JSON.stringify(s));
  });
  await page.reload(); await click(page, 'resolveRound');
  assert.equal((await read(page)).status, 'dead');
  assert.ok(await page.locator('.ending.dead').isVisible());
  await page.reload(); assert.equal((await read(page)).status, 'dead');
  await audit(page, 'death');
  await page.evaluate(() => localStorage.setItem('ashfall.run.v1', '{invalid-json'));
  await page.reload(); assert.ok(await page.locator('[data-action="start"]').isVisible());
  console.log('PASS: archive, export, abort confirmation, permanent death, corrupted-save fallback');
  for (const width of [320, 390, 768, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const responsive = await context.newPage();
    responsive.on('pageerror', e => errors.push(e.message));
    await responsive.goto(baseURL);
    await audit(responsive, `registration-${width}`);
    await click(responsive, 'start');
    await click(responsive, 'view', '[data-id="skills"]');
    await audit(responsive, `skills-${width}`);
    await click(responsive, 'view', '[data-id="field"]');
    await click(responsive, 'choose', '[data-id="accept"]');
    await click(responsive, 'advance', '[data-route="risk"]');
    await audit(responsive, `combat-${width}`);
    assert.ok(await responsive.locator('.character-panel .central-resources').isVisible());
    assert.ok(await responsive.locator('body').evaluate(el => el.classList.contains('left-collapsed') && el.classList.contains('right-collapsed')));
    await context.close();
    console.log(`PASS: responsive registration, skills, combat at ${width}px`);
  }
  assert.deepEqual(errors, [], 'Browser console errors');
  console.log('PASS: no browser errors, loaded visual assets, no clipped buttons or horizontal overflow');
} finally { await browser.close(); }
