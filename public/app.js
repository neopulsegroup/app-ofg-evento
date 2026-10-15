// OFG Recife 2026 – PWA (vanilla JS, sem build)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICONS = {
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  agenda: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14zM7 12h5v5H7z',
  people: 'M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.900 2 3.400V19h6v-2.500c0-2.300-4.700-3.500-7-3.500z',
  live: 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zm5 9a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.900V21h2v-3.100A7 7 0 0 0 19 11z',
  more: 'M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  star: 'M12 17.3l6.200 3.700-1.600-7L22 9.200l-7.200-.6L12 2 9.200 8.600 2 9.200 7.400 14l-1.600 7z',
  starO: 'M22 9.200l-7.200-.6L12 2 9.200 8.600 2 9.200 7.400 14l-1.600 7 6.200-3.700 6.200 3.700-1.600-7zM12 15.400l-3.800 2.300 1-4.300-3.300-2.900 4.400-.4L12 6.100l1.700 4 4.400.4-3.300 2.900 1 4.300z',
  back: 'M20 11H7.800l5.600-5.600L12 4l-8 8 8 8 1.400-1.400L7.800 13H20z',
  bell: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 0 0-5-5.900V4a1 1 0 0 0-2 0v1.100A6 6 0 0 0 6 11v5l-2 2v1h16v-1z',
  send: 'M2 21l21-9L2 3v7l15 2-15 2z',
  check: 'M9 16.200L4.800 12l-1.400 1.400L9 19 21 7l-1.400-1.400z',
};
const icon = (n) => `<svg class="ic" viewBox="0 0 24 24"><path d="${ICONS[n]}"/></svg>`;

// ---------- estado ----------
const S = { token: localStorage.getItem('ofg_token'), me: null, ev: null, tab: 'home', day: null, view: null, people: [], q: '', conns: [], sugg: [], polls: [], questions: [], notes: [], board: null, chat: [], chatWith: null, qSession: null, err: '', authMode: 'register', pickInterests: [] };

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) { logout(); }
  if (!r.ok) throw new Error(j.error || 'Erro');
  return j;
}
function logout() { localStorage.removeItem('ofg_token'); S.token = null; S.me = null; ws?.close(); render(); }

const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' });
const sessionTs = (s) => { const d = S.ev.event.days.find((x) => x.id === s.day); return new Date(`${d.date}T${s.start}:00-03:00`).getTime(); };
const sessionEnd = (s) => { const d = S.ev.event.days.find((x) => x.id === s.day); return new Date(`${d.date}T${s.end}:00-03:00`).getTime(); };
const initials = (n) => n.split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const timeAgo = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : `há ${Math.round(m / 60)} h`; };

function toast(title, body) {
  const el = document.createElement('div');
  el.className = 'toast'; el.innerHTML = `<b>${esc(title)}</b>${esc(body || '')}`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 6000);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: '/icons/icon.svg' });
}

