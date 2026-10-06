import { VERSION, ACTION_POINTS, DODGE_BASE, CLASSES, SKILL_BY_ID, CAMPAIGNS, NODE_TYPES, STANCES, ITEMS, EVENT_TEXT } from './data.js';
import { enemyDefinition, ENEMY_BY_ID } from './enemies.js';
import { chapterMap, adjacentNodes, validMap } from './map.js';

export class RuleError extends Error {}
const requireRule = (condition, message) => { if (!condition) throw new RuleError(message); };
export const modifier = value => Math.floor((value - 10) / 2);
export const hasSkill = (state, id) => state.player.skills.includes(id);
export const chapterNumber = state => state.chapter + 1;
export const currentArmor = state => CLASSES[state.player.classId].armor + state.player.armor;
export const attackPower = state => 5 + modifier(state.player.stats[CLASSES[state.player.classId].primary]) + state.player.weapon + state.player.level - 1;
export const dodgeChance = state => Math.min(35, DODGE_BASE[state.player.classId] + state.player.level - 1 + 2 * (modifier(state.player.stats.agi) - modifier(CLASSES[state.player.classId].stats.agi)));
export const cooldownRemaining = (state, id) => Math.max(0, (state.player.cooldowns[id] || 0) - state.player.combatClock - 1);

// The PRNG state is saved with the run. Reloading does not reroll a result.
function random(state, max) {
  let x = state.rng >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.rng = x >>> 0;
  return Math.floor(state.rng / 4294967296 * max);
}
function log(state, kind, title, text = '') {
  state.log.push({ id: ++state.logId, kind, title, text, chapter: state.chapter + 1, node: state.node + 1, round: state.battle?.round || 0 });
  if (state.log.length > 180) state.log.shift();
}
function heal(state, amount) { state.player.hp = Math.min(state.player.maxHp, state.player.hp + amount); }
function sanity(state, amount) { state.player.san = Math.min(state.player.maxSan, Math.max(0, state.player.san + amount)); checkDeath(state); }
function checkDeath(state) {
  if (state.status !== 'active') return;
  if (state.player.hp <= 0 || state.player.san <= 0) {
    state.player.hp = Math.max(0, state.player.hp);
    state.status = 'dead';
    state.ending = state.player.hp <= 0 ? '你的生命体征停止更新。事务所将这次事故归类为「员工主动离岗」。' : '你的理智正式离职了。你的身体还在继续上班，这一点得到了管理层的高度评价。';
    log(state, 'death', '委托终止 · 人员损失已归档', state.ending);
  }
}
function hurt(state, amount) {
  if (state.status !== 'active') return;
  if (amount >= state.player.hp && hasSkill(state, 'unyielding') && !state.chapterUses.unyielding) {
    state.chapterUses.unyielding = 1;
    state.player.hp = Math.min(8, state.player.maxHp);
    log(state, 'skill', '不屈', '在致命伤害生效前保住 8 HP。本章机会已用尽。');
  } else state.player.hp = Math.max(0, state.player.hp - amount);
  checkDeath(state);
}
export function newRun(classId, campaignId, seed = 1) {
  const cls = CLASSES[classId];
  requireRule(cls && CAMPAIGNS[campaignId], '无效的职业或委托。');
  const state = {
    version: VERSION, id: `${campaignId}-${seed >>> 0}`, seed: seed >>> 0, rng: (seed >>> 0) || 1,
    mode: 'solo', status: 'active', campaignId, chapter: 0, node: 0, revision: 0,
    player: { id: 'player-1', teamId: 'team-1', classId, level: 1, stats: { ...cls.stats }, hp: cls.hp, maxHp: cls.hp, san: cls.san, maxSan: cls.san, gold: cls.gold, clues: 0, weapon: 2, armor: 0, skills: [cls.starter], skillPoints: 1, loadout: [cls.starter], inventory: { potion: 2, tonic: 1, bomb: 1 } },
    stance: 'balanced', chapterUses: {}, pendingGrowth: false, entryGrowthClaimed: false,
    completed: [], encounter: null, battle: null, log: [], logId: 0, enemyRecords: {}, map: chapterMap(seed, 0),
    metrics: { kills: 0, checks: 0, passed: 0, spent: 0, damage: 0 }, ending: null,
  };
  state.player.combatClock = 0; state.player.cooldowns = {};
  enterNode(state);
  log(state, 'story', '劳动关系已建立', `${cls.name}接下了「${CAMPAIGNS[campaignId].name}」。人事部祝你工作顺利。`);
  return state;
}

