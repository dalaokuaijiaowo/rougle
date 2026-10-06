export type Attribute = 'str' | 'agi' | 'int' | 'per' | 'cha' | 'wil' | 'con' | 'luk';
export type ClassId = 'warrior' | 'rogue' | 'mage';
export type CampaignId = 'cult' | 'oracle' | 'theatre';
export type Stance = 'balanced' | 'assault' | 'guard';
export type NodeType = 'intro' | 'event' | 'combat' | 'shop' | 'camp' | 'elite' | 'boss';
export type ConsumableId = 'potion' | 'tonic' | 'bomb';
export type ItemId = ConsumableId | 'weapon' | 'armor';
export type SkillId = 'smash' | 'cleave' | 'berserk' | 'shieldwall' | 'taunt' | 'unyielding' | 'heavy' | 'sunder' | 'execute' | 'backstab' | 'poison' | 'shadow' | 'invisible' | 'sprint' | 'vanish' | 'lockpick' | 'steal' | 'sleight' | 'fireball' | 'burn' | 'meteor' | 'ice' | 'freeze' | 'blizzard' | 'barrier' | 'teleport' | 'timestop';
export type SkillEffect =
  | { kind: 'damage'; base: number; element?: 'fire' | 'ice'; weaken?: number; vsArmor?: number; ambush?: number; evade?: number; chill?: number; duration?: number }
  | { kind: 'shield'; base: number; attr: Attribute }
  | { kind: 'followup' | 'prevent_death' | 'invisible' | 'sprint' | 'freeze'; value: number }
  | { kind: 'berserk' | 'stun'; duration: number }
  | { kind: 'taunt'; armor: number; attack: number }
  | { kind: 'sunder'; value: number; max: number }
  | { kind: 'execute'; value: number; threshold: number }
  | { kind: 'dot'; status: 'poison' | 'burn'; value: number; duration: number; element?: 'fire' }
  | { kind: 'check_bonus'; attr: Attribute; value: number }
  | { kind: 'steal'; dc: number }
  | { kind: 'escape' | 'loot_choice' | 'skip_node' };
export interface ClassDefinition {
  id: ClassId; name: string; title: string; icon: string; color: string;
  primary: Attribute; secondary: Attribute; hp: number; san: number; gold: number;
  armor: number; weapon: string; starter: SkillId; stats: Record<Attribute, number>;
  growth: { hp: number; san: number }; branches: string[]; description: string; tags: string[];
}
export interface SkillDefinition {
  id: SkillId; classId: ClassId; branch: number; tier: 1 | 2 | 3;
  name: string; type: 'active' | 'passive' | 'ultimate' | 'exploration';
  description: string; effect: SkillEffect; minLevel: number; cost: number; apCost: number; icon: string;
  requires?: SkillId; cooldown?: number; sanCost?: number; automatic?: boolean; perChapter?: boolean;
}
export interface CharacterState {
  id: string; teamId: string; classId: ClassId; level: number; stats: Record<Attribute, number>;
  hp: number; maxHp: number; san: number; maxSan: number; gold: number; clues: number;
  weapon: number; armor: number; weaponBuys?: number; armorBuys?: number;
  skills: SkillId[]; skillPoints: number; loadout: SkillId[]; inventory: Record<ConsumableId, number>;
  combatClock: number;
  cooldowns: Partial<Record<SkillId, number>>; // Absolute ready-at combat round, shared across encounters.
}
export interface EncounterState {
  id: string; type: NodeType; route: 'safe' | 'risk'; title: string; text: string; dc?: number;
  resolved: boolean; result: string; stolen: boolean; restUsed: boolean; purchases: Partial<Record<ItemId, number>>;
}
export interface EnemyState {
  id: string; definitionId: string; teamId: string; name: string; hp: number; maxHp: number;
  attack: number; armor: number; speed: number; boss: boolean; phase: 1 | 2;
  statuses: { id: 'poison' | 'burn'; value: number; remaining: number; sourceId: string }[];
}
export interface BattleState {
  round: number; maxAp: 3; plan: CombatAction[]; enemy: EnemyState; shield: number; evade: number; hidden: boolean;
  cooldowns: Partial<Record<SkillId, number>>; sunder: number; freezeUsed: boolean;
  berserk: number; chill: number; chillTurns: number; stun: number; weaken?: number;
  dodgeBonus: number;
  selfSunder?: number; selfAttackBonus?: number;
}
export interface CheckResult {
  roll: number; bonus: number; total: number; dc: number; attr: Attribute; success: boolean;
  outcome: 'criticalSuccess' | 'success' | 'failure' | 'criticalFailure';
}
export interface LogEntry {
  id: number; kind: string; title: string; text: string; chapter: number; node: number; round: number;
}
export interface GameState {
  version: 3; id: string; seed: number; rng: number; revision: number; mode: 'solo';
  status: 'active' | 'dead' | 'won'; campaignId: CampaignId; chapter: number; node: number;
  player: CharacterState; stance: Stance; chapterUses: Partial<Record<SkillId, number>>;
  pendingGrowth: boolean; entryGrowthClaimed: boolean;
  completed: { chapter: number; node: number; mapNodeId?: string; type: NodeType; result: string }[];
  map: ChapterMap;
  encounter: EncounterState; battle: BattleState | null; log: LogEntry[]; logId: number;
  metrics: { kills: number; checks: number; passed: number; spent: number; damage: number };
  ending: string | null; lastCheck?: CheckResult | null;
  enemyRecords: Record<string, EnemyRecord>;
}
export interface EnemyRecord { seen: number; kills: number }
export interface EnemyDefinition {
  id: string; name: string; chapter: number; type: 'combat' | 'elite' | 'boss'; campaignId: CampaignId | null;
  hp: number; attack: number; armor: number; speed: number; portrait: string; gold: number;
  description: string; tactic: string;
}
export interface EnemyCodex { entries: Record<string, EnemyRecord>; runId: string | null; snapshot: Record<string, EnemyRecord> }
export interface Preferences { leftCollapsed: boolean; rightCollapsed: boolean; soundEnabled: boolean; volume: number }
export type CombatAction = { kind: 'attack' | 'escape' | 'dodge' } | { kind: 'skill'; id: SkillId } | { kind: 'item'; id: ConsumableId };
export type GameCommand =
  | { type: 'choose'; id: 'accept' | 'class' | 'inspect' | 'pay' | 'leave' }
  | { type: 'advance'; nodeId?: string; route?: 'safe' | 'risk' }
  | { type: 'queueAction'; action: CombatAction }
  | { type: 'removeAction'; index: number }
  | { type: 'moveAction'; index: number; direction: -1 | 1 }
  | { type: 'clearPlan' | 'resolveRound' }
  | { type: 'stance'; id: Stance }
  | { type: 'item'; id: ConsumableId }
  | { type: 'buy'; id: ItemId }
  | { type: 'grow'; choice: 'power' | 'health' | 'sanity' }
  | { type: 'learn' | 'equip'; id: SkillId }
  | { type: 'rest'; choice: 'heal' | 'sanity' }
  | { type: 'explorationSkill'; id: SkillId; choice?: 'potion' | 'bomb' }
  | { type: 'leaveShop' };

