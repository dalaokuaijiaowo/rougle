import { newRun, dispatch, learnReason, ultimateReason, currentArmor, planReason } from '../src/engine.js';

export const builds = {
  warrior: ['shieldwall', 'heavy', 'sunder', 'taunt', 'cleave', 'unyielding', 'execute', 'berserk'],
  rogue: ['invisible', 'poison', 'sprint', 'lockpick', 'steal', 'shadow', 'vanish', 'sleight'],
  mage: ['barrier', 'ice', 'freeze', 'burn', 'teleport', 'meteor', 'timestop', 'blizzard'],
};

export function choosePlan(s) {
  const plan = [];
  const add = action => { if (!planReason(s, [...plan, action])) { plan.push(action); return true; } return false; };
  const heavyIncoming = Math.max(1, Math.floor(s.battle.enemy.attack * 1.5 * .65 * 1.15) - currentArmor(s));
  if (s.player.hp <= Math.max(s.player.maxHp - 12, heavyIncoming + 1)) add({ kind: 'item', id: 'potion' });
  const ultimate = ['meteor', 'execute', 'shadow', 'timestop', 'berserk'].find(id => !ultimateReason(s, id));
  if (s.battle.enemy.boss && ultimate && add({ kind: 'skill', id: ultimate })) return plan;
  if (s.battle.enemy.boss) add({ kind: 'item', id: 'bomb' });
  const defense = s.player.loadout.find(id => ['barrier', 'shieldwall'].includes(id) && s.battle.shield < 4 || id === 'invisible' && !s.battle.evade && !s.battle.hidden);
  if (defense) add({ kind: 'skill', id: defense });
  for (const id of s.player.loadout) if (!['barrier', 'shieldwall', 'invisible'].includes(id)) add({ kind: 'skill', id });
  while (add({ kind: 'attack' })) { /* Spend the remainder on basic attacks. */ }
  return plan;
}

export function simulate(classId, campaignId, seed) {
  let s = newRun(classId, campaignId, seed), commands = 0;
  const act = cmd => { s = dispatch(s, cmd); commands++; };
  while (s.status === 'active' && commands < 500) {
    if (!s.battle || s.encounter.resolved) {
      for (const id of builds[classId]) if (!learnReason(s, id)) act({ type: 'learn', id });
    }
    if (s.pendingGrowth) { act({ type: 'grow', choice: 'health' }); continue; }
    if (s.encounter.resolved) { act({ type: 'advance' }); continue; }
    if (!s.battle && s.player.san <= s.player.maxSan - 10 && s.player.inventory.tonic) { act({ type: 'item', id: 'tonic' }); continue; }
    if (s.battle) {
      if (s.stance !== 'guard') { act({ type: 'stance', id: 'guard' }); continue; }
      for (const action of choosePlan(s)) act({ type: 'queueAction', action });
      act({ type: 'resolveRound' });
    } else if (s.encounter.type === 'intro') act({ type: 'choose', id: 'accept' });
    else if (s.encounter.type === 'event') act({ type: 'choose', id: 'class' });
    else if (s.encounter.type === 'camp') act({ type: 'rest', choice: 'heal' });
    else if (s.encounter.type === 'shop') {
      if (s.player.gold >= 14 && (s.player.armorBuys || 0) < 3 && !s.encounter.purchases.armor) act({ type: 'buy', id: 'armor' });
      else if (s.player.gold >= 8 && (s.encounter.purchases.potion || 0) < 2 && s.player.inventory.potion < 4) act({ type: 'buy', id: 'potion' });
      else act({ type: 'leaveShop' });
    }
  }
  if (commands >= 500) throw new Error('Simulation did not terminate');
  return s;
}

if (process.argv[1]?.endsWith('simulate.mjs')) {
  const results = [];
  for (const classId of Object.keys(builds)) {
    let won = 0, totalHp = 0, totalNodes = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const s = simulate(classId, ['cult', 'oracle', 'theatre'][seed % 3], seed * 7139);
      won += Number(s.status === 'won'); totalHp += s.player.hp; totalNodes += s.completed.length;
    }
    results.push({ class: classId, runs: 150, won, winRate: (won / 150 * 100).toFixed(1) + '%', meanFinalHp: (totalHp / 150).toFixed(1), meanNodes: (totalNodes / 150).toFixed(1) });
  }
  console.table(results);
}