function enterNode(state, route = 'safe') {
  const { chapter: c, node: n } = state;
  const mapNode = state.map.nodes.find(node => node.id === state.map.currentId);
  const type = mapNode.type;
  const entry = { id: `${state.campaignId}-${mapNode.id}`, type, route, resolved: false, result: '', stolen: false, purchases: {}, restUsed: false };
  const campaign = CAMPAIGNS[state.campaignId];
  if (type === 'intro') {
    entry.title = ['新的委托，旧的免责条款', '档案馆拒绝承认你的存在', '午夜已至，请完成离岗手续'][c];
    entry.text = c === 0 ? campaign.briefing : c === 1 ? '门卫翻遍了所有档案，确认你目前还没有死亡证明。「那就先进去补办吧。」你接过临时通行证。' : '电梯只剩下一个按钮：终点。合同在你的口袋里发热，仿佛急着销毁证据。';
  } else if (type === 'event') {
    const [title, text] = EVENT_TEXT[state.campaignId][c];
    entry.title = n === 3 ? `封存副本：${title}` : title;
    entry.text = n === 3 ? `${text} 桌边多了一份未销毁的副本，处理它比正本更危险。` : text;
    entry.dc = 10 + c * 2 + (route === 'risk' ? 2 : 0);
  } else if (type === 'shop') {
    entry.title = ['夜班黑市', '档案员的副业', '最后一间便利店'][c];
    entry.text = '老板把「童叟无欺」翻到了背面，露出「概不赊账」。柜台上的药没有生产日期，只有预计使用日期。';
  } else if (type === 'camp') {
    entry.title = ['还没塌的休息室', '暂时安全的阅览区', '终点前的值班室'][c];
    entry.text = '灯还亮着，水还是热的。墙上的标语写着：「充分休息，是为了更长久地加班。」这一回，你决定相信它。';
  } else {
    const boss = type === 'boss';
    const elite = type === 'elite';
    const def = enemyDefinition(state.campaignId, c, type);
    entry.title = def.name;
    entry.text = boss ? `「一切都在计划之中。」${entry.title}整理好领口。显然，计划里没有给你留返程的位置。` : elite ? '对方拿出了武器和一份空白事故报告，看起来已经准备好其中一项工作。' : '前方的身影拦住去路。它要求你出示通行证。你看着它手里的刀，决定先确认一下办理流程。';
    state.battle = { round: 0, maxAp: ACTION_POINTS, plan: [], enemy: { id: `enemy-${c}-${n}`, definitionId: def.id, teamId: 'enemy', name: entry.title, hp: def.hp, maxHp: def.hp, attack: def.attack, armor: def.armor, speed: def.speed, boss, phase: 1, statuses: [] }, shield: 0, evade: 0, hidden: false, cooldowns: {}, sunder: 0, freezeUsed: false, berserk: 0, chill: 0, chillTurns: 0, stun: 0 };
    state.battle.dodgeBonus = 0;
    state.battle.cooldowns = { ...state.player.cooldowns };
    const record = state.enemyRecords[def.id] ||= { seen: 0, kills: 0 };
    record.seen++;
    if (hasSkill(state, 'taunt')) { state.battle.enemy.armor = Math.max(0, state.battle.enemy.armor - 2); state.battle.enemy.attack += 1; }
  }
  state.encounter = entry;
}

function resolve(state, result) {
  if (state.encounter.resolved || state.status !== 'active') return;
  state.encounter.resolved = true;
  state.encounter.result = result;
  state.completed.push({ chapter: state.chapter, node: state.node, mapNodeId: state.map.currentId, type: state.encounter.type, result });
  log(state, 'reward', '区域已完成', result);
}
function victory(state) {
  if (!state.battle || state.battle.enemy.hp > 0 || state.status !== 'active') return;
  const boss = state.battle.enemy.boss;
  const reward = (boss ? 16 : state.encounter.type === 'elite' ? 10 : 6) + state.chapter * 3;
  state.player.gold += reward;
  state.metrics.kills++;
  const entry = state.enemyRecords[state.battle.enemy.definitionId] ||= { seen: 1, kills: 0 };
  entry.kills++;
  let result = `获得 ${reward} 金币。`;
  if (boss) {
    state.player.clues++;
    state.player.weapon++;
    heal(state, Math.ceil(state.player.maxHp * .5));
    sanity(state, 4);
    result += ' 线索 +1，武器伤害 +1，恢复 50% 生命与 4 理智。';
  }
  resolve(state, result);
  if (boss && state.chapter < 2) state.pendingGrowth = true;
  if (boss && state.chapter === 2) {
    state.status = 'won';
    const campaign = CAMPAIGNS[state.campaignId];
    state.ending = state.player.clues >= 8 ? campaign.clueEnding : campaign.ending;
    log(state, 'story', '委托完成 · 你居然回来了', state.ending);
  }
}

export function checkBonus(state, attr) {
  let value = modifier(state.player.stats[attr]);
  if (CLASSES[state.player.classId].primary === attr) value += 2;
  if (attr === 'agi' && hasSkill(state, 'lockpick')) value += 3;
  return value;
}
export function check(state, attr, dc, extra = 0) {
  const roll = random(state, 20) + 1;
  const bonus = checkBonus(state, attr) + extra;
  const total = roll + bonus;
  const outcome = roll === 1 ? 'criticalFailure' : roll === 20 ? 'criticalSuccess' : total >= dc + 10 ? 'criticalSuccess' : total <= dc - 10 ? 'criticalFailure' : total >= dc ? 'success' : 'failure';
  const success = outcome === 'success' || outcome === 'criticalSuccess';
  state.metrics.checks++;
  if (success) state.metrics.passed++;
  const result = { roll, bonus, total, dc, outcome, success, attr };
  state.lastCheck = result;
  log(state, success ? 'check' : 'damage', `${{ criticalSuccess: '大成功', success: '检定成功', failure: '检定失败', criticalFailure: '大失败' }[outcome]} · D20`, `${roll} ${bonus >= 0 ? '+' : '-'} ${Math.abs(bonus)} = ${total} / DC ${dc}`);
  return result;
}

