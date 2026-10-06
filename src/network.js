const KEY = 'ashfall.room.session.v1';
export const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join('');
export class RoomClient {
  constructor(onUpdate, onError) {
    this.onUpdate = onUpdate; this.onError = onError; this.snapshot = null; this.pending = false; this.timer = null;
    try { this.credentials = JSON.parse(sessionStorage.getItem(KEY)); } catch { this.credentials = null; }
  }
  async request(path, body) {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(this.credentials ? { Authorization: `Bearer ${this.credentials.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    let result; try { result = await response.json(); } catch { throw new Error('联机服务尚未启动，请检查服务地址'); }
    if (!response.ok) throw new Error(result.error || '联机请求失败'); return result;
  }
  accept(snapshot) {
    if (this.snapshot && snapshot.id === this.snapshot.id && snapshot.version < this.snapshot.version) return;
    const changed = !this.snapshot || snapshot.version !== this.snapshot.version || snapshot.id !== this.snapshot.id;
    this.snapshot = snapshot; if (changed) this.onUpdate(snapshot);
  }
  async enter({ id, classId, campaignId, name }) {
    const data = { classId, campaignId, name, nonce: nonce() };
    const path = id ? `/api/rooms/${id}/join` : '/api/rooms';
    let snapshot;
    try { snapshot = await this.request(path, data); } catch (error) {
      // A retry uses the same nonce, so a lost response cannot claim a second seat.
      if (error instanceof TypeError || error.name === 'TimeoutError') snapshot = await this.request(path, data); else throw error;
    }
    this.credentials = { id: snapshot.id, token: snapshot.token }; sessionStorage.setItem(KEY, JSON.stringify(this.credentials));
    this.accept(snapshot); this.schedule(); return snapshot;
  }
  async refresh() {
    const credentials = this.credentials;
    if (credentials) { const result = await this.request(`/api/rooms/${credentials.id}`); if (this.credentials === credentials) this.accept(result); }
  }
  async send(command) {
    if (this.pending) throw new Error('上一项行动仍在同步');
    this.pending = true;
    const request = { commandId: nonce(), expectedRevision: this.snapshot.seatVersion, command };
    try {
      let result;
      try { result = await this.request(`/api/rooms/${this.credentials.id}/commands`, request); }
      catch (error) {
        if (error instanceof TypeError || error.name === 'TimeoutError') result = await this.request(`/api/rooms/${this.credentials.id}/commands`, request); else throw error;
      }
      this.accept(result);
    } catch (error) { await this.refresh().catch(() => {}); throw error; }
    finally { this.pending = false; }
  }
  schedule() {
    clearTimeout(this.timer);
    if (!this.credentials) return;
    this.timer = setTimeout(async () => {
      try { if (!this.pending) await this.refresh(); this.onError(''); }
      catch { this.onError('连接中断，正在重连'); }
      this.schedule();
    }, 1500);
  }
  disconnect() { clearTimeout(this.timer); this.credentials = null; this.snapshot = null; sessionStorage.removeItem(KEY); }
}
