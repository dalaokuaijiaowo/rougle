import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { newRun, dispatch, validSave, migrateSave, dodgeChance, cooldownRemaining } from '../src/engine.js';
import { chapterMap, availableNodes, validMap } from '../src/map.js';
import { newDuel, duelCommand, duelPlanReason, resolveDuel } from '../src/duel.js';
import { RoomService } from '../rooms.mjs';
import { builds, choosePlan } from './simulate.mjs';
import { learnReason } from '../src/engine.js';

const nonce = () => randomBytes(24).toString('hex');
function battle(classId = 'warrior') {
  let s = newRun(classId, 'cult', 6739); s = dispatch(s, { type: 'choose', id: 'accept' });
  return dispatch(s, { type: 'advance', route: 'risk' });
}
test('chapter maps have branches, convergence, deterministic seeds and reachable bosses', () => {
  for (let seed = 0; seed < 20; seed++) for (let chapter = 0; chapter < 3; chapter++) {
    const map = chapterMap(seed, chapter); assert.ok(validMap(map, chapter, 0)); assert.equal(map.nodes.length, 16);
    const reached = new Set([map.currentId]);
    for (const n of map.nodes) if (reached.has(n.id)) n.next.forEach(id => reached.add(id));
    assert.equal(reached.size, 16);
    assert.ok(map.nodes.some(n => n.next.length === 3));
    assert.ok(map.nodes.some(n => map.nodes.filter(p => p.next.includes(n.id)).length > 1));
    assert.deepEqual(chapterMap(seed, chapter), map);
  }
});
test('only connected nodes can be selected and completed nodes cannot be farmed', () => {
  let s = newRun('rogue', 'cult', 88); assert.equal(availableNodes(s).length, 0);
  s = dispatch(s, { type: 'choose', id: 'accept' }); assert.equal(availableNodes(s).length, 3);
  assert.throws(() => dispatch(s, { type: 'advance', nodeId: 'c0-r6-l0' }), /连线/);
  s = dispatch(s, { type: 'advance', nodeId: 'c0-r1-l2' });
  s = dispatch(s, { type: 'choose', id: 'leave' });
  assert.throws(() => dispatch(s, { type: 'advance', nodeId: 'c0-r2-l0' }), /连线/);
  assert.throws(() => dispatch(s, { type: 'advance', nodeId: 'c0-r1-l2' }), /连线/);
  s = dispatch(s, { type: 'advance', nodeId: 'c0-r2-l1' });
  assert.equal(s.encounter.type, 'event'); assert.ok(validSave(s));
});
test('cooldown survives a finishing blow, next encounter and JSON reload', () => {
  let s = battle('mage'); s.battle.enemy.hp = 1;
  s = dispatch(s, { type: 'queueAction', action: { kind: 'skill', id: 'fireball' } });
  s = dispatch(s, { type: 'resolveRound' }); assert.ok(s.encounter.resolved); assert.equal(cooldownRemaining(s, 'fireball'), 1);
  s = dispatch(s, { type: 'advance', nodeId: 'c0-r2-l0' });
  s = migrateSave(JSON.parse(JSON.stringify(s))); assert.ok(s);
  assert.throws(() => dispatch(s, { type: 'queueAction', action: { kind: 'skill', id: 'fireball' } }), /冷却/);
  s = dispatch(s, { type: 'resolveRound' }); assert.equal(cooldownRemaining(s, 'fireball'), 0);
  s = dispatch(s, { type: 'queueAction', action: { kind: 'skill', id: 'fireball' } }); assert.equal(s.battle.plan.length, 1);
});
test('noncombat actions do not tick combat cooldowns', () => {
  let s = newRun('mage', 'cult', 44); s.player.cooldowns.fireball = 3;
  s = dispatch(s, { type: 'choose', id: 'accept' }); s = dispatch(s, { type: 'advance' }); s = dispatch(s, { type: 'choose', id: 'leave' });
  assert.equal(s.player.combatClock, 0); assert.equal(cooldownRemaining(s, 'fireball'), 2);
});
test('every class has dodge, grows with level, and dodge uses AP without stacking', () => {
  for (const [id, rate] of [['warrior', 5], ['rogue', 12], ['mage', 8]]) {
    let s = battle(id); assert.equal(dodgeChance(s), rate);
    s.player.level++; assert.equal(dodgeChance(s), rate + 1);
    s = dispatch(s, { type: 'queueAction', action: { kind: 'dodge' } });
    assert.throws(() => dispatch(s, { type: 'queueAction', action: { kind: 'dodge' } }), /叠加/);
    s.rng = 1; const hp = s.player.hp; s = dispatch(s, { type: 'resolveRound' });
    assert.equal(s.player.hp, hp); assert.equal(s.battle.dodgeBonus, 0); assert.ok(s.log.some(l => l.title === '闪避成功'));
  }
});
test('v2 migration retains queued actions, live cooldown, HP, RNG and visited progress', () => {
  let old = battle('warrior'); old = dispatch(old, { type: 'queueAction', action: { kind: 'attack' } });
  old.version = 2; delete old.map; delete old.player.cooldowns; delete old.player.combatClock; delete old.battle.dodgeBonus;
  old.battle.round = 2; old.battle.cooldowns = { smash: 4 };
  const s = migrateSave(old); assert.ok(s); assert.equal(s.version, 3); assert.equal(s.player.combatClock, 2);
  assert.equal(cooldownRemaining(s, 'smash'), 1); assert.deepEqual(s.battle.plan, [{ kind: 'attack' }]);
  assert.equal(s.rng, old.rng); assert.equal(s.player.hp, old.player.hp); assert.equal(s.map.visited.length, 2);
});
test('duel preserves inputs, validates hidden plans and alternates initiative with bounded results', () => {
  const runs = [newRun('warrior', 'cult', 4), newRun('mage', 'cult', 4)], before = structuredClone(runs);
  let duel = newDuel(runs, 99, 0);
  assert.equal(duel.fighters[1].player.hp, 32);
  assert.match(duelPlanReason(runs[0], duel, 0, [{ kind: 'item', id: 'bomb' }]), /补给/);
  assert.match(duelPlanReason(runs[0], duel, 0, [{ kind: 'escape' }]), /撤退/);
  duel = duelCommand(duel, runs[0], 0, { type: 'queueAction', action: { kind: 'attack' } }, 0);
  duel = duelCommand(duel, runs[0], 0, { type: 'resolveRound' }, 0); assert.equal(duel.round, 0);
  assert.throws(() => duelCommand(duel, runs[0], 0, { type: 'clearPlan' }, 0), /锁定/);
  duel = duelCommand(duel, runs[1], 1, { type: 'resolveRound' }, 0); assert.equal(duel.round, 1);
  while (!duel.result) duel = resolveDuel(duel, duel.deadline);
  assert.equal(duel.round, 20); assert.deepEqual(runs, before);
});
function setup() {
  let time = 0; const service = new RoomService([], () => time);
  const host = service.create({ classId: 'warrior', campaignId: 'cult', name: '<host>', nonce: nonce() });
  const id = host.room.id, hostToken = host.room.seats[0].token;
  const guest = service.join(id, { classId: 'mage', name: 'Guest', nonce: nonce() });
  const tokens = [hostToken, guest.room.seats[1].token];
  const act = (i, command, commandId = nonce()) => service.command(id, tokens[i], { commandId, expectedRevision: service.get(id).seats[i].version, command });
  act(0, { type: 'ready' }); act(1, { type: 'ready' });
  return { service, id, tokens, act, advanceTime: () => { time += 100000; service.tick(); } };
}
test('rooms require credentials, are two-seat, idempotent, and never reveal opponent plans or tokens', () => {
  const { service, id, tokens, act } = setup(), room = service.get(id);
  assert.equal(room.phase, 'pve'); assert.deepEqual(room.seats[0].run.map, room.seats[1].run.map);
  assert.throws(() => service.join(id, { classId: 'rogue', nonce: nonce() }), /已满/);
  assert.throws(() => service.authenticate(room, 'invalid'), /凭据/);
  const cmdId = nonce(); act(0, { type: 'choose', id: 'accept' }, cmdId);
  const after = service.get(id).seats[0].version; act(0, { type: 'choose', id: 'accept' }, cmdId);
  assert.equal(service.get(id).seats[0].version, after);
  const request = { commandId: nonce(), expectedRevision: 0, command: { type: 'advance' } };
  assert.throws(() => service.command(id, tokens[0], request), /状态已更新/);
  const snapshot = service.snapshot(service.get(id), 0), json = JSON.stringify(snapshot);
  assert.ok(!json.includes(tokens[0]) && !json.includes(tokens[1]) && !json.includes('nonce')); assert.equal(snapshot.run.rng, 1);
});
test('three complete chapter PVE/PVP cycles, score persistence and no repeated checkpoint', () => {
  const { service, id, act } = setup(); let operations = 0;
  while (service.get(id).phase !== 'ended' && operations++ < 1200) {
    let room = service.get(id);
    if (room.phase === 'duel') {
      for (let i = 0; i < 2; i++) {
        room = service.get(id); if (room.phase !== 'duel') break;
        if (room.duel.fighters[i].submitted) continue;
        for (let n = 0; n < 3; n++) act(i, { type: 'queueAction', action: { kind: 'attack' } });
        act(i, { type: 'resolveRound' });
        if (i === 0 && service.get(id).phase === 'duel') assert.equal(service.snapshot(service.get(id), 1).run.battle.plan.length, 0);
      }
    } else if (room.phase === 'chapter') {
      for (const s of room.seats) { assert.ok(s.run.player.hp > 0); assert.equal(s.run.status, 'active'); }
      act(0, { type: 'continueChapter' }); act(1, { type: 'continueChapter' });
    } else for (let i = 0; i < 2; i++) {
      room = service.get(id); if (room.phase !== 'pve' || room.seats[i].checkpoint) continue;
      let s = room.seats[i].run;
      if (!s.battle || s.encounter.resolved) for (const skill of builds[s.player.classId]) {
        s = service.get(id).seats[i].run; if (!learnReason(s, skill)) act(i, { type: 'learn', id: skill });
      }
      s = service.get(id).seats[i].run;
      if (s.pendingGrowth) act(i, { type: 'grow', choice: 'health' });
      else if (s.encounter.resolved) act(i, { type: 'advance' });
      else if (s.battle) {
        act(i, { type: 'stance', id: 'guard' }); s = service.get(id).seats[i].run;
        for (const action of choosePlan(s)) act(i, { type: 'queueAction', action });
        act(i, { type: 'resolveRound' });
      } else if (s.encounter.type === 'intro') act(i, { type: 'choose', id: 'accept' });
      else if (s.encounter.type === 'event') act(i, { type: 'choose', id: 'class' });
      else if (s.encounter.type === 'camp') act(i, { type: 'rest', choice: 'heal' });
      else if (s.encounter.type === 'shop') {
        if (s.player.gold >= 14 && (s.player.armorBuys || 0) < 3 && !s.encounter.purchases.armor) act(i, { type: 'buy', id: 'armor' });
        else if (s.player.gold >= 8 && (s.encounter.purchases.potion || 0) < 2 && s.player.inventory.potion < 4) act(i, { type: 'buy', id: 'potion' });
        else act(i, { type: 'leaveShop' });
      }
    }
  }
  const room = service.get(id); assert.equal(room.results.length, 3); assert.equal(room.phase, 'ended');
  assert.ok(room.seats.every(s => s.run.status === 'won' && s.run.completed.length === 21 && validSave(s.run)));
  const restored = new RoomService(JSON.parse(JSON.stringify([...service.rooms.values()])));
  assert.deepEqual(restored.snapshot(restored.get(id), 0), service.snapshot(room, 0));
});
test('PVE death terminates the room; disconnect timeout resolves a locked duel', () => {
  const { service, id, act, advanceTime } = setup();
  const room = service.get(id); room.phase = 'duel'; room.duel = newDuel(room.seats.map(s => s.run), 7, 0);
  act(0, { type: 'queueAction', action: { kind: 'attack' } }); act(0, { type: 'resolveRound' });
  advanceTime(); assert.equal(service.get(id).duel.round, 1); assert.ok(service.get(id).duel.log.some(l => l.title === '超时待命'));
  const r = service.get(id); r.phase = 'pve'; r.duel = null; r.seats[0].run = battle();
  r.seats[0].run.player.hp = 1; r.seats[0].run.battle.enemy.attack = 1000; r.seats[0].run.rng = 999999;
  act(0, { type: 'resolveRound' }); assert.equal(service.get(id).phase, 'ended'); assert.equal(service.get(id).seats[0].run.status, 'dead');
  assert.throws(() => act(1, { type: 'choose', id: 'accept' }), /已经结束/);
});