export function eventOptions(state) {
  if (state.encounter.type === 'intro') return [{ id: 'accept', label: state.chapter === 0 ? '签署免责协议，进入旧街' : '收好通行证，继续调查', detail: state.chapter === 2 ? '晋升至 Lv.4 · 终极技能可解锁' : '领取 1 份线索', icon: 'arrow-right' }];
  if (state.encounter.type !== 'event') return [];
  const cls = CLASSES[state.player.classId];
  return [
    { id: 'class', label: { warrior: '直接拆开它', rogue: '撬开封条', mage: '解析残留术式' }[cls.id], detail: `${cls.name}专属 · ${state.encounter.route === 'risk' ? '高风险' : '专业处理'}`, attr: cls.primary, dc: state.encounter.dc, icon: cls.icon },
    { id: 'inspect', label: '仔细检查周围', detail: '成功获得 1 线索与 5 金币；失败 -3 SAN', attr: 'per', dc: state.encounter.dc, icon: 'search' },
    { id: 'pay', label: '付费获取副本', detail: '支付 5 金币，获得 1 线索', disabled: state.player.gold < 5, icon: 'coins' },
    { id: 'leave', label: '假装没看见', detail: '安全离开，不获得奖励', icon: 'footprints' },
  ];
}
function chooseEvent(state, id) {
  requireRule(!state.encounter.resolved && !state.battle, '当前无法处理事件。');
  const option = eventOptions(state).find(o => o.id === id);
  requireRule(option && !option.disabled, '这个选项当前不可用。');
  if (id === 'accept') {
    state.player.clues++;
    resolve(state, '线索 +1。你的调查已被记录。');
    if (state.chapter === 2 && !state.entryGrowthClaimed) { state.pendingGrowth = true; state.entryGrowthClaimed = true; }
  } else if (id === 'leave') resolve(state, '你决定不给自己增加工作量。');
  else if (id === 'pay') {
    state.player.gold -= 5; state.metrics.spent += 5; state.player.clues++;
    resolve(state, '金币 -5，线索 +1。发票需要另外收费。');
  } else {
    const result = check(state, option.attr, option.dc);
    if (result.success) {
      const extra = result.outcome === 'criticalSuccess';
      state.player.clues += extra ? 2 : 1;
      state.player.gold += extra ? 10 : 5;
      resolve(state, `线索 +${extra ? 2 : 1}，金币 +${extra ? 10 : 5}。有些真相的确比加班费更容易到手。`);
    } else {
      const critical = result.outcome === 'criticalFailure';
      if (id === 'inspect') sanity(state, critical ? -6 : -3);
      else hurt(state, Math.ceil((critical ? 7 : 4) / (hasSkill(state, 'sprint') ? 2 : 1)));
      if (state.status === 'active') resolve(state, `${id === 'inspect' ? '理智' : '生命'}受损。现场很安静，只有你的报销申请在尖叫。`);
    }
  }
}

function damageEnemy(state, value, trueDamage = false) {
  const b = state.battle;
  const amount = Math.max(1, Math.floor(value) - (trueDamage ? 0 : Math.max(0, b.enemy.armor - b.sunder)));
  const dealt = Math.min(b.enemy.hp, amount);
  b.enemy.hp = Math.max(0, b.enemy.hp - amount);
  state.metrics.damage += dealt;
  return amount;
}
function applyAttack(state, skillDef) {
  const b = state.battle, p = state.player, cls = CLASSES[p.classId];
  const effect = skillDef?.effect || { kind: 'damage', base: 5 };
  const hit = Math.min(98, 90 + modifier(p.stats[cls.primary]) * 2);
  if (random(state, 100) >= hit) { log(state, 'combat', `${skillDef?.name || '普通攻击'}未命中`, '对方敏捷地躲开了责任。'); return; }
  const critical = random(state, 100) < Math.max(1, 5 + modifier(p.stats.luk) * 2);
  let value = effect.base + modifier(p.stats[cls.primary]) + p.weapon + p.level - 1;
  if (effect.vsArmor && b.enemy.armor - b.sunder >= 3) value += effect.vsArmor;
  if (effect.ambush && (b.round === 1 || b.hidden)) { value *= effect.ambush; b.hidden = false; }
  value *= STANCES[state.stance].damage * (b.berserk ? 1.5 : 1) * (critical ? 1.5 : 1);
  const dealt = damageEnemy(state, value);
  log(state, 'combat', `${skillDef?.name || '普通攻击'}${critical ? ' · 暴击' : ''}`, `你对${b.enemy.name}造成 ${dealt} 点伤害。`);
  if (effect.weaken) b.weaken = Math.max(b.weaken || 0, effect.weaken);
  if (effect.evade) b.evade = Math.max(b.evade, effect.evade);
  if (effect.chill) { b.chill = effect.chill; b.chillTurns = effect.duration; }
  for (const id of p.skills) {
    const e = SKILL_BY_ID[id].effect;
    if (e.kind === 'dot' && (!e.element || e.element === effect.element)) {
      const status = b.enemy.statuses.find(s => s.id === e.status);
      if (status) status.remaining = e.duration;
      else b.enemy.statuses.push({ id: e.status, value: e.value, remaining: e.duration, sourceId: p.id });
    }
    if (e.kind === 'sunder') b.sunder = Math.min(e.max, b.sunder + e.value);
    if (e.kind === 'followup' && b.enemy.hp > 0) log(state, 'skill', '连斩', `追加 ${damageEnemy(state, e.value)} 点伤害。`);
    if (e.kind === 'freeze' && effect.element === 'ice' && !b.freezeUsed) { b.stun = Math.max(b.stun, 1); b.freezeUsed = true; }
  }
}
function useCombatSkill(state, skillDef) {
  const b = state.battle, effect = skillDef.effect;
  if (skillDef.type === 'ultimate') state.chapterUses[skillDef.id] = 1;
  else { state.player.cooldowns[skillDef.id] = state.player.combatClock + skillDef.cooldown; b.cooldowns[skillDef.id] = state.player.cooldowns[skillDef.id]; }
  if (skillDef.sanCost) sanity(state, -skillDef.sanCost);
  if (state.status !== 'active') return;
  if (effect.kind === 'damage') applyAttack(state, skillDef);
  else if (effect.kind === 'shield') {
    b.shield = effect.base + modifier(state.player.stats[effect.attr]);
    log(state, 'skill', skillDef.name, `获得 ${b.shield} 点护盾。`);
  } else if (effect.kind === 'invisible') { b.evade = 1; b.hidden = true; log(state, 'skill', '隐身', '下一次受击将被闪避，背刺得到强化。'); }
  else if (effect.kind === 'berserk') { b.berserk = effect.duration + 1; log(state, 'skill', '狂战', '此后 3 回合伤害 +50%，效果期间承伤 +25%。'); }
  else if (effect.kind === 'execute') log(state, 'skill', '斩杀', `造成 ${damageEnemy(state, effect.value, true)} 点真实伤害。`);
  else if (effect.kind === 'stun') { b.stun = effect.duration; log(state, 'skill', '时间停止', '敌人接下来两次行动被暂停。'); }
  else if (effect.kind === 'escape') { resolve(state, '你从现场消失，没有留下辞职信，也没有带走战利品。'); state.battle = null; }
}