// ---------- websocket ----------
let ws, wsRetry = 0;
function connectWS() {
  if (!S.token) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${S.token}`);
  ws.onopen = () => (wsRetry = 0);
  ws.onclose = (e) => { if (S.token && e.code !== 4001) setTimeout(connectWS, Math.min(1000 * 2 ** wsRetry++, 15000)); };
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'notification') { S.notes.unshift(m.item); toast(m.item.title, m.item.body); }
    if (m.type === 'announcement') { S.ev.announcements.unshift(m.item); }
    if (m.type === 'message') {
      const other = m.item.from === S.me.id ? m.item.to : m.item.from;
      if (S.chatWith === other) { S.chat.push(m.item); }
    }
    if (m.type === 'connections') await loadConns();
    if (m.type === 'poll') await loadPolls();
    if (m.type === 'questions') await loadQuestions();
    if (m.type === 'leaderboard' && S.tab === 'more') await loadBoard();
    if (!typing()) render();
    if (S.chatWith) window.scrollTo(0, document.body.scrollHeight);
  };
}
const typing = () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

// ---------- Web Push ----------
const b64 = (k) => Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('Notificações', 'Este navegador não suporta push. No iPhone, adicione a app ao ecrã principal primeiro.');
  if ((await Notification.requestPermission()) !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api('/push/key');
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }));
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  toast('Notificações ativadas', 'Receberá avisos mesmo com a app fechada.');
}
async function syncPush() { // renova a subscrição no servidor se a permissão já foi dada
  try { if (Notification.permission === 'granted') { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } }); } } catch {}
}

// ---------- carregamento ----------
const loadMe = async () => (S.me = await api('/me'));
const loadConns = async () => (S.conns = await api('/connections'));
const loadPolls = async () => (S.polls = await api('/polls'));
const loadQuestions = async () => (S.questions = await api('/questions'));
const loadBoard = async () => (S.board = await api('/leaderboard'));
const loadPeople = async () => (S.people = await api('/people?q=' + encodeURIComponent(S.q)));
const loadSugg = async () => (S.sugg = await api('/suggestions'));
const loadNotes = async () => (S.notes = await api('/notifications'));

async function boot() {
  try { S.ev = await api('/event'); } catch { document.body.innerHTML = '<p style="padding:24px">Sem ligação. Tente novamente.</p>'; return; }
  S.day = S.ev.event.days.find((d) => d.date === new Date().toISOString().slice(0, 10))?.id || S.ev.event.days[0].id;
  if (S.token) {
    try { await Promise.all([loadMe(), loadConns(), loadPolls(), loadQuestions(), loadNotes(), loadSugg(), loadPeople()]); connectWS(); syncPush(); } catch { /* logout tratado */ }
    const code = new URLSearchParams(location.search).get('checkin');
    if (code && S.me) { await doCheckin(code); history.replaceState({}, '', '/'); }
  }
  render();
  setInterval(() => { if (!typing() && S.me && !S.chatWith) render(); }, 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
}

async function doCheckin(code) {
  try { const r = await api('/checkin', { method: 'POST', body: { code } }); await loadMe(); toast('Check-in feito ✔', r.title); S.err = ''; }
  catch (e) { S.err = e.message; toast('Check-in', e.message); }
}

// ---------- vistas ----------
function render() {
  const app = $('#app');
  if (!S.token || !S.me) { app.innerHTML = authView(); return; }
  const unread = S.notes.filter((n) => !n.read).length;
  const pend = S.conns.filter((c) => c.status === 'pending' && c.incoming).length;
  const titles = { home: S.ev.event.name, agenda: 'Programa', network: 'Networking', live: 'Ao vivo', more: 'Mais' };
  let body;
  if (S.chatWith) body = chatView();
  else if (S.view?.type === 'session') body = sessionView(S.view.id);
  else if (S.view?.type === 'person') body = personView(S.view.id);
  else if (S.view?.type === 'notes') body = notesView();
  else body = { home: homeView, agenda: agendaView, network: networkView, live: liveView, more: moreView }[S.tab]();
  const sub = S.chatWith || S.view;
  const bar = sub
    ? `<div class="topbar"><button class="iconbtn" data-act="back" aria-label="Voltar">${icon('back')}</button><h1>${esc(S.chatWith ? S.conns.find((c) => c.user.id === S.chatWith)?.user.name : S.view.type === 'notes' ? 'Notificações' : '')}</h1></div>`
    : `<div class="topbar"><h1>${titles[S.tab]}</h1><button class="iconbtn" data-act="notes" aria-label="Notificações" style="position:relative">${icon('bell')}${unread ? `<span class="badge" style="left:22px;top:2px">${unread}</span>` : ''}</button></div>`;
  const tabs = [['home', 'Início'], ['agenda', 'Programa'], ['network', 'Pessoas'], ['live', 'Ao vivo'], ['more', 'Mais']];
  app.innerHTML = `<div class="shell">${bar}<main>${body}</main>${S.chatWith ? composer() : `<nav class="nav"><div class="nav-inner">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k && !sub ? 'on' : ''}"><span class="pill">${icon(k === 'network' ? 'people' : k)}</span>${l}${k === 'network' && pend ? `<span class="badge">${pend}</span>` : ''}</button>`).join('')}</div></nav>`}</div>`;
}

