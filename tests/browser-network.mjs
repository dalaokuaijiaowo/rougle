import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createGameServer } from '../http-server.mjs';
import { newDuel } from '../src/duel.js';
import { newRun, dispatch } from '../src/engine.js';

let require = createRequire(import.meta.url), pw;
try { pw = require('playwright'); } catch { require = createRequire(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/')); pw = require('playwright'); }
const { server, rooms } = await createGameServer({ dataFile: path.resolve(`test-results/rooms-ui-${Date.now()}.json`) });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await pw.chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined) });
const errors = [];
const read = p => p.evaluate(() => JSON.parse(localStorage.getItem('ashfall.run.v1')));
const roomState = p => p.evaluate(async () => {
  const c = JSON.parse(sessionStorage.getItem('ashfall.room.session.v1'));
  return (await fetch(`/api/rooms/${c.id}`, { headers: { Authorization: `Bearer ${c.token}` } })).json();
});
async function click(p, action, extra = '') { await p.locator(`[data-action="${action}"]${extra}:visible`).first().click(); }
async function audit(p, label) {
  await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${label}: overflow`);
  const clipped = await p.locator('button:visible').evaluateAll(nodes => nodes.filter(n => n.scrollWidth > n.clientWidth + 2 || n.scrollHeight > n.clientHeight + 2).map(n => n.innerText));
  assert.deepEqual(clipped, [], `${label}: clipped controls`);
  assert.equal(await p.locator('img').evaluateAll(nodes => nodes.every(n => n.complete && n.naturalWidth > 0)), true);
  await p.screenshot({ path: `test-results/${label}.png`, fullPage: true });
}
try {
  await mkdir('test-results', { recursive: true });
  const host = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  host.setDefaultTimeout(10000); host.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
  await host.goto(url); console.log('Loaded game');
  await click(host, 'start'); await click(host, 'choose', '[data-id="accept"]');
  await click(host, 'advance', '[data-node-id="c0-r1-l1"]');
  assert.equal((await read(host)).map.currentId, 'c0-r1-l1');
  const boxes = await host.locator('.comparison > section').evaluateAll(n => n.map(e => { const b = e.getBoundingClientRect(); return { x: b.x, right: b.right, y: b.y }; }));
  assert.equal(boxes[0].y, boxes[1].y); assert.ok(boxes[0].right <= boxes[1].x);
  await audit(host, 'v3-comparison-desktop');
  await click(host, 'queue', '[data-kind="dodge"]'); assert.equal((await read(host)).battle.plan[0].kind, 'dodge');
  await click(host, 'view', '[data-id="map"]'); assert.equal(await host.locator('.map-stop').count(), 16);
  await audit(host, 'v3-map-desktop');
  await host.reload(); assert.equal((await read(host)).battle.plan[0].kind, 'dodge');
  const solo = await read(host);
  await click(host, 'view', '[data-id="room"]');
  await host.locator('#player-name').fill('甲方'); await click(host, 'enterRoom');
  await host.locator('.invite-qr').waitFor();
  let state = await roomState(host); const id = state.id;
  assert.equal(state.participants.length, 1);
  assert.deepEqual(await read(host), solo, 'Joining multiplayer does not overwrite the solo save');
  await audit(host, 'v3-invitation');
  const qr = await host.locator('.invite-qr').getAttribute('src');
  const sharp = require('sharp'); const qrStats = await sharp(Buffer.from(qr.split(',')[1], 'base64')).stats();
  assert.ok(qrStats.channels[0].min === 0 && qrStats.channels[0].max === 255);
  const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
  guest.setDefaultTimeout(10000); guest.on('pageerror', e => errors.push(e.message));
  await guest.goto(`${url}/?room=${id}`); await guest.locator('#player-name').fill('乙方');
  await click(guest, 'selectClass', '[data-id="mage"]');
  assert.equal(await guest.locator('#player-name').inputValue(), '乙方');
  await click(guest, 'enterRoom'); await guest.locator('.invite-qr').waitFor();
  await click(host, 'roomReady'); await click(guest, 'roomReady');
  await host.locator('[data-action="choose"][data-id="accept"]').waitFor();
  await guest.locator('[data-action="choose"][data-id="accept"]').waitFor();
  await click(host, 'choose', '[data-id="accept"]'); await click(guest, 'choose', '[data-id="accept"]');
  await click(host, 'advance', '[data-node-id="c0-r1-l0"]');
  await click(guest, 'advance', '[data-node-id="c0-r1-l1"]');
  assert.equal((await roomState(host)).run.map.currentId, 'c0-r1-l0');
  assert.equal((await roomState(guest)).run.map.currentId, 'c0-r1-l1');
  await audit(guest, 'v3-comparison-mobile');
  await guest.reload(); await guest.locator('[data-action="queue"][data-kind="dodge"]').waitFor();
  assert.equal((await roomState(guest)).run.map.currentId, 'c0-r1-l1');
  console.log('PASS: side-by-side panels, connected map, AP dodge, QR invite, real two-client rooms, independent routes, solo preservation and reload reconnect');

  // Isolated server-side fixture reaches the chapter checkpoint without modifying any user save.
  const r = rooms.get(id);
  for (const [i, s] of r.seats.entries()) {
    s.run = newRun(i ? 'mage' : 'warrior', 'cult', r.seed);
    s.run.player.skills.push(i ? 'barrier' : 'shieldwall'); s.run.player.loadout.push(i ? 'barrier' : 'shieldwall');
    s.run.player.hp = i ? 9 : 21; s.checkpoint = true; s.version++;
  }
  r.phase = 'duel'; r.duel = newDuel(r.seats.map(s => s.run), 8821); rooms.changed(r);
  await host.locator('[data-action="queue"][data-id="shieldwall"]').waitFor();
  await guest.locator('[data-action="queue"][data-id="barrier"]').waitFor();
  await click(host, 'queue', '[data-id="shieldwall"]'); await click(host, 'queue', '[data-kind="attack"]');
  await click(guest, 'queue', '[data-id="barrier"]'); await click(guest, 'queue', '[data-kind="dodge"]');
  await click(host, 'resolveRound');
  await host.getByRole('button', { name: /已锁定，等待对方/ }).waitFor();
  assert.equal((await roomState(guest)).run.battle.plan.length, 2, 'Opponent queue is not exposed in own queue');
  assert.ok(await host.locator('[data-action="queue"][data-kind="attack"]').isDisabled());
  await click(guest, 'resolveRound');
  await guest.getByRole('heading', { name: /第 2 回合/ }).waitFor();
  await host.getByRole('heading', { name: /第 2 回合/ }).waitFor();
  assert.equal((await roomState(host)).duel.round, 1);
  assert.ok(await host.locator('[data-action="queue"][data-id="shieldwall"]').isDisabled());
  await audit(host, 'v3-pvp-desktop'); await audit(guest, 'v3-pvp-mobile');
  await guest.reload(); await guest.getByRole('heading', { name: /第 2 回合/ }).waitFor();
  assert.equal((await roomState(guest)).duel.round, 1);
  while (rooms.get(id).phase === 'duel') { rooms.get(id).duel.deadline = 0; rooms.tick(); }
  await host.locator('.duel-result .result-strip').waitFor(); await guest.locator('.duel-result .result-strip').waitFor();
  assert.equal((await roomState(host)).run.player.hp, 21); assert.equal((await roomState(guest)).run.player.hp, 9);
  await audit(guest, 'v3-chapter-result-mobile');
  await click(host, 'continueChapter'); await click(guest, 'continueChapter');
  await host.locator('[data-action="choose"][data-id="accept"]').waitFor();
  assert.equal((await roomState(host)).phase, 'pve');
  console.log('PASS: secret plan lock, simultaneous submission, one authoritative round, persistent cooldown and duel reconnect');

  for (const width of [320, 390, 768, 1920]) {
    const p = await browser.newPage({ viewport: { width, height: 900 } }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(url); await click(p, 'start'); await click(p, 'choose', '[data-id="accept"]');
    await audit(p, `v3-event-${width}`);
    await click(p, 'view', '[data-id="map"]'); await audit(p, `v3-map-${width}`);
    await click(p, 'advance', '[data-node-id="c0-r1-l1"]');
    const sides = await p.locator('.comparison > section').evaluateAll(n => n.map(e => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y, right: e.getBoundingClientRect().right })));
    assert.equal(sides[0].y, sides[1].y); assert.ok(sides[0].right <= sides[1].x);
    await click(p, 'queue', '[data-kind="dodge"]'); await audit(p, `v3-combat-${width}`);
    await p.close();
  }
  assert.deepEqual(errors, []); console.log('PASS: 320/390/768/1920 responsive event, graph and battle views; no overflow, clipping or page errors');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
