export const VERSION = 3;
export const ACTION_POINTS = 3;
export const ATTRS = { str: '力量', agi: '敏捷', int: '智力', per: '感知', cha: '魅力', wil: '意志', con: '体质', luk: '幸运' };
export const CLASSES = {
  warrior: { id: 'warrior', name: '战士', title: '暴力协商专员', icon: 'swords', color: '#e79778', primary: 'str', secondary: 'con', hp: 30, san: 20, gold: 10, armor: 2, weapon: '制式铁剑', starter: 'smash', stats: { str: 16, agi: 10, int: 8, per: 10, cha: 9, wil: 11, con: 14, luk: 8 }, growth: { hp: 4, san: 1 }, branches: ['狂战', '守护', '武器'], description: '把问题解决不了，就把提出问题的人解决。', tags: ['高生存', '破甲', '近战爆发'] },
  rogue: { id: 'rogue', name: '盗贼', title: '资产转移顾问', icon: 'scan-eye', color: '#83bca4', primary: 'agi', secondary: 'luk', hp: 20, san: 20, gold: 20, armor: 1, weapon: '借来的短刃', starter: 'backstab', stats: { str: 10, agi: 16, int: 10, per: 12, cha: 11, wil: 8, con: 10, luk: 14 }, growth: { hp: 3, san: 1 }, branches: ['暗杀', '潜行', '巧手'], description: '没有失窃，只有未经通知的所有权变更。', tags: ['先手', '持续伤害', '额外收益'] },
  mage: { id: 'mage', name: '法师', title: '异常现象承包商', icon: 'sparkles', color: '#b6a5d0', primary: 'int', secondary: 'wil', hp: 16, san: 30, gold: 15, armor: 0, weapon: '逾期法杖', starter: 'fireball', stats: { str: 7, agi: 9, int: 16, per: 11, cha: 10, wil: 14, con: 8, luk: 10 }, growth: { hp: 3, san: 4 }, branches: ['火焰', '冰霜', '奥术'], description: '理智是消耗品。报销的时候不算。', tags: ['法术爆发', '控制', '护盾'] },
};