function authView() {
  const reg = S.authMode === 'register';
  return `<div class="shell"><main style="padding-top:32px">
    <div class="card hero"><div class="label" style="color:inherit;opacity:.8">3 · 4 · 5 novembro 2026 · Recife</div><h1 class="display">${esc(S.ev?.event.name || '')}</h1><p>${esc(S.ev?.event.tagline || '')}</p></div>
    <h2 class="title-l" style="margin-top:8px">${reg ? 'Crie o seu perfil' : 'Entrar'}</h2>
    <form id="authForm" class="card filled" style="gap:16px">
      ${reg ? `<div class="field"><label>Nome *</label><input name="name" required autocomplete="name"></div>` : ''}
      <div class="field"><label>Email *</label><input name="email" type="email" required autocomplete="email"></div>
      ${reg ? `<div class="field"><label>Empresa</label><input name="company" autocomplete="organization"></div>
      <div class="field"><label>Cargo</label><input name="role" autocomplete="organization-title"></div>
      <div class="field"><label>LinkedIn (opcional)</label><input name="linkedin" placeholder="linkedin.com/in/..."></div>
      <div><div class="label" style="margin-bottom:8px">Interesses (para sugestões de networking)</div><div class="chips">${S.ev.interests.map((i) => `<button type="button" class="chip ${S.pickInterests.includes(i) ? 'on' : ''}" data-act="pick" data-v="${esc(i)}">${esc(i)}</button>`).join('')}</div></div>` : ''}
      ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
      <button class="btn">${reg ? 'Entrar no evento' : 'Entrar'}</button>
      <button type="button" class="btn text" data-act="authmode">${reg ? 'Já tenho conta' : 'Criar perfil'}</button>
    </form>
    <p class="body-s">Os seus dados ficam visíveis apenas para os outros participantes do evento.</p>
  </main></div>`;
}

function sessionCard(s) {
  const fav = S.me.favorites.includes(s.id);
  const t = Date.now(), live = sessionTs(s) <= t && t < sessionEnd(s);
  return `<div class="card ${live ? 'now' : ''}" data-act="session" data-id="${s.id}" style="cursor:pointer"><div class="row top">
    <div class="badge-time">${s.start}<div class="body-s">${s.end}</div></div>
    <div class="grow"><div class="title-m">${esc(s.title)}</div><div class="body-s">${esc(s.room)}${s.speaker ? ' · ' + esc(s.speaker) : ''}${live ? ' · <b>a decorrer</b>' : ''}</div></div>
    <button class="iconbtn ${fav ? 'on' : ''}" data-act="fav" data-id="${s.id}" aria-label="Favorito">${icon(fav ? 'star' : 'starO')}</button></div></div>`;
}