function enemyTurn(state) {
  const b = state.battle;
  if (b.stun > 0) { b.stun--; log(state, 'skill', '敌人无法行动', '控制效果阻止了这次攻击。'); return; }
  if (b.evade > 0) { b.evade--; log(state, 'skill', '闪避', '攻击落空。对方正在重新评估你的出勤情况。'); return; }
  const heavy = b.round % 3 === 0;
  const dodge = Math.min(80, dodgeChance(state) + b.dodgeBonus);
  b.dodgeBonus = 0;
  if (random(state, 100) < dodge) { log(state, 'skill', '闪避成功', `避开了敌方${heavy ? '重击' : '攻击'}，闪避率 ${dodge}%。`); return; }
  let value = Math.max(1, b.enemy.attack - (b.weaken || 0) - (b.chillTurns > 0 ? b.chill : 0));
  b.weaken = 0;
  if (b.chillTurns > 0) b.chillTurns--;
  value *= (heavy ? 1.5 : 1) * (b.enemy.phase === 2 ? 1.15 : 1) * STANCES[state.stance].incoming * (b.berserk > 0 ? 1.25 : 1);
  let amount = Math.max(1, Math.floor(value) - currentArmor(state));
  const absorbed = Math.min(b.shield, amount);
  b.shield -= absorbed; amount -= absorbed;
  log(state, 'damage', heavy ? '敌方重击' : '敌方攻击', `受到 ${amount} 点伤害${absorbed ? `，护盾吸收 ${absorbed} 点` : ''}。`);
  if (amount) hurt(state, amount);
}
export function ultimateReason(state, id) {
  const skillDef = SKILL_BY_ID[id];
  if (!skillDef || !hasSkill(state, id) || skillDef.type !== 'ultimate' || skillDef.automatic) return '未解锁主动终极技能';
  if (state.chapterUses[id]) return '本章已使用';
  if (!state.battle || state.encounter.resolved) return '仅战斗中可用';
  if (skillDef.sanCost && state.player.san <= skillDef.sanCost) return '理智不足';
  if (skillDef.effect.kind === 'execute' && state.battle.enemy.hp / state.battle.enemy.maxHp > .3) return '敌人生命需不高于 30%';
  if (skillDef.effect.kind === 'escape' && state.battle.enemy.boss) return '首领战不可逃脱';
  return '';
}
export function actionInfo(action) {
  if (action?.kind === 'attack') return { name: '普通攻击', icon: 'sword', ap: 1 };
  if (action?.kind === 'dodge') return { name: '闪避', icon: 'wind', ap: 1 };
  if (action?.kind === 'escape') return { name: '撤退', icon: 'footprints', ap: 3 };
  if (action?.kind === 'skill' && Object.hasOwn(SKILL_BY_ID, action.id)) {
    const s = SKILL_BY_ID[action.id];
    return { name: s.name, icon: s.icon, ap: s.apCost };
  }
  if (action?.kind === 'item' && ['potion', 'tonic', 'bomb'].includes(action.id)) return { name: ITEMS[action.id].name, icon: ITEMS[action.id].icon, ap: 1 };
  return null;
}
export function remainingAp(state) { return state.battle ? state.battle.maxAp - state.battle.plan.reduce((sum, a) => sum + actionInfo(a).ap, 0) : 0; }
export function planReason(state, plan) {
  if (state.status !== 'active' || !state.battle || state.encounter.resolved) return '当前没有正在进行的战斗';
  if (!Array.isArray(plan) || plan.length > ACTION_POINTS) return '行动队列无效';
  let spent = 0;
  const skills = new Set(), inventory = { ...state.player.inventory };
  for (const action of plan) {
    const info = actionInfo(action);
    if (!info) return '未知行动';
    spent += info.ap;
    if (spent > state.battle.maxAp) return '本回合行动点不足';
    if (action.kind === 'skill') {
      const s = SKILL_BY_ID[action.id];
      if (!hasSkill(state, s.id) || !['active', 'ultimate'].includes(s.type) || s.automatic) return '此技能不能主动施放';
      if (skills.has(s.id)) return '同一技能每回合只能安排一次';
      skills.add(s.id);
      if (s.type === 'active' && !state.player.loadout.includes(s.id)) return '请先装配该主动技能';
      if (cooldownRemaining(state, s.id)) return `冷却剩余 ${cooldownRemaining(state, s.id)} 回合`;
      if (s.type === 'ultimate') { const reason = ultimateReason(state, s.id); if (reason) return reason; }
    }
    if (action.kind === 'item') {
      if (!inventory[action.id]--) return '该物品数量不足';
      if (action.id === 'potion' && state.player.hp === state.player.maxHp) return '生命已满';
      if (action.id === 'tonic' && state.player.san === state.player.maxSan) return '理智已满';
    }
    if (action.kind === 'escape' && state.battle.enemy.boss) return '首领战不可撤退';
    if (action.kind === 'dodge') {
      if (skills.has('dodge') || state.battle.dodgeBonus) return '闪避准备不可叠加';
      skills.add('dodge');
    }
  }
  return '';
}
function requireCombat(state) { requireRule(state.battle && !state.encounter.resolved, '当前没有正在进行的战斗。'); }
function resolveRound(state) {
  requireCombat(state);
  const b = state.battle;
  const reason = planReason(state, b.plan);
  requireRule(!reason, reason);
  const plan = [...b.plan];
  b.plan = []; b.round++; state.player.combatClock++;
  log(state, 'round', `第 ${b.round} 回合`, `可用 ${b.maxAp} AP，已编排 ${plan.reduce((sum, a) => sum + actionInfo(a).ap, 0)} AP。`);
  for (const [index, action] of plan.entries()) {
    const info = actionInfo(action);
    log(state, 'action', `行动 ${index + 1} · ${info.name}`, `消耗 ${info.ap} AP。`);
    if (action.kind === 'attack') applyAttack(state);
    else if (action.kind === 'dodge') { b.dodgeBonus = 35; log(state, 'skill', '闪避准备', '下一次直接受击时，闪避率 +35 个百分点。'); }
    else if (action.kind === 'skill') useCombatSkill(state, SKILL_BY_ID[action.id]);
    else if (action.kind === 'item') useItem(state, action.id, true);
    else if (action.kind === 'escape') {
      const result = check(state, 'agi', 12 + state.chapter * 2, hasSkill(state, 'sprint') ? 5 : 0);
      if (result.success) { resolve(state, '撤离成功，无战利品。活着也是一种工作成果。'); state.battle = null; }
    }
    if (state.status !== 'active' || !state.battle || state.encounter.resolved) return;
    if (b.enemy.hp <= 0) { victory(state); return; }
  }
  // The player controls the complete sequence; the enemy responds once per round.
  enemyTurn(state);
  if (state.status !== 'active') return;
  for (const status of b.enemy.statuses) {
    const amount = damageEnemy(state, status.value, true);
    log(state, 'skill', status.id === 'poison' ? '中毒' : '燃烧', `敌人受到 ${amount} 点持续伤害。`);
    status.remaining--;
    if (b.enemy.hp <= 0) break;
  }
  b.enemy.statuses = b.enemy.statuses.filter(s => s.remaining > 0);
  if (b.berserk > 0) b.berserk--;
  if (b.enemy.hp <= 0) { victory(state); return; }
  if (b.enemy.boss && b.enemy.phase === 1 && b.enemy.hp <= b.enemy.maxHp * .5) {
    b.enemy.phase = 2;
    log(state, 'story', '首领进入第二阶段', '下回合起敌方伤害提高 15%。');
  }
}