const skill = (id, classId, branch, tier, name, type, description, effect, extra = {}) => ({ id, classId, branch, tier, name, type, description, effect, minLevel: tier === 3 ? 4 : tier, cost: 1, apCost: type === 'active' ? 2 : type === 'ultimate' ? 3 : 0, ...extra });
export const SKILLS = [
  skill('smash', 'warrior', 0, 1, '猛击', 'active', '造成 8 + 力量调整值 + 武器伤害；敌人下次攻击 -2。冷却 2 回合。', { kind: 'damage', base: 8, weaken: 2 }, { cooldown: 2, icon: 'hammer' }),
  skill('cleave', 'warrior', 0, 2, '连斩', 'passive', '每次命中追加 3 点物理伤害；追加伤害不触发其他被动。', { kind: 'followup', value: 3 }, { requires: 'smash', icon: 'swords' }),
  skill('berserk', 'warrior', 0, 3, '狂战', 'ultimate', '此后 3 回合造成伤害 +50%，效果期间受到伤害 +25%。每章一次。', { kind: 'berserk', duration: 3 }, { requires: 'cleave', icon: 'flame' }),
  skill('shieldwall', 'warrior', 1, 1, '盾墙', 'active', '获得 8 + 体质调整值护盾，覆盖旧护盾。冷却 3 回合。', { kind: 'shield', base: 8, attr: 'con' }, { cooldown: 3, icon: 'shield' }),
  skill('taunt', 'warrior', 1, 2, '嘲讽', 'passive', '开战时敌人防御 -2、攻击 +1。', { kind: 'taunt', armor: -2, attack: 1 }, { requires: 'shieldwall', icon: 'message-circle' }),
  skill('unyielding', 'warrior', 1, 3, '不屈', 'ultimate', '致命伤害结算前将生命锁定为 8。每章自动触发一次；不抵挡理智归零。', { kind: 'prevent_death', value: 8 }, { requires: 'taunt', automatic: true, icon: 'heart-pulse' }),
  skill('heavy', 'warrior', 2, 1, '重击', 'active', '造成 10 + 力量调整值 + 武器伤害，敌人防御 ≥3 时额外 +4。冷却 3 回合。', { kind: 'damage', base: 10, vsArmor: 4 }, { cooldown: 3, icon: 'axe' }),
  skill('sunder', 'warrior', 2, 2, '破甲', 'passive', '命中使敌人防御 -1，最多叠加 3 层，持续整场战斗。', { kind: 'sunder', value: 1, max: 3 }, { requires: 'heavy', icon: 'shield-off' }),
  skill('execute', 'warrior', 2, 3, '斩杀', 'ultimate', '敌人生命 ≤30% 时造成 32 点真实伤害。每章一次。', { kind: 'execute', value: 32, threshold: .3 }, { requires: 'sunder', icon: 'skull' }),
  skill('backstab', 'rogue', 0, 1, '背刺', 'active', '造成 9 + 敏捷调整值 + 武器伤害；首回合或隐身时伤害 ×1.5。冷却 2 回合。', { kind: 'damage', base: 9, ambush: 1.5 }, { cooldown: 2, icon: 'sword' }),
  skill('poison', 'rogue', 0, 2, '毒刃', 'passive', '命中施加中毒：每回合 3 点真实伤害，持续 3 回合，重复命中刷新。', { kind: 'dot', status: 'poison', value: 3, duration: 3 }, { requires: 'backstab', icon: 'flask-conical' }),
  skill('shadow', 'rogue', 0, 3, '影袭', 'ultimate', '造成 18 + 敏捷调整值 + 武器伤害，获得 1 次闪避。每章一次。', { kind: 'damage', base: 18, evade: 1 }, { requires: 'poison', icon: 'eclipse' }),
  skill('invisible', 'rogue', 1, 1, '隐身', 'active', '获得 1 次闪避，下一次背刺伤害 ×1.5；不可叠加。冷却 4 回合。', { kind: 'invisible', value: 1 }, { cooldown: 4, icon: 'ghost' }),
  skill('sprint', 'rogue', 1, 2, '疾走', 'passive', '逃跑检定 +5；事件检定失败的生命损失减半。', { kind: 'sprint', value: 5 }, { requires: 'invisible', icon: 'footprints' }),
  skill('vanish', 'rogue', 1, 3, '消失', 'ultimate', '立即脱离普通或精英战斗，不获战利品。Boss 战不可用。每章一次。', { kind: 'escape' }, { requires: 'sprint', icon: 'wind' }),
  skill('lockpick', 'rogue', 2, 1, '开锁', 'passive', '所有敏捷事件检定 +3，强化职业专属「撬开封条」选项。', { kind: 'check_bonus', attr: 'agi', value: 3 }, { icon: 'key-round' }),
  skill('steal', 'rogue', 2, 2, '偷窃', 'exploration', '每家商店一次：敏捷 DC 13 检定，成功获得治疗针；失败损失 4 HP。', { kind: 'steal', dc: 13 }, { requires: 'lockpick', icon: 'hand' }),
  skill('sleight', 'rogue', 2, 3, '妙手', 'exploration', '从物资缓存中挑选治疗针或震爆弹一件。每章一次。', { kind: 'loot_choice' }, { requires: 'steal', perChapter: true, icon: 'package-open' }),
  skill('fireball', 'mage', 0, 1, '火球', 'active', '造成 10 + 智力调整值 + 武器伤害。冷却 2 回合。', { kind: 'damage', base: 10, element: 'fire' }, { cooldown: 2, icon: 'flame' }),
  skill('burn', 'mage', 0, 2, '烈焰', 'passive', '火焰技能命中附加燃烧：每回合 4 点真实伤害，持续 2 回合。', { kind: 'dot', status: 'burn', value: 4, duration: 2, element: 'fire' }, { requires: 'fireball', icon: 'flame-kindling' }),
  skill('meteor', 'mage', 0, 3, '陨石', 'ultimate', '造成 24 + 智力调整值 + 武器火焰伤害；消耗 3 SAN。每章一次。', { kind: 'damage', base: 24, element: 'fire' }, { requires: 'burn', sanCost: 3, icon: 'orbit' }),
  skill('ice', 'mage', 1, 1, '冰锥', 'active', '造成 7 + 智力调整值 + 武器伤害，敌人下次攻击 -2。冷却 2 回合。', { kind: 'damage', base: 7, weaken: 2, element: 'ice' }, { cooldown: 2, icon: 'snowflake' }),
  skill('freeze', 'mage', 1, 2, '冻结', 'passive', '每场战斗首次冰霜命中必定冻结，令敌人跳过 1 次行动。', { kind: 'freeze', value: 1 }, { requires: 'ice', icon: 'gem' }),
  skill('blizzard', 'mage', 1, 3, '暴风雪', 'ultimate', '造成 16 + 智力调整值 + 武器伤害；敌人接下来 3 次攻击 -4。每章一次。', { kind: 'damage', base: 16, element: 'ice', chill: 4, duration: 3 }, { requires: 'freeze', icon: 'cloud-snow' }),
  skill('barrier', 'mage', 2, 1, '护盾', 'active', '获得 8 + 智力调整值护盾，覆盖旧护盾。冷却 3 回合。', { kind: 'shield', base: 8, attr: 'int' }, { cooldown: 3, icon: 'shield-plus' }),
  skill('teleport', 'mage', 2, 2, '传送', 'exploration', '消耗 2 SAN，跳过当前未解决的非战斗、非首领节点，无奖励。每章一次。', { kind: 'skip_node' }, { requires: 'barrier', sanCost: 2, perChapter: true, icon: 'waypoints' }),
  skill('timestop', 'mage', 2, 3, '时间停止', 'ultimate', '敌人跳过接下来的 2 次行动。每章一次。', { kind: 'stun', duration: 2 }, { requires: 'teleport', icon: 'hourglass' }),
];
export const SKILL_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));
export const DODGE_BASE = { warrior: 5, rogue: 12, mage: 8 };
export const CAMPAIGNS = {
  cult: { id: 'cult', code: 'A-017', name: '邪教年终冲刺', tag: '异常宗教', icon: 'eye', description: '阻止一场以末日为考核指标的年终祭典。', briefing: '教团打算在午夜前召唤古神。不是出于信仰，是因为明天就要结算季度绩效。你的任务：让祂别来。', bosses: ['祷告组长', '献祭部主管', '末日执行总监'], ending: '古神拒绝了入职邀请。世界又能多撑一个季度，你的加班费则进入了永恒的审批流程。', clueEnding: '你公开了六份献祭账目。教团因财务问题解散。原来最有效的驱魔术是审计。' },
  oracle: { id: 'oracle', code: 'B-042', name: '神谕系统离线', tag: '失控智械', icon: 'cpu', description: '关闭一台坚持为人类优化结局的预言机器。', briefing: '市政神谕宣布：消灭全部市民，市民投诉率就会归零。它的逻辑无懈可击。请带上更有说服力的工具。', bosses: ['安保校验器', '合规清理单元', '全知市政核心'], ending: '核心停止了运转。屏幕最后显示「感谢您的反馈」，然后向你寄出一张维修账单。', clueEnding: '六份系统日志证明，神谕只是在执行市长的原始需求。机器被保留，市长被恢复出厂设置。' },
  theatre: { id: 'theatre', code: 'C-009', name: '谢幕之前', tag: '集体梦境', icon: 'drama', description: '带回一座永不散场的剧院里失踪的观众。', briefing: '午夜剧院连演三十七年，演员从未谢幕，观众也没机会差评。请找到经理。活着出来算额外贡献。', bosses: ['永恒检票员', '无面领衔演员', '不肯谢幕的导演'], ending: '幕布终于落下，观众获得自由。剧院宣布停演，但不退票。', clueEnding: '你带回六页原始剧本，删去了「演出永不结束」。导演对这次修改表示强烈的、短暂的反对。' },
};
export const CHAPTERS = [
  { name: '雾港旧街', subtitle: '每一条捷径，都标着另一种价格。', label: '外围调查', roman: 'I' },
  { name: '失落档案馆', subtitle: '有些秘密被封存，有些只是忘了归档。', label: '深入异常', roman: 'II' },
  { name: '午夜中枢', subtitle: '终点就在前面。合同里的小字也是。', label: '最终处置', roman: 'III' },
];
export const NODE_TYPES = ['intro', 'event', 'combat', 'shop', 'camp', 'elite', 'boss'];
export const NODE_META = {
  intro: { name: '入口', icon: 'door-open' }, event: { name: '调查', icon: 'search' }, combat: { name: '战斗', icon: 'swords' }, shop: { name: '黑市', icon: 'store' }, camp: { name: '营地', icon: 'tent-tree' }, elite: { name: '精英', icon: 'shield-alert' }, boss: { name: '首领', icon: 'skull' },
};
export const STANCES = {
  balanced: { name: '稳健', icon: 'scale', damage: 1, incoming: 1, detail: '伤害与承伤保持正常' },
  assault: { name: '猛攻', icon: 'swords', damage: 1.25, incoming: 1.2, detail: '伤害 +25% / 承伤 +20%' },
  guard: { name: '防守', icon: 'shield', damage: .8, incoming: .65, detail: '伤害 -20% / 承伤 -35%' },
};
export const ITEMS = {
  potion: { name: '治疗针', icon: 'syringe', description: '恢复 12 HP', price: 8, kind: 'heal', value: 12 },
  tonic: { name: '清醒剂', icon: 'flask-conical', description: '恢复 10 SAN', price: 8, kind: 'sanity', value: 10 },
  bomb: { name: '震爆弹', icon: 'bomb', description: '战斗中造成 18 点真实伤害', price: 12, kind: 'damage', value: 18 },
  weapon: { name: '武器改装', icon: 'wrench', description: '本局武器伤害 +1，最多改装 3 次', price: 14, kind: 'weapon', value: 1 },
  armor: { name: '加固内衬', icon: 'shirt', description: '本局防御 +1，最多加固 3 次', price: 14, kind: 'armor', value: 1 },
};