function homeView() {
  const t = Date.now();
  const upcoming = S.ev.sessions.filter((s) => sessionEnd(s) > t).sort((a, b) => sessionTs(a) - sessionTs(b));
  const mine = upcoming.filter((s) => S.me.favorites.includes(s.id)).slice(0, 3);
  const next = upcoming.slice(0, 3);
  const days = S.ev.event.days;
  const first = new Date(days[0].date + 'T00:00:00-03:00').getTime();
  const daysTo = Math.ceil((first - t) / 864e5);
  const today = days.find((d) => d.date === new Date(t - 3 * 3600e3).toISOString().slice(0, 10));
  const checked = today && S.me.checkins[today.id];
  const pend = S.conns.filter((c) => c.status === 'pending' && c.incoming);
  return `
    <div class="card hero"><div class="label" style="color:inherit;opacity:.8">Olá, ${esc(S.me.name.split(' ')[0])}</div>
      <h2 class="display">${daysTo > 0 ? `Faltam ${daysTo} dia${daysTo > 1 ? 's' : ''}` : today ? esc(today.title) : 'Obrigado pela presença'}</h2>
      <p class="muted">${esc(S.ev.event.venue.name)}</p></div>
    ${today && !checked ? `<div class="banner row"><div class="grow"><b>Faça check-in de hoje</b><div class="body-s">Leia o QR code na receção ou introduza o código.</div></div><button class="btn small" data-act="goto" data-tab="more">Check-in</button></div>` : ''}
    ${S.ev.announcements.slice(0, 3).map((a) => `<div class="banner ${a.kind === 'alert' ? 'alert' : ''}"><b>${esc(a.title)}</b><div>${esc(a.body)}</div><div class="body-s">${timeAgo(a.at)}</div></div>`).join('')}
    ${pend.length ? `<div class="card row"><div class="grow"><b>${pend.length} pedido(s) de conexão</b></div><button class="btn small tonal" data-act="goto" data-tab="network">Ver</button></div>` : ''}
    <h3 class="title-m">${mine.length ? 'As suas próximas sessões' : 'A seguir'}</h3>
    ${(mine.length ? mine : next).map(sessionCard).join('') || '<div class="empty">Sem sessões futuras.</div>'}
    ${S.sugg.length ? `<h3 class="title-m">Pessoas com interesses em comum</h3>${S.sugg.slice(0, 3).map(personRow).join('')}` : ''}`;
}

function agendaView() {
  const days = S.ev.event.days;
  const list = S.ev.sessions.filter((s) => s.day === S.day).sort((a, b) => a.start.localeCompare(b.start));
  const favOnly = S.favOnly;
  return `<div class="chips scroll-x">${days.map((d) => `<button class="chip ${S.day === d.id ? 'on' : ''}" data-act="day" data-id="${d.id}">${fmtDay(d.date)} · ${esc(d.title)}</button>`).join('')}<button class="chip ${favOnly ? 'on' : ''}" data-act="favonly">★ Favoritos</button></div>
    <div class="body-s">${esc(days.find((d) => d.id === S.day).subtitle)}</div>
    ${list.filter((s) => !favOnly || S.me.favorites.includes(s.id)).map(sessionCard).join('') || '<div class="empty">Nada por aqui.</div>'}
    <div class="body-s">Marque ★ para receber um aviso 10 min antes de cada sessão.</div>`;
}

function sessionView(id) {
  const s = S.ev.sessions.find((x) => x.id === id), fav = S.me.favorites.includes(id);
  const qs = S.questions.filter((q) => q.sessionId === id);
  const polls = S.polls.filter((p) => p.sessionId === id);
  return `<div class="card"><div class="label">${fmtDay(S.ev.event.days.find((d) => d.id === s.day).date)} · ${s.start}–${s.end} · ${esc(s.room)}</div>
    <h2 class="title-l">${esc(s.title)}</h2>${s.speaker ? `<div class="muted">${esc(s.speaker)}</div>` : ''}<p>${esc(s.desc)}</p>
    <button class="btn ${fav ? 'tonal' : ''}" data-act="fav" data-id="${id}">${icon(fav ? 'star' : 'starO')} ${fav ? 'Nos favoritos' : 'Adicionar aos favoritos'}</button></div>
    ${polls.map(pollCard).join('')}
    <h3 class="title-m">Perguntas ao vivo</h3>
    <form id="qForm" class="card filled" data-id="${id}"><div class="field"><label>Faça uma pergunta</label><textarea name="text" maxlength="300" required></textarea></div>
      <label class="row body-s"><input type="checkbox" name="anon"> Enviar anonimamente</label><button class="btn">Enviar pergunta</button></form>
    ${qs.map(questionCard).join('')}`;
}

const questionCard = (q) => `<div class="card row top"><div class="grow"><div>${esc(q.text)}</div><div class="body-s">${esc(q.author)}</div></div>
  <button class="chip ${q.mine ? 'on' : ''}" data-act="upvote" data-id="${q.id}">▲ ${q.votes}</button></div>`;

