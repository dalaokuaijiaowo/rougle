import { CLASSES, SKILLS, SKILL_BY_ID, CAMPAIGNS, CHAPTERS, ATTRS, NODE_META, NODE_TYPES, STANCES, ITEMS } from './data.js';
import { newRun, dispatch, migrateSave, currentArmor as baseArmor, attackPower as baseAttack, modifier, checkBonus, eventOptions, learnReason, planReason, actionInfo, remainingAp, dodgeChance, cooldownRemaining } from './engine.js';
import { availableNodes } from './map.js';
import { RoomClient } from './network.js';
import { ENEMIES, ENEMY_BY_ID, emptyCodex, loadCodex, syncCodex } from './enemies.js';
import { SoundEffects } from './audio.js';

const SAVE_KEY = 'ashfall.run.v1';
const ARCHIVE_KEY = 'ashfall.archive.v1';
const CODEX_KEY = 'ashfall.bestiary.v1';
const PREFS_KEY = 'ashfall.preferences.v1';
const app = document.querySelector('#app');
const overlay = document.querySelector('#overlay');
let run = null, selectedClass = 'warrior', selectedCampaign = 'cult', view = 'field', busy = false, toastTimer, archive = [], storageProblem = false;
let codex = emptyCodex(), codexFilter = 'all', codexSearch = '';
let prefs = { leftCollapsed: false, rightCollapsed: false, soundEnabled: true, volume: .45 };
let room = null, connectionError = '', selectedMode = 'solo';
const inviteId = new URLSearchParams(location.search).get('room');
let entryName = '', joinCode = inviteId || '';
if (inviteId) selectedMode = 'duo';
try {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  const migrated = migrateSave(saved);
  if (migrated) { run = migrated; selectedClass = run.player.classId; selectedCampaign = run.campaignId; }
  else if (saved) storageProblem = true;
  const storedArchive = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
  if (Array.isArray(storedArchive)) archive = storedArchive.filter(v => v && typeof v.id === 'string' && CLASSES[v.classId] && CAMPAIGNS[v.campaignId]).slice(0, 20);
} catch { storageProblem = true; }
try { codex = loadCodex(JSON.parse(localStorage.getItem(CODEX_KEY) || 'null')); } catch { /* A damaged codex does not invalidate the current run. */ }
try {
  const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
  if (saved) {
    for (const key of ['leftCollapsed', 'rightCollapsed', 'soundEnabled']) if (typeof saved[key] === 'boolean') prefs[key] = saved[key];
    if (Number.isFinite(saved.volume)) prefs.volume = Math.max(0, Math.min(1, saved.volume));
  } else if (run || window.innerWidth <= 800) prefs.leftCollapsed = prefs.rightCollapsed = true;
} catch { /* Use default display and sound preferences. */ }
const sound = new SoundEffects({ enabled: prefs.soundEnabled, volume: prefs.volume });
const network = new RoomClient(snapshot => {
  const previousPhase = room?.phase, lastLog = run?.logId || 0;
  room = snapshot; run = snapshot.run; selectedMode = 'duo';
  selectedCampaign = snapshot.campaignId; selectedClass = snapshot.participants[snapshot.you].classId;
  if (room.phase === 'ended' && run) record(run.status === 'active' ? 'abandoned' : run.status);
  if (previousPhase !== room.phase) { view = 'field'; prefs.leftCollapsed = prefs.rightCollapsed = true; }
  if (run && previousPhase === room.phase) sound.playLog(run.log.filter(l => l.id > lastLog));
  store(); render();
}, message => { if (connectionError !== message) { connectionError = message; render(); } });

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name, cls = '') => `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
const portrait = (id, cls = '') => `<svg class="portrait ${cls}" role="img" aria-label="${CLASSES[id].name}肖像"><use href="./assets/portraits.svg#${id}"></use></svg>`;
const button = (text, action, cls = '', attrs = '') => `<button class="btn ${cls}" data-action="${action}" ${attrs}>${text}</button>`;
const percent = (a, b) => Math.max(0, Math.min(100, a / b * 100));
const clsNow = () => CLASSES[run?.player.classId || selectedClass];
const currentArmor = state => Math.max(0, baseArmor(state) - (state.battle?.selfSunder || 0));
const attackPower = state => baseAttack(state) + (state.battle?.selfAttackBonus || 0);
const pad = n => String(n).padStart(2, '0');
function icons() { window.lucide?.createIcons({ attrs: { 'stroke-width': 1.6 } }); }
function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message; toast.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}
function store() {
  try {
    codex = syncCodex(codex, run);
    if (!room) { if (run) localStorage.setItem(SAVE_KEY, JSON.stringify(run)); else localStorage.removeItem(SAVE_KEY); }
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
    localStorage.setItem(CODEX_KEY, JSON.stringify(codex));
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { notify('浏览器存储不可用，本次进度仅保留在当前页面。'); }
}
function record(status = run.status) {
  const summary = { id: run.id, classId: run.player.classId, campaignId: run.campaignId, status, level: run.player.level, chapters: run.chapter + 1, nodes: run.completed.length, kills: run.metrics.kills, clues: run.player.clues, date: new Date().toLocaleDateString('zh-CN') };
  archive = [summary, ...archive.filter(a => a.id !== summary.id)].slice(0, 20);
}
async function command(cmd) {
  try {
    if (room) { busy = true; await network.send(cmd); busy = false; render(); return true; }
    const lastLogId = run.logId;
    run = dispatch(run, cmd);
    sound.playLog(run.log.filter(entry => entry.id > lastLogId));
    if (cmd.type === 'queueAction') sound.play('queue');
    if (run.status !== 'active') record();
    store(); render();
    return true;
  } catch (error) { busy = false; render(); sound.play('fail'); notify(error.message); return false; }
}

function sidebar() {
  return `<aside class="sidebar" id="left-sidebar">
    <a class="brand" href="#" data-action="view" data-id="field"><img src="./assets/mark.svg" alt="" width="38" height="38"><span>灰烬事务所<small>ASHFALL BUREAU</small></span></a>
    ${button(icon('panel-left-close'), 'toggleLeft', 'icon-button sidebar-close', 'title="收起左侧导航" aria-label="收起左侧导航"')}
    <div class="branch-label">雾港分署 <span>EST. 1897</span></div>
    <nav aria-label="主导航">
      ${[['field', 'compass', '委托现场'], ['map', 'map', '区域地图'], ['skills', 'git-branch', '职业技能'], ['bestiary', 'book-open', '敌人图鉴'], ['room', 'users', '双人委托'], ['archive', 'folder-closed', '行动档案']].map(([id, i, name]) => `<button class="nav-item ${view === id ? 'active' : ''}" data-action="view" data-id="${id}" title="${name}" aria-label="${name}" ${view === id ? 'aria-current="page"' : ''}>${icon(i)}<span>${name}</span>${id === 'skills' && run?.player.skillPoints ? `<b class="nav-count">${run.player.skillPoints}</b>` : ''}${id === 'field' ? icon('chevron-right', 'nav-arrow') : ''}</button>`).join('')}
    </nav>
    <div class="sidebar-assignment"><div class="micro">${run ? '当前委托' : '待办委托'}</div><span class="assignment-code">${CAMPAIGNS[run?.campaignId || selectedCampaign].code}</span><p>${CAMPAIGNS[run?.campaignId || selectedCampaign].name}</p><div class="tiny muted">${run ? `第 ${chapterNumber()} 章 · ${run.completed.length} / 21 区域` : '外勤席位空缺 01'}</div></div>
    <div class="sidebar-bottom"><blockquote>“愿你的名字，<br>晚一点出现在档案室。”<span>—— 不具名的前任员工</span></blockquote>
    <div class="system-status"><span class="status-dot"></span> ${room ? '双人档案已同步' : run ? '档案已自动保存' : '分署正常运转中'} <span class="mono">v0.3</span></div></div>
  </aside>`;
}
function chapterNumber() { return (run?.chapter || 0) + 1; }
function topbar() {
  const label = view === 'map' ? '区域地图' : view === 'room' ? '双人委托' : view === 'skills' ? '职业发展' : view === 'bestiary' ? '敌人图鉴' : view === 'archive' ? '历史记录' : run ? '进行中的委托' : '外勤人员登记';
  return `<header class="topbar"><div class="toolbar-left">${button(icon(prefs.leftCollapsed ? 'panel-left-open' : 'panel-left-close'), 'toggleLeft', 'icon-button', `title="${prefs.leftCollapsed ? '展开' : '收起'}左侧导航" aria-label="${prefs.leftCollapsed ? '展开' : '收起'}左侧导航" aria-expanded="${!prefs.leftCollapsed}" aria-controls="left-sidebar"`)}<div class="breadcrumb"><span>事务所</span>${icon('chevron-right')}<strong>${label}</strong></div></div><div class="top-actions"><span class="top-status"><span class="status-dot ${run?.status === 'dead' ? 'red' : ''}"></span>${run ? { active: '外勤中', won: '已完成', dead: '已归档' }[run.status] : '待命中'}</span>${button(icon(prefs.soundEnabled ? 'volume-2' : 'volume-x'), 'soundSettings', 'icon-button', 'title="音效与音量" aria-label="音效与音量"')}${button(icon('file-down'), 'export', 'icon-button', 'title="导出当前档案" aria-label="导出当前档案" ' + (!run ? 'disabled' : ''))}${button(icon('rotate-ccw'), 'new', 'icon-button', 'title="开始新委托" aria-label="开始新委托"')}${button(icon(prefs.rightCollapsed ? 'panel-right-open' : 'panel-right-close'), 'toggleRight', 'icon-button', `title="${prefs.rightCollapsed ? '展开' : '收起'}右侧档案" aria-label="${prefs.rightCollapsed ? '展开' : '收起'}右侧档案" aria-expanded="${!prefs.rightCollapsed}"`)}</div></header>`;
}
function scene() {
  const chapter = CHAPTERS[run?.chapter || 0];
  return `<div class="scene chapter-${run?.chapter || 0}"><img src="./assets/old-quarter.svg" alt="雨夜中的雾港旧街，街道尽头的事务所仍然亮着灯" fetchpriority="high"><div class="scene-top"><span>${icon('map-pin')} ${chapter.name}</span><span class="mono">${['23:47', '00:13', '00:59'][run?.chapter || 0]}</span></div><div class="scene-caption"><span class="micro">${run ? `CHAPTER ${pad(chapterNumber())} / ${chapter.label}` : 'THE NIGHT SHIFT'}</span><h1>${run ? chapter.name : '灰烬事务所'}</h1><p>${run ? chapter.subtitle : '又一个普通的夜晚。愿你平安下班。'}</p></div><div class="scene-stamp">雾港<br>外勤许可</div></div>`;
}
function registration() {
  return `${scene()}<div class="mode-line segmented" aria-label="游玩模式">${[['solo', 'user', '单人委托'], ['duo', 'users', '双人竞逐']].map(([id, i, text]) => `<button data-action="selectMode" data-id="${id}" aria-pressed="${selectedMode === id}" class="${selectedMode === id ? 'active' : ''}">${icon(i)} ${text}</button>`).join('')}</div>${selectedMode === 'duo' ? `<div class="room-entry"><label>外勤代号<input id="player-name" maxlength="20" placeholder="外勤员" autocomplete="nickname"></label><label>邀请房间<input id="join-code" maxlength="80" value="${escape(inviteId || '')}" placeholder="创建新房间，或输入邀请编号"></label></div>` : ''}<section class="registration-section"><div class="section-heading"><h2><span class="section-number">01</span> 选择你的职业</h2><span class="tiny muted">职位不同，风险平等。</span></div>
  <div class="class-grid">${Object.values(CLASSES).map(cls => `<button class="class-card ${selectedClass === cls.id ? 'selected' : ''}" style="--class-color:${cls.color}" data-action="selectClass" data-id="${cls.id}" aria-pressed="${selectedClass === cls.id}"><span class="card-check">${icon(selectedClass === cls.id ? 'circle-check' : 'circle')}</span><div class="portrait-backdrop">${portrait(cls.id)}</div><div class="class-text"><h3>${cls.name}<span>${cls.title}</span></h3><p>${cls.tags.join(' · ')}</p><div class="class-numbers"><span>${icon('heart')} ${cls.hp}</span><span>${icon('brain')} ${cls.san}</span><span>${icon('coins')} ${cls.gold}</span></div></div></button>`).join('')}</div></section>
  <section class="registration-section contracts"><div class="section-heading"><h2><span class="section-number">02</span> 领取委托</h2><span class="tiny muted">合同一式一份，概不留底。</span></div><div class="campaign-list">${Object.values(CAMPAIGNS).map(c => `<button class="campaign-option ${selectedCampaign === c.id ? 'selected' : ''}" data-action="selectCampaign" data-id="${c.id}" aria-pressed="${selectedCampaign === c.id}"><span class="campaign-icon">${icon(c.icon)}</span><span class="campaign-copy"><strong>${c.name}</strong><span>${c.description}</span></span><span class="campaign-code mono">${c.code}</span>${icon(selectedCampaign === c.id ? 'circle-check' : 'circle', 'campaign-check')}</button>`).join('')}</div></section>
  <div class="sign-contract"><p>${icon('fingerprint')} 签署即生效。<span>${selectedMode === 'duo' ? 'PVE 永久死亡 · 每章 Boss 后积分切磋' : '死亡将永久结束本次委托。'}</span></p>${button((selectedMode === 'duo' ? '建立 / 加入双人委托 ' : '签约，出发 ') + icon('arrow-right'), selectedMode === 'duo' ? 'enterRoom' : 'start', 'primary', busy ? 'disabled' : '')}</div>`;
}
function routeMap() {
  if (!run) return registration();
  const nodes = run.map.nodes, available = new Set((room && (room.phase !== 'pve' || room.participants[room.you].checkpoint) ? [] : availableNodes(run)).map(n => n.id));
  const other = room?.participants[1 - room.you];
  return `<div class="page-heading"><span class="micro">CHAPTER ${pad(chapterNumber())}</span><h1>${CHAPTERS[run.chapter].name}</h1><p>有些路通往真相，有些通往下一张账单。</p></div>${room ? roomBar() : ''}<section class="web-map" aria-label="网状区域地图"><svg class="map-edges" viewBox="0 0 100 700" preserveAspectRatio="none" aria-hidden="true">${nodes.flatMap(n => n.next.map(id => {
    const to = nodes.find(v => v.id === id), used = run.map.visited.includes(n.id) && run.map.visited.includes(id);
    return `<line x1="${n.x}" y1="${45 + n.depth * 100}" x2="${to.x}" y2="${45 + to.depth * 100}" class="${used ? 'travelled' : available.has(id) && n.id === run.map.currentId ? 'reachable' : ''}"/>`;
  })).join('')}</svg>${nodes.map(n => {
    const current = n.id === run.map.currentId, visited = run.map.visited.includes(n.id), opponent = other?.chapter === run.chapter && other.mapNodeId === n.id;
    return `<button class="map-stop ${current ? 'current' : ''} ${visited ? 'visited' : ''} ${available.has(n.id) ? 'available' : ''}" style="left:${n.x}%;top:${45 + n.depth * 100}px" data-action="advance" data-node-id="${n.id}" ${available.has(n.id) ? '' : 'disabled'} aria-label="第 ${n.depth + 1} 层 ${NODE_META[n.type].name}${current ? ' 当前区域' : available.has(n.id) ? ' 可前往' : ''}">${icon(visited && !current ? 'check' : NODE_META[n.type].icon)}<strong>${NODE_META[n.type].name}</strong><small>${current ? '我方位置' : available.has(n.id) ? '可前往' : `第 ${n.depth + 1} 层`}</small>${opponent ? '<b class="opponent-marker">对方</b>' : ''}</button>`;
  }).join('')}</section><div class="map-footer">${button(icon('compass') + '返回当前区域', 'view', 'subtle', 'data-id="field"')}<span>${room ? '首领之后 · PVP 切磋' : '首领之后 · 章节结算'}</span></div>`;
}
function checkPill(option) {
  const bonus = checkBonus(run, option.attr);
  return `<span class="check-pill">${ATTRS[option.attr]} ${bonus >= 0 ? '+' : ''}${bonus}<span>DC ${option.dc}</span></span>`;
}
function encounterActions() {
  if (run.pendingGrowth) return growth();
  if (run.encounter.resolved) return continuation();
  if (run.battle) return combat();
  if (['intro', 'event'].includes(run.encounter.type)) return `<div class="event-options">${eventOptions(run).map((o, i) => `<button class="event-option" data-action="choose" data-id="${o.id}" ${o.disabled ? 'disabled' : ''}><span class="option-number mono">${pad(i + 1)}</span><span class="option-text"><strong>${o.label}</strong><small>${o.detail}</small></span>${o.attr ? checkPill(o) : icon(o.icon)}</button>`).join('')}</div>`;
  if (run.encounter.type === 'camp') return `<div class="camp-options">${button(icon('heart-pulse') + '<span>处理伤口<small>恢复全部 HP · SAN +4</small></span>' + icon('arrow-right'), 'rest', 'option-tile', 'data-choice="heal"')}${button(icon('coffee') + '<span>喝杯热的<small>恢复全部 SAN · HP +8</small></span>' + icon('arrow-right'), 'rest', 'option-tile', 'data-choice="sanity"')}</div>`;
  if (run.encounter.type === 'shop') return shop();
  return '';
}
function continuation() {
  const result = `<div class="result-strip">${icon('circle-check')}<p>${escape(run.encounter.result)}</p></div>`;
  if (run.node === 6) return result + `<div class="continue-bar">${button('进入下一章' + icon('arrow-right'), 'advance', 'primary')}</div>`;
  const destinations = availableNodes(run).map(n => button(icon(NODE_META[n.type].icon) + `<span>${NODE_META[n.type].name}<small>第 ${n.depth + 1} 层 · 路线 ${n.lane + 1}</small></span>` + icon('arrow-up-right'), 'advance', 'option-tile', `data-node-id="${n.id}" data-route="${n.lane === 0 ? 'safe' : 'risk'}"`)).join('');
  return result + `<div class="next-label micro">连通区域</div><div class="next-routes">${destinations}</div>${button(icon('map') + '查看完整地图', 'view', 'subtle map-link', 'data-id="map"')}`;
}
function growth() {
  return `<div class="growth-banner">${icon('badge-check')}<div><h3>晋升通知 · Lv.${run.player.level + 1}</h3><p>技能点 +2，主副属性 +1，HP 上限 +${clsNow().growth.hp}，SAN 上限 +${clsNow().growth.san}。</p></div></div><div class="growth-options">${[['power', 'swords', '磨炼技艺', `${ATTRS[clsNow().primary]}额外 +2（上限 20）`], ['health', 'heart', '强化体魄', 'HP 上限额外 +6'], ['sanity', 'brain', '稳定心智', 'SAN 上限额外 +6']].map(([id, i, title, detail]) => button(icon(i) + `<strong>${title}</strong><small>${detail}</small>`, 'grow', 'growth-option', `data-choice="${id}"`)).join('')}</div>`;
}
function combat() {
  const b = run.battle, e = b.enemy;
  const left = remainingAp(run);
  return `<div class="combat-surface ${room?.phase === 'duel' && room.participants[room.you].submitted ? 'plan-locked' : ''}">
  <div class="enemy-intent ${b.round % 3 === 2 ? 'danger' : ''}">${icon(room?.phase === 'duel' ? 'users' : b.stun ? 'snowflake' : b.round % 3 === 2 ? 'triangle-alert' : 'sword')}<span>${room?.phase === 'duel' ? `双方按队列交替行动 · 本回合${room.duel.first === room.you ? '我方' : '对方'}先手 · ${room.participants[1 - room.you].submitted ? '对方已锁定' : '对方正在编排'} · 截止 ${new Date(room.duel.deadline).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : `敌方回应：${b.stun ? `无法行动（剩余 ${b.stun} 次）` : b.round % 3 === 2 ? '重击 · 伤害 ×1.5' : '普通攻击'}${e.phase === 2 ? ' · 狂暴 +15%' : ''}`}</span></div>
  ${(b.shield || b.evade || b.stun || e.statuses.length) ? `<div class="battle-statuses">${b.shield ? `<span>${icon('shield')} 护盾 ${b.shield}</span>` : ''}${b.evade ? `<span>${icon('ghost')} 闪避 ${b.evade}</span>` : ''}${b.stun ? `<span>${icon('snowflake')} 敌方受控 ${b.stun}</span>` : ''}${e.statuses.map(s => `<span>${icon(s.id === 'poison' ? 'flask-conical' : 'flame')} ${s.id === 'poison' ? '中毒' : '燃烧'} ${s.remaining} 回合</span>`).join('')}</div>` : ''}
  <div class="tactics-line"><span class="micro">战术部署</span><div class="segmented" aria-label="战斗策略">${Object.entries(STANCES).map(([id, s]) => `<button data-action="stance" data-id="${id}" class="${run.stance === id ? 'active' : ''}" aria-pressed="${run.stance === id}" title="${s.detail}">${icon(s.icon)} ${s.name}</button>`).join('')}</div><span class="tactic-detail tiny muted">${STANCES[run.stance].detail}</span></div>
  <div class="round-heading"><h3>第 ${b.round + 1} 回合 <span>我方行动</span></h3><div class="ap-counter" aria-label="剩余 ${left} 点行动点"><span>行动点</span><div class="ap-pips">${Array.from({ length: b.maxAp }, (_, i) => `<span class="${i < left ? 'available' : ''}"></span>`).join('')}</div><strong>${left}<small> / ${b.maxAp}</small></strong></div></div>
  <div class="action-palette">${actionButton({ kind: 'attack' })}${actionButton({ kind: 'dodge' })}${run.player.loadout.map(id => actionButton({ kind: 'skill', id })).join('')}${run.player.skills.filter(id => SKILL_BY_ID[id].type === 'ultimate' && !SKILL_BY_ID[id].automatic && !(room?.phase === 'duel' && id === 'vanish')).map(id => actionButton({ kind: 'skill', id })).join('')}${room?.phase === 'duel' ? '' : actionButton({ kind: 'escape' })}</div>
  ${room?.phase === 'duel' ? '' : `<div class="battle-items">${['potion', 'tonic', 'bomb'].map(id => actionButton({ kind: 'item', id })).join('')}</div>`}
  <div class="plan-heading"><span>行动顺序 <small>${b.plan.length} 项</small></span>${button(icon('trash-2'), 'clearPlan', 'icon-button', `title="清空行动队列" aria-label="清空行动队列" ${!b.plan.length ? 'disabled' : ''}`)}</div>
  <ol class="action-queue" aria-label="本回合行动顺序">${b.plan.length ? b.plan.map((action, i) => {
    const info = actionInfo(action);
    return `<li><span class="queue-number mono">${i + 1}</span>${icon(info.icon)}<strong>${info.name}</strong><span class="queue-cost">${info.ap} AP</span><div class="queue-tools">${button(icon('arrow-up'), 'moveAction', 'icon-button', `data-index="${i}" data-direction="-1" aria-label="上移第 ${i + 1} 项行动" title="上移" ${i === 0 ? 'disabled' : ''}`)}${button(icon('arrow-down'), 'moveAction', 'icon-button', `data-index="${i}" data-direction="1" aria-label="下移第 ${i + 1} 项行动" title="下移" ${i === b.plan.length - 1 ? 'disabled' : ''}`)}${button(icon('x'), 'removeAction', 'icon-button', `data-index="${i}" aria-label="移除第 ${i + 1} 项行动" title="移除"`)}</div></li>`;
  }).join('') : `<li class="queue-empty">${icon('list-ordered')} 待命中</li>`}</ol>
  <div class="combat-controls"><span class="round-order">${room?.phase === 'duel' ? '双方锁定后结算' : `我方行动 ${icon('arrow-right')} 敌方回应`}</span>${button(icon(room?.phase === 'duel' ? 'lock-keyhole' : 'play') + (room?.phase === 'duel' ? room.participants[room.you].submitted ? '已锁定，等待对方' : '锁定本回合' : b.plan.length ? '执行本回合' : '结束空回合') + `<span class="button-note">${b.maxAp - left} / ${b.maxAp} AP</span>`, 'resolveRound', 'primary', busy || (room?.phase === 'duel' && room.participants[room.you].submitted) ? 'disabled' : '')}</div></div>`;
}
function actionButton(action) {
  const info = actionInfo(action), reason = room?.phase === 'duel' && room.participants[room.you].submitted ? '本回合已锁定' : planReason(run, [...run.battle.plan, action]);
  const detail = action.kind === 'dodge' ? '下一次直接受击时，闪避率 +35 个百分点；不叠加，不闪避持续伤害' : action.kind === 'skill' ? SKILL_BY_ID[action.id].description : action.kind === 'item' ? `${ITEMS[action.id].description} · 库存 ${run.player.inventory[action.id]}` : action.kind === 'attack' ? `基础攻击 ${attackPower(run)}` : '敏捷检定，失败承受一次敌方回应';
  return `<button class="battle-action ${action.kind === 'skill' && SKILL_BY_ID[action.id].type === 'ultimate' ? 'ultimate' : ''}" data-action="queue" data-kind="${action.kind}" ${action.id ? `data-id="${action.id}"` : ''} title="${escape(reason || detail)}" ${reason ? 'disabled' : ''}>${icon(info.icon)}<span>${info.name}${action.kind === 'item' ? `<small>×${run.player.inventory[action.id]}</small>` : ''}</span><b>${info.ap} AP</b>${reason && !['本回合行动点不足', '生命已满', '理智已满', '该物品数量不足'].includes(reason) ? `<small class="action-reason">${reason}</small>` : ''}</button>`;
}
function enemyPortrait(def) { return `<svg class="enemy-portrait" role="img" aria-label="${def.name}画像"><use href="./assets/enemies.svg#${def.portrait}"></use></svg>`; }
function shop() {
  return `<div class="shop-grid">${Object.entries(ITEMS).map(([id, item]) => {
    const sold = (run.encounter.purchases[id] || 0) >= 2 || (run.player[`${item.kind}Buys`] || 0) >= 3;
    return `<div class="shop-item"><span class="shop-icon">${icon(item.icon)}</span><div><strong>${item.name}</strong><small>${item.description}</small></div>${button(sold ? '售罄' : icon('coins') + item.price, 'buy', 'price-button', `data-id="${id}" ${sold || run.player.gold < item.price ? 'disabled' : ''} aria-label="购买${item.name}，${item.price}金币"`)}</div>`;
  }).join('')}</div><div class="continue-bar">${run.player.skills.includes('steal') ? button(icon('hand') + '偷窃', 'explore', 'subtle', `data-id="steal" ${run.encounter.stolen ? 'disabled' : ''}`) : '<span class="tiny muted">售价已含「活人附加税」。</span>'}${button('结束采购' + icon('arrow-right'), 'leaveShop', 'primary')}</div>`;
}
function field() {
  if (room && (['lobby', 'chapter', 'ended'].includes(room.phase) || room.phase === 'pve' && room.participants[room.you].checkpoint)) return roomView();
  if (!run) return registration();
  if (run.status !== 'active') return ending();
  return `${room ? roomBar() : ''}<div class="region-heading"><span>${CHAPTERS[run.chapter].name} · 第 ${run.node + 1} / 7 层</span>${button(icon('map') + '区域地图', 'view', 'subtle', 'data-id="map"')}</div><section class="encounter" aria-label="当前遭遇"><div class="encounter-meta"><span>${icon(room?.phase === 'duel' ? 'swords' : NODE_META[run.encounter.type].icon)} ${room?.phase === 'duel' ? 'PVP 切磋' : NODE_META[run.encounter.type].name}</span><span class="mono">FILE ${CAMPAIGNS[run.campaignId].code}</span></div><h2>${run.encounter.title}</h2><div class="comparison">${characterPanel()}${opponentPanel()}</div><p class="narrative">${run.encounter.text}</p>${encounterActions()}</section>${journal()}`;
}
function characterPanel() {
  const cls = clsNow(), p = run?.player || { ...cls, level: 1, maxHp: cls.hp, maxSan: cls.san, clues: 0 };
  return `<section class="character-panel" aria-label="基础属性"><div class="compare-identity">${portrait(cls.id)}<div><small>我方 · Lv.${p.level}</small><h3>${cls.name}</h3></div></div><div class="central-resources"><div><span>${icon('heart')} 生命</span><strong>${p.hp} / ${p.maxHp}</strong><div class="bar hp-bar"><span style="width:${percent(p.hp, p.maxHp)}%"></span></div></div></div><div class="compare-numbers"><span>攻击 <b>${attackPower(run)}</b></span><span>防御 <b>${currentArmor(run)}</b></span><span>闪避 <b>${dodgeChance(run)}%</b></span><span>护盾 <b>${run.battle?.shield || 0}</b></span><span>理智 <b>${p.san}/${p.maxSan}</b></span><span>准备 <b>${run.battle?.dodgeBonus ? '+35%' : '无'}</b></span></div><div class="central-attributes">${Object.entries(ATTRS).map(([id, name]) => `<div class="${id === cls.primary ? 'primary-attr' : ''}"><span>${name}</span><strong class="mono">${p.stats[id]}</strong></div>`).join('')}</div><div class="compare-wallet">${icon('coins')} ${p.gold} · 线索 ${p.clues}</div>${p.skillPoints ? button(icon('plus') + `${p.skillPoints} 技能点`, 'view', 'text-button', 'data-id="skills"') : ''}<div class="cooldown-strip">${p.loadout.map(id => `<span>${SKILL_BY_ID[id].name} <b>${cooldownRemaining(run, id) ? `CD ${cooldownRemaining(run, id)}` : '就绪'}</b></span>`).join('')}</div></section>`;
}
function opponentPanel() {
  const b = run.battle, e = b?.enemy, def = ENEMY_BY_ID[e?.definitionId];
  if (e) return `<section class="opponent-panel" aria-label="敌方属性"><div class="compare-identity">${def ? enemyPortrait(def) : portrait(e.classId)}<div><small>${room?.phase === 'duel' ? escape(room.participants[1 - room.you].name) : e.boss ? `首领 · 阶段 ${e.phase}` : '敌方'}</small><h3>${e.name}</h3></div></div><div class="central-resources"><div><span>${icon('heart')} 生命</span><strong>${e.hp} / ${e.maxHp}</strong><div class="bar hp-bar"><span style="width:${percent(e.hp, e.maxHp)}%"></span></div></div></div><div class="compare-numbers"><span>攻击 <b>${e.attack}</b></span><span>防御 <b>${Math.max(0, e.armor - b.sunder)}</b></span><span>闪避 <b>${e.dodge || 0}%</b></span><span>护盾 <b>${e.shield || 0}</b></span></div><p>${room?.phase === 'duel' ? '非致命切磋 · 胜 3 / 平 1 / 负 0' : def.description}</p>${e.statuses.map(s => `<span class="opponent-effect">${s.id === 'poison' ? '中毒' : '燃烧'} · ${s.remaining} 回合</span>`).join('')}${def ? button(icon('book-open') + '敌人图鉴', 'enemyDetail', 'subtle', `data-id="${def.id}"`) : ''}</section>`;
  const type = run.encounter.type;
  return `<section class="opponent-panel area-panel" aria-label="区域情报"><div class="compare-identity"><span class="area-icon">${icon(NODE_META[type].icon)}</span><div><small>当前区域</small><h3>${NODE_META[type].name}</h3></div></div><div class="area-status">${icon(run.encounter.resolved ? 'circle-check' : 'circle-dot')} ${run.encounter.resolved ? '区域已完成' : '等待处理'}</div>${type === 'event' ? `<div class="compare-numbers"><span>检定难度 <b>DC ${run.encounter.dc}</b></span><span>职业加成 <b>+${checkBonus(run, clsNow().primary)}</b></span></div>` : ''}<p>${{ intro: '免责条款已备好。你的签名比生命更受重视。', event: '没有敌人在场。调查失败仍可能损失生命或理智。', shop: '补给与改装在售。库存有限，附加税无限。', camp: '恢复生命或理智。技能冷却不会随休息清零。' }[type]}</p></section>`;
}
function journal() {
  const entries = run.log.slice(-8).reverse();
  return `<section class="journal"><div class="section-heading"><h2>${icon('scroll-text')} 现场记录</h2><button class="text-button" data-action="fullLog">全部记录 ${icon('arrow-up-right')}</button></div><div class="journal-entries" aria-live="polite">${entries.map(entry => `<div class="log-entry ${entry.kind}"><span class="log-time mono">${entry.round ? 'R' + pad(entry.round) : pad(entry.chapter) + '.' + pad(entry.node)}</span><span class="log-marker"></span><p><strong>${escape(entry.title)}</strong>${entry.text ? `<span>${escape(entry.text)}</span>` : ''}</p></div>`).join('')}</div></section>`;
}
function dossier() {
  const cls = clsNow();
  const p = run?.player || { hp: cls.hp, maxHp: cls.hp, san: cls.san, maxSan: cls.san, gold: cls.gold, clues: 0, stats: cls.stats, level: 1, skills: [cls.starter], inventory: { potion: 2, tonic: 1, bomb: 1 } };
  return `<aside class="dossier" id="right-sidebar"><div class="dossier-title"><span class="micro">${run ? '外勤档案' : '候选人档案'}</span>${button(icon('panel-right-close'), 'toggleRight', 'icon-button', 'title="收起右侧档案" aria-label="收起右侧档案"')}</div><div class="identity"><div class="identity-portrait" style="--class-color:${cls.color}">${portrait(cls.id)}</div><div><h2>${cls.name}<span class="level mono">LV.${p.level}</span></h2><p>${cls.title}</p><span class="employee-id mono">NO. ${run ? String(run.seed).slice(-6).padStart(6, '0') : '------'}</span></div></div><p class="class-quote">“${cls.description}”</p>
  <div class="resources"><div class="resource"><div><span>${icon('heart')} 生命</span><strong class="mono">${p.hp} <small>/ ${p.maxHp}</small></strong></div><div class="bar hp-bar"><span style="width:${percent(p.hp, p.maxHp)}%"></span></div></div><div class="resource"><div><span>${icon('brain')} 理智</span><strong class="mono">${p.san} <small>/ ${p.maxSan}</small></strong></div><div class="bar san-bar"><span style="width:${percent(p.san, p.maxSan)}%"></span></div></div><div class="currency"><span>${icon('coins')} 金币 <strong class="mono">${p.gold}</strong></span><span>${icon('file-search')} 线索 <strong class="mono">${p.clues}</strong></span></div></div>
  <div class="dossier-section"><h3>随身装备 ${icon('backpack')}</h3><div class="equipment-row">${icon('sword')}<div><span>${cls.weapon}</span><small>攻击 ${run ? attackPower(run) : 7 + modifier(cls.stats[cls.primary])}</small></div><span class="quality">制式</span></div><div class="equipment-row">${icon('shirt')}<div><span>外勤制服</span><small>防御 ${run ? currentArmor(run) : cls.armor}</small></div><span class="quality">制式</span></div></div>
  <div class="dossier-section"><h3>应急物资 <span class="micro">SUPPLIES</span></h3><div class="inventory">${['potion', 'tonic', 'bomb'].map(id => `<button data-action="item" data-id="${id}" title="${ITEMS[id].name} · ${ITEMS[id].description}" aria-label="使用${ITEMS[id].name}，${ITEMS[id].description}，剩余${p.inventory[id]}" ${!run || run.status !== 'active' || !p.inventory[id] || (id === 'potion' && p.hp === p.maxHp) || (id === 'tonic' && p.san === p.maxSan) || (id === 'bomb' && (!run.battle || run.encounter.resolved)) ? 'disabled' : ''}>${icon(ITEMS[id].icon)}<span>${ITEMS[id].name}</span><b class="mono">${p.inventory[id]}</b></button>`).join('')}</div></div>
  <div class="dossier-section dossier-skills"><h3>已掌握技能 <button class="text-button" data-action="view" data-id="skills" title="查看职业技能树" aria-label="查看职业技能树">${icon('arrow-up-right')}</button></h3>${p.skills.slice(0, 5).map(id => `<div class="small-skill">${icon(SKILL_BY_ID[id].icon)}<span>${SKILL_BY_ID[id].name}</span><small>${{ active: '主动', passive: '被动', ultimate: '终极', exploration: '探索' }[SKILL_BY_ID[id].type]}</small></div>`).join('')}${p.skills.length > 5 ? `<span class="tiny muted">另有 ${p.skills.length - 5} 项技能</span>` : ''}</div>
  ${run?.status === 'active' ? explorationControls() : ''}<div class="dossier-footer">${icon('shield-alert')} 本事务所不提供复活服务。</div></aside>`;
}
function explorationControls() {
  const skills = run.player.skills.filter(id => ['teleport', 'sleight'].includes(id));
  if (!skills.length) return '';
  return `<div class="dossier-section exploration-controls">${skills.map(id => button(icon(SKILL_BY_ID[id].icon) + SKILL_BY_ID[id].name + `<small>${run.chapterUses[id] ? '本章已用' : '每章一次'}</small>`, 'explore', 'subtle', `data-id="${id}" ${run.chapterUses[id] || (run.battle && !run.encounter.resolved) ? 'disabled' : ''}`)).join('')}</div>`;
}
function skillsView() {
  const cls = clsNow();
  return `<div class="page-heading"><span class="micro">PROFESSIONAL DEVELOPMENT</span><h1>职业技能 <span>${cls.name}</span></h1><p>${cls.description}</p></div><div class="skill-summary"><div>${icon('git-branch')}<strong>${run?.player.skillPoints || 0}</strong><span>可用技能点</span></div><div class="tiny muted">${run ? `Lv.${run.player.level} · ${run.player.skills.length} / 9 技能已掌握` : '正式签约后开放晋升'}</div></div>
  <div class="skill-tree">${cls.branches.map((branch, index) => `<section class="skill-branch"><div class="branch-heading"><span class="mono">0${index + 1}</span><h2>${branch}</h2></div>${SKILLS.filter(s => s.classId === cls.id && s.branch === index).map(s => {
    const owned = run?.player.skills.includes(s.id);
    const reason = run ? learnReason(run, s.id) : '签约后解锁';
    const equipped = run?.player.loadout.includes(s.id);
    return `<article class="skill-card ${owned ? 'owned' : ''} ${s.tier === 3 ? 'ultimate' : ''}"><div class="skill-card-top"><span class="skill-icon">${icon(s.icon)}</span><span class="skill-type">${{ active: '主动', passive: '被动', ultimate: '终极', exploration: '探索' }[s.type]} · ${s.tier === 3 ? 'IV' : s.tier === 2 ? 'II' : 'I'}</span></div><h3>${s.name}${owned ? icon('check') : ''}</h3><p>${s.description}</p><div class="skill-card-bottom">${owned ? s.type === 'active' ? button((equipped ? icon('check') : icon('plus')) + (equipped ? '已装配' : '装配'), 'equip', equipped ? 'equipped' : 'subtle', `data-id="${s.id}" ${run.status !== 'active' || (run.battle && !run.encounter.resolved) ? 'disabled' : ''}`) : `<span class="owned-label">${icon('circle-check')} ${s.automatic ? '自动生效' : s.type === 'passive' ? '被动生效' : '已掌握'}</span>` : button(reason ? icon('lock-keyhole') + reason : icon('plus') + '学习 · 1 技能点', 'learn', !reason ? 'learn-button' : 'locked-button', `data-id="${s.id}" ${reason || run?.status !== 'active' ? 'disabled' : ''}`)}</div></article>`;
  }).join('')}</section>`).join('')}</div><div class="skills-footnote">${icon('info')} 主动技能装配 ${run?.player.loadout.length || 0} / 2。被动技能无需装配；终极技能每章限用一次。</div>`;
}
function ending() {
  const won = run.status === 'won';
  return `${scene()}<section class="ending ${won ? 'won' : 'dead'}"><span class="ending-icon">${icon(won ? 'badge-check' : 'skull')}</span><span class="micro">${won ? 'CASE CLOSED' : 'EMPLOYMENT TERMINATED'}</span><h2>${won ? '委托完成。你居然回来了。' : '你的档案，已经封存。'}</h2><p>${run.ending}</p><div class="ending-stats"><div><strong>${run.completed.length}<small>/21</small></strong><span>完成区域</span></div><div><strong>${run.metrics.kills}</strong><span>击败敌人</span></div><div><strong>${run.player.clues}</strong><span>带回线索</span></div></div><div class="ending-actions">${button(icon('plus') + '签署下一份合同', 'new', 'primary')}${button(icon('file-down') + '导出档案', 'export', 'subtle')}</div><small class="muted">${won ? '功劳已记录。奖金待审批。' : '本次角色不会复活。新委托从头开始。'}</small></section>${journal()}`;
}
function archiveView() {
  return `<div class="page-heading"><span class="micro">BUREAU ARCHIVES</span><h1>行动档案</h1><p>我们记得每一位员工。尤其是他们尚未结清的账款。</p></div><div class="archive-summary"><div><strong>${archive.length}</strong><span>已归档委托</span></div><div><strong>${archive.filter(a => a.status === 'won').length}</strong><span>成功处置</span></div><div><strong>${archive.filter(a => a.status === 'dead').length}</strong><span>永久离岗</span></div></div>${archive.length ? `<div class="archive-list">${archive.map(a => `<article class="archive-row"><span class="archive-icon ${a.status}">${icon(a.status === 'won' ? 'badge-check' : a.status === 'dead' ? 'skull' : 'archive')}</span><div><h3>${CAMPAIGNS[a.campaignId].name}</h3><p>${CLASSES[a.classId].name} · Lv.${a.level} · 完成 ${a.nodes} 个区域</p></div><div><span class="archive-result">${{ won: '处置完成', dead: '永久离岗', abandoned: '主动终止' }[a.status] || '已归档'}</span><small class="mono">${escape(a.date)}</small></div></article>`).join('')}</div>` : `<div class="empty-state">${icon('folder-open')}<h2>档案室暂时很安静</h2><p>愿这种情况持续得久一点。</p>${button('返回委托现场' + icon('arrow-right'), 'view', 'subtle', 'data-id="field"')}</div>`}`;
}
function bestiaryView() {
  const seen = Object.values(codex.entries).filter(e => e.seen > 0).length;
  return `<div class="page-heading"><span class="micro">HOSTILE PERSONNEL DIRECTORY</span><h1>敌人图鉴</h1><p>每一位危险人物，都值得一份不带感情色彩的差评。</p></div><div class="codex-toolbar"><span>${icon('book-open')} 已遭遇 <strong>${seen} / ${ENEMIES.length}</strong></span><label class="codex-search">${icon('search')}<input type="search" id="codex-search" placeholder="搜索敌人" aria-label="搜索敌人" value="${escape(codexSearch)}"></label><select id="codex-filter" aria-label="筛选敌人类型">${[['all', '全部敌人'], ['seen', '已遭遇'], ['combat', '普通'], ['elite', '精英'], ['boss', '首领']].map(([id, label]) => `<option value="${id}" ${id === codexFilter ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="codex-grid" id="codex-results">${bestiaryCards()}</div>`;
}
function bestiaryCards() {
  const enemies = ENEMIES.filter(e => (codexFilter === 'all' || (codexFilter === 'seen' ? codex.entries[e.id]?.seen > 0 : e.type === codexFilter)) && `${e.name} ${e.description} ${e.campaignId ? CAMPAIGNS[e.campaignId].name : ''}`.includes(codexSearch.trim()));
  return enemies.length ? enemies.map(e => `<button class="codex-card ${e.type}" data-action="enemyDetail" data-id="${e.id}"><div class="codex-art">${enemyPortrait(e)}<span>${NODE_META[e.type].name}</span></div><div class="codex-card-copy"><small>第 ${e.chapter + 1} 章 · ${e.campaignId ? CAMPAIGNS[e.campaignId].name : '公共区域'}</small><h2>${e.name}</h2><div class="codex-stats"><span>HP <b>${e.hp}</b></span><span>ATK <b>${e.attack}</b></span><span>DEF <b>${e.armor}</b></span></div><p>${e.description}</p><div class="codex-record">${icon(codex.entries[e.id]?.seen ? 'eye' : 'scan-eye')}<span>${codex.entries[e.id]?.seen ? `遭遇 ${codex.entries[e.id].seen} 次 · 击败 ${codex.entries[e.id].kills} 次` : '尚未遭遇'}</span>${icon('arrow-up-right')}</div></div></button>`).join('') : `<div class="empty-state">${icon('search-x')}<h2>没有匹配的档案</h2></div>`;
}
function enemyDetail(id) {
  const e = ENEMY_BY_ID[id];
  if (!e) return;
  const record = codex.entries[id];
  modal(`<div class="enemy-detail-art">${enemyPortrait(e)}</div><span class="micro">${NODE_META[e.type].name} / 第 ${e.chapter + 1} 章</span><h2>${e.name}</h2><p>${e.description}</p><div class="detail-stats"><span>生命 <b>${e.hp}</b></span><span>攻击 <b>${e.attack}</b></span><span>防御 <b>${e.armor}</b></span></div><h3>交战情报</h3><p>${e.tactic}</p><h3>战利品</h3><p>${e.gold} 金币${e.type === 'boss' ? '、1 线索、武器伤害 +1；恢复 50% HP 和 4 SAN。' : '。'}</p><div class="detail-record">遭遇 ${record?.seen || 0} 次 · 击败 ${record?.kills || 0} 次</div>`, `${e.name}图鉴`);
}
function soundSettings() {
  modal(`<span class="micro">AUDIO</span><h2>音效设置</h2><label class="sound-toggle"><span>${icon('volume-2')} 游戏音效</span><input id="sound-enabled" type="checkbox" role="switch" ${prefs.soundEnabled ? 'checked' : ''}></label><label class="volume-label" for="sound-volume">音量 <output id="volume-value">${Math.round(prefs.volume * 100)}%</output></label><input type="range" id="sound-volume" min="0" max="100" value="${Math.round(prefs.volume * 100)}" aria-label="音效音量"><div class="modal-actions">${button(icon('play') + '试听', 'previewSound', 'subtle')}${button('完成', 'closeModal', 'primary')}</div>`, '音效设置');
}
function render() {
  document.body.classList.toggle('left-collapsed', prefs.leftCollapsed);
  document.body.classList.toggle('right-collapsed', prefs.rightCollapsed);
  app.innerHTML = `${sidebar()}<div class="workspace">${topbar()}<div class="content-grid"><main id="main-content">${view === 'map' ? routeMap() : view === 'room' ? roomView() : view === 'skills' ? skillsView() : view === 'bestiary' ? bestiaryView() : view === 'archive' ? archiveView() : field()}</main>${prefs.rightCollapsed ? '' : dossier()}</div><footer class="workspace-footer"><span>异常事务处理局 · 雾港分署</span><span class="mono">${run ? `SEED ${run.seed} / REV ${run.revision}` : 'ALL PERSONNEL ARE EXPENDABLE.'}</span></footer></div>`;
  if (room?.phase === 'duel' && room.participants[room.you].submitted) app.querySelectorAll('[data-action="queue"], [data-action="stance"], [data-action="removeAction"], [data-action="moveAction"], [data-action="clearPlan"]').forEach(button => button.disabled = true);
  if (app.querySelector('#player-name')) app.querySelector('#player-name').value = entryName;
  if (app.querySelector('#join-code')) app.querySelector('#join-code').value = joinCode;
  icons();
}
function roomBar() {
  return `<div class="room-bar"><span>${icon('users')} ${room.participants.map(s => `${escape(s.name)} ${s.score}`).join(' : ')}</span><span class="connection-status ${connectionError ? 'offline' : ''}">${connectionError || '已同步'}</span>${button(icon('qr-code'), 'view', 'icon-button', 'data-id="room" title="查看邀请与房间" aria-label="查看邀请与房间"')}</div>`;
}
function roomView() {
  if (!room) { selectedMode = 'duo'; return registration(); }
  const self = room.participants[room.you], other = room.participants[1 - room.you], latest = room.results.at(-1);
  const resultText = latest ? latest.winner === null ? '本章平局' : latest.winner === room.you ? '本章切磋获胜' : '本章切磋落败' : '';
  return `<div class="page-heading"><span class="micro">ROOM ${room.id.toUpperCase()}</span><h1>双人竞逐</h1><p>${escape(CAMPAIGNS[room.campaignId].name)}</p></div>${roomBar()}<div class="room-roster">${[0, 1].map(i => {
    const p = room.participants[i];
    return `<article class="room-member">${p ? portrait(p.classId) : icon('user-plus')}<h2>${p ? escape(p.name) : '等待受邀者'}</h2><span>${p ? `${CLASSES[p.classId].name} · Lv.${p.level}` : '席位空缺'}</span><strong>${p?.score || 0}<small> 积分</small></strong><p>${!p ? '尚未加入' : room.phase === 'lobby' ? p.ready ? '已准备' : '未准备' : p.checkpoint ? '本章首领已完成' : `第 ${p.chapter + 1} 章 · 第 ${p.node + 1} 层 · HP ${p.hp}/${p.maxHp}`}</p></article>`;
  }).join('')}</div>${room.phase === 'lobby' ? `<div class="invite-section"><img class="invite-qr" src="${room.qr}" alt="双人房间邀请二维码" width="240" height="240"><div><h2>邀请另一位外勤员</h2><label>邀请地址<input class="invite-address" value="${escape(room.inviteUrl)}" readonly aria-label="邀请地址"></label>${button(icon('copy') + '复制邀请链接', 'copyInvite', 'subtle')}<p class="tiny muted">${new URL(room.inviteUrl).hostname === '127.0.0.1' || new URL(room.inviteUrl).hostname === 'localhost' ? '本机地址 · 手机暂不可达' : /^https:/.test(room.inviteUrl) ? '公网邀请地址' : '局域网邀请 · 双方需在同一网络'}</p></div></div><div class="room-actions">${button(icon(self.ready ? 'circle-check' : 'check') + (self.ready ? '取消准备' : '准备出发'), 'roomReady', 'primary')}${button(icon('log-out') + '离开房间', 'leaveRoom', 'subtle')}</div>` : room.phase === 'chapter' ? `<section class="duel-result"><h2>${resultText}</h2><p>${latest.reason} · ${latest.rounds} 回合</p><div class="result-strip">${icon('heart')} 训练结束 · PVE 生命 ${run.player.hp}/${run.player.maxHp} · 技能冷却保留</div>${button(icon('arrow-right') + (self.continued ? '已确认，等待对方' : room.chapter === 2 ? '确认最终积分' : '继续下一章'), 'continueChapter', 'primary', self.continued ? 'disabled' : '')}</section>` : room.phase === 'ended' ? `<section class="duel-result"><h2>${room.results.length === 3 ? (self.score === other?.score ? '总积分持平' : self.score > other?.score ? '赢得本次竞逐' : '本次竞逐落败') : '双人委托结束'}</h2><p>${escape(room.endReason)}</p>${button(icon('arrow-left') + '返回单人档案', 'disconnectRoom', 'primary')}</section>` : `<section class="duel-result"><h2>${self.checkpoint && room.phase === 'pve' ? '等待对方完成本章首领' : room.phase === 'duel' ? '章节切磋进行中' : '双人外勤进行中'}</h2>${button(icon('compass') + '返回当前区域', 'view', 'primary', `data-id="field" ${self.checkpoint && room.phase === 'pve' ? 'disabled' : ''}`)}${button(icon('map') + '查看地图', 'view', 'subtle', 'data-id="map"')}${button(icon('log-out') + '终止双人委托', 'leaveRoom', 'subtle')}</section>`}${room.results.length ? `<div class="room-results">${room.results.map(r => `<div>第 ${r.chapter + 1} 章 <strong>${r.winner === null ? '平局 · 各 +1' : `${escape(room.participants[r.winner].name)} +3`}</strong></div>`).join('')}</div>` : ''}`;
}
function disconnectRoom() {
  network.disconnect(); room = null; connectionError = ''; selectedMode = 'solo'; view = 'field';
  try { run = migrateSave(JSON.parse(localStorage.getItem(SAVE_KEY))); } catch { run = null; }
  closeModal(); render();
}
function modal(content, label = '确认操作') {
  overlay.innerHTML = `<dialog class="modal" aria-label="${label}"><button class="modal-close icon-button" data-action="closeModal" aria-label="关闭">${icon('x')}</button>${content}</dialog>`;
  icons(); overlay.querySelector('dialog').showModal();
}
function closeModal() { overlay.querySelector('dialog')?.close(); overlay.innerHTML = ''; }
function resetRun() {
  if (run?.status === 'active') record('abandoned');
  run = null; view = 'field'; store(); closeModal(); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
}
function fullLog() {
  modal(`<span class="micro">INCIDENT REPORT</span><h2>完整现场记录</h2><div class="full-log">${run.log.map(l => `<div class="log-entry ${l.kind}"><span class="log-time mono">${pad(l.chapter)}.${pad(l.node)}</span><p><strong>${escape(l.title)}</strong><span>${escape(l.text)}</span></p></div>`).join('')}</div>`, '完整现场记录');
  const list = overlay.querySelector('.full-log'); list.scrollTop = list.scrollHeight;
}

async function handleAction(event) {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled || busy) return;
  event.preventDefault();
  await sound.unlock();
  if (busy || !target.isConnected) return;
  const { action, id, choice, route } = target.dataset;
  if (room?.phase === 'duel' && room.participants[room.you].submitted && ['queue', 'stance', 'removeAction', 'moveAction', 'clearPlan'].includes(action)) return;
  if (['view', 'selectClass', 'selectCampaign', 'toggleLeft', 'toggleRight', 'enemyDetail'].includes(action)) sound.play('click');
  if (action === 'view') { view = id; if (window.innerWidth <= 800) prefs.leftCollapsed = true; store(); render(); window.scrollTo({ top: 0 }); }
  else if (action === 'toggleLeft' || action === 'toggleRight') {
    const key = action === 'toggleLeft' ? 'leftCollapsed' : 'rightCollapsed'; prefs[key] = !prefs[key];
    if (window.innerWidth <= 800 && !prefs[key]) prefs[action === 'toggleLeft' ? 'rightCollapsed' : 'leftCollapsed'] = true;
    store(); render();
  }
  else if (action === 'soundSettings') soundSettings();
  else if (action === 'previewSound') sound.play('level');
  else if (action === 'enemyDetail') enemyDetail(id);
  else if (action === 'selectMode') { selectedMode = id; render(); }
  else if (action === 'enterRoom') {
    entryName = document.querySelector('#player-name').value; joinCode = document.querySelector('#join-code').value.trim();
    let id = joinCode;
    if (id.startsWith('http')) { try { id = new URL(id).searchParams.get('room') || ''; } catch { notify('邀请地址无效'); return; } }
    if (id && !/^[a-f0-9]{12}$/i.test(id)) { notify('请输入完整的 12 位邀请编号或邀请链接'); return; }
    busy = true; target.disabled = true;
    try { await network.enter({ id: id.toLowerCase(), name: entryName, classId: selectedClass, campaignId: selectedCampaign }); }
    catch (error) { notify(error.message); }
    finally { busy = false; render(); }
  }
  else if (action === 'roomReady') await command({ type: 'ready' });
  else if (action === 'continueChapter') await command({ type: 'continueChapter' });
  else if (action === 'copyInvite') {
    try { await navigator.clipboard.writeText(room.inviteUrl); notify('邀请链接已复制'); }
    catch { const input = document.querySelector('.invite-address'); input.focus(); input.select(); notify('已选中邀请链接'); }
  }
  else if (action === 'leaveRoom' || action === 'new' && room) modal(`<h2>终止双人委托？</h2><p>双方本次进度将封存。单人档案不受影响。</p><div class="modal-actions">${button('继续游玩', 'closeModal', 'subtle')}${button('确认终止', 'confirmLeaveRoom', 'primary')}</div>`);
  else if (action === 'confirmLeaveRoom') { if (await command({ type: 'leaveRoom' })) disconnectRoom(); }
  else if (action === 'disconnectRoom') disconnectRoom();
  else if (action === 'selectClass') { selectedClass = id; render(); }
  else if (action === 'selectCampaign') { selectedCampaign = id; render(); }
  else if (action === 'start') {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    prefs.leftCollapsed = prefs.rightCollapsed = true;
    run = newRun(selectedClass, selectedCampaign, seed); sound.play('level'); store(); render(); window.scrollTo({ top: 0 }); notify('外勤档案已建立。初始技能点 +1。');
  } else if (action === 'new') {
    if (run?.status === 'active') modal(`<span class="micro">CONTRACT TERMINATION</span><h2>提前结束当前委托？</h2><p>当前角色的行程将被封存，无法继续。新合同从 Lv.1 开始。</p><div class="modal-actions">${button('继续当前委托', 'closeModal', 'subtle')}${button('结束并重新登记', 'confirmReset', 'primary')}</div>`);
    else resetRun();
  } else if (action === 'confirmReset') resetRun();
  else if (action === 'closeModal') closeModal();
  else if (action === 'fullLog') fullLog();
  else if (action === 'export' && run) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `ashfall-${run.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else if (action === 'explore') {
    if (id === 'sleight') modal(`<span class="micro">UNCLAIMED ASSETS</span><h2>没人认领的物资</h2><p>请选择一件，剩下的留给下一位幸运员工。</p><div class="modal-actions">${button(icon('syringe') + '治疗针', 'claimSleight', 'subtle', 'data-choice="potion"')}${button(icon('bomb') + '震爆弹', 'claimSleight', 'subtle', 'data-choice="bomb"')}</div>`);
    else command({ type: 'explorationSkill', id });
  } else if (action === 'claimSleight') { closeModal(); command({ type: 'explorationSkill', id: 'sleight', choice }); }
  else if (action === 'queue') await command({ type: 'queueAction', action: { kind: target.dataset.kind, ...(id ? { id } : {}) } });
  else if (action === 'item' && run?.battle && !run.encounter.resolved) await command({ type: 'queueAction', action: { kind: 'item', id } });
  else if (action === 'removeAction' || action === 'moveAction') await command({ type: action, index: Number(target.dataset.index), direction: Number(target.dataset.direction) });
  else if (action === 'resolveRound') {
    const expectedId = run.id, expectedRevision = run.revision, expectedSeatVersion = room?.seatVersion;
    busy = true; target.disabled = true; target.classList.add('resolving');
    await new Promise(resolve => setTimeout(resolve, 280));
    busy = false;
    if (run?.id === expectedId && run.revision === expectedRevision && room?.seatVersion === expectedSeatVersion) await command({ type: 'resolveRound' });
    else { render(); notify('档案已更新，请重新确认本回合。'); }
  } else {
    const nodeId = target.dataset.nodeId;
    const ok = await command({ type: action, id, choice, route, ...(nodeId ? { nodeId } : {}) });
    if (ok && action === 'grow') { view = 'skills'; render(); notify('晋升完成。可分配 2 个新技能点。'); window.scrollTo({ top: 0 }); }
    if (ok && action === 'learn') notify(`已掌握${SKILL_BY_ID[id].name}`);
    if (ok && action === 'buy') notify(`已购入${ITEMS[id].name}`);
    if (ok && action === 'advance') { view = 'field'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }
}
document.addEventListener('click', handleAction);
document.addEventListener('input', event => {
  if (event.target.id === 'player-name') entryName = event.target.value;
  if (event.target.id === 'join-code') joinCode = event.target.value;
  if (event.target.id === 'sound-volume') {
    prefs.volume = Number(event.target.value) / 100;
    sound.configure(prefs.soundEnabled, prefs.volume); store();
    document.querySelector('#volume-value').textContent = `${Math.round(prefs.volume * 100)}%`;
  }
  if (event.target.id === 'codex-search') {
    codexSearch = event.target.value;
    document.querySelector('#codex-results').innerHTML = bestiaryCards(); icons();
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'sound-enabled') {
    prefs.soundEnabled = event.target.checked;
    sound.configure(prefs.soundEnabled, prefs.volume); store(); render();
  }
  if (event.target.id === 'codex-filter') {
    codexFilter = event.target.value;
    document.querySelector('#codex-results').innerHTML = bestiaryCards(); icons();
  }
});
window.addEventListener('storage', event => {
  if (event.key === SAVE_KEY && !room && !network.credentials) {
    try {
      const saved = JSON.parse(event.newValue || 'null');
      const migrated = migrateSave(saved);
      if (saved && !migrated) return;
      run = migrated; closeModal(); render(); notify('已同步另一窗口的档案。');
    } catch { /* Ignore incomplete writes from other browser tabs. */ }
  }
});
window.addEventListener('DOMContentLoaded', icons);
if (run) store();
render();
if (network.credentials) {
  network.refresh().catch(() => notify('双人房间暂时无法连接，可在双人委托中重新加入。')).finally(() => network.schedule());
} else if (inviteId) { view = 'room'; render(); }
if (storageProblem) notify('上次档案无法读取，已返回登记处。');
