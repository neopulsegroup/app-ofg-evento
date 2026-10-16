// API serverless (Vercel). Sem websockets nem disco: dados no Redis e "tempo real" por polling leve (/api/sync).
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import webpush from 'web-push';
import { r, persistent } from './db.js';
import { EVENT, SESSIONS, SPONSORS, FAQS, INTERESTS, POINTS } from '../event-data.js';

const ADMIN_KEY = process.env.ADMIN_KEY;
const SECRET = process.env.APP_SECRET || 'dev-secret';
const TZ_OFFSET = '-03:00'; // Recife

let vapid = process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE ? { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE } : null;
if (!vapid && !persistent) vapid = webpush.generateVAPIDKeys(); // só em desenvolvimento
if (vapid) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:eventos@oportofortegroup.com', vapid.publicKey, vapid.privateKey);

// ids começam por letra: o Upstash desserializa strings numéricas e isso corromperia ids só com dígitos
const id = (p = 'x') => p + crypto.randomBytes(6).toString('hex');
const now = () => Date.now();
const clean = (s, n = 200) => String(s ?? '').trim().slice(0, n);
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const dayCode = (dayId) => crypto.createHmac('sha256', SECRET).update('checkin:' + dayId).digest('hex').slice(0, 8).toUpperCase();
const sessionStart = (s) => new Date(`${EVENT.days.find((d) => d.id === s.day).date}T${s.start}:00${TZ_OFFSET}`).getTime();

// ---- senhas e email ----
const scrypt = promisify(crypto.scrypt);
const hashPw = async (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${(await scrypt(pw, salt, 64)).toString('hex')}`; };
const checkPw = async (pw, stored) => {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex'), b = await scrypt(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const pinHash = (email, pin) => crypto.createHmac('sha256', SECRET).update(`pin:${email}:${pin}`).digest('hex');
const MAX_FAILS = 8, LOCK_MS = 10 * 60000;

async function sendMail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (persistent) throw new Error('Envio de email não configurado (RESEND_API_KEY)');
    console.log(`[dev email] para ${to}: ${subject}\n${html.replace(/<[^>]+>/g, ' ')}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'OFG Recife <onboarding@resend.dev>', to, subject, html }),
  });
  if (!res.ok) throw new Error('Falha ao enviar email');
}