export interface MapNode { id: string; depth: number; lane: number; type: NodeType; x: number; next: string[] }
export interface ChapterMap { nodes: MapNode[]; currentId: string; visited: string[] }
export interface DuelFighter {
  player: CharacterState; chapterUses: Partial<Record<SkillId, number>>; stance: Stance;
  plan: CombatAction[]; submitted: boolean; shield: number; evade: number; hidden: boolean;
  dodgeBonus: number; sunder: number; weaken: number; chill: number; chillTurns: number;
  stun: number; berserk: number; freezeUsed: boolean; statuses: EnemyState['statuses']; attackBonus?: number;
}
export interface DuelResult { winner: 0 | 1 | null; reason: string }
export interface DuelState {
  chapter: number; rng: number; round: number; initiative: number; deadline: number;
  fighters: [DuelFighter, DuelFighter]; log: LogEntry[]; logId: number; result: DuelResult | null;
}
export type RoomPhase = 'lobby' | 'pve' | 'duel' | 'chapter' | 'ended';
export type RoomCommand = GameCommand | { type: 'ready' | 'continueChapter' | 'leaveRoom' };
export interface RoomCommandRequest { commandId: string; expectedRevision: number; command: RoomCommand }
export interface RoomParticipant {
  name: string; classId: ClassId; ready: boolean; checkpoint: boolean; continued: boolean;
  score: number; chapter: number; node: number; mapNodeId?: string; path: string[];
  status: GameState['status'] | 'waiting'; hp: number; maxHp: number; level: number; submitted: boolean;
}
export interface DuelDisplayRun extends Omit<GameState, 'battle'> {
  battle: Omit<BattleState, 'enemy'> & { enemy: Omit<EnemyState, 'definitionId' | 'speed'> & { classId: ClassId; dodge: number; shield: number } };
}
export interface RoomSnapshot {
  id: string; version: number; phase: RoomPhase; chapter: number; campaignId: CampaignId;
  you: number; seatVersion: number; run: GameState | DuelDisplayRun | null;
  participants: RoomParticipant[]; endReason: string;
  results: (DuelResult & { chapter: number; rounds: number })[];
  duel: { round: number; deadline: number; first: number; result: DuelResult | null; log: LogEntry[] } | null;
  inviteUrl: string; qr: string;
  token?: string; // Returned only on create/join, never in peer state or invite URL.
}
