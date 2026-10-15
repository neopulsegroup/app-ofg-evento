import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import webpush from 'web-push';
import { EVENT, SESSIONS, SPONSORS, FAQS, INTERESTS, POINTS } from './event-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin-ofg-2026';
const SECRET = process.env.APP_SECRET || 'troque-este-segredo';
const TZ_OFFSET = '-03:00'; // Recife

// ---------- VAPID (Web Push) ----------
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
let vapid = process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE ? { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE } : null;
if (!vapid) {
  try { vapid = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')); } catch {
    vapid = webpush.generateVAPIDKeys();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid));
  }
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:eventos@oportofortegroup.com', vapid.publicKey, vapid.privateKey);

// ---------- persistência (ficheiro JSON; suficiente para ~250 pessoas) ----------
const emptyDb = () => ({ users: {}, connections: [], messages: [], announcements: [], polls: [], questions: [], notified: {} });
let db = emptyDb();
try { db = { ...emptyDb(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch {}
let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db));
    fs.renameSync(DB_FILE + '.tmp', DB_FILE);
  }, 200);
};
const id = () => crypto.randomBytes(6).toString('hex');
const now = () => Date.now();

// ---------- helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});
const clean = (s, n = 200) => String(s ?? '').trim().slice(0, n);
const dayCode = (dayId) => crypto.createHmac('sha256', SECRET).update('checkin:' + dayId).digest('hex').slice(0, 8).toUpperCase();
const sessionStart = (s) => {
  const day = EVENT.days.find((d) => d.id === s.day);
  return new Date(`${day.date}T${s.start}:00${TZ_OFFSET}`).getTime();
};

const publicUser = (u) => u && ({ id: u.id, name: u.name, company: u.company, role: u.role, interests: u.interests, points: u.points, checkedIn: Object.keys(u.checkins).length > 0 });
const addPoints = (u, key) => { u.points += POINTS[key] || 0; };

// ---------- websockets ----------
const sockets = new Map(); // userId -> Set<ws>
const emit = (userId, msg) => { for (const w of sockets.get(userId) || []) if (w.readyState === 1) w.send(JSON.stringify(msg)); };
const broadcast = (msg) => { for (const set of sockets.values()) for (const w of set) if (w.readyState === 1) w.send(JSON.stringify(msg)); };
const notify = (userId, n) => {
  const u = db.users[userId]; if (!u) return;
  const item = { id: id(), at: now(), read: false, ...n };
  u.notifications.unshift(item);
  u.notifications = u.notifications.slice(0, 50);
  emit(userId, { type: 'notification', item });
  const payload = JSON.stringify({ title: item.title, body: item.body, tag: item.kind + (item.sessionId || item.userId || ''), kind: item.kind });
  for (const sub of u.pushSubs || []) {
    webpush.sendNotification(sub, payload, { TTL: 3600 }).catch((e) => {
      if (e.statusCode === 404 || e.statusCode === 410) u.pushSubs = u.pushSubs.filter((x) => x.endpoint !== sub.endpoint);
    });
  }
  save();
};

// lembretes "a sessão começa em 10 min" para quem marcou como favorita
setInterval(() => {
  const t = now();
  for (const s of SESSIONS) {
    const diff = sessionStart(s) - t;
    if (diff > 0 && diff <= 10 * 60000 && !db.notified[s.id]) {
      db.notified[s.id] = true;
      for (const u of Object.values(db.users)) {
        if (u.favorites.includes(s.id)) notify(u.id, { kind: 'reminder', title: 'Começa em 10 min', body: `${s.title} · ${s.room}`, sessionId: s.id });
      }
      save();
    }
  }
}, 30000);

// ---------- API ----------
const authUser = (req) => {
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  return Object.values(db.users).find((u) => u.token && u.token === tok);
};

const connBetween = (a, b) => db.connections.find((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));

const similarity = (a, b) => a.interests.filter((i) => b.interests.includes(i)).length;