function pollCard(p) {
  const total = p.counts.reduce((a, b) => a + b, 0) || 1;
  return `<div class="card"><div class="row"><div class="grow title-m">${esc(p.question)}</div><span class="chip static ${p.open ? 'on' : ''}">${p.open ? 'Aberta' : 'Fechada'}</span></div>
    ${p.options.map((o, i) => `<div data-act="${p.open ? 'vote' : ''}" data-poll="${p.id}" data-opt="${i}" style="cursor:${p.open ? 'pointer' : 'default'}">
      <div class="row"><div class="grow">${p.myVote === i ? '✔ ' : ''}${esc(o)}</div><div class="body-s">${p.counts[i]} · ${Math.round((p.counts[i] / total) * 100)}%</div></div>
      <div class="bar"><i style="width:${(p.counts[i] / total) * 100}%"></i></div></div>`).join('')}</div>`;
}

function liveView() {
  const t = Date.now();
  const cur = S.ev.sessions.find((s) => sessionTs(s) <= t && t < sessionEnd(s));
  const sid = S.qSession || cur?.id || S.ev.sessions[0].id;
  const open = S.polls.filter((p) => p.open), closed = S.polls.filter((p) => !p.open);
  return `<h3 class="title-m">Enquetes</h3>${open.map(pollCard).join('') || '<div class="empty">Nenhuma enquete aberta. Fique atento!</div>'}
    ${closed.length ? `<h3 class="title-m">Resultados</h3>${closed.map(pollCard).join('')}` : ''}
    <h3 class="title-m">Perguntas por sessão</h3>
    <div class="chips scroll-x">${S.ev.sessions.filter((s) => !/almoço|jantar|drink|check-in|Receção|Credenciamento/i.test(s.title)).map((s) => `<button class="chip ${s.id === sid ? 'on' : ''}" data-act="qsess" data-id="${s.id}">${esc(s.title.slice(0, 28))}…</button>`).join('')}</div>
    <button class="btn tonal" data-act="session" data-id="${sid}">Perguntar nesta sessão</button>
    ${S.questions.filter((q) => q.sessionId === sid).map(questionCard).join('') || '<div class="empty">Ainda sem perguntas.</div>'}`;
}

function personRow(u) {
  const label = u.conn === 'accepted' ? 'Conectados' : u.conn === 'pending' ? (u.incoming ? 'Aceitar' : 'Pendente') : 'Conectar';
  const disabled = u.conn === 'accepted' || (u.conn === 'pending' && !u.incoming);
  return `<div class="card" data-act="person" data-id="${u.id}" style="cursor:pointer"><div class="row"><div class="avatar">${esc(initials(u.name))}</div>
    <div class="grow"><div class="title-m">${esc(u.name)}</div><div class="body-s">${esc([u.role, u.company].filter(Boolean).join(' · '))}</div></div>
    <button class="btn small ${disabled ? 'tonal' : ''}" data-act="connect" data-id="${u.id}" ${disabled ? 'disabled' : ''}>${label}</button></div>
    ${u.shared?.length ? `<div class="chips">${u.shared.map((i) => `<span class="chip static on">${esc(i)}</span>`).join('')}</div>` : ''}</div>`;
}