export function learnReason(state, id) {
  const skillDef = SKILL_BY_ID[id];
  if (!skillDef || skillDef.classId !== state.player.classId) return '职业不符';
  if (hasSkill(state, id)) return '已掌握';
  if (state.battle && !state.encounter.resolved) return '交战中无法学习';
  if (state.player.level < skillDef.minLevel) return `需要 Lv.${skillDef.minLevel}`;
  if (skillDef.requires && !hasSkill(state, skillDef.requires)) return `先学习${SKILL_BY_ID[skillDef.requires].name}`;
  if (state.player.skillPoints < skillDef.cost) return '技能点不足';
  return '';
}
function grow(state, choice) {
  requireRule(state.pendingGrowth && ['power', 'health', 'sanity'].includes(choice), '当前无法升级。');
  const p = state.player, cls = CLASSES[p.classId];
  p.level++; p.skillPoints += 2;
  p.stats[cls.primary] = Math.min(20, p.stats[cls.primary] + 1);
  p.stats[cls.secondary] = Math.min(20, p.stats[cls.secondary] + 1);
  const hp = cls.growth.hp + (choice === 'health' ? 6 : 0);
  const san = cls.growth.san + (choice === 'sanity' ? 6 : 0);
  p.maxHp += hp; p.hp += hp; p.maxSan += san; p.san += san;
  if (choice === 'power') p.stats[cls.primary] = Math.min(20, p.stats[cls.primary] + 2);
  state.pendingGrowth = false;
  log(state, 'reward', `晋升至 Lv.${p.level}`, '技能点 +2，职业属性与生命、理智上限提升。人事部拒绝同步调整薪酬。');
}
function advance(state, route, nodeId) {
  requireRule(state.encounter.resolved && !state.pendingGrowth, '先完成当前区域与晋升。');
  requireRule(['safe', 'risk'].includes(route), '无效的路线。');
  if (state.node === 6) {
    requireRule(!nodeId, '请先完成章节交接。');
    state.node = 0; state.chapter++; state.chapterUses = {};
    requireRule(state.chapter < 3, '委托已经完成。');
    state.map = chapterMap(state.seed, state.chapter);
  } else {
    const next = adjacentNodes(state);
    const selected = nodeId ? next.find(n => n.id === nodeId) : route === 'risk' ? next.find(n => n.type === (state.node === 0 ? 'combat' : 'event')) || next.at(-1) : next[0];
    requireRule(selected && !state.map.visited.includes(selected.id), '只能进入当前区域连线指向的下一处区域。');
    state.map.currentId = selected.id; state.map.visited.push(selected.id); state.node = selected.depth;
    route = selected.lane === 0 ? 'safe' : 'risk';
  }
  state.battle = null; state.lastCheck = null;
  requireRule(state.chapter < 3, '委托已经完成。');
  enterNode(state, route);
}
function useItem(state, id, inPlan = false) {
  requireRule(inPlan || !state.battle || state.encounter.resolved, '请将物品加入本回合行动队列，消耗 1 AP。');
  const item = ITEMS[id];
  requireRule(item && state.player.inventory[id] > 0, '没有这件物品。');
  if (item.kind === 'heal' && !inPlan) requireRule(state.player.hp < state.player.maxHp, '生命已满。');
  if (item.kind === 'sanity' && !inPlan) requireRule(state.player.san < state.player.maxSan, '理智已满。');
  if (item.kind === 'damage') requireRule(state.battle && !state.encounter.resolved, '震爆弹只能在交战中使用。');
  state.player.inventory[id]--;
  if (item.kind === 'heal') heal(state, item.value);
  if (item.kind === 'sanity') sanity(state, item.value);
  if (item.kind === 'damage') { damageEnemy(state, item.value, true); victory(state); }
  log(state, 'item', `使用${item.name}`, item.description);
}
function buy(state, id) {
  requireRule(state.encounter.type === 'shop' && !state.encounter.resolved, '商店已关闭。');
  const item = ITEMS[id], p = state.player;
  requireRule(item && p.gold >= item.price, '金币不足。');
  requireRule((state.encounter.purchases[id] || 0) < 2, '本店库存售罄。');
  if (item.kind === 'weapon' || item.kind === 'armor') requireRule((p[`${item.kind}Buys`] || 0) < 3, '本局改装已达到上限。');
  p.gold -= item.price; state.metrics.spent += item.price;
  state.encounter.purchases[id] = (state.encounter.purchases[id] || 0) + 1;
  if (item.kind === 'weapon' || item.kind === 'armor') { p[item.kind]++; p[`${item.kind}Buys`] = (p[`${item.kind}Buys`] || 0) + 1; }
  else p.inventory[id] = (p.inventory[id] || 0) + 1;
  log(state, 'item', `购入${item.name}`, `支付 ${item.price} 金币。`);
}
function explorationSkill(state, id, choice) {
  requireRule(hasSkill(state, id) && SKILL_BY_ID[id].type === 'exploration', '未掌握此探索技能。');
  requireRule(!state.battle || state.encounter.resolved, '交战中无法使用探索技能。');
  const s = SKILL_BY_ID[id];
  requireRule(!s.perChapter || !state.chapterUses[id], '本章已使用。');
  if (s.sanCost) requireRule(state.player.san > s.sanCost, '理智不足。');
  if (id === 'steal') {
    requireRule(state.encounter.type === 'shop' && !state.encounter.resolved && !state.encounter.stolen, '当前无法偷窃。');
    state.encounter.stolen = true;
    const result = check(state, 'agi', s.effect.dc);
    if (result.success) { state.player.inventory.potion++; log(state, 'item', '资产转移成功', '获得一支治疗针。'); }
    else hurt(state, hasSkill(state, 'sprint') ? 2 : 4);
  } else if (id === 'teleport') {
    requireRule(!state.encounter.resolved && !['intro', 'boss', 'combat', 'elite'].includes(state.encounter.type), '这个区域无法跳过。');
    sanity(state, -s.sanCost); resolve(state, '空间折叠。你抵达了出口，没有带走任何东西。');
  } else if (id === 'sleight') {
    requireRule(['potion', 'bomb'].includes(choice), '请选择一种物资。');
    state.player.inventory[choice]++;
    log(state, 'item', '妙手', `获得${ITEMS[choice].name}。所有权问题留给法务。`);
  }
  if (s.perChapter) state.chapterUses[id] = 1;
}

