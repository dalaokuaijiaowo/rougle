import { CAMPAIGNS } from './data.js';

const regularNames = ['失控巡逻员', '档案搬运机', '沉默的执行员'];
const eliteNames = ['绩效督察', '机密保管员', '午夜清算者'];
const portraits = { cult: 'cultist', oracle: 'machine', theatre: 'actor' };
function definition(id, name, chapter, type, campaignId = null) {
  const boss = type === 'boss', elite = type === 'elite';
  return {
    id, name, chapter, type, campaignId,
    hp: (boss ? [40, 61, 86] : elite ? [25, 36, 47] : [18, 27, 35])[chapter],
    attack: (boss ? [7, 9, 11] : elite ? [6, 8, 10] : [5, 7, 8])[chapter],
    armor: (boss ? [2, 3, 4] : [1, 2, 3])[chapter], speed: 8 + chapter * 2,
    portrait: boss ? portraits[campaignId] : elite ? 'inspector' : chapter === 1 ? 'machine' : 'guard',
    gold: (boss ? 16 : elite ? 10 : 6) + chapter * 3,
    description: boss ? {
      cult: ['传达神意之前，先传达部门指标。', '坚持每次献祭都要签字，主要是为了免责。', '末日可以迟到，年报不能。'],
      oracle: ['检查你是否具备被消灭的合法资格。', '它能清除一切异常，包括提出异议的人。', '它想让每个人都幸福。现在，它正在减少「每个人」的数量。'],
      theatre: ['你的票没有问题，有问题的是离场这个想法。', '扮演过所有人，唯独忘了自己。', '谢幕意味着失业，所以他决定永不谢幕。'],
    }[campaignId][chapter] : elite ? [
      '巡逻员的上司。擅长把事故改称为个人成长。', '看守那些连档案员都不许阅读的档案。', '在午夜核对人头。通常一手拿表，另一手拿结果。',
    ][chapter] : [
      '从未请过假，也从未批准过别人的通行证。', '原本只负责搬运档案，后来发现人也能按字母排序。', '它已经停止说话。管理层认为这让沟通更高效。',
    ][chapter],
    tactic: boss ? '半血后攻击提高 15%。第三回合起每三回合重击一次，伤害 ×1.5；护盾、冻结与终极技能适合应对危险回合。' : elite ? '防御高于普通目标。破甲与真实伤害更有效；每三回合的重击可以用护盾或隐身抵挡。' : '每三回合重击一次，伤害 ×1.5。可以先安排技能，再用普攻补足本回合行动。',
  };
}
export const ENEMIES = [
  ...regularNames.map((name, c) => definition(`regular-${c}`, name, c, 'combat')),
  ...eliteNames.map((name, c) => definition(`elite-${c}`, name, c, 'elite')),
  ...Object.values(CAMPAIGNS).flatMap(c => c.bosses.map((name, chapter) => definition(`${c.id}-boss-${chapter}`, name, chapter, 'boss', c.id))),
];
export const ENEMY_BY_ID = Object.fromEntries(ENEMIES.map(e => [e.id, e]));
export function enemyDefinition(campaignId, chapter, type) {
  return ENEMY_BY_ID[type === 'boss' ? `${campaignId}-boss-${chapter}` : `${type === 'elite' ? 'elite' : 'regular'}-${chapter}`];
}
export const emptyCodex = () => ({ entries: {}, runId: null, snapshot: {} });
export function loadCodex(value) {
  if (!value || typeof value !== 'object' || !value.entries || !value.snapshot) return emptyCodex();
  const validCounts = counts => Object.entries(counts).every(([id, entry]) => ENEMY_BY_ID[id] && entry && ['seen', 'kills'].every(k => Number.isSafeInteger(entry[k]) && entry[k] >= 0));
  return validCounts(value.entries) && validCounts(value.snapshot) ? value : emptyCodex();
}
// A per-run snapshot makes repeated renders and reloads idempotent.
export function syncCodex(codex, run) {
  if (!run) return codex;
  const next = structuredClone(codex);
  if (next.runId !== run.id) { next.runId = run.id; next.snapshot = {}; }
  for (const [id, counts] of Object.entries(run.enemyRecords)) {
    const old = next.snapshot[id] || { seen: 0, kills: 0 };
    const total = next.entries[id] || { seen: 0, kills: 0 };
    next.entries[id] = { seen: total.seen + Math.max(0, counts.seen - old.seen), kills: total.kills + Math.max(0, counts.kills - old.kills) };
  }
  next.snapshot = structuredClone(run.enemyRecords);
  return next;
}