function networkView() {
  const pend = S.conns.filter((c) => c.status === 'pending' && c.incoming);
  const mine = S.conns.filter((c) => c.status === 'accepted');
  const sub = S.netTab || 'all';
  return `<div class="chips"><button class="chip ${sub === 'all' ? 'on' : ''}" data-act="nettab" data-id="all">Participantes</button><button class="chip ${sub === 'conn' ? 'on' : ''}" data-act="nettab" data-id="conn">Conexões (${mine.length})</button></div>
  ${sub === 'all' ? `
    ${pend.map((c) => `<div class="card row"><div class="avatar">${esc(initials(c.user.name))}</div><div class="grow"><b>${esc(c.user.name)}</b><div class="body-s">${esc(c.user.company || '')} quer conectar</div></div>
      <button class="btn small" data-act="respond" data-id="${c.id}" data-v="1">Aceitar</button><button class="btn small text" data-act="respond" data-id="${c.id}" data-v="0">Ignorar</button></div>`).join('')}
    ${!S.q && S.sugg.length ? `<h3 class="title-m">Sugestões para si</h3>${S.sugg.map(personRow).join('')}<h3 class="title-m">Todos</h3>` : ''}
    <div class="search"><input id="search" type="search" placeholder="Procurar nome, empresa, interesse…" value="${esc(S.q)}"></div>
    <div id="peopleList">${S.people.map(personRow).join('') || '<div class="empty">Ninguém encontrado ainda.</div>'}</div>`
  : mine.map((c) => `<div class="card" data-act="chat" data-id="${c.user.id}" style="cursor:pointer"><div class="row"><div class="avatar">${esc(initials(c.user.name))}</div>
      <div class="grow"><div class="title-m">${esc(c.user.name)}</div><div class="body-s">${esc(c.lastMessage ? c.lastMessage.text.slice(0, 50) : [c.user.role, c.user.company].filter(Boolean).join(' · '))}</div></div></div></div>`).join('') || '<div class="empty">Ainda sem conexões. Envie pedidos na aba Participantes.</div>'}`;
}

function personView(id) {
  const conn = S.conns.find((c) => c.user.id === id);
  const u = conn?.user || S.people.find((p) => p.id === id) || S.sugg.find((p) => p.id === id);
  if (!u) return '<div class="empty">Não encontrado.</div>';
  const accepted = conn?.status === 'accepted';
  return `<div class="card"><div class="row"><div class="avatar" style="width:64px;height:64px;font-size:24px">${esc(initials(u.name))}</div><div><h2 class="title-l">${esc(u.name)}</h2><div class="muted">${esc([u.role, u.company].filter(Boolean).join(' · '))}</div></div></div>
    <div class="chips">${(u.interests || []).map((i) => `<span class="chip static ${S.me.interests.includes(i) ? 'on' : ''}">${esc(i)}</span>`).join('')}</div>
    ${accepted ? `<div class="hr"></div><div class="label">Contactos partilhados</div><div>✉ <a href="mailto:${esc(u.email)}">${esc(u.email)}</a></div>${u.linkedin ? `<div>in <a href="${esc(u.linkedin.startsWith('http') ? u.linkedin : 'https://' + u.linkedin)}" target="_blank" rel="noopener">${esc(u.linkedin)}</a></div>` : ''}<button class="btn" data-act="chat" data-id="${u.id}">${icon('send')} Enviar mensagem</button>`
      : `<button class="btn" data-act="connect" data-id="${u.id}" ${conn ? 'disabled' : ''}>${conn ? (conn.incoming ? 'Aceitar pedido' : 'Pedido enviado') : 'Conectar'}</button><p class="body-s">Ao aceitar, vocês trocam email e LinkedIn e podem conversar.</p>`}</div>`;
}

function chatView() {
  return `<div class="chat">${S.chat.map((m) => `<div class="bubble ${m.from === S.me.id ? 'me' : ''}">${esc(m.text)}</div>`).join('') || '<div class="empty">Diga olá 👋</div>'}</div>`;
}
const composer = () => `<form id="msgForm" class="composer"><input name="text" placeholder="Mensagem" autocomplete="off" maxlength="1000"><button class="btn" aria-label="Enviar">${icon('send')}</button></form>`;

function notesView() {
  return S.notes.map((n) => `<div class="card ${n.read ? '' : 'filled'}"><b>${esc(n.title)}</b><div>${esc(n.body)}</div><div class="body-s">${timeAgo(n.at)}</div></div>`).join('') || '<div class="empty">Sem notificações.</div>';
}