/** Commands contain intent only; all numbers and random outcomes are engine-owned. */
export function dispatch(previous, command) {
  requireRule(previous?.version === VERSION, '存档版本不兼容。');
  requireRule(previous.status === 'active', '这位员工的档案已经封存，请开始新委托。');
  const state = structuredClone(previous);
  switch (command.type) {
    case 'choose': chooseEvent(state, command.id); break;
    case 'advance': advance(state, command.route || 'safe', command.nodeId); break;
    case 'queueAction': {
      requireCombat(state);
      const plan = [...state.battle.plan, command.action];
      const reason = planReason(state, plan); requireRule(!reason, reason);
      state.battle.plan = plan.map(a => a.id ? { kind: a.kind, id: a.id } : { kind: a.kind });
      break;
    }
    case 'removeAction':
      requireCombat(state);
      requireRule(Number.isInteger(command.index) && command.index >= 0 && command.index < state.battle.plan.length, '无效的队列位置。');
      state.battle.plan.splice(command.index, 1); break;
    case 'moveAction': {
      requireCombat(state);
      const index = command.index, next = index + command.direction;
      requireRule([-1, 1].includes(command.direction) && Number.isInteger(index) && index >= 0 && next >= 0 && index < state.battle.plan.length && next < state.battle.plan.length, '无法移动到该位置。');
      [state.battle.plan[index], state.battle.plan[next]] = [state.battle.plan[next], state.battle.plan[index]];
      break;
    }
    case 'clearPlan': requireCombat(state); state.battle.plan = []; break;
    case 'resolveRound': resolveRound(state); break;
    case 'stance': requireRule(STANCES[command.id], '无效战术。'); state.stance = command.id; break;
    case 'item': useItem(state, command.id); break;
    case 'buy': buy(state, command.id); break;
    case 'grow': grow(state, command.choice); break;
    case 'learn': {
      const reason = learnReason(state, command.id); requireRule(!reason, reason);
      const s = SKILL_BY_ID[command.id];
      state.player.skills.push(s.id); state.player.skillPoints -= s.cost;
      if (s.type === 'active' && state.player.loadout.length < 2) state.player.loadout.push(s.id);
      log(state, 'skill', `掌握${s.name}`, s.description);
      break;
    }
    case 'equip': {
      const s = SKILL_BY_ID[command.id];
      requireRule(s?.type === 'active' && hasSkill(state, s.id), '未掌握此主动技能。');
      requireRule(!state.battle || state.encounter.resolved, '交战中无法更换技能装配。');
      if (state.player.loadout.includes(s.id)) state.player.loadout = state.player.loadout.filter(id => id !== s.id);
      else { requireRule(state.player.loadout.length < 2, '先卸下一项主动技能，最多装配两项。'); state.player.loadout.push(s.id); }
      break;
    }
    case 'rest': {
      requireRule(state.encounter.type === 'camp' && !state.encounter.resolved && ['heal', 'sanity'].includes(command.choice), '当前无法休息。');
      if (command.choice === 'heal') { heal(state, state.player.maxHp); sanity(state, 4); }
      else { sanity(state, state.player.maxSan); heal(state, 8); }
      resolve(state, command.choice === 'heal' ? '生命完全恢复，理智 +4。椅子比同事更可靠。' : '理智完全恢复，生命 +8。你暂时想不起这份工作的意义，这很好。');
      break;
    }
    case 'leaveShop': requireRule(state.encounter.type === 'shop' && !state.encounter.resolved, '当前不在营业中的商店。'); resolve(state, '采购结束。请妥善保管没有法律效力的收据。'); break;
    case 'explorationSkill': explorationSkill(state, command.id, command.choice); break;
    default: throw new RuleError('未知操作。');
  }
  state.revision++;
  return state;
}