// ---- acesso a dados ----
const getUser = (uid) => r.hget('users', uid);
const putUser = (u) => r.hset('users', { [u.id]: u });
const allUsers = async () => Object.values((await r.hgetall('users')) || {});
const allConns = async () => Object.values((await r.hgetall('conns')) || {});
const bump = (key) => r.incr(key);
const pairKey = (a, b) => 'msgs:' + [a, b].sort().join(':');
const between = (conns, a, b) => conns.find((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
const publicUser = (u) => u && ({ id: u.id, name: u.name, company: u.company, role: u.role, interests: u.interests, points: u.points, checkedIn: Object.keys(u.checkins).length > 0 });
const addPoints = (u, key) => { u.points += POINTS[key] || 0; };

const tokenCache = new Map(); // token -> userId (instância "quente"); evita 1 comando Redis por poll
async function authId(req) {
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  if (!tok) return null;
  if (tokenCache.has(tok)) return tokenCache.get(tok);
  const uid = await r.hget('tokens', tok);
  if (uid) tokenCache.set(tok, uid);
  return uid;
}

// ---- notificações (lista no Redis + contador uv:<id> + Web Push) ----
async function notifyMany(users, n) {
  if (!users.length) return;
  const item = { id: id('n'), at: now(), ...n };
  const p = r.pipeline();
  for (const u of users) { p.lpush(`notes:${u.id}`, item); p.ltrim(`notes:${u.id}`, 0, 49); p.incr(`uv:${u.id}`); }
  await p.exec();
  if (!vapid) return;
  const payload = JSON.stringify({ title: item.title, body: item.body, tag: item.kind + (item.sessionId || item.userId || '') });
  await Promise.allSettled(users.flatMap((u) => (u.pushSubs || []).map((sub) =>
    webpush.sendNotification(sub, payload, { TTL: 3600 }).catch(async (e) => {
      if (e.statusCode === 404 || e.statusCode === 410) { const fresh = await getUser(u.id); fresh.pushSubs = (fresh.pushSubs || []).filter((x) => x.endpoint !== sub.endpoint); await putUser(fresh); }
    }))));
}

// lembretes "começa em 10 min": SADD é atómico, só uma instância envia cada lembrete
async function reminders() {
  const t = now();
  for (const s of SESSIONS) {
    const diff = sessionStart(s) - t;
    if (diff > 0 && diff <= 10 * 60000 && (await r.sadd('notified', s.id))) {
      const fans = (await allUsers()).filter((u) => u.favorites.includes(s.id));
      await notifyMany(fans, { kind: 'reminder', title: 'Começa em 10 min', body: `${s.title} · ${s.room}`, sessionId: s.id });
    }
  }
}

export async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    let body = req.method === 'GET' ? {} : req.body ?? {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    await route(req, res, url, body);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Erro interno' });
  }
}

async function route(req, res, url, body) {
  const p = url.pathname.replace(/\/$/, '');
  const m = req.method;

  // ---- admin ----
  if (p.startsWith('/api/admin/')) {
    if (!ADMIN_KEY && persistent) return send(res, 503, { error: 'ADMIN_KEY não configurada' });
    if (req.headers['x-admin-key'] !== (ADMIN_KEY || 'admin-dev')) return send(res, 401, { error: 'Chave admin inválida' });
    if (p === '/api/admin/stats') {
      const [us, conns, polls, qs] = await Promise.all([allUsers(), allConns(), r.hgetall('polls'), r.hgetall('qs')]);
      return send(res, 200, { users: us.length, checkedIn: us.filter((u) => Object.keys(u.checkins).length).length, connections: conns.filter((c) => c.status === 'accepted').length, messages: us.reduce((a, u) => a + (u.sent || 0), 0), questions: Object.keys(qs || {}).length, codes: EVENT.days.map((d) => ({ day: d.id, title: d.title, date: d.date, code: dayCode(d.id) })), polls: Object.values(polls || {}).sort((a, b) => b.at - a.at), openQuestions: Object.values(qs || {}) });
    }
    if (p === '/api/admin/announce' && m === 'POST') {
      const a = { id: id('a'), at: now(), title: clean(body.title, 80), body: clean(body.body, 400), kind: clean(body.kind, 20) || 'info' };
      if (!a.title) return send(res, 400, { error: 'Título obrigatório' });
      await r.lpush('ann', a); await r.ltrim('ann', 0, 49); await bump('ver');
      await notifyMany(await allUsers(), { kind: 'announcement', title: a.title, body: a.body });
      return send(res, 200, a);
    }
    if (p === '/api/admin/poll' && m === 'POST') {
      const options = (body.options || []).map((o) => clean(o, 80)).filter(Boolean).slice(0, 6);
      const q = clean(body.question, 200);
      if (!q || options.length < 2) return send(res, 400, { error: 'Pergunta e 2+ opções' });
      const poll = { id: id('p'), sessionId: clean(body.sessionId, 20), question: q, options, votes: {}, open: true, at: now() };
      await r.hset('polls', { [poll.id]: poll }); await bump('ver');
      return send(res, 200, poll);
    }
    if (p === '/api/admin/poll/close' && m === 'POST') {
      const poll = await r.hget('polls', body.id);
      if (poll) { poll.open = false; await r.hset('polls', { [poll.id]: poll }); await bump('ver'); }
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'not found' });
  }

  // ---- público ----
  if (p === '/api/event') {
    const announcements = (await r.lrange('ann', 0, 29)) || [];
    return send(res, 200, { event: EVENT, sessions: SESSIONS, sponsors: SPONSORS, faqs: FAQS, interests: INTERESTS, announcements, points: POINTS });
  }
  if (p === '/api/register' && m === 'POST') {
    const name = clean(body.name, 80), email = clean(body.email, 120).toLowerCase(), company = clean(body.company, 80), role = clean(body.role, 80);
    const pw = String(body.password || '');
    if (!name || !company || !role || !/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Nome, email, empresa e cargo são obrigatórios' });
    if (pw.length < 8 || pw.length > 100) return send(res, 400, { error: 'A senha deve ter no mínimo 8 caracteres' });
    if (await r.hget('emails', email)) return send(res, 409, { error: 'Este email já está registado. Use "Já tenho conta".' });
    const u = { id: id('u'), name, email, company, role, linkedin: clean(body.linkedin, 200), pass: await hashPw(pw), fails: 0, interests: (body.interests || []).filter((i) => INTERESTS.includes(i)).slice(0, 8), favorites: [], pushSubs: [], checkins: {}, points: 0, sent: 0, createdAt: now() };
    const token = crypto.randomBytes(24).toString('hex');
    addPoints(u, 'profile');
    await Promise.all([putUser(u), r.hset('tokens', { [token]: u.id }), r.hset('emails', { [email]: u.id })]);
    return send(res, 200, { token });
  }
  if (p === '/api/login' && m === 'POST') {
    const email = clean(body.email, 120).toLowerCase();
    const bad = () => send(res, 401, { error: 'Email ou senha inválidos' });
    const uid0 = await r.hget('emails', email);
    const u = uid0 && (await getUser(uid0));
    if (!u) { await hashPw('x'); return bad(); } // custo semelhante, evita distinguir contas
    if (u.lockUntil && u.lockUntil > now()) return send(res, 429, { error: 'Demasiadas tentativas. Tente novamente em alguns minutos.' });
    if (!(await checkPw(String(body.password || ''), u.pass))) {
      u.fails = (u.fails || 0) + 1;
      if (u.fails >= MAX_FAILS) { u.lockUntil = now() + LOCK_MS; u.fails = 0; }
      await putUser(u); return bad();
    }
    if (u.fails || u.lockUntil) { u.fails = 0; u.lockUntil = 0; await putUser(u); }
    const token = crypto.randomBytes(24).toString('hex');
    await r.hset('tokens', { [token]: u.id });
    return send(res, 200, { token });
  }
  // recuperação: envia PIN de 6 dígitos + link; resposta sempre genérica (não revela se o email existe)
  if (p === '/api/recover' && m === 'POST') {
    const email = clean(body.email, 120).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Email inválido' });
    const uid0 = await r.hget('emails', email);
    if (uid0) {
      const prev = await r.get(`pin:${email}`);
      if (!prev || now() - prev.at > 60000) { // reenvio no mínimo a cada 60 s
        const pin = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
        await r.set(`pin:${email}`, { h: pinHash(email, pin), exp: now() + 15 * 60000, at: now(), tries: 0 });
        const base = process.env.PUBLIC_URL || `https://${req.headers.host}`;
        const link = `${base}/?reset=${encodeURIComponent(email)}`;
        try {
          await sendMail(email, 'OFG Recife 2026 · Recuperar acesso', `<p>O seu código de recuperação é <b style="font-size:22px;letter-spacing:4px">${pin}</b> (válido 15 minutos).</p><p><a href="${link}">Abrir a app para redefinir a senha</a></p><p>Se não pediu, ignore este email.</p>`);
        } catch (e) { return send(res, 503, { error: e.message }); }
      }
    }
    return send(res, 200, { ok: true });
  }
  if (p === '/api/reset' && m === 'POST') {
    const email = clean(body.email, 120).toLowerCase(), pin = clean(body.pin, 6), pw = String(body.password || '');
    if (pw.length < 8 || pw.length > 100) return send(res, 400, { error: 'A senha deve ter no mínimo 8 caracteres' });
    const rec = await r.get(`pin:${email}`);
    const fail = () => send(res, 400, { error: 'Código inválido ou expirado' });
    if (!rec || rec.exp < now() || rec.tries >= 5) return fail();
    if (rec.h !== pinHash(email, pin)) { await r.set(`pin:${email}`, { ...rec, tries: rec.tries + 1 }); return fail(); }
    const u = await getUser(await r.hget('emails', email));
    if (!u) return fail();
    u.pass = await hashPw(pw); u.fails = 0; u.lockUntil = 0;
    await putUser(u);
    await r.set(`pin:${email}`, { ...rec, exp: 0 });
    const token = crypto.randomBytes(24).toString('hex');
    await r.hset('tokens', { [token]: u.id });
    return send(res, 200, { token });
  }

  const uid = await authId(req);
  if (!uid) return send(res, 401, { error: 'Sessão inválida' });

  // polling leve: devolve só 2 contadores (1 comando Redis); o cliente refaz o fetch do que mudou
  if (p === '/api/sync') {
    const [ver, uv] = await r.mget('ver', `uv:${uid}`);
    reminders().catch((e) => console.error('reminders', e));
    return send(res, 200, { ver: +ver || 0, uv: +uv || 0 });
  }

  const me = await getUser(uid);
  if (!me) return send(res, 401, { error: 'Sessão inválida' });

  if (p === '/api/push/key') return send(res, 200, { key: vapid?.publicKey || null });
  if (p === '/api/push/subscribe' && m === 'POST') {
    const sub = body.subscription;
    if (!sub?.endpoint || !sub.keys) return send(res, 400, { error: 'Subscrição inválida' });
    me.pushSubs = [...(me.pushSubs || []).filter((x) => x.endpoint !== sub.endpoint), { endpoint: sub.endpoint, keys: sub.keys }].slice(-5);
    await putUser(me); return send(res, 200, { ok: true });
  }
  if (p === '/api/me' && m === 'GET') return send(res, 200, { ...me, pushSubs: undefined, pass: undefined, fails: undefined, lockUntil: undefined });
  if (p === '/api/me' && m === 'PUT') {
    for (const k of ['name', 'company', 'role', 'linkedin']) if (body[k] !== undefined) me[k] = clean(body[k], 120) || me[k];
    if (Array.isArray(body.interests)) me.interests = body.interests.filter((i) => INTERESTS.includes(i)).slice(0, 8);
    await putUser(me); return send(res, 200, { ok: true });
  }
  if (p === '/api/people') {
    const q = clean(url.searchParams.get('q')).toLowerCase();
    const [us, conns] = await Promise.all([allUsers(), allConns()]);
    const list = us.filter((u) => u.id !== me.id)
      .filter((u) => !q || [u.name, u.company, u.role, ...u.interests].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100)
      .map((u) => { const c = between(conns, me.id, u.id); return { ...publicUser(u), conn: c?.status || null, incoming: c?.to === me.id }; });
    return send(res, 200, list);
  }
  if (p === '/api/suggestions') {
    const [us, conns] = await Promise.all([allUsers(), allConns()]);
    const list = us.filter((u) => u.id !== me.id && !between(conns, me.id, u.id))
      .map((u) => ({ ...publicUser(u), shared: me.interests.filter((i) => u.interests.includes(i)) }))
      .map((u) => ({ ...u, score: u.shared.length })).filter((u) => u.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
    return send(res, 200, list);
  }
  if (p === '/api/favorite' && m === 'POST') {
    const sid = clean(body.sessionId, 20);
    if (!SESSIONS.some((s) => s.id === sid)) return send(res, 400, { error: 'Sessão inválida' });
    if (me.favorites.includes(sid)) me.favorites = me.favorites.filter((f) => f !== sid);
    else { me.favorites.push(sid); addPoints(me, 'favorite'); }
    await putUser(me); return send(res, 200, { favorites: me.favorites });
  }
  if (p === '/api/connect' && m === 'POST') {
    const [to, conns] = await Promise.all([getUser(body.to), allConns()]);
    if (!to || to.id === me.id) return send(res, 400, { error: 'Participante inválido' });
    const existing = between(conns, me.id, to.id);
    if (existing) {
      if (existing.status === 'pending' && existing.to === me.id) {
        existing.status = 'accepted'; addPoints(me, 'connect'); addPoints(to, 'connect');
        await Promise.all([r.hset('conns', { [existing.id]: existing }), putUser(me), putUser(to), bump(`uv:${to.id}`)]);
      }
      return send(res, 200, existing);
    }
    const c = { id: id('c'), from: me.id, to: to.id, status: 'pending', at: now() };
    await r.hset('conns', { [c.id]: c });
    await notifyMany([to], { kind: 'connect', title: 'Novo pedido de conexão', body: `${me.name}${me.company ? ' · ' + me.company : ''} quer conectar` });
    return send(res, 200, c);
  }
  if (p === '/api/connect/respond' && m === 'POST') {
    const c = await r.hget('conns', body.id);
    if (!c || c.to !== me.id || c.status !== 'pending') return send(res, 404, { error: 'Pedido não encontrado' });
    if (body.accept) {
      const from = await getUser(c.from);
      c.status = 'accepted'; addPoints(me, 'connect'); addPoints(from, 'connect');
      await Promise.all([r.hset('conns', { [c.id]: c }), putUser(me), putUser(from)]);
      await notifyMany([from], { kind: 'connect', title: 'Conexão aceite', body: `${me.name} aceitou o seu pedido` });
    } else {
      await r.hdel('conns', c.id);
      await bump(`uv:${c.from}`);
    }
    return send(res, 200, { ok: true });
  }
  if (p === '/api/connections') {
    const [conns, us] = await Promise.all([allConns(), r.hgetall('users')]);
    const mine = conns.filter((c) => (c.from === me.id || c.to === me.id));
    const list = await Promise.all(mine.map(async (c) => {
      const other = us[c.from === me.id ? c.to : c.from];
      const accepted = c.status === 'accepted';
      return { id: c.id, status: c.status, incoming: c.to === me.id, user: { ...publicUser(other), ...(accepted ? { email: other.email, linkedin: other.linkedin } : {}) }, lastMessage: accepted ? await r.lindex(pairKey(me.id, other.id), -1) : null };
    }));
    return send(res, 200, list);
  }
  if (p.startsWith('/api/messages/') && m === 'GET') {
    const other = p.split('/')[3];
    if (between(await allConns(), me.id, other)?.status !== 'accepted') return send(res, 403, { error: 'Sem conexão' });
    return send(res, 200, (await r.lrange(pairKey(me.id, other), -200, -1)) || []);
  }
  if (p === '/api/messages' && m === 'POST') {
    const text = clean(body.text, 1000);
    if (!text || between(await allConns(), me.id, body.to)?.status !== 'accepted') return send(res, 400, { error: 'Mensagem inválida' });
    const msg = { id: id('m'), from: me.id, to: body.to, text, at: now() };
    me.sent = (me.sent || 0) + 1; addPoints(me, 'message');
    await Promise.all([r.rpush(pairKey(me.id, body.to), msg), putUser(me)]);
    const to = await getUser(body.to);
    if (to) await notifyMany([to], { kind: 'message', title: me.name, body: text.slice(0, 80), userId: me.id });
    return send(res, 200, msg);
  }
  if (p === '/api/checkin' && m === 'POST') {
    const code = clean(body.code, 20).toUpperCase();
    const day = EVENT.days.find((d) => dayCode(d.id) === code);
    if (!day) return send(res, 400, { error: 'Código de check-in inválido' });
    if (!me.checkins[day.id]) { me.checkins[day.id] = now(); addPoints(me, 'checkin'); await putUser(me); }
    return send(res, 200, { day: day.id, title: day.title, checkins: me.checkins });
  }
  if (p === '/api/polls') {
    const polls = Object.values((await r.hgetall('polls')) || {}).sort((a, b) => b.at - a.at);
    return send(res, 200, polls.map((x) => ({ id: x.id, sessionId: x.sessionId, question: x.question, options: x.options, open: x.open, counts: x.options.map((_, i) => Object.values(x.votes).filter((v) => v === i).length), myVote: x.votes[me.id] ?? null })));
  }
  if (p === '/api/polls/vote' && m === 'POST') {
    const poll = await r.hget('polls', body.pollId);
    const opt = Number(body.option);
    if (!poll || !poll.open || !(opt >= 0 && opt < poll.options.length)) return send(res, 400, { error: 'Votação indisponível' });
    if (poll.votes[me.id] === undefined) { addPoints(me, 'vote'); await putUser(me); }
    poll.votes[me.id] = opt;
    await r.hset('polls', { [poll.id]: poll }); await bump('ver');
    return send(res, 200, { ok: true });
  }
  if (p === '/api/questions' && m === 'GET') {
    const sid = url.searchParams.get('session');
    const [qs, us] = await Promise.all([r.hgetall('qs'), r.hgetall('users')]);
    return send(res, 200, Object.values(qs || {}).filter((q) => !sid || q.sessionId === sid).sort((a, b) => b.upvotes.length - a.upvotes.length || b.at - a.at)
      .map((q) => ({ id: q.id, sessionId: q.sessionId, text: q.text, author: q.anonymous ? 'Anónimo' : us[q.userId]?.name, votes: q.upvotes.length, mine: q.upvotes.includes(me.id) })));
  }
  if (p === '/api/questions' && m === 'POST') {
    const text = clean(body.text, 300);
    if (!text || !SESSIONS.some((s) => s.id === body.sessionId)) return send(res, 400, { error: 'Pergunta inválida' });
    const q = { id: id('q'), sessionId: body.sessionId, userId: me.id, text, anonymous: !!body.anonymous, upvotes: [], at: now() };
    addPoints(me, 'question');
    await Promise.all([r.hset('qs', { [q.id]: q }), putUser(me), bump('ver')]);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/questions/upvote' && m === 'POST') {
    const q = await r.hget('qs', body.id);
    if (!q) return send(res, 404, { error: 'não encontrada' });
    q.upvotes = q.upvotes.includes(me.id) ? q.upvotes.filter((x) => x !== me.id) : [...q.upvotes, me.id];
    await r.hset('qs', { [q.id]: q }); await bump('ver');
    return send(res, 200, { ok: true });
  }
  if (p === '/api/leaderboard') {
    const sorted = (await allUsers()).sort((a, b) => b.points - a.points);
    return send(res, 200, { top: sorted.slice(0, 20).map((u) => ({ id: u.id, name: u.name, company: u.company, points: u.points })), rank: sorted.findIndex((u) => u.id === me.id) + 1, points: me.points });
  }
  if (p === '/api/notifications') {
    if (m === 'POST') { await r.set(`nr:${me.id}`, now()); return send(res, 200, { ok: true }); }
    const [items, readAt] = await Promise.all([r.lrange(`notes:${me.id}`, 0, 49), r.mget(`nr:${me.id}`)]);
    return send(res, 200, (items || []).map((n) => ({ ...n, read: n.at <= (+readAt[0] || 0) })));
  }
  return send(res, 404, { error: 'not found' });
}
