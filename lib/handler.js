// API serverless (Vercel) sobre Supabase Postgres. Tempo real: Supabase Realtime (broadcast) + Web Push.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import webpush from 'web-push';
import { sb, q, configured, supaUrl, anonKey, broadcast, track, flush } from './db.js';
import { EVENT, SESSIONS, SPONSORS, FAQS, INTERESTS, POINTS } from '../event-data.js';

const ADMIN_KEY = process.env.ADMIN_KEY;
const SECRET = process.env.APP_SECRET || 'dev-secret';
const PROD = !!process.env.VERCEL;
const TZ_OFFSET = '-03:00'; // Recife

const vapid = process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE ? { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE } : null;
if (vapid) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:eventos@oportofortegroup.com', vapid.publicKey, vapid.privateKey);

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
    if (PROD) throw new Error('Envio de email não configurado (RESEND_API_KEY)');
    console.log(`[dev email] para ${to}: ${subject}\n${html.replace(/<[^>]+>/g, ' ')}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'OFG Recife <onboarding@resend.dev>', to, subject, html }),
  });
  if (!res.ok) throw new Error('Falha ao enviar email');
}

// ---- acesso a dados (colunas snake_case <-> objetos camelCase usados na API) ----
const toUser = (r) => r && ({ id: r.id, name: r.name, email: r.email, company: r.company, role: r.role, linkedin: r.linkedin, pass: r.pass, fails: r.fails, lockUntil: Number(r.lock_until), interests: r.interests, favorites: r.favorites, pushSubs: r.push_subs, checkins: r.checkins, points: r.points, sent: r.sent, createdAt: Number(r.created_at) });
const getUser = async (uid) => toUser(await q(sb.from('users').select('*').eq('id', uid).maybeSingle()));
const userByEmail = async (email) => toUser(await q(sb.from('users').select('*').eq('email', email).maybeSingle()));
const allUsers = async () => (await q(sb.from('users').select('*'))).map(toUser);
// pontos não são gravados por putUser (evita sobrescrever incrementos concorrentes): usa a função add_points
const putUser = (u) => q(sb.from('users').update({ name: u.name, company: u.company, role: u.role, linkedin: u.linkedin, pass: u.pass, fails: u.fails || 0, lock_until: u.lockUntil || 0, interests: u.interests, favorites: u.favorites, push_subs: u.pushSubs || [], checkins: u.checkins, sent: u.sent || 0 }).eq('id', u.id));
const addPoints = (u, key) => { const n = POINTS[key] || 0; u.points += n; if (n) track(sb.rpc('add_points', { uid: u.id, n }).then(({ error }) => { if (error) throw new Error(error.message); })); };
const toConn = (r) => r && ({ id: r.id, from: r.from_id, to: r.to_id, status: r.status, at: Number(r.at) });
const allConns = async () => (await q(sb.from('connections').select('*'))).map(toConn);
const putConn = (c) => q(sb.from('connections').upsert({ id: c.id, from_id: c.from, to_id: c.to, status: c.status, at: c.at }));
const between = (conns, a, b) => conns.find((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
const pairKey = (a, b) => [a, b].sort().join(':');
const toMsg = (r) => r && ({ id: r.id, from: r.from_id, to: r.to_id, text: r.text, at: Number(r.at) });
const publicUser = (u) => u && ({ id: u.id, name: u.name, company: u.company, role: u.role, interests: u.interests, points: u.points, checkedIn: Object.keys(u.checkins).length > 0 });
const kvGet = async (key) => (await q(sb.from('kv').select('value').eq('key', key).maybeSingle()))?.value ?? null;
const kvSet = (key, value) => q(sb.from('kv').upsert({ key, value }));

const loadPolls = async () => {
  const [polls, votes] = await Promise.all([q(sb.from('polls').select('*').order('at', { ascending: false })), q(sb.from('poll_votes').select('*'))]);
  return polls.map((p) => ({ id: p.id, sessionId: p.session_id, question: p.question, options: p.options, open: p.open, at: Number(p.at), votes: Object.fromEntries(votes.filter((v) => v.poll_id === p.id).map((v) => [v.user_id, v.option])) }));
};
const loadQuestions = async () => {
  const [qs, votes] = await Promise.all([q(sb.from('questions').select('*')), q(sb.from('question_votes').select('*'))]);
  return qs.map((x) => ({ id: x.id, sessionId: x.session_id, userId: x.user_id, text: x.text, anonymous: x.anonymous, at: Number(x.at), upvotes: votes.filter((v) => v.question_id === x.id).map((v) => v.user_id) }));
};

// ---- tempo real: sinais "refaz o fetch" ----
const sigAll = (event) => broadcast([{ topic: 'ofg:all', event }]);
const sigUser = (uids) => broadcast(uids.map((u) => ({ topic: `ofg:u:${u}`, event: 'uv' })));

const tokenCache = new Map(); // token -> userId (instância quente)
async function authId(req) {
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  if (!tok) return null;
  if (tokenCache.has(tok)) return tokenCache.get(tok);
  const row = await q(sb.from('tokens').select('user_id').eq('token', tok).maybeSingle());
  if (row) tokenCache.set(tok, row.user_id);
  return row?.user_id ?? null;
}

// ---- notificações (tabela + broadcast + Web Push) ----
async function notifyMany(users, n) {
  if (!users.length) return;
  const at = now();
  await q(sb.from('notifications').insert(users.map((u) => ({ id: id('n'), user_id: u.id, kind: n.kind, title: n.title, body: n.body || '', session_id: n.sessionId || null, from_user: n.userId || null, at }))));
  sigUser(users.map((u) => u.id));
  if (!vapid) return;
  const payload = JSON.stringify({ title: n.title, body: n.body, tag: n.kind + (n.sessionId || n.userId || '') });
  await Promise.allSettled(users.flatMap((u) => (u.pushSubs || []).map((sub) =>
    webpush.sendNotification(sub, payload, { TTL: 3600 }).catch(async (e) => {
      if (e.statusCode === 404 || e.statusCode === 410) { const fresh = await getUser(u.id); fresh.pushSubs = (fresh.pushSubs || []).filter((x) => x.endpoint !== sub.endpoint); await putUser(fresh); }
    }))));
}

// lembretes "começa em 10 min": o insert em kv é atómico, só uma instância envia cada lembrete
async function reminders() {
  const t = now();
  for (const s of SESSIONS) {
    const diff = sessionStart(s) - t;
    if (diff > 0 && diff <= 10 * 60000) {
      const claimed = await q(sb.from('kv').upsert({ key: `notified:${s.id}`, value: true }, { onConflict: 'key', ignoreDuplicates: true }).select());
      if (claimed.length) await notifyMany((await allUsers()).filter((u) => u.favorites.includes(s.id)), { kind: 'reminder', title: 'Começa em 10 min', body: `${s.title} · ${s.room}`, sessionId: s.id });
    }
  }
}

export async function handle(req, res) {
  try {
    if (!configured) return send(res, 503, { error: 'Supabase não configurado' });
    const url = new URL(req.url, 'http://x');
    let body = req.method === 'GET' ? {} : req.body ?? {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    await route(req, res, url, body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Erro interno' });
  } finally {
    await flush(); // garante que pontos/broadcasts terminam antes de a função ser congelada
  }
}

async function route(req, res, url, body) {
  const p = url.pathname.replace(/\/$/, '');
  const m = req.method;

  // ---- admin ----
  if (p.startsWith('/api/admin/')) {
    if (!ADMIN_KEY && PROD) return send(res, 503, { error: 'ADMIN_KEY não configurada' });
    if (req.headers['x-admin-key'] !== (ADMIN_KEY || 'admin-dev')) return send(res, 401, { error: 'Chave admin inválida' });
    if (p === '/api/admin/stats') {
      const [us, conns, polls, qs] = await Promise.all([allUsers(), allConns(), loadPolls(), loadQuestions()]);
      return send(res, 200, { users: us.length, checkedIn: us.filter((u) => Object.keys(u.checkins).length).length, connections: conns.filter((c) => c.status === 'accepted').length, messages: us.reduce((a, u) => a + (u.sent || 0), 0), questions: qs.length, codes: EVENT.days.map((d) => ({ day: d.id, title: d.title, date: d.date, code: dayCode(d.id) })), polls, openQuestions: qs });
    }
    if (p === '/api/admin/announce' && m === 'POST') {
      const a = { id: id('a'), at: now(), title: clean(body.title, 80), body: clean(body.body, 400), kind: clean(body.kind, 20) || 'info' };
      if (!a.title) return send(res, 400, { error: 'Título obrigatório' });
      await q(sb.from('announcements').insert(a));
      await notifyMany(await allUsers(), { kind: 'announcement', title: a.title, body: a.body });
      sigAll('ver');
      return send(res, 200, a);
    }
    if (p === '/api/admin/poll' && m === 'POST') {
      const options = (body.options || []).map((o) => clean(o, 80)).filter(Boolean).slice(0, 6);
      const qn = clean(body.question, 200);
      if (!qn || options.length < 2) return send(res, 400, { error: 'Pergunta e 2+ opções' });
      const poll = { id: id('p'), session_id: clean(body.sessionId, 20), question: qn, options, open: true, at: now() };
      await q(sb.from('polls').insert(poll)); sigAll('ver');
      return send(res, 200, poll);
    }
    if (p === '/api/admin/poll/close' && m === 'POST') {
      await q(sb.from('polls').update({ open: false }).eq('id', clean(body.id, 40))); sigAll('ver');
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'not found' });
  }

  // ---- público ----
  if (p === '/api/event') {
    const ann = await q(sb.from('announcements').select('*').order('at', { ascending: false }).limit(30));
    return send(res, 200, { event: EVENT, sessions: SESSIONS, sponsors: SPONSORS, faqs: FAQS, interests: INTERESTS, announcements: ann.map((a) => ({ ...a, at: Number(a.at) })), points: POINTS, realtime: anonKey ? { url: supaUrl, anonKey } : null });
  }
  if (p === '/api/register' && m === 'POST') {
    const name = clean(body.name, 80), email = clean(body.email, 120).toLowerCase(), company = clean(body.company, 80), role = clean(body.role, 80);
    const pw = String(body.password || '');
    if (!name || !company || !role || !/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Nome, email, empresa e cargo são obrigatórios' });
    if (pw.length < 8 || pw.length > 100) return send(res, 400, { error: 'A senha deve ter no mínimo 8 caracteres' });
    if (await userByEmail(email)) return send(res, 409, { error: 'Este email já está registado. Use "Já tenho conta".' });
    const uid = id('u'), token = crypto.randomBytes(24).toString('hex');
    await q(sb.from('users').insert({ id: uid, name, email, company, role, linkedin: clean(body.linkedin, 200), pass: await hashPw(pw), interests: (body.interests || []).filter((i) => INTERESTS.includes(i)).slice(0, 8), points: POINTS.profile, created_at: now() }));
    await q(sb.from('tokens').insert({ token, user_id: uid }));
    return send(res, 200, { token });
  }
  if (p === '/api/login' && m === 'POST') {
    const email = clean(body.email, 120).toLowerCase();
    const bad = () => send(res, 401, { error: 'Email ou senha inválidos' });
    const u = await userByEmail(email);
    if (!u) { await hashPw('x'); return bad(); } // custo semelhante, evita distinguir contas
    if (u.lockUntil && u.lockUntil > now()) return send(res, 429, { error: 'Demasiadas tentativas. Tente novamente em alguns minutos.' });
    if (!(await checkPw(String(body.password || ''), u.pass))) {
      u.fails = (u.fails || 0) + 1;
      if (u.fails >= MAX_FAILS) { u.lockUntil = now() + LOCK_MS; u.fails = 0; }
      await putUser(u); return bad();
    }
    if (u.fails || u.lockUntil) { u.fails = 0; u.lockUntil = 0; await putUser(u); }
    const token = crypto.randomBytes(24).toString('hex');
    await q(sb.from('tokens').insert({ token, user_id: u.id }));
    return send(res, 200, { token });
  }
  // recuperação: envia PIN de 6 dígitos + link; resposta sempre genérica (não revela se o email existe)
  if (p === '/api/recover' && m === 'POST') {
    const email = clean(body.email, 120).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Email inválido' });
    if (await userByEmail(email)) {
      const prev = await kvGet(`pin:${email}`);
      if (!prev || now() - prev.at > 60000) { // reenvio no mínimo a cada 60 s
        const pin = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
        await kvSet(`pin:${email}`, { h: pinHash(email, pin), exp: now() + 15 * 60000, at: now(), tries: 0 });
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
    const rec = await kvGet(`pin:${email}`);
    const fail = () => send(res, 400, { error: 'Código inválido ou expirado' });
    if (!rec || rec.exp < now() || rec.tries >= 5) return fail();
    if (rec.h !== pinHash(email, pin)) { await kvSet(`pin:${email}`, { ...rec, tries: rec.tries + 1 }); return fail(); }
    const u = await userByEmail(email);
    if (!u) return fail();
    u.pass = await hashPw(pw); u.fails = 0; u.lockUntil = 0;
    await putUser(u);
    await kvSet(`pin:${email}`, { ...rec, exp: 0 });
    const token = crypto.randomBytes(24).toString('hex');
    await q(sb.from('tokens').insert({ token, user_id: u.id }));
    return send(res, 200, { token });
  }

  const uid = await authId(req);
  if (!uid) return send(res, 401, { error: 'Sessão inválida' });

  // heartbeat (~60 s): dispara lembretes de sessões
  if (p === '/api/sync') {
    await reminders().catch((e) => console.error('reminders', e));
    return send(res, 200, { ok: true });
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
    const qs = clean(url.searchParams.get('q')).toLowerCase();
    const [us, conns] = await Promise.all([allUsers(), allConns()]);
    const list = us.filter((u) => u.id !== me.id)
      .filter((u) => !qs || [u.name, u.company, u.role, ...u.interests].join(' ').toLowerCase().includes(qs))
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
    const [to, conns] = await Promise.all([getUser(clean(body.to, 40)), allConns()]);
    if (!to || to.id === me.id) return send(res, 400, { error: 'Participante inválido' });
    const existing = between(conns, me.id, to.id);
    if (existing) {
      if (existing.status === 'pending' && existing.to === me.id) {
        existing.status = 'accepted'; addPoints(me, 'connect'); addPoints(to, 'connect');
        await putConn(existing); sigUser([to.id]);
      }
      return send(res, 200, existing);
    }
    const c = { id: id('c'), from: me.id, to: to.id, status: 'pending', at: now() };
    await putConn(c);
    await notifyMany([to], { kind: 'connect', title: 'Novo pedido de conexão', body: `${me.name}${me.company ? ' · ' + me.company : ''} quer conectar` });
    return send(res, 200, c);
  }
  if (p === '/api/connect/respond' && m === 'POST') {
    const c = toConn(await q(sb.from('connections').select('*').eq('id', clean(body.id, 40)).maybeSingle()));
    if (!c || c.to !== me.id || c.status !== 'pending') return send(res, 404, { error: 'Pedido não encontrado' });
    if (body.accept) {
      const from = await getUser(c.from);
      c.status = 'accepted'; addPoints(me, 'connect'); addPoints(from, 'connect');
      await putConn(c);
      await notifyMany([from], { kind: 'connect', title: 'Conexão aceite', body: `${me.name} aceitou o seu pedido` });
    } else {
      await q(sb.from('connections').delete().eq('id', c.id)); sigUser([c.from]);
    }
    return send(res, 200, { ok: true });
  }
  if (p === '/api/connections') {
    const [conns, us] = await Promise.all([allConns(), allUsers()]);
    const byId = Object.fromEntries(us.map((u) => [u.id, u]));
    const mine = conns.filter((c) => c.from === me.id || c.to === me.id);
    const list = await Promise.all(mine.map(async (c) => {
      const other = byId[c.from === me.id ? c.to : c.from];
      const accepted = c.status === 'accepted';
      const last = accepted ? toMsg((await q(sb.from('messages').select('*').eq('pair', pairKey(me.id, other.id)).order('at', { ascending: false }).limit(1)))[0]) : null;
      return { id: c.id, status: c.status, incoming: c.to === me.id, user: { ...publicUser(other), ...(accepted ? { email: other.email, linkedin: other.linkedin } : {}) }, lastMessage: last || null };
    }));
    return send(res, 200, list);
  }
  if (p.startsWith('/api/messages/') && m === 'GET') {
    const other = p.split('/')[3];
    if (between(await allConns(), me.id, other)?.status !== 'accepted') return send(res, 403, { error: 'Sem conexão' });
    const rows = await q(sb.from('messages').select('*').eq('pair', pairKey(me.id, other)).order('at', { ascending: false }).limit(200));
    return send(res, 200, rows.reverse().map(toMsg));
  }
  if (p === '/api/messages' && m === 'POST') {
    const text = clean(body.text, 1000), toId = clean(body.to, 40);
    if (!text || between(await allConns(), me.id, toId)?.status !== 'accepted') return send(res, 400, { error: 'Mensagem inválida' });
    const msg = { id: id('m'), from: me.id, to: toId, text, at: now() };
    me.sent = (me.sent || 0) + 1; addPoints(me, 'message');
    await Promise.all([q(sb.from('messages').insert({ id: msg.id, pair: pairKey(me.id, toId), from_id: me.id, to_id: toId, text, at: msg.at })), putUser(me)]);
    const to = await getUser(toId);
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
    return send(res, 200, (await loadPolls()).map((x) => ({ id: x.id, sessionId: x.sessionId, question: x.question, options: x.options, open: x.open, counts: x.options.map((_, i) => Object.values(x.votes).filter((v) => v === i).length), myVote: x.votes[me.id] ?? null })));
  }
  if (p === '/api/polls/vote' && m === 'POST') {
    const poll = await q(sb.from('polls').select('*').eq('id', clean(body.pollId, 40)).maybeSingle());
    const opt = Number(body.option);
    if (!poll || !poll.open || !Number.isInteger(opt) || opt < 0 || opt >= poll.options.length) return send(res, 400, { error: 'Votação indisponível' });
    const had = await q(sb.from('poll_votes').select('option').eq('poll_id', poll.id).eq('user_id', me.id).maybeSingle());
    if (!had) addPoints(me, 'vote');
    await q(sb.from('poll_votes').upsert({ poll_id: poll.id, user_id: me.id, option: opt }));
    sigAll('ver');
    return send(res, 200, { ok: true });
  }
  if (p === '/api/questions' && m === 'GET') {
    const sid = url.searchParams.get('session');
    const [qs, us] = await Promise.all([loadQuestions(), allUsers()]);
    const byId = Object.fromEntries(us.map((u) => [u.id, u]));
    return send(res, 200, qs.filter((x) => !sid || x.sessionId === sid).sort((a, b) => b.upvotes.length - a.upvotes.length || b.at - a.at)
      .map((x) => ({ id: x.id, sessionId: x.sessionId, text: x.text, author: x.anonymous ? 'Anónimo' : byId[x.userId]?.name, votes: x.upvotes.length, mine: x.upvotes.includes(me.id) })));
  }
  if (p === '/api/questions' && m === 'POST') {
    const text = clean(body.text, 300);
    if (!text || !SESSIONS.some((s) => s.id === body.sessionId)) return send(res, 400, { error: 'Pergunta inválida' });
    await q(sb.from('questions').insert({ id: id('q'), session_id: body.sessionId, user_id: me.id, text, anonymous: !!body.anonymous, at: now() }));
    addPoints(me, 'question'); sigAll('ver');
    return send(res, 200, { ok: true });
  }
  if (p === '/api/questions/upvote' && m === 'POST') {
    const qid = clean(body.id, 40);
    if (!(await q(sb.from('questions').select('id').eq('id', qid).maybeSingle()))) return send(res, 404, { error: 'não encontrada' });
    const had = await q(sb.from('question_votes').select('user_id').eq('question_id', qid).eq('user_id', me.id).maybeSingle());
    if (had) await q(sb.from('question_votes').delete().eq('question_id', qid).eq('user_id', me.id));
    else await q(sb.from('question_votes').insert({ question_id: qid, user_id: me.id }));
    sigAll('ver');
    return send(res, 200, { ok: true });
  }
  if (p === '/api/leaderboard') {
    const sorted = (await allUsers()).sort((a, b) => b.points - a.points);
    return send(res, 200, { top: sorted.slice(0, 20).map((u) => ({ id: u.id, name: u.name, company: u.company, points: u.points })), rank: sorted.findIndex((u) => u.id === me.id) + 1, points: sorted.find((u) => u.id === me.id)?.points ?? me.points });
  }
  if (p === '/api/notifications') {
    if (m === 'POST') { await kvSet(`nr:${me.id}`, now()); return send(res, 200, { ok: true }); }
    const [items, readAt] = await Promise.all([q(sb.from('notifications').select('*').eq('user_id', me.id).order('at', { ascending: false }).limit(50)), kvGet(`nr:${me.id}`)]);
    return send(res, 200, items.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, sessionId: n.session_id, userId: n.from_user, at: Number(n.at), read: Number(n.at) <= (Number(readAt) || 0) })));
  }
  return send(res, 404, { error: 'not found' });
}