export function validSave(value) {
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
  const strings = (v, keys) => keys.every(key => typeof v[key] === 'string');
  if (!object(value) || value.version !== VERSION || !Object.hasOwn(CLASSES, value.player?.classId) || !Object.hasOwn(CAMPAIGNS, value.campaignId)) return false;
  const p = value.player, e = value.encounter;
  if (!strings(value, ['id']) || value.mode !== 'solo' || !['active', 'dead', 'won'].includes(value.status) || !Object.hasOwn(STANCES, value.stance)) return false;
  if (!integer(value.chapter, 0, 2) || !integer(value.node, 0, 6) || !integer(value.seed, 0, 4294967295) || !integer(value.rng, 1, 4294967295) || !integer(value.revision) || !integer(value.logId)) return false;
  if (!integer(p.level, 1, 4) || !strings(p, ['id', 'teamId']) || !['hp', 'maxHp', 'san', 'maxSan', 'gold', 'clues', 'weapon', 'armor', 'skillPoints'].every(k => integer(p[k]))) return false;
  if (p.maxHp < 1 || p.maxSan < 1 || p.hp > p.maxHp || p.san > p.maxSan || (value.status !== 'dead' && (!p.hp || !p.san))) return false;
  if (!object(p.stats) || !Object.keys(CLASSES[p.classId].stats).every(k => integer(p.stats[k], 1, 20))) return false;
  if (!Array.isArray(p.skills) || new Set(p.skills).size !== p.skills.length || !p.skills.every(id => SKILL_BY_ID[id]?.classId === p.classId)) return false;
  if (!Array.isArray(p.loadout) || p.loadout.length > 2 || new Set(p.loadout).size !== p.loadout.length || !p.loadout.every(id => p.skills.includes(id) && SKILL_BY_ID[id]?.type === 'active')) return false;
  if (!object(p.inventory) || !['potion', 'tonic', 'bomb'].every(id => integer(p.inventory[id]))) return false;
  if (!integer(p.combatClock) || !object(p.cooldowns) || !Object.entries(p.cooldowns).every(([id, ready]) => Object.hasOwn(SKILL_BY_ID, id) && integer(ready))) return false;
  if (!validMap(value.map, value.chapter, value.node)) return false;
  if (!object(value.chapterUses) || !Object.entries(value.chapterUses).every(([id, uses]) => p.skills.includes(id) && integer(uses, 0, 1))) return false;
  if (typeof value.pendingGrowth !== 'boolean' || typeof value.entryGrowthClaimed !== 'boolean') return false;
  if (!object(e) || !NODE_TYPES.includes(e.type) || !strings(e, ['id', 'title', 'text', 'result']) || !['safe', 'risk'].includes(e.route) || typeof e.resolved !== 'boolean' || typeof e.stolen !== 'boolean' || !object(e.purchases)) return false;
  if (e.type === 'event' && !integer(e.dc, 1)) return false;
  if (!Object.entries(e.purchases).every(([id, count]) => Object.hasOwn(ITEMS, id) && integer(count, 0, 2))) return false;
  if (!Array.isArray(value.completed) || !value.completed.every(n => object(n) && integer(n.chapter, 0, 2) && integer(n.node, 0, 6) && NODE_TYPES.includes(n.type) && typeof n.result === 'string')) return false;
  if (!object(value.metrics) || !['kills', 'checks', 'passed', 'spent', 'damage'].every(k => integer(value.metrics[k]))) return false;
  if (!object(value.enemyRecords) || !Object.entries(value.enemyRecords).every(([id, counts]) => ENEMY_BY_ID[id] && object(counts) && integer(counts.seen) && integer(counts.kills) && counts.kills <= counts.seen)) return false;
  if (!Array.isArray(value.log) || !value.log.every(l => object(l) && strings(l, ['title', 'text']) && ['story', 'reward', 'combat', 'damage', 'death', 'skill', 'check', 'item', 'round', 'action'].includes(l.kind) && integer(l.id) && integer(l.chapter, 1, 3) && integer(l.node, 1, 7) && integer(l.round))) return false;
  if (value.ending !== null && typeof value.ending !== 'string') return false;
  if (value.battle !== null) {
    const b = value.battle, enemy = b?.enemy;
    if (!object(b) || !object(enemy) || !strings(enemy, ['id', 'teamId', 'name']) || !['hp', 'maxHp', 'attack', 'armor', 'speed'].every(k => integer(enemy[k])) || enemy.maxHp < 1 || enemy.hp > enemy.maxHp) return false;
    if (typeof enemy.boss !== 'boolean' || ![1, 2].includes(enemy.phase) || !['round', 'shield', 'evade', 'sunder', 'berserk', 'chill', 'chillTurns', 'stun'].every(k => integer(b[k]))) return false;
    if (typeof b.hidden !== 'boolean' || typeof b.freezeUsed !== 'boolean' || !object(b.cooldowns) || !Object.entries(b.cooldowns).every(([id, round]) => Object.hasOwn(SKILL_BY_ID, id) && integer(round))) return false;
    if (!integer(b.dodgeBonus, 0, 35)) return false;
    if (!Array.isArray(enemy.statuses) || !enemy.statuses.every(s => object(s) && ['poison', 'burn'].includes(s.id) && integer(s.value, 1) && integer(s.remaining, 1) && typeof s.sourceId === 'string')) return false;
    if (!Object.hasOwn(ENEMY_BY_ID, enemy.definitionId) || b.maxAp !== ACTION_POINTS || !Array.isArray(b.plan) || b.plan.length > ACTION_POINTS || !b.plan.every(actionInfo)) return false;
    if (value.status === 'active' && !e.resolved && planReason(value, b.plan)) return false;
  }
  return true;
}

