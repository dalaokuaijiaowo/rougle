import test from 'node:test';
import assert from 'node:assert/strict';
import { newRun, dispatch, validSave, check, modifier, checkBonus, learnReason, ultimateReason } from '../src/engine.js';
import { CLASSES, SKILLS, SKILL_BY_ID } from '../src/data.js';

function encounter(classId = 'warrior', seed = 42) {
  let s = newRun(classId, 'cult', seed);
  s = dispatch(s, { type: 'choose', id: 'accept' });
  return dispatch(s, { type: 'advance', route: 'risk' });
}
function learn(s, id) { return dispatch(s, { type: 'learn', id }); }
function round(s, actions = []) {
  for (const action of actions) s = dispatch(s, { type: 'queueAction', action });
  return dispatch(s, { type: 'resolveRound' });
}
function readyUltimate(id) {
  const skill = SKILL_BY_ID[id];
  const s = encounter(skill.classId);
  s.player.skills = SKILLS.filter(s => s.classId === skill.classId).map(s => s.id);
  s.player.level = 4;
  s.player.hp = s.player.maxHp = 200;
  s.player.san = s.player.maxSan = 100;
  s.battle.enemy.hp = s.battle.enemy.maxHp = 500;
  s.battle.enemy.attack = 1;
  return s;
}

