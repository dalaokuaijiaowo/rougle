import { ACTION_POINTS, CLASSES, SKILL_BY_ID, STANCES } from './data.js';
import { RuleError, modifier, currentArmor, attackPower, dodgeChance, planReason } from './engine.js';

const requireRule = (condition, message) => { if (!condition) throw new RuleError(message); };
const knows = (fighter, id) => fighter.player.skills.includes(id);
function roll(duel, max = 100) {
  let x = duel.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  duel.rng = x >>> 0; return Math.floor(duel.rng / 4294967296 * max);
}
function log(duel, title, text = '', kind = 'combat') {
  duel.log.push({ id: ++duel.logId, round: duel.round, chapter: duel.chapter + 1, node: 7, title, text, kind });
  if (duel.log.length > 180) duel.log.shift();
}
export function newDuel(runs, seed, now = Date.now()) {
  const duel = { chapter: runs[0].chapter, rng: seed || 1, round: 0, initiative: seed % 2, deadline: now + 90000,
    fighters: runs.map(run => ({
      player: { ...structuredClone(run.player), hp: run.player.maxHp * 2, maxHp: run.player.maxHp * 2 },
      chapterUses: { ...run.chapterUses }, stance: run.stance, plan: [], submitted: false,
      shield: 0, evade: 0, hidden: false, dodgeBonus: 0, sunder: 0, weaken: 0, chill: 0, chillTurns: 0,
      stun: 0, berserk: 0, freezeUsed: false, statuses: [],
    })), log: [], logId: 0, result: null };
  for (let i = 0; i < 2; i++) if (knows(duel.fighters[i], 'taunt')) {
    duel.fighters[1 - i].sunder = 2; duel.fighters[1 - i].attackBonus = 1;
  }
  log(duel, '章节切磋开始', '训练生命为最大生命的两倍。补给封存，逃跑窗口关闭。', 'story');
  return duel;
}

// This projection reuses the PVE queue validator and combat controls without exposing a hidden opponent plan.
export function duelViewRun(base, duel, index) {
  const f = duel.fighters[index], other = duel.fighters[1 - index];
  return { ...structuredClone(base), status: 'active', pendingGrowth: false, player: structuredClone(f.player), chapterUses: { ...f.chapterUses }, stance: f.stance,
    encounter: { ...base.encounter, type: 'boss', title: '章节切磋', text: '没有伤亡指标，只有积分争议。', resolved: false },
    battle: { ...structuredClone(f), round: duel.round, maxAp: ACTION_POINTS, cooldowns: { ...f.player.cooldowns },
      sunder: 0, selfSunder: f.sunder, selfAttackBonus: f.attackBonus || 0, enemy: { id: other.player.id, name: CLASSES[other.player.classId].name, classId: other.player.classId,
        hp: other.player.hp, maxHp: other.player.maxHp, attack: attackPower(other) + (other.attackBonus || 0), armor: Math.max(0, currentArmor(other) - other.sunder),
        dodge: dodgeChance(other), boss: true, phase: 1, statuses: structuredClone(other.statuses), shield: other.shield } },
    log: structuredClone(duel.log), logId: duel.logId,
  };
}
export function duelPlanReason(base, duel, index, plan) {
  if (duel.result) return '本场切磋已经结束';
  if (duel.fighters[index].submitted) return '行动已锁定，等待双方结算';
  if (!Array.isArray(plan)) return '无效的行动队列';
  if (plan.some(a => a?.kind === 'item' || a?.kind === 'escape' || a?.id === 'vanish')) return '切磋中不能使用补给或撤退';
  return planReason(duelViewRun(base, duel, index), plan);
}

