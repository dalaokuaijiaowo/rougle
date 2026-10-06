import { randomBytes } from 'node:crypto';
import { newRun, dispatch, RuleError } from './src/engine.js';
import { CLASSES, CAMPAIGNS } from './src/data.js';
import { newDuel, duelCommand, resolveDuel, duelViewRun } from './src/duel.js';

const token = () => randomBytes(24).toString('hex');
const seed = () => randomBytes(4).readUInt32LE() || 1;
const requireRule = (condition, message) => { if (!condition) throw new RuleError(message); };
function seat(input) {
  requireRule(Object.hasOwn(CLASSES, input.classId), '请选择有效职业');
  requireRule(typeof input.nonce === 'string' && /^[a-f0-9]{48}$/.test(input.nonce), '无效的入场凭据');
  return { token: token(), nonce: input.nonce, name: String(input.name || '外勤员').trim().slice(0, 20) || '外勤员', classId: input.classId,
    ready: false, checkpoint: false, continued: false, version: 0, score: 0, run: null, commands: [] };
}
export class RoomService {
  constructor(rooms = [], now = () => Date.now()) { this.rooms = new Map(rooms.map(r => [r.id, r])); this.now = now; }
  create(input) {
    requireRule(Object.hasOwn(CAMPAIGNS, input.campaignId), '无效委托');
    const existing = [...this.rooms.values()].find(r => r.seats[0].nonce === input.nonce && r.phase === 'lobby');
    if (existing) return { room: existing, index: 0 };
    requireRule(this.rooms.size < 200, '房间已满，请稍后重试');
    const room = { id: randomBytes(6).toString('hex'), seed: seed(), campaignId: input.campaignId, version: 0,
      phase: 'lobby', chapter: 0, seats: [seat(input)], duel: null, results: [], createdAt: this.now(), updatedAt: this.now(), endReason: '' };
    this.rooms.set(room.id, room); return { room, index: 0 };
  }
  join(id, input) {
    const room = this.get(id), existing = room.seats.findIndex(s => s.nonce === input.nonce);
    if (existing >= 0) return { room, index: existing };
    requireRule(room.phase === 'lobby' && room.seats.length === 1, '房间已满或委托已经开始');
    room.seats.push(seat(input)); this.changed(room); return { room, index: 1 };
  }
  get(id) { const room = this.rooms.get(id); requireRule(room, '房间不存在或已经过期'); return room; }
  authenticate(room, bearer) { const index = room.seats.findIndex(s => s.token === bearer); requireRule(index >= 0, '入场凭据无效，请重新加入房间'); return index; }
  changed(room) { room.version++; room.updatedAt = this.now(); }
  command(id, bearer, request) {
    const original = this.get(id), index = this.authenticate(original, bearer);
    requireRule(typeof request.commandId === 'string' && /^[a-f0-9-]{16,64}$/.test(request.commandId), '缺少操作编号');
    if (original.seats[index].commands.includes(request.commandId)) return { room: original, index };
    requireRule(request.expectedRevision === original.seats[index].version, '状态已更新，请重新确认操作');
    const room = structuredClone(original), s = room.seats[index], cmd = request.command;
    requireRule(cmd && typeof cmd.type === 'string', '无效操作');
    if (cmd.type === 'leaveRoom') { room.phase = 'ended'; room.endReason = `${s.name}终止了双人委托。`; }
    else if (room.phase === 'lobby') {
      requireRule(cmd.type === 'ready', '等待双方准备'); s.ready = !s.ready;
      if (room.seats.length === 2 && room.seats.every(s => s.ready)) {
        room.phase = 'pve';
        for (const [i, member] of room.seats.entries()) {
          member.run = newRun(member.classId, room.campaignId, room.seed);
          member.run.id = `${room.id}-${i}`; member.run.player.id = `player-${i + 1}`; member.run.player.teamId = `team-${i + 1}`;
          member.run.rng = seed(); member.version++;
        }
      }
    } else if (room.phase === 'pve') {
      requireRule(!s.checkpoint, '本章首领已完成，等待另一位玩家'); s.run = dispatch(s.run, cmd);
      if (s.run.status === 'dead') { room.phase = 'ended'; room.endReason = `${s.name}在 PVE 中永久离岗，本次双人委托结束。`; }
      else if (s.run.node === 6 && s.run.encounter.resolved && !original.seats[index].run.encounter.resolved) {
        s.checkpoint = true; if (s.run.status === 'won') s.run.status = 'active';
        if (room.seats.every(s => s.checkpoint)) {
          room.phase = 'duel'; room.duel = newDuel(room.seats.map(s => s.run), seed(), this.now()); room.seats.forEach(s => s.version++);
        }
      }
    } else if (room.phase === 'duel') {
      room.duel = duelCommand(room.duel, s.run, index, cmd, this.now());
      if (room.duel.round !== original.duel.round) room.seats.forEach(s => s.version++);
      this.finishDuel(room);
    } else if (room.phase === 'chapter') {
      requireRule(cmd.type === 'continueChapter', '请先确认章节切磋结果'); s.continued = true;
      if (room.seats.every(s => s.continued)) {
        if (room.chapter === 2) { room.phase = 'ended'; room.endReason = '三章委托与切磋全部结束。奖金仍在审批。'; room.seats.forEach(s => { s.run.status = 'won'; s.version++; }); }
        else { room.chapter++; room.phase = 'pve'; room.duel = null; room.seats.forEach(s => { s.checkpoint = false; s.continued = false; s.version++; }); }
      }
    } else throw new RuleError('这份双人委托已经结束');
    s.version++; s.commands.push(request.commandId); s.commands = s.commands.slice(-64);
    this.changed(room); this.rooms.set(id, room); return { room, index };
  }
  finishDuel(room) {
    if (!room.duel.result || room.phase !== 'duel') return;
    room.phase = 'chapter'; room.results.push({ chapter: room.chapter, ...room.duel.result, rounds: room.duel.round });
    for (const [i, s] of room.seats.entries()) {
      s.score += room.duel.result.winner === null ? 1 : room.duel.result.winner === i ? 3 : 0;
      const fighter = room.duel.fighters[i]; s.run.player.combatClock = fighter.player.combatClock;
      s.run.player.cooldowns = { ...fighter.player.cooldowns }; s.run.chapterUses = { ...fighter.chapterUses };
      if (s.run.battle) s.run.battle.cooldowns = { ...fighter.player.cooldowns }; s.version++;
    }
  }
  tick() {
    let changed = false;
    for (const [id, room] of this.rooms) {
      if (this.now() - room.updatedAt > 86400000) { this.rooms.delete(id); changed = true; continue; }
      if (room.phase === 'duel' && this.now() >= room.duel.deadline) {
        room.duel = resolveDuel(room.duel, this.now()); room.seats.forEach(s => s.version++);
        this.finishDuel(room); this.changed(room); changed = true;
      }
    }
    return changed;
  }
  snapshot(room, index) {
    const own = room.seats[index];
    const run = own.run ? room.phase === 'duel' ? duelViewRun(own.run, room.duel, index) : structuredClone(own.run) : null;
    if (run) run.rng = 1;
    return { id: room.id, version: room.version, phase: room.phase, chapter: room.chapter, campaignId: room.campaignId,
      you: index, seatVersion: own.version, run, results: room.results, endReason: room.endReason,
      participants: room.seats.map((s, i) => ({ name: s.name, classId: s.classId, ready: s.ready, checkpoint: s.checkpoint,
        continued: s.continued, score: s.score, chapter: s.run?.chapter || 0, node: s.run?.node || 0,
        mapNodeId: s.run?.map.currentId, path: s.run?.map.visited || [], status: s.run?.status || 'waiting',
        hp: s.run?.player.hp ?? CLASSES[s.classId].hp, maxHp: s.run?.player.maxHp ?? CLASSES[s.classId].hp,
        level: s.run?.player.level || 1, submitted: !!room.duel?.fighters[i].submitted })),
      duel: room.duel ? { round: room.duel.round, deadline: room.duel.deadline, first: (room.duel.initiative + room.duel.round) % 2,
        result: room.duel.result, log: room.duel.log } : null };
  }
}
