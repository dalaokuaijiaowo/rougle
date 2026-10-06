import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import QRCode from 'qrcode';
import { RoomService } from './rooms.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('仅接受 JSON 请求');
  let bytes = 0, data = '';
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 16384) throw new Error('请求过大'); data += chunk; }
  return JSON.parse(data);
}
export async function createGameServer({ dataFile = path.join(root, '.local', 'rooms.json'), publicOrigin = '', lan = false } = {}) {
  if (publicOrigin && !/^https?:\/\/[^\s/]+\/?$/.test(publicOrigin)) throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without a path');
  let saved = [];
  try { saved = JSON.parse(await readFile(dataFile, 'utf8')); if (!Array.isArray(saved)) throw new Error('Invalid room store'); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot load room store: ${error.message}`); }
  const rooms = new RoomService(saved), qrCache = new Map(), rates = new Map();
  let chain = Promise.resolve();
  const persist = async () => {
    await mkdir(path.dirname(dataFile), { recursive: true });
    await writeFile(dataFile + '.tmp', JSON.stringify([...rooms.rooms.values()]), { mode: 0o600 });
    await rename(dataFile + '.tmp', dataFile);
  };
  const transaction = task => {
    const result = chain.then(async () => {
      const before = structuredClone([...rooms.rooms.values()]);
      try { return await task(); } catch (error) { rooms.rooms = new Map(before.map(r => [r.id, r])); throw error; }
    });
    chain = result.catch(() => {}); return result;
  };
  const originFor = req => {
    if (publicOrigin) return publicOrigin.replace(/\/$/, '');
    const host = req.headers.host || 'localhost';
    if (!/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d+)?$/i.test(host)) throw new Error('无效主机地址');
    if (lan && /^(localhost|127\.0\.0\.1)(:|$)/.test(host)) {
      const ip = Object.values(os.networkInterfaces()).flat().find(n => n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'))?.address;
      if (ip) return `http://${ip}:${server.address().port}`;
    }
    return `http://${host}`;
  };
  const decorate = async (req, room, index) => {
    const snapshot = rooms.snapshot(room, index), inviteUrl = `${originFor(req)}/?room=${room.id}`;
    if (!qrCache.has(inviteUrl)) { if (qrCache.size > 256) qrCache.clear(); qrCache.set(inviteUrl, await QRCode.toDataURL(inviteUrl, { width: 240, margin: 4, errorCorrectionLevel: 'M' })); }
    return { ...snapshot, inviteUrl, qr: qrCache.get(inviteUrl) };
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.startsWith('/api/')) {
        const key = req.socket.remoteAddress, now = Date.now(), rate = rates.get(key) || { until: now + 60000, count: 0 };
        if (now > rate.until) { rate.count = 0; rate.until = now + 60000; } rate.count++; rates.set(key, rate);
        if (rates.size > 1000) for (const [ip, value] of rates) if (value.until < now) rates.delete(ip);
        if (rate.count > 600) { json(res, 429, { error: '请求过于频繁，请稍后重试' }); return; }
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== publicOrigin.replace(/\/$/, '')) { json(res, 403, { error: '不接受跨站请求' }); return; }
        if (pathname === '/api/config' && req.method === 'GET') { json(res, 200, { multiplayer: true, inviteOrigin: originFor(req), configuredOrigin: !!publicOrigin, lan }); return; }
        await transaction(async () => {
          let result, credentials = false;
          if (pathname === '/api/rooms' && req.method === 'POST') { result = rooms.create(await body(req)); credentials = true; }
          else {
            const match = pathname.match(/^\/api\/rooms\/([a-f0-9]{12})(?:\/(join|commands))?$/);
            if (!match) { json(res, 404, { error: '接口不存在' }); return; }
            const [, id, action] = match;
            if (action === 'join' && req.method === 'POST') { result = rooms.join(id, await body(req)); credentials = true; }
            else {
              const bearer = req.headers.authorization?.replace(/^Bearer /, ''), room = rooms.get(id), index = rooms.authenticate(room, bearer);
              if (action === 'commands' && req.method === 'POST') result = rooms.command(id, bearer, await body(req));
              else if (!action && req.method === 'GET') result = { room, index };
              else throw new Error('无效请求方法');
            }
          }
          if (req.method === 'POST') await persist();
          const data = await decorate(req, result.room, result.index);
          json(res, 200, { ...data, ...(credentials ? { token: result.room.seats[result.index].token } : {}) });
        }); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const allowed = pathname === '/' || pathname === '/index.html' || /^\/(src|assets|vendor)\/[\w./-]+$/.test(pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)), relative = path.relative(root, file);
      if (!allowed || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(p => p.startsWith('.')) || !types[path.extname(file)]) { res.writeHead(403); res.end('Forbidden'); return; }
      const content = await readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (res.headersSent) return;
      if (req.url.startsWith('/api/')) json(res, error.message.includes('凭据无效') ? 401 : error.message.includes('状态已更新') ? 409 : error.code ? 503 : 400, { error: error.code ? '房间保存失败，请稍后重试' : error.message });
      else { res.writeHead(404); res.end('Not found'); }
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  const timer = setInterval(() => { transaction(async () => { if (rooms.tick()) await persist(); }).catch(error => console.error('Room checkpoint failed:', error.message)); }, 1000);
  timer.unref(); server.on('close', () => clearInterval(timer));
  return { server, rooms, flush: () => chain };
}