function moreView() {
  const sec = S.moreTab || 'checkin';
  const tabs = [['checkin', 'Check-in'], ['rank', 'Ranking'], ['info', 'Local'], ['sponsors', 'Parceiros'], ['faq', 'FAQ'], ['profile', 'Perfil']];
  const days = S.ev.event.days;
  let c = '';
  if (sec === 'checkin') c = `<div class="card"><h2 class="title-l">Check-in</h2><p class="muted">Leia o QR code do dia na receção (abre esta app e faz o check-in) ou escreva o código abaixo.</p>
      <form id="ckForm" class="row"><div class="field grow"><input name="code" placeholder="Código" autocapitalize="characters" required></div><button class="btn">Validar</button></form>${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}</div>
      ${days.map((d) => `<div class="card row"><div class="grow"><b>${fmtDay(d.date)}</b><div class="body-s">${esc(d.title)}</div></div>${S.me.checkins[d.id] ? `<span class="chip on static">${icon('check')} Presente</span>` : '<span class="muted">—</span>'}</div>`).join('')}`;
  if (sec === 'rank') c = !S.board ? '<div class="empty">A carregar…</div>' : `<div class="card hero"><div class="label" style="color:inherit;opacity:.8">Os seus pontos</div><h2 class="display">${S.board.points} pts</h2><p class="muted">Posição #${S.board.rank}</p></div>
      <div class="card"><div class="label">Como ganhar pontos</div><div class="body-s">Check-in ${S.ev.points.checkin} · Conexão ${S.ev.points.connect} · Pergunta ${S.ev.points.question} · Voto ${S.ev.points.vote} · Favorito ${S.ev.points.favorite} · Mensagem ${S.ev.points.message}</div></div>
      ${S.board.top.map((u, i) => `<div class="list-item"><b style="width:28px">${i + 1}</b><div class="grow">${esc(u.name)}<div class="body-s">${esc(u.company)}</div></div><b>${u.points}</b></div>`).join('')}`;
  if (sec === 'info') { const v = S.ev.event.venue; c = `<div class="card"><h2 class="title-l">${esc(v.name)}</h2><p>${esc(v.address)}</p><p class="muted">${esc(v.room)}</p>
      <iframe title="Mapa" style="border:0;border-radius:12px;width:100%;height:240px" loading="lazy" src="https://maps.google.com/maps?q=${encodeURIComponent(v.mapsQuery)}&output=embed"></iframe>
      <a class="btn tonal" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.mapsQuery)}" target="_blank" rel="noopener">Abrir no Google Maps</a></div>`; }
  if (sec === 'sponsors') c = S.ev.sponsors.map((s) => `<div class="card"><div class="label">${esc(s.tier)}</div><div class="title-m">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</div></div>`).join('');
  if (sec === 'faq') c = S.ev.faqs.map((f) => `<details class="card"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  if (sec === 'profile') c = `<form id="profForm" class="card filled" style="gap:16px">
      ${['name:Nome', 'company:Empresa', 'role:Cargo', 'linkedin:LinkedIn'].map((x) => { const [k, l] = x.split(':'); return `<div class="field"><label>${l}</label><input name="${k}" value="${esc(S.me[k])}"></div>`; }).join('')}
      <div class="chips">${S.ev.interests.map((i) => `<button type="button" class="chip ${S.me.interests.includes(i) ? 'on' : ''}" data-act="myint" data-v="${esc(i)}">${esc(i)}</button>`).join('')}</div>
      <button class="btn">Guardar</button>
      ${'Notification' in window && Notification.permission !== 'granted' ? '<button type="button" class="btn tonal" data-act="notif">Ativar notificações</button>' : ''}
      <button type="button" class="btn text" data-act="logout">Sair</button></form>`;
  return `<div class="chips scroll-x">${tabs.map(([k, l]) => `<button class="chip ${sec === k ? 'on' : ''}" data-act="moretab" data-id="${k}">${l}</button>`).join('')}</div>${c}`;
}

// ---------- eventos ----------
document.addEventListener('click', async (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { S.tab = tabBtn.dataset.tab; S.view = null; S.chatWith = null; render(); window.scrollTo(0, 0); if (S.tab === 'more') loadBoard().then(render); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id, v } = el.dataset;
  e.stopPropagation();
  try {
    if (act === 'authmode') { S.authMode = S.authMode === 'register' ? 'login' : 'register'; S.err = ''; }
    else if (act === 'pick') { S.pickInterests = S.pickInterests.includes(v) ? S.pickInterests.filter((x) => x !== v) : [...S.pickInterests, v]; }
    else if (act === 'back') { S.view = null; S.chatWith = null; await loadConns(); }
    else if (act === 'goto') { S.tab = el.dataset.tab; }
    else if (act === 'notes') { S.view = { type: 'notes' }; await api('/notifications', { method: 'POST' }); const shown = [...S.notes]; await loadNotes(); S.notes.forEach((n, i) => (n.read = false)); S.notes = shown; S.notes.forEach((n) => (n.read = true)); }
    else if (act === 'day') S.day = id;
    else if (act === 'favonly') S.favOnly = !S.favOnly;
    else if (act === 'fav') { const r = await api('/favorite', { method: 'POST', body: { sessionId: id } }); S.me.favorites = r.favorites; if ('Notification' in window && Notification.permission === 'default') enablePush(); }
    else if (act === 'session') S.view = { type: 'session', id };
    else if (act === 'person') S.view = { type: 'person', id };
    else if (act === 'nettab') S.netTab = id;
    else if (act === 'connect') { await api('/connect', { method: 'POST', body: { to: id } }); await Promise.all([loadConns(), loadPeople(), loadSugg()]); toast('Pedido enviado', 'Será avisado quando aceitarem.'); }
    else if (act === 'respond') { await api('/connect/respond', { method: 'POST', body: { id, accept: v === '1' } }); await Promise.all([loadConns(), loadPeople(), loadSugg()]); }
    else if (act === 'chat') { S.chatWith = id; S.chat = await api('/messages/' + id); S.view = null; }
    else if (act === 'vote') { await api('/polls/vote', { method: 'POST', body: { pollId: el.dataset.poll, option: +el.dataset.opt } }); await loadPolls(); }
    else if (act === 'upvote') { await api('/questions/upvote', { method: 'POST', body: { id } }); await loadQuestions(); }
    else if (act === 'qsess') S.qSession = id;
    else if (act === 'moretab') { S.moreTab = id; S.err = ''; if (id === 'rank') await loadBoard(); }
    else if (act === 'myint') { S.me.interests = S.me.interests.includes(v) ? S.me.interests.filter((x) => x !== v) : [...S.me.interests, v]; }
    else if (act === 'notif') { await enablePush(); }
    else if (act === 'logout') return logout();
  } catch (err) { toast('Erro', err.message); }
  render();
  if (S.chatWith) window.scrollTo(0, document.body.scrollHeight);
}, true);

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, d = Object.fromEntries(new FormData(f));
  try {
    if (f.id === 'authForm') {
      const r = await api(S.authMode === 'register' ? '/register' : '/login', { method: 'POST', body: { ...d, interests: S.pickInterests } });
      S.token = r.token; localStorage.setItem('ofg_token', r.token); S.err = '';
      await boot(); return;
    }
    if (f.id === 'ckForm') { await doCheckin(d.code); }
    if (f.id === 'profForm') { await api('/me', { method: 'PUT', body: { ...d, interests: S.me.interests } }); await loadMe(); toast('Perfil guardado'); }
    if (f.id === 'qForm') { await api('/questions', { method: 'POST', body: { sessionId: f.dataset.id, text: d.text, anonymous: !!d.anon } }); await loadQuestions(); f.reset(); }
    if (f.id === 'msgForm') { if (!d.text.trim()) return; const txt = d.text; f.reset(); await api('/messages', { method: 'POST', body: { to: S.chatWith, text: txt } }); }
  } catch (err) { S.err = err.message; if (f.id !== 'ckForm') toast('Erro', err.message); }
  render();
  if (S.chatWith) { window.scrollTo(0, document.body.scrollHeight); $('#msgForm input')?.focus(); }
});

let searchT;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'search') return;
  S.q = e.target.value; clearTimeout(searchT);
  searchT = setTimeout(async () => { await loadPeople(); const l = $('#peopleList'); if (l) l.innerHTML = S.people.map(personRow).join('') || '<div class="empty">Ninguém encontrado.</div>'; }, 250);
});

boot();