export function migrateSave(value) {
  if (value?.version === VERSION) return validSave(value) ? value : null;
  if (![1, 2].includes(value?.version) || !Array.isArray(value.completed) || !value.player || !value.encounter) return null;
  const next = structuredClone(value);
  next.version = VERSION; next.enemyRecords = value.version === 2 ? next.enemyRecords : {};
  for (const node of value.version === 1 ? next.completed : []) {
    if (!node || !['combat', 'elite', 'boss'].includes(node.type)) continue;
    const def = enemyDefinition(next.campaignId, node.chapter, node.type);
    if (!def) return null;
    const record = next.enemyRecords[def.id] ||= { seen: 0, kills: 0 };
    record.seen++;
    if (typeof node.result === 'string' && node.result.startsWith('获得 ')) record.kills++;
  }
  if (next.battle) {
    if (!next.battle.enemy || !next.encounter) return null;
    const def = enemyDefinition(next.campaignId, next.chapter, next.encounter.type);
    if (!def) return null;
    next.battle.enemy.definitionId = def.id;
    next.battle.maxAp = ACTION_POINTS; next.battle.plan = value.version === 2 ? structuredClone(value.battle.plan) : [];
    if (value.version === 1 && !next.encounter.resolved) {
      const record = next.enemyRecords[def.id] ||= { seen: 0, kills: 0 };
      record.seen++;
    }
  }
  next.player.combatClock = next.battle?.round || 0;
  next.player.cooldowns = { ...next.battle?.cooldowns };
  if (next.battle) next.battle.dodgeBonus = 0;
  next.map = chapterMap(next.seed, next.chapter);
  next.map.visited = [];
  for (let depth = 0; depth <= next.node; depth++) {
    const n = next.map.nodes.find(n => n.depth === depth && n.lane === 0);
    if (!n) return null;
    const previous = next.completed.find(c => c.chapter === next.chapter && c.node === depth);
    n.type = depth === next.node ? next.encounter.type : previous?.type || n.type;
    next.map.visited.push(n.id);
    if (previous) previous.mapNodeId = n.id;
  }
  next.map.currentId = next.map.visited.at(-1);
  return validSave(next) ? next : null;
}
