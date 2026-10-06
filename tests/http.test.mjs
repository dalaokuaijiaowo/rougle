import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createGameServer } from '../http-server.mjs';

test('HTTP rooms persist across server restarts, enforce auth/origin/version, and keep private files private', async () => {
  const dataFile = path.resolve(`test-results/rooms-http-${Date.now()}.json`);
  let app = await createGameServer({ dataFile, publicOrigin: 'https://example.test' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let origin = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (pathname, data, token, headers = {}) => {
    const response = await fetch(origin + pathname, { method: data ? 'POST' : 'GET', headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, data: await response.json() };
  };
  const nonce = () => randomBytes(24).toString('hex');
  try {
    const ownerInput = { name: 'Owner', classId: 'warrior', campaignId: 'cult', nonce: nonce() };
    const host = await request('/api/rooms', ownerInput);
    assert.equal(host.status, 200); assert.match(host.data.qr, /^data:image\/png;base64,/);
    assert.equal(host.data.inviteUrl, `https://example.test/?room=${host.data.id}`);
    const repeated = await request('/api/rooms', ownerInput); assert.equal(repeated.data.token, host.data.token);
    const id = host.data.id, token = host.data.token;
    const guest = await request(`/api/rooms/${id}/join`, { name: 'Guest', classId: 'rogue', nonce: nonce() }); assert.equal(guest.status, 200);
    assert.equal((await request(`/api/rooms/${id}`)).status, 401);
    assert.equal((await request(`/api/rooms/${id}`, null, 'bad')).status, 401);
    assert.equal((await request(`/api/rooms/${id}/join`, { classId: 'mage', nonce: nonce() })).status, 400);
    const state = (await request(`/api/rooms/${id}`, null, token)).data;
    const cmd = { commandId: nonce(), expectedRevision: state.seatVersion, command: { type: 'ready' } };
    const ready = await request(`/api/rooms/${id}/commands`, cmd, token); assert.equal(ready.status, 200);
    const twice = await request(`/api/rooms/${id}/commands`, cmd, token); assert.equal(twice.data.seatVersion, ready.data.seatVersion);
    assert.equal((await request(`/api/rooms/${id}/commands`, { ...cmd, commandId: nonce() }, token)).status, 409);
    assert.equal((await request(`/api/rooms/${id}/commands`, cmd, token, { Origin: 'https://evil.test' })).status, 403);
    for (const name of ['/.local/rooms.json', '/rooms.mjs', '/http-server.mjs', '/package.json', '/test-results/rooms.json']) assert.equal((await fetch(origin + name)).status, 403);
    const page = await fetch(origin + '/'); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    await app.flush(); await new Promise(resolve => app.server.close(resolve));
    app = await createGameServer({ dataFile, publicOrigin: 'https://example.test' });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${app.server.address().port}`;
    const restored = await request(`/api/rooms/${id}`, null, token);
    assert.equal(restored.status, 200); assert.equal(restored.data.participants[0].ready, true);
    assert.equal(restored.data.participants.length, 2); assert.equal(restored.data.seatVersion, ready.data.seatVersion);
  } finally { await app.flush(); await new Promise(resolve => app.server.close(resolve)); }
});