async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const body = m === 'GET' ? {} : await readBody(req);

  // ---- admin ----
  if (p.startsWith('/api/admin/')) {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return send(res, 401, { error: 'Chave admin inválida' });
    if (p === '/api/admin/stats') {
      const us = Object.values(db.users);
      return send(res, 200, { users: us.length, checkedIn: us.filter((u) => Object.keys(u.checkins).length).length, connections: db.connections.filter((c) => c.status === 'accepted').length, messages: db.messages.length, questions: db.questions.length, codes: EVENT.days.map((d) => ({ day: d.id, title: d.title, date: d.date, code: dayCode(d.id) })), polls: db.polls, openQuestions: db.questions });
    }
    if (p === '/api/admin/announce' && m === 'POST') {
      const a = { id: id(), at: now(), title: clean(body.title, 80), body: clean(body.body, 400), kind: clean(body.kind, 20) || 'info' };
      if (!a.title) return send(res, 400, { error: 'Título obrigatório' });
      db.announcements.unshift(a); save();
      broadcast({ type: 'announcement', item: a });
      for (const u of Object.values(db.users)) notify(u.id, { kind: 'announcement', title: a.title, body: a.body });
      return send(res, 200, a);
    }
    if (p === '/api/admin/poll' && m === 'POST') {
      const options = (body.options || []).map((o) => clean(o, 80)).filter(Boolean).slice(0, 6);
      const q = clean(body.question, 200);
      if (!q || options.length < 2) return send(res, 400, { error: 'Pergunta e 2+ opções' });
      const poll = { id: id(), sessionId: clean(body.sessionId, 20), question: q, options, votes: {}, open: true, at: now() };
      db.polls.unshift(poll); save();
      broadcast({ type: 'poll' });
      return send(res, 200, poll);
    }
    if (p === '/api/admin/poll/close' && m === 'POST') {
      const poll = db.polls.find((x) => x.id === body.id); if (poll) poll.open = false; save();
      broadcast({ type: 'poll' });
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'not found' });
  }

  // ---- público ----
  if (p === '/api/event') {
    return send(res, 200, { event: EVENT, sessions: SESSIONS, sponsors: SPONSORS, faqs: FAQS, interests: INTERESTS, announcements: db.announcements.slice(0, 30), points: POINTS });
  }
  if (p === '/api/register' && m === 'POST') {
    const name = clean(body.name, 80), email = clean(body.email, 120).toLowerCase();
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Nome e email válidos são obrigatórios' });
    if (Object.values(db.users).some((u) => u.email === email)) return send(res, 409, { error: 'Este email já está registado. Use "Já tenho conta".' });
    const u = { id: id(), token: crypto.randomBytes(24).toString('hex'), name, email, company: clean(body.company, 80), role: clean(body.role, 80), linkedin: clean(body.linkedin, 200), phone: '', interests: (body.interests || []).filter((i) => INTERESTS.includes(i)).slice(0, 8), favorites: [], pushSubs: [], checkins: {}, points: 0, notifications: [], createdAt: now() };
    addPoints(u, 'profile');
    db.users[u.id] = u; save();
    broadcast({ type: 'leaderboard' });
    return send(res, 200, { token: u.token });
  }
  if (p === '/api/login' && m === 'POST') {
    const email = clean(body.email, 120).toLowerCase();
    const u = Object.values(db.users).find((x) => x.email === email);
    if (!u) return send(res, 404, { error: 'Email não encontrado' });
    return send(res, 200, { token: u.token });
  }

  const me = authUser(req);
  if (!me) return send(res, 401, { error: 'Sessão inválida' });

  if (p === '/api/push/key') return send(res, 200, { key: vapid.publicKey });
  if (p === '/api/push/subscribe' && m === 'POST') {
    const sub = body.subscription;
    if (!sub?.endpoint || !sub.keys) return send(res, 400, { error: 'Subscrição inválida' });
    me.pushSubs = [...(me.pushSubs || []).filter((x) => x.endpoint !== sub.endpoint), { endpoint: sub.endpoint, keys: sub.keys }].slice(-5);
    save(); return send(res, 200, { ok: true });
  }
  if (p === '/api/push/unsubscribe' && m === 'POST') { me.pushSubs = (me.pushSubs || []).filter((x) => x.endpoint !== body.endpoint); save(); return send(res, 200, { ok: true }); }
  if (p === '/api/me' && m === 'GET') return send(res, 200, { ...me, token: undefined, pushSubs: undefined, notifications: undefined });
  if (p === '/api/me' && m === 'PUT') {
    for (const k of ['name', 'company', 'role', 'linkedin']) if (body[k] !== undefined) me[k] = clean(body[k], 120) || me[k];
    if (Array.isArray(body.interests)) me.interests = body.interests.filter((i) => INTERESTS.includes(i)).slice(0, 8);
    save(); return send(res, 200, { ok: true });
  }
  if (p === '/api/people') {
    const q = clean(url.searchParams.get('q')).toLowerCase();
    const list = Object.values(db.users).filter((u) => u.id !== me.id)
      .filter((u) => !q || [u.name, u.company, u.role, ...u.interests].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100)
      .map((u) => ({ ...publicUser(u), conn: connBetween(me.id, u.id)?.status || null, incoming: connBetween(me.id, u.id)?.to === me.id }));
    return send(res, 200, list);
  }
  if (p === '/api/suggestions') {
    const list = Object.values(db.users).filter((u) => u.id !== me.id && !connBetween(me.id, u.id))
      .map((u) => ({ ...publicUser(u), shared: me.interests.filter((i) => u.interests.includes(i)), score: similarity(me, u) }))
      .filter((u) => u.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
    return send(res, 200, list);
  }
  if (p === '/api/favorite' && m === 'POST') {
    const sid = clean(body.sessionId, 20);
    if (!SESSIONS.some((s) => s.id === sid)) return send(res, 400, { error: 'Sessão inválida' });
    if (me.favorites.includes(sid)) me.favorites = me.favorites.filter((f) => f !== sid);
    else { me.favorites.push(sid); addPoints(me, 'favorite'); }
    save(); return send(res, 200, { favorites: me.favorites });
  }
  if (p === '/api/connect' && m === 'POST') {
    const to = db.users[body.to];
    if (!to || to.id === me.id) return send(res, 400, { error: 'Participante inválido' });
    const existing = connBetween(me.id, to.id);
    if (existing) {
      if (existing.status === 'pending' && existing.to === me.id) { existing.status = 'accepted'; addPoints(me, 'connect'); addPoints(to, 'connect'); }
      save(); emit(to.id, { type: 'connections' }); return send(res, 200, existing);
    }
    const c = { id: id(), from: me.id, to: to.id, status: 'pending', at: now() };
    db.connections.push(c); save();
    notify(to.id, { kind: 'connect', title: 'Novo pedido de conexão', body: `${me.name}${me.company ? ' · ' + me.company : ''} quer conectar` });
    emit(to.id, { type: 'connections' });
    return send(res, 200, c);
  }
  if (p === '/api/connect/respond' && m === 'POST') {
    const c = db.connections.find((x) => x.id === body.id && x.to === me.id && x.status === 'pending');
    if (!c) return send(res, 404, { error: 'Pedido não encontrado' });
    if (body.accept) {
      c.status = 'accepted'; addPoints(me, 'connect'); addPoints(db.users[c.from], 'connect');
      notify(c.from, { kind: 'connect', title: 'Conexão aceite', body: `${me.name} aceitou o seu pedido` });
      broadcast({ type: 'leaderboard' });
    } else db.connections = db.connections.filter((x) => x !== c);
    save(); emit(c.from, { type: 'connections' });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/connections') {
    const list = db.connections.filter((c) => c.from === me.id || c.to === me.id).map((c) => {
      const other = db.users[c.from === me.id ? c.to : c.from];
      const accepted = c.status === 'accepted';
      return { id: c.id, status: c.status, incoming: c.to === me.id, user: { ...publicUser(other), ...(accepted ? { email: other.email, linkedin: other.linkedin } : {}) }, lastMessage: accepted ? db.messages.filter((x) => (x.from === me.id && x.to === other.id) || (x.from === other.id && x.to === me.id)).at(-1) || null : null };
    });
    return send(res, 200, list);
  }
  if (p.startsWith('/api/messages/') && m === 'GET') {
    const other = p.split('/')[3];
    if (connBetween(me.id, other)?.status !== 'accepted') return send(res, 403, { error: 'Sem conexão' });
    return send(res, 200, db.messages.filter((x) => (x.from === me.id && x.to === other) || (x.from === other && x.to === me.id)).slice(-200));
  }
  if (p === '/api/messages' && m === 'POST') {
    const text = clean(body.text, 1000);
    if (!text || connBetween(me.id, body.to)?.status !== 'accepted') return send(res, 400, { error: 'Mensagem inválida' });
    const msg = { id: id(), from: me.id, to: body.to, text, at: now() };
    db.messages.push(msg); addPoints(me, 'message'); save();
    emit(body.to, { type: 'message', item: msg });
    emit(me.id, { type: 'message', item: msg });
    notify(body.to, { kind: 'message', title: me.name, body: text.slice(0, 80), userId: me.id });
    return send(res, 200, msg);
  }
  if (p === '/api/checkin' && m === 'POST') {
    const code = clean(body.code, 20).toUpperCase();
    const day = EVENT.days.find((d) => dayCode(d.id) === code);
    if (!day) return send(res, 400, { error: 'Código de check-in inválido' });
    if (!me.checkins[day.id]) { me.checkins[day.id] = now(); addPoints(me, 'checkin'); save(); broadcast({ type: 'leaderboard' }); }
    return send(res, 200, { day: day.id, title: day.title, checkins: me.checkins });
  }
  if (p === '/api/polls') {
    return send(res, 200, db.polls.map((x) => ({ id: x.id, sessionId: x.sessionId, question: x.question, options: x.options, open: x.open, counts: x.options.map((_, i) => Object.values(x.votes).filter((v) => v === i).length), myVote: x.votes[me.id] ?? null })));
  }
  if (p === '/api/polls/vote' && m === 'POST') {
    const poll = db.polls.find((x) => x.id === body.pollId);
    const opt = Number(body.option);
    if (!poll || !poll.open || !(opt >= 0 && opt < poll.options.length)) return send(res, 400, { error: 'Votação indisponível' });
    if (poll.votes[me.id] === undefined) addPoints(me, 'vote');
    poll.votes[me.id] = opt; save();
    broadcast({ type: 'poll' });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/questions' && m === 'GET') {
    const sid = url.searchParams.get('session');
    return send(res, 200, db.questions.filter((q) => !sid || q.sessionId === sid).sort((a, b) => b.upvotes.length - a.upvotes.length || b.at - a.at)
      .map((q) => ({ id: q.id, sessionId: q.sessionId, text: q.text, author: q.anonymous ? 'Anónimo' : db.users[q.userId]?.name, votes: q.upvotes.length, mine: q.upvotes.includes(me.id) })));
  }
  if (p === '/api/questions' && m === 'POST') {
    const text = clean(body.text, 300);
    if (!text || !SESSIONS.some((s) => s.id === body.sessionId)) return send(res, 400, { error: 'Pergunta inválida' });
    db.questions.push({ id: id(), sessionId: body.sessionId, userId: me.id, text, anonymous: !!body.anonymous, upvotes: [], at: now() });
    addPoints(me, 'question'); save();
    broadcast({ type: 'questions' });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/questions/upvote' && m === 'POST') {
    const q = db.questions.find((x) => x.id === body.id);
    if (!q) return send(res, 404, { error: 'não encontrada' });
    q.upvotes = q.upvotes.includes(me.id) ? q.upvotes.filter((x) => x !== me.id) : [...q.upvotes, me.id];
    save(); broadcast({ type: 'questions' });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/leaderboard') {
    const top = Object.values(db.users).sort((a, b) => b.points - a.points).slice(0, 20).map((u) => ({ id: u.id, name: u.name, company: u.company, points: u.points }));
    const rank = Object.values(db.users).sort((a, b) => b.points - a.points).findIndex((u) => u.id === me.id) + 1;
    return send(res, 200, { top, rank, points: me.points });
  }
  if (p === '/api/notifications') {
    if (m === 'POST') { me.notifications.forEach((n) => (n.read = true)); save(); }
    return send(res, 200, me.notifications);
  }
  return send(res, 404, { error: 'not found' });
}

// ---------- servidor HTTP + estáticos ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
    if (file.endsWith('sw.js')) headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Erro interno' });
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const tok = new URL(req.url, 'http://x').searchParams.get('token');
  const u = Object.values(db.users).find((x) => x.token === tok);
  if (!u) return ws.close(4001);
  if (!sockets.has(u.id)) sockets.set(u.id, new Set());
  sockets.get(u.id).add(ws);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('close', () => sockets.get(u.id)?.delete(ws));
});
setInterval(() => wss.clients.forEach((w) => { if (!w.isAlive) return w.terminate(); w.isAlive = false; w.ping(); }), 30000);

server.listen(PORT, () => console.log(`App OFG a correr em http://localhost:${PORT}  (admin: /admin.html, chave: ${ADMIN_KEY})`));
