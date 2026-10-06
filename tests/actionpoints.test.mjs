import test from 'node:test';
import assert from 'node:assert/strict';
import { newRun, dispatch, migrateSave, validSave, planReason, remainingAp } from '../src/engine.js';
import { ENEMIES, enemyDefinition, emptyCodex, syncCodex } from '../src/enemies.js';

function combat(classId = 'warrior', seed = 6739) {
  let s = newRun(classId, 'cult', seed);
  s = dispatch(s, { type: 'choose', id: 'accept' });
  return dispatch(s, { type: 'advance', route: 'risk' });
}
const queue = (s, action) => dispatch(s, { type: 'queueAction', action });
const finish = s => dispatch(s, { type: 'resolveRound' });
const attack = { kind: 'attack' };

test('queue reserves 3 AP without spending inventory, advancing time or rolling RNG', () => {
  const before = combat();
  let s = queue(before, attack);
  s = queue(s, { kind: 'skill', id: 'smash' });
  assert.equal(remainingAp(s), 0);
  assert.equal(s.rng, before.rng);
  assert.equal(s.player.hp, before.player.hp);
  assert.equal(s.battle.enemy.hp, before.battle.enemy.hp);
  assert.equal(s.battle.round, 0);
  assert.deepEqual(s.battle.cooldowns, {});
  assert.throws(() => queue(s, attack), /行动点/);
  assert.deepEqual(before.battle.plan, []);
});
test('editing, clearing and reloading the plan preserve AP accounting', () => {
  let s = queue(queue(combat(), attack), { kind: 'skill', id: 'smash' });
  s = dispatch(s, { type: 'moveAction', index: 1, direction: -1 });
  assert.equal(s.battle.plan[0].id, 'smash');
  assert.equal(remainingAp(s), 0);
  assert.deepEqual(migrateSave(JSON.parse(JSON.stringify(s))), s);
  s = dispatch(s, { type: 'removeAction', index: 0 });
  assert.equal(remainingAp(s), 2);
  s = dispatch(s, { type: 'clearPlan' });
  assert.equal(remainingAp(s), 3);
  assert.throws(() => dispatch(s, { type: 'removeAction', index: -1 }));
  assert.throws(() => dispatch(s, { type: 'moveAction', index: 0, direction: 8 }));
});
test('one confirmation executes exactly one round in player-defined order', () => {
  let s = combat(); s.battle.enemy.hp = s.battle.enemy.maxHp = 300;
  s = queue(queue(s, attack), { kind: 'skill', id: 'smash' });
  s = dispatch(s, { type: 'moveAction', index: 1, direction: -1 });
  s = finish(s);
  assert.equal(s.battle.round, 1);
  assert.deepEqual(s.log.filter(e => e.kind === 'action').map(e => e.title), ['行动 1 · 猛击', '行动 2 · 普通攻击']);
  assert.equal(s.log.filter(e => e.title === '敌方攻击').length, 1);
  assert.deepEqual(s.battle.plan, []);
  assert.equal(remainingAp(s), 3);
  assert.ok(s.log.findIndex(l => l.title === '行动 2 · 普通攻击') < s.log.findIndex(l => l.title === '敌方攻击'));
});
test('multiple attacks are allowed but do not grant multiple enemy actions or status ticks', () => {
  let s = combat('rogue'); s.player.skills.push('poison'); s.battle.enemy.hp = s.battle.enemy.maxHp = 300;
  for (let i = 0; i < 3; i++) s = queue(s, attack);
  s = finish(s);
  assert.equal(s.log.filter(e => e.kind === 'action').length, 3);
  assert.equal(s.log.filter(e => e.title === '中毒').length, 1);
  assert.equal(s.battle.enemy.statuses[0].remaining, 2);
  assert.equal(s.log.filter(e => e.title === '敌方攻击').length, 1);
});
test('items spend 1 AP and are consumed on execution, not on queue or cancel', () => {
  let s = combat(); s.player.hp = 10;
  s = queue(s, { kind: 'item', id: 'potion' });
  assert.equal(remainingAp(s), 2); assert.equal(s.player.inventory.potion, 2); assert.equal(s.player.hp, 10);
  s = dispatch(s, { type: 'removeAction', index: 0 });
  assert.equal(s.player.inventory.potion, 2);
  s = finish(queue(s, { kind: 'item', id: 'potion' }));
  assert.equal(s.player.inventory.potion, 1); assert.equal(s.player.hp, 19);
  assert.throws(() => dispatch(s, { type: 'item', id: 'potion' }), /队列/);
});
test('inventory reservations prevent overspending and execution revalidates the plan', () => {
  let s = combat();
  s = queue(s, { kind: 'item', id: 'bomb' });
  assert.throws(() => queue(s, { kind: 'item', id: 'bomb' }), /数量/);
  const before = structuredClone(s);
  s.player.inventory.bomb = 0;
  assert.throws(() => finish(s), /数量/);
  assert.equal(s.rng, before.rng); assert.equal(s.battle.round, before.battle.round);
});
test('cooldowns use whole rounds, and direct old combat commands cannot bypass AP', () => {
  let s = combat(); s.battle.enemy.hp = s.battle.enemy.maxHp = 300;
  s = finish(queue(s, { kind: 'skill', id: 'smash' }));
  assert.throws(() => queue(s, { kind: 'skill', id: 'smash' }), /冷却/);
  s = finish(s);
  assert.equal(planReason(s, [{ kind: 'skill', id: 'smash' }]), '');
  assert.throws(() => dispatch(s, { type: 'fight' }));
  assert.throws(() => dispatch(s, { type: 'escape' }));
});
test('unlearned, unequipped and passive skills cannot enter the queue', () => {
  let s = combat();
  assert.throws(() => queue(s, { kind: 'skill', id: 'fireball' }));
  s.player.skills.push('heavy', 'cleave');
  assert.throws(() => queue(s, { kind: 'skill', id: 'heavy' }), /装配/);
  assert.throws(() => queue(s, { kind: 'skill', id: 'cleave' }), /主动/);
  assert.throws(() => queue(s, { kind: 'item', id: 'weapon' }));
});
test('lethal first action stops the queue without spending subsequent consumables', () => {
  let s = combat(); s.battle.enemy.hp = 1;
  s = queue(queue(s, attack), { kind: 'item', id: 'bomb' });
  s = finish(s);
  assert.equal(s.encounter.resolved, true);
  assert.equal(s.player.inventory.bomb, 1);
  assert.equal(s.log.filter(e => e.kind === 'action').length, 1);
  assert.equal(s.log.filter(e => e.title === '敌方攻击').length, 0);
  assert.equal(s.enemyRecords['regular-0'].kills, 1);
});
test('queued ultimate consumes all 3 AP but only spends the chapter charge on execution', () => {
  let s = combat('mage'); s.player.skills.push('meteor'); s.player.level = 4;
  s.battle.enemy.hp = s.battle.enemy.maxHp = 300;
  s = queue(s, { kind: 'skill', id: 'meteor' });
  assert.equal(remainingAp(s), 0); assert.equal(s.chapterUses.meteor, undefined); assert.equal(s.player.san, 30);
  s = finish(s);
  assert.equal(s.chapterUses.meteor, 1); assert.equal(s.player.san, 27);
});
test('shield then attack honors manual order and blocks the enemy response', () => {
  let s = combat('mage', 9); s.player.skills.push('barrier'); s.player.loadout.push('barrier');
  s = finish(queue(queue(s, { kind: 'skill', id: 'barrier' }), attack));
  assert.equal(s.player.hp, 16); assert.equal(s.battle.shield, 6);
  assert.deepEqual(s.log.filter(l => l.kind === 'action').map(l => l.title), ['行动 1 · 护盾', '行动 2 · 普通攻击']);
});
test('empty rounds expire statuses and buffs, preventing indefinite control', () => {
  let s = combat(); s.battle.stun = 2; s.battle.berserk = 2;
  s = finish(s); assert.equal(s.battle.stun, 1); assert.equal(s.battle.berserk, 1);
  s = finish(s); assert.equal(s.battle.stun, 0); assert.equal(s.battle.berserk, 0);
  s = finish(s); assert.ok(s.log.some(l => l.title === '敌方重击'));
});
test('15 codex definitions match live encounters, including all campaign bosses', () => {
  assert.equal(ENEMIES.length, 15);
  for (const e of ENEMIES) assert.equal(enemyDefinition(e.campaignId || 'cult', e.chapter, e.type).id, e.id);
  const s = combat(); const def = enemyDefinition('cult', 0, 'combat');
  assert.equal(s.battle.enemy.definitionId, def.id); assert.equal(s.battle.enemy.maxHp, def.hp);
});
test('codex sync is cumulative across runs and idempotent on reload', () => {
  let s = combat(); let codex = syncCodex(emptyCodex(), s);
  assert.deepEqual(codex.entries['regular-0'], { seen: 1, kills: 0 });
  assert.deepEqual(syncCodex(codex, s), codex);
  s = finish(queue(s, { kind: 'item', id: 'bomb' }));
  codex = syncCodex(codex, s); assert.equal(codex.entries['regular-0'].kills, 1);
  const next = combat('mage', 88);
  codex = syncCodex(codex, next); assert.deepEqual(codex.entries['regular-0'], { seen: 2, kills: 1 });
  assert.deepEqual(syncCodex(codex, next), codex);
});
test('v1 saves migrate without rerolling, losing resources or reviving dead characters', () => {
  const old = combat('mage'); old.version = 1;
  delete old.enemyRecords; delete old.battle.plan; delete old.battle.maxAp; delete old.battle.enemy.definitionId;
  const next = migrateSave(old);
  assert.ok(next); assert.equal(next.version, 3); assert.equal(next.rng, old.rng);
  assert.deepEqual(next.player, old.player); assert.equal(next.battle.maxAp, 3); assert.deepEqual(next.battle.plan, []);
  assert.deepEqual(next.enemyRecords['regular-0'], { seen: 1, kills: 0 });
  assert.equal(old.version, 1);
  old.status = 'dead'; old.player.hp = 0;
  assert.equal(migrateSave(old).status, 'dead');
});
test('corrupted AP, plans, codex and combat definitions are rejected', () => {
  for (const edit of [s => { s.battle.maxAp = 100; }, s => { s.battle.plan = [attack, attack, attack, attack]; }, s => { s.battle.plan = [null]; }, s => { s.battle.enemy.definitionId = 'missing'; }, s => { s.enemyRecords['regular-0'].kills = 99; }]) {
    const s = combat(); edit(s); assert.equal(validSave(s), false);
  }
});