function damage(duel, target, amount, direct = true) {
  const f = duel.fighters[target];
  let dealt = Math.max(1, Math.floor(amount));
  if (direct) { const absorbed = Math.min(f.shield, dealt); f.shield -= absorbed; dealt -= absorbed; }
  if (dealt >= f.player.hp && knows(f, 'unyielding') && !f.chapterUses.unyielding) {
    f.chapterUses.unyielding = 1; f.player.hp = 8; log(duel, `${CLASSES[f.player.classId].name} · 不屈`, '保住 8 点训练生命。', 'skill');
  } else f.player.hp = Math.max(0, f.player.hp - dealt);
  return dealt;
}
function strike(duel, index, skill) {
  const f = duel.fighters[index], target = duel.fighters[1 - index], p = f.player;
  const effect = skill?.effect || { kind: 'damage', base: 5 };
  const name = `${CLASSES[p.classId].name} · ${skill?.name || '普通攻击'}`;
  const hit = Math.min(98, 90 + modifier(p.stats[CLASSES[p.classId].primary]) * 2);
  if (roll(duel) >= hit) { log(duel, `${name}未命中`); return; }
  if (target.evade) { target.evade--; log(duel, '隐身闪避', `${name}落空。`, 'skill'); return; }
  const dodge = Math.min(80, dodgeChance(target) + target.dodgeBonus); target.dodgeBonus = 0;
  if (roll(duel) < dodge) { log(duel, '闪避成功', `${name}被避开，闪避率 ${dodge}%。`, 'skill'); return; }
  const critical = roll(duel) < Math.max(1, 5 + modifier(p.stats.luk) * 2);
  let value = effect.base + modifier(p.stats[CLASSES[p.classId].primary]) + p.weapon + p.level - 1 + (f.attackBonus || 0);
  const armor = Math.max(0, currentArmor(target) - target.sunder);
  if (effect.vsArmor && armor >= 3) value += effect.vsArmor;
  if (effect.ambush && (duel.round === 1 || f.hidden)) { value *= effect.ambush; f.hidden = false; }
  value = Math.max(1, value - f.weaken - (f.chillTurns ? f.chill : 0));
  f.weaken = 0; if (f.chillTurns) f.chillTurns--;
  value *= STANCES[f.stance].damage * STANCES[target.stance].incoming * (f.berserk ? 1.5 : 1) * (target.berserk ? 1.25 : 1) * (critical ? 1.5 : 1);
  const dealt = damage(duel, 1 - index, Math.max(1, Math.floor(value) - armor));
  log(duel, name + (critical ? ' · 暴击' : ''), `造成 ${dealt} 点伤害。`);
  if (effect.weaken) target.weaken = Math.max(target.weaken, effect.weaken);
  if (effect.evade) f.evade = Math.max(f.evade, effect.evade);
  if (effect.chill) { target.chill = effect.chill; target.chillTurns = effect.duration; }
  for (const id of p.skills) {
    const e = SKILL_BY_ID[id].effect;
    if (e.kind === 'dot' && (!e.element || e.element === effect.element)) {
      const status = target.statuses.find(s => s.id === e.status);
      if (status) status.remaining = e.duration;
      else target.statuses.push({ id: e.status, value: e.value, remaining: e.duration, sourceId: p.id });
    }
    if (e.kind === 'sunder') target.sunder = Math.min(e.max + (knows(f, 'taunt') ? 2 : 0), target.sunder + e.value);
    if (e.kind === 'followup' && target.player.hp) log(duel, '连斩', `追加 ${damage(duel, 1 - index, Math.max(1, e.value - armor))} 点伤害。`, 'skill');
    if (e.kind === 'freeze' && effect.element === 'ice' && !f.freezeUsed) { target.stun = Math.max(target.stun, 1); f.freezeUsed = true; }
  }
}
function execute(duel, index, action) {
  const f = duel.fighters[index], target = duel.fighters[1 - index];
  if (f.stun) { f.stun--; log(duel, `${CLASSES[f.player.classId].name}无法行动`, '控制阻止了一项行动。', 'skill'); return; }
  if (action.kind === 'attack') { strike(duel, index); return; }
  if (action.kind === 'dodge') { f.dodgeBonus = 35; log(duel, `${CLASSES[f.player.classId].name} · 闪避准备`, '下一次直击闪避率 +35%。', 'skill'); return; }
  const skill = SKILL_BY_ID[action.id], e = skill.effect;
  if (skill.type === 'ultimate') f.chapterUses[skill.id] = 1;
  else f.player.cooldowns[skill.id] = f.player.combatClock + skill.cooldown;
  if (skill.sanCost) f.player.san -= skill.sanCost;
  if (e.kind === 'damage') strike(duel, index, skill);
  else if (e.kind === 'shield') f.shield = e.base + modifier(f.player.stats[e.attr]);
  else if (e.kind === 'invisible') { f.evade = 1; f.hidden = true; }
  else if (e.kind === 'berserk') f.berserk = e.duration + 1;
  else if (e.kind === 'execute') {
    if (target.player.hp / target.player.maxHp <= e.threshold) damage(duel, 1 - index, e.value, false);
    else log(duel, '斩杀落空', '目标不再符合斩杀条件。');
  } else if (e.kind === 'stun') target.stun = e.duration;
  if (e.kind !== 'damage') log(duel, `${CLASSES[f.player.classId].name} · ${skill.name}`, skill.description, 'skill');
}
function checkResult(duel) {
  const hp = duel.fighters.map(f => f.player.hp / f.player.maxHp);
  if (hp.every(v => v > 0) && duel.round < 20) return false;
  const winner = hp[0] === hp[1] ? null : hp[0] > hp[1] ? 0 : 1;
  duel.result = { winner, reason: hp.some(v => v === 0) ? '训练生命耗尽' : '20 回合上限，比较剩余生命比例' };
  log(duel, winner === null ? '切磋平局' : `${CLASSES[duel.fighters[winner].player.classId].name}赢得切磋`, duel.result.reason, 'reward');
  return true;
}
export function resolveDuel(previous, now = Date.now()) {
  const duel = structuredClone(previous);
  requireRule(!duel.result && (duel.fighters.every(f => f.submitted) || now >= duel.deadline), '等待双方锁定行动');
  duel.round++;
  const order = [(duel.initiative + duel.round - 1) % 2, (duel.initiative + duel.round) % 2];
  log(duel, `第 ${duel.round} 回合`, `${CLASSES[duel.fighters[order[0]].player.classId].name}先行动，双方按队列交替执行。`, 'round');
  for (const f of duel.fighters) { f.player.combatClock++; if (!f.submitted) { f.plan = []; log(duel, '超时待命', `${CLASSES[f.player.classId].name}未锁定行动。`, 'story'); } }
  for (let step = 0; step < ACTION_POINTS; step++) {
    for (const index of order) {
      const action = duel.fighters[index].plan[step];
      if (action) execute(duel, index, action);
      if (duel.fighters.some(f => f.player.hp <= 0)) { checkResult(duel); return duel; }
    }
  }
  for (const [i, f] of duel.fighters.entries()) {
    for (const status of f.statuses) { damage(duel, i, status.value, false); status.remaining--; }
    f.statuses = f.statuses.filter(s => s.remaining > 0);
    if (f.berserk) f.berserk--;
    // An empty plan cannot preserve a stun indefinitely.
    if (!f.plan.length && f.stun) f.stun--;
    f.plan = []; f.submitted = false;
  }
  if (!checkResult(duel)) duel.deadline = now + 90000;
  return duel;
}
export function duelCommand(previous, base, index, command, now = Date.now()) {
  const duel = structuredClone(previous), f = duel.fighters[index];
  requireRule(!duel.result && !f.submitted, '本回合已锁定');
  if (command.type === 'stance') { requireRule(Object.hasOwn(STANCES, command.id), '无效战术'); f.stance = command.id; return duel; }
  let plan = [...f.plan];
  if (command.type === 'queueAction') plan.push(command.action);
  else if (command.type === 'clearPlan') plan = [];
  else if (command.type === 'removeAction') { requireRule(Number.isInteger(command.index) && command.index >= 0 && command.index < plan.length, '无效队列位置'); plan.splice(command.index, 1); }
  else if (command.type === 'moveAction') {
    const i = command.index, j = i + command.direction;
    requireRule(Number.isInteger(i) && [-1, 1].includes(command.direction) && i >= 0 && j >= 0 && i < plan.length && j < plan.length, '无效队列位置');
    [plan[i], plan[j]] = [plan[j], plan[i]];
  } else requireRule(command.type === 'resolveRound', '切磋中只允许战斗指令');
  const reason = duelPlanReason(base, duel, index, plan); requireRule(!reason, reason);
  f.plan = plan.map(a => a.id ? { kind: a.kind, id: a.id } : { kind: a.kind });
  if (command.type === 'resolveRound') f.submitted = true;
  return duel.fighters.every(f => f.submitted) ? resolveDuel(duel, now) : duel;
}