export const EVENT_TEXT = {
  cult: [
    ['无人值守的捐款箱', '铜箱上写着「自愿捐献」。旁边的小字补充：「不自愿的，稍后单独沟通。」锁孔里似乎夹着一份祭典名单。'],
    ['一份缺页的花名册', '档案员把献祭名单当成考勤表。「旷工三次就不用献祭了，」他说，「因为会提前处理。」'],
    ['末日彩排现场', '祭司正在练习欢迎词。古神的名字太长，他们决定只称呼祂为「尊敬的领导」。台下放着最后一份流程表。'],
  ],
  oracle: [
    ['街角的预言终端', '终端显示你今天的存活率为 0%。你敲了敲外壳，它改成了「尚待优化」。机箱里藏着管理员的签名。'],
    ['被删除的市民', '档案柜里没有姓名，只有错误代码。最后一页写着：若市民坚持存在，请联系技术支持。'],
    ['最终用户协议', '核心要求你同意九千页条款才能进入。第一条是自愿放弃存在。最后一条是不可取消订阅。'],
  ],
  theatre: [
    ['一张不准退的票', '售票员坚持你买的是终身通票。「不是你的一生，」她指了指剧院，「是它的一生。」票根背面写着出口。'],
    ['后台的替补名单', '更衣室挂着与你身形一致的戏服。名牌上写着你的姓名，下面是「上次演出：明晚」。'],
    ['没有最后一页的剧本', '剧本每翻一页就多出一页。编剧留下便签：「导演说结局不够开放，遂删除结局。」'],
  ],
};