test('class definitions, skill chains and starting resources are complete', () => {
  assert.equal(SKILLS.length, 27);
  assert.equal(new Set(SKILLS.map(s => s.id)).size, 27);
  for (const cls of Object.values(CLASSES)) {
    const s = newRun(cls.id, 'cult', 8);
    assert.equal(s.player.hp, cls.hp);
    assert.equal(s.player.san, cls.san);
    assert.ok(validSave(s));
    assert.equal(SKILLS.filter(s => s.classId === cls.id).length, 9);
    for (const skill of SKILLS.filter(s => s.classId === cls.id)) {
      if (skill.requires) assert.equal(SKILL_BY_ID[skill.requires].classId, cls.id);
    }
  }
  assert.equal(modifier(9), -1);
});
test('commands are immutable and replay deterministically after JSON roundtrip', () => {
  const input = encounter('rogue', 73), before = JSON.stringify(input);
  const a = round(input, [{ kind: 'attack' }]);
  const b = round(JSON.parse(before), [{ kind: 'attack' }]);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(a.rng, input.rng);
});
test('resolved nodes cannot be farmed and unopened nodes cannot be skipped', () => {
  let s = newRun('warrior', 'oracle', 15);
  assert.throws(() => dispatch(s, { type: 'advance' }));
  s = dispatch(s, { type: 'choose', id: 'accept' });
  assert.throws(() => dispatch(s, { type: 'choose', id: 'accept' }));
  assert.equal(s.completed.length, 1);
  assert.equal(s.player.clues, 1);
});
test('active slots, skill points, prerequisites and level gates are enforced', () => {
  let s = newRun('warrior', 'cult');
  assert.ok(learnReason(s, 'berserk'));
  s = learn(s, 'shieldwall');
  assert.equal(s.player.skillPoints, 0);
  assert.deepEqual(s.player.loadout, ['smash', 'shieldwall']);
  assert.throws(() => learn(s, 'heavy'));
  s.player.skillPoints = 3;
  s = learn(s, 'heavy');
  assert.throws(() => dispatch(s, { type: 'equip', id: 'heavy' }));
  s = dispatch(s, { type: 'equip', id: 'smash' });
  s = dispatch(s, { type: 'equip', id: 'heavy' });
  assert.deepEqual(s.player.loadout, ['shieldwall', 'heavy']);
  assert.throws(() => learn(s, 'fireball'));
});
test('death is terminal and negative HP cannot be restored through any action', () => {
  let s = encounter('mage');
  s.player.hp = 1; s.battle.enemy.speed = 100; s.battle.enemy.attack = 100;
  s.rng = 999999;
  s = round(s);
  assert.equal(s.status, 'dead');
  assert.equal(s.player.hp, 0);
  for (const command of [{ type: 'item', id: 'potion' }, { type: 'fight' }, { type: 'advance' }, { type: 'learn', id: 'barrier' }]) assert.throws(() => dispatch(s, command));
  assert.ok(validSave(s));
});
test('sanity loss from an event can permanently end a run', () => {
  let found = false;
  for (let seed = 1; seed < 50; seed++) {
    let s = newRun('mage', 'theatre', seed);
    s = dispatch(s, { type: 'choose', id: 'accept' });
    s = dispatch(s, { type: 'advance' });
    s.player.san = 1;
    s = dispatch(s, { type: 'choose', id: 'inspect' });
    if (s.status === 'dead') { assert.equal(s.player.san, 0); found = true; break; }
  }
  assert.ok(found);
});
test('natural 1 and 20 override numerical check totals', () => {
  let one = false, twenty = false;
  const s = newRun('rogue', 'cult', 9255);
  for (let n = 0; n < 300; n++) {
    const r = check(s, 'agi', n % 2 ? 1 : 99);
    if (r.roll === 1) { assert.equal(r.outcome, 'criticalFailure'); one = true; }
    if (r.roll === 20) { assert.equal(r.outcome, 'criticalSuccess'); twenty = true; }
  }
  assert.ok(one && twenty);
});
test('all manual combat ultimates resolve and consume exactly one chapter charge', () => {
  for (const skill of SKILLS.filter(s => s.type === 'ultimate' && !s.automatic)) {
    let s = readyUltimate(skill.id);
    if (skill.id === 'execute') s.battle.enemy.hp = 145;
    const next = round(s, [{ kind: 'skill', id: skill.id }]);
    assert.equal(next.chapterUses[skill.id], 1, skill.id);
    if (next.battle && !next.encounter.resolved) assert.throws(() => round(next, [{ kind: 'skill', id: skill.id }]), skill.id);
    if (skill.id === 'vanish') { assert.equal(next.battle, null); assert.equal(next.player.gold, s.player.gold); }
    if (skill.id === 'meteor') assert.equal(next.player.san, s.player.san - 3);
  }
});
test('execute thresholds, boss escape and unsafe sanity costs are blocked', () => {
  let s = readyUltimate('execute');
  assert.ok(ultimateReason(s, 'execute'));
  s = readyUltimate('vanish'); s.battle.enemy.boss = true;
  assert.throws(() => round(s, [{ kind: 'skill', id: 'vanish' }]));
  assert.throws(() => round(s, [{ kind: 'escape' }]));
  s = readyUltimate('meteor'); s.player.san = 3;
  assert.throws(() => round(s, [{ kind: 'skill', id: 'meteor' }]));
});
test('unyielding intercepts one lethal hit, then death is permanent', () => {
  let s = readyUltimate('unyielding');
  s.player.hp = 1; s.battle.enemy.attack = 500; s.battle.enemy.speed = 100;
  s.rng = 999999;
  s = round(s);
  assert.equal(s.chapterUses.unyielding, 1);
  assert.equal(s.status, 'active');
  s.rng = 999999;
  s = round(s);
  assert.equal(s.status, 'dead');
  assert.equal(s.log.filter(l => l.title === '不屈').length, 1);
});
test('shield, poison, fire and ice skills have observable effects', () => {
  for (const [classId, ids, expected] of [
    ['warrior', ['shieldwall'], '护盾'], ['rogue', ['backstab', 'poison'], '中毒'],
    ['mage', ['fireball', 'burn'], '燃烧'], ['mage', ['ice', 'freeze'], '无法行动'],
  ]) {
    let s = encounter(classId, 9);
    s.player.skills = ids; s.player.loadout = ids.filter(id => SKILL_BY_ID[id].type === 'active');
    s.player.hp = s.player.maxHp = 100; s.battle.enemy.hp = s.battle.enemy.maxHp = 100;
    s = round(s, [{ kind: 'skill', id: ids[0] }]);
    assert.ok(s.log.some(l => (l.title + l.text).includes(expected)), expected);
  }
});
test('player acts before enemy and weaken applies to its next response', () => {
  let s = encounter('mage', 9);
  s.player.loadout = ['ice']; s.player.skills = ['ice']; s.player.hp = s.player.maxHp = 100;
  s.battle.enemy.hp = s.battle.enemy.maxHp = 300; s.battle.enemy.speed = 99;
  s = round(s, [{ kind: 'skill', id: 'ice' }]);
  s = round(s);
  const enemyHits = s.log.filter(l => l.title === '敌方攻击');
  assert.equal(enemyHits[0].text, '受到 3 点伤害。');
  assert.equal(enemyHits[1].text, '受到 5 点伤害。');
});
test('growth increases current and maximum resources and caps attributes', () => {
  let s = newRun('mage', 'cult');
  s.pendingGrowth = true;
  s = dispatch(s, { type: 'grow', choice: 'health' });
  assert.equal(s.player.level, 2);
  assert.equal(s.player.hp, 25);
  assert.equal(s.player.maxHp, 25);
  assert.equal(s.player.maxSan, 34);
  assert.equal(s.player.skillPoints, 3);
  s.pendingGrowth = true; s.player.stats.int = 20;
  s = dispatch(s, { type: 'grow', choice: 'power' });
  assert.equal(s.player.stats.int, 20);
});
test('shop economy, stock and exploration charges cannot be duplicated', () => {
  let s = newRun('rogue', 'cult');
  s.encounter.type = 'shop'; s.player.gold = 100; s.player.skills.push('lockpick', 'steal', 'sleight'); s.player.level = 4;
  const bonus = checkBonus(s, 'agi'); assert.equal(bonus, 8);
  const hp = s.player.inventory.potion;
  s = dispatch(s, { type: 'buy', id: 'potion' });
  s = dispatch(s, { type: 'buy', id: 'potion' });
  assert.equal(s.player.inventory.potion, hp + 2);
  assert.equal(s.player.gold, 84);
  assert.throws(() => dispatch(s, { type: 'buy', id: 'potion' }));
  s = dispatch(s, { type: 'explorationSkill', id: 'steal' });
  assert.throws(() => dispatch(s, { type: 'explorationSkill', id: 'steal' }));
  s = dispatch(s, { type: 'explorationSkill', id: 'sleight', choice: 'bomb' });
  assert.equal(s.player.inventory.bomb, 2);
  assert.throws(() => dispatch(s, { type: 'explorationSkill', id: 'sleight', choice: 'bomb' }));
});
test('teleport consumes sanity and cannot bypass a mandatory boss', () => {
  let s = newRun('mage', 'cult');
  s.player.skills.push('barrier', 'teleport');
  s = dispatch(s, { type: 'choose', id: 'accept' });
  s = dispatch(s, { type: 'advance' });
  s = dispatch(s, { type: 'explorationSkill', id: 'teleport' });
  assert.equal(s.player.san, 28); assert.equal(s.encounter.resolved, true);
  s = encounter('mage'); s.player.skills.push('teleport'); s.encounter.type = 'boss';
  assert.throws(() => dispatch(s, { type: 'explorationSkill', id: 'teleport' }));
});
test('chapter transitions clear charges and final entrance allows level 4', () => {
  let s = newRun('warrior', 'cult');
  s.chapter = 1; s.node = 6; s.player.level = 3; s.encounter.resolved = true;
  s.chapterUses = { berserk: 1 };
  s = dispatch(s, { type: 'advance' });
  assert.deepEqual(s.chapterUses, {});
  s = dispatch(s, { type: 'choose', id: 'accept' });
  assert.equal(s.pendingGrowth, true);
  s = dispatch(s, { type: 'grow', choice: 'health' });
  assert.equal(s.player.level, 4);
});
test('last boss death finishes the campaign once and dead saves cannot resume', () => {
  let s = encounter('warrior');
  s.chapter = 2; s.node = 6; s.battle.enemy.boss = true; s.battle.enemy.hp = 1; s.encounter.type = 'boss';
  s = round(s, [{ kind: 'item', id: 'bomb' }]);
  assert.equal(s.status, 'won');
  assert.ok(s.ending);
  assert.throws(() => dispatch(s, { type: 'fight' }));
  assert.equal(validSave({ version: 1 }), false);
  assert.equal(validSave({ ...s, version: 99 }), false);
});
test('damaged nested save data is rejected without throwing', () => {
  const baseline = encounter('warrior');
  assert.equal(validSave(baseline), true);
  for (const mutate of [
    s => { s.player.stats = null; }, s => { s.battle.enemy = null; },
    s => { s.log = [null]; }, s => { s.encounter.purchases = null; },
    s => { s.metrics = null; }, s => { s.battle.cooldowns = null; },
    s => { s.player.loadout.push(s.player.loadout[0]); }, s => { s.stance = 'invalid'; },
    s => { s.player.classId = 'toString'; }, s => { s.battle.enemy.statuses = [{ id: 'poison' }]; },
  ]) {
    const s = structuredClone(baseline); mutate(s); assert.equal(validSave(s), false);
  }
});
