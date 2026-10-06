export class SoundEffects {
  constructor({ enabled = true, volume = .45 } = {}) {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    this.context = null;
    this.master = null;
  }
  async unlock() {
    try {
      if (!this.context) {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return false;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.enabled ? this.volume * .35 : 0;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') await this.context.resume();
      return this.context.state === 'running';
    } catch { return false; }
  }
  configure(enabled, volume = this.volume) {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(enabled ? this.volume * .35 : 0, now);
    }
  }
  tone(frequency, duration, type, when, end = frequency, strength = .5) {
    const osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), when + duration);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(strength, when + .006);
    gain.gain.exponentialRampToValueAtTime(.001, when + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(when); osc.stop(when + duration + .015);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  play(cue, delay = 0) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return false;
    const now = this.context.currentTime + delay;
    const tone = (f, d, t = 'sine', offset = 0, end = f, gain = .5) => this.tone(f, d, t, now + offset, end, gain);
    if (cue === 'click') tone(620, .055, 'sine', 0, 480, .2);
    else if (cue === 'queue') { tone(390, .08, 'triangle'); tone(590, .07, 'sine', .05, 690, .3); }
    else if (cue === 'attack') { tone(180, .14, 'triangle', 0, 45, .9); tone(1100, .07, 'sawtooth', 0, 150, .12); }
    else if (cue === 'hurt') tone(95, .22, 'triangle', 0, 36, .9);
    else if (cue === 'cast') { tone(420, .2, 'sine', 0, 1300, .4); tone(840, .23, 'triangle', .07, 1400, .15); }
    else if (cue === 'shield') { tone(260, .35, 'sine', 0, 280, .5); tone(780, .25, 'sine', .035, 800, .25); }
    else if (cue === 'heal') [523, 659, 784].forEach((f, i) => tone(f, .2, 'sine', i * .09, f, .3));
    else if (cue === 'coin') { tone(1200, .12, 'sine'); tone(1700, .2, 'sine', .065); }
    else if (cue === 'fail') { tone(230, .14, 'triangle'); tone(155, .2, 'triangle', .12); }
    else if (cue === 'victory' || cue === 'level') [392, 494, 587, 784].forEach((f, i) => tone(f, .34, 'triangle', i * .11, f, .35));
    else if (cue === 'death') [220, 185, 147, 110].forEach((f, i) => tone(f, .5, 'sine', i * .19, f / 1.1, .5));
    return true;
  }
  playLog(entries) {
    let delay = 0;
    for (const entry of entries) {
      let cue;
      if (entry.kind === 'death') cue = 'death';
      else if (entry.kind === 'combat') cue = entry.title.includes('未命中') ? 'click' : entry.title.includes('普通攻击') || entry.title.includes('背刺') || entry.title.includes('重击') || entry.title.includes('猛击') ? 'attack' : 'cast';
      else if (entry.kind === 'damage') cue = entry.title.includes('检定') || entry.title.includes('失败') ? 'fail' : 'hurt';
      else if (entry.kind === 'check') cue = 'coin';
      else if (entry.kind === 'item') cue = entry.title.includes('购入') ? 'coin' : entry.title.includes('震爆') ? 'attack' : 'heal';
      else if (entry.kind === 'skill') cue = entry.title.includes('盾') || entry.title.includes('不屈') ? 'shield' : 'cast';
      else if (entry.title.startsWith('晋升')) cue = 'level';
      else if (entry.kind === 'reward') cue = 'victory';
      if (cue) { this.play(cue, delay); delay += cue === 'death' ? .6 : .14; }
    }
  }
}
