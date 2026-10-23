// OFG Recife 2026 – PWA (vanilla JS, sem build)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n, cls = '') => `<span class="material-symbols-outlined ${cls}">${n}</span>`;

// ---------- tema (escuro/claro) ----------
// o modo claro é o padrão; só fica escuro se a pessoa o escolher (guardado como 'dark')
const getTheme = () => { try { return localStorage.getItem('ofg_theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } };
function applyTheme(t) {
  if (t === 'light') document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('ofg_theme', t); } catch { /* sem armazenamento: vale só nesta sessão */ }
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'light' ? '#F3F6FB' : '#111418';
}

// ---------- estado ----------
const S = { token: localStorage.getItem('ofg_token') || sessionStorage.getItem('ofg_token'), me: null, ev: null, tab: 'agenda', day: null, view: null, people: [], q: '', conns: [], sugg: [], polls: [], questions: [], notes: [], board: null, chat: [], chatWith: null, qSession: null, err: '', authMode: 'welcome', draft: {}, recoverSent: false, recoverEmail: '', pickInterests: [] };

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) { logout(); }
  if (!r.ok) throw new Error(j.error || `Erro do servidor (HTTP ${r.status})`);
  return j;
}
function logout() { localStorage.removeItem('ofg_token'); sessionStorage.removeItem('ofg_token'); S.token = null; S.me = null; S.authMode = 'welcome'; clearTimeout(syncTimer); try { rt?.removeAllChannels(); } catch {} rt = null; rtOk = false; render(); }

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
}

// ---------- tempo real (Supabase Realtime) + heartbeat ----------
// O servidor envia só um "sinal" por broadcast; o cliente refaz o fetch autenticado do que mudou.
let syncTimer, rt = null, rtOk = false, seenNotes = new Set(), pending = new Set(), flushT = null;
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

function schedule(kind) { // junta rajadas de sinais (ex.: 250 votos seguidos) num único refresh
  pending.add(kind); clearTimeout(flushT);
  flushT = setTimeout(async () => {
    const kinds = [...pending]; pending.clear();
    try {
      if (kinds.includes('ver')) {
        const ev = await api('/event'); S.ev.announcements = ev.announcements;
        await Promise.all([loadPolls(), loadQuestions(), S.tab === 'live' ? loadBoard() : null]);
      }
      if (kinds.includes('uv')) {
        await Promise.all([loadMe(), loadConns(), loadNotes(), loadSugg()]);
        if (S.chatWith) S.chat = await api('/messages/' + S.chatWith);
        S.notes.filter((n) => !n.read && !seenNotes.has(n.id)).slice(0, 3).forEach((n) => toast(n.title, n.body));
        S.notes.forEach((n) => seenNotes.add(n.id));
      }
      if (adminOn()) await loadAdmin();
    } catch { /* tenta no próximo sinal/heartbeat */ }
    if (!typing()) { render(); if (S.chatWith) toBottom(); }
  }, 600);
}

async function connectRealtime() {
  if (rt || !S.ev.realtime) return;
  try {
    const { createClient } = await import(SUPABASE_JS);
    rt = createClient(S.ev.realtime.url, S.ev.realtime.anonKey, { realtime: { params: { eventsPerSecond: 5 } } });
    rt.channel('ofg:all').on('broadcast', { event: 'ver' }, () => schedule('ver')).on('broadcast', { event: 'uv' }, () => schedule('uv'))
      .subscribe((st) => { rtOk = st === 'SUBSCRIBED'; });
    rt.channel('ofg:u:' + S.me.id).on('broadcast', { event: 'uv' }, () => schedule('uv')).subscribe();
  } catch { rt = null; rtOk = false; } // sem Realtime: o heartbeat faz refresh completo
}

function startSync() {
  clearTimeout(syncTimer);
  connectRealtime();
  const tick = async () => {
    if (!S.token || !S.me) return;
    if (!document.hidden) {
      try { await api('/sync'); } catch { /* offline */ }
      if (!rtOk) schedule('ver'), schedule('uv'); // reserva: sem Realtime, refresh a cada minuto
    }
    syncTimer = setTimeout(tick, 60000);
  };
  tick();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token && S.me) { schedule('ver'); schedule('uv'); } });
const typing = () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

// ---------- Web Push ----------
const b64 = (k) => Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('Notificações', 'Este navegador não suporta push. No iPhone, adicione a app ao ecrã principal primeiro.');
  if ((await Notification.requestPermission()) !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api('/push/key');
  if (!key) return toast('Notificações', 'Push não configurado no servidor.');
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
  // regresso do login com Google (modo redirect): troca o código de uso único pela sessão
  const sp = new URLSearchParams(location.search), gcode = sp.get('gcode'), gerr = sp.get('gerr');
  if (gcode || gerr) history.replaceState({}, '', '/');
  if (gcode) {
    setBusy(true);
    try { const r = await api('/google/exchange', { method: 'POST', body: { code: gcode } }); S.token = r.token; localStorage.setItem('ofg_token', r.token); }
    catch (e) { S.authMode = 'login'; setTimeout(() => toast('Login com Google', e.message), 300); }
    finally { setBusy(false); }
  }
  if (gerr) { S.authMode = 'login'; setTimeout(() => toast('Login com Google', 'Não foi possível validar a conta Google. Tente novamente.'), 300); }
  const rp = new URLSearchParams(location.search).get('reset');
  if (rp && !S.token) { S.authMode = 'recover'; S.recoverEmail = rp; S.recoverSent = true; history.replaceState({}, '', '/'); }
  S.day = S.ev.event.days.find((d) => d.date === new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10))?.id || S.ev.event.days[0].id;
  if (S.token) {
    try { await Promise.all([loadMe(), loadConns(), loadPolls(), loadQuestions(), loadNotes(), loadSugg(), loadPeople()]); S.notes.forEach((n) => seenNotes.add(n.id)); if (adminOn()) await loadAdmin(); startSync(); syncPush(); } catch (err) { if (S.token) { S.err = 'Não foi possível carregar a sua conta. Tente novamente.'; S.me = null; } /* 401: logout já tratado */ }
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
const TAGCLS = { 'Networking': 'green', 'Receção': 'gray' };
const nowTs = () => Date.now();
const isLive = (s) => sessionTs(s) <= nowTs() && nowTs() < sessionEnd(s);
const wazeUrl = (q) => `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes`;
const countdown = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60); return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`; };
const pct = (u) => Math.min(100, Math.round(((u.shared?.length || 0) / Math.max(S.me.interests.length, 1)) * 100));
const sharedWith = (u) => (u.interests || []).filter((i) => S.me.interests.includes(i));
const profilePct = () => Math.round(([S.me.name, S.me.company, S.me.role, S.me.linkedin, S.me.interests.length ? 'x' : ''].filter(Boolean).length / 5) * 100);

// A página não rola: só o <main> rola, e cabeçalho/navegação ficam sempre fixos no ecrã (sem sticky/fixed).
function toTop() { S.resetScroll = true; const m = $('main'); if (m) m.scrollTop = 0; setTimeout(() => { S.resetScroll = false; }, 0); }
function toBottom() { S.stickBottom = true; const m = $('main'); if (m) m.scrollTop = m.scrollHeight; setTimeout(() => { S.stickBottom = false; }, 0); }
let lastViewKey = '';
function setApp(html) {
  const app = $('#app'), old = app.querySelector('main');
  const key = [S.token && S.me ? (adminOn() ? 'a' + (S.adminTab || 'dash') : S.tab) : 'auth' + S.authMode + S.recoverSent, S.view?.type, S.view?.id, S.chatWith].join('|');
  const keep = old && key === lastViewKey ? old.scrollTop : 0; lastViewKey = key;
  app.innerHTML = html;
  const m = app.querySelector('main');
  if (m) m.scrollTop = S.resetScroll ? 0 : S.stickBottom ? m.scrollHeight : keep;
  window.scrollTo(0, 0); // evita o ecrã "deslocado" quando o teclado do telemóvel fecha
}

function render() {
  if (!S.token || !S.me) { setApp(authView()); mountGoogle(); return; }
  if (!S.me.company || !S.me.role) { setApp(onboardView()); return; }
  const unread = S.notes.filter((n) => !n.read).length;
  const pend = S.conns.filter((c) => c.status === 'pending' && c.incoming).length;
  const titles = { agenda: 'Agenda', network: 'Networking', live: 'Ao Vivo', event: 'Evento' };
  const v = S.view;
  const sub = S.chatWith || v;
  let body, title = titles[S.tab];
  if (S.chatWith) { body = chatView(); title = S.conns.find((c) => c.user.id === S.chatWith)?.user.name || 'Conversa'; }
  else if (v?.type === 'session') { body = sessionView(v.id); title = 'Sessão'; }
  else if (v?.type === 'person') { body = personView(v.id); title = 'Perfil'; }
  else if (v?.type === 'notes') { body = notesView(); title = 'Notificações'; }
  else if (v?.type === 'profile') { body = profileView(); title = 'O meu perfil'; }
  else if (v?.type === 'checkin') { body = checkinView(); title = 'Check-in'; }
  else if (adminOn()) { const at = S.adminTab || 'dash'; body = { dash: adminDash, users: adminUsers, comms: adminComms, live: adminLive }[at](); title = { dash: 'Painel', users: 'Inscritos', comms: 'Avisos', live: 'Enquetes' }[at]; }
  else body = { agenda: agendaView, network: networkView, live: liveView, event: eventView }[S.tab]();
  const left = sub
    ? `<button class="tool" data-act="back" aria-label="Voltar" style="background:none">${icon('arrow_back')}</button>`
    : `<img src="/icons/icon-192.png" alt="OFG">`;
  const adm = adminOn();
  const modeBtn = S.me.isAdmin ? `<button class="mode-btn ${adm ? 'on' : ''}" data-act="mode" aria-label="Alternar entre administrador e usuário">${icon(adm ? 'admin_panel_settings' : 'person', 'i-s')}<span class="lbl">${adm ? 'Admin' : 'Usuário'}</span></button>` : '';
  const tools = S.chatWith ? '' : `<div class="tools">${modeBtn}
      ${adm ? '' : `<button class="tool" data-act="checkin" aria-label="Check-in">${icon('qr_code_scanner')}</button>`}
      <button class="tool" data-act="notes" aria-label="Notificações">${icon('notifications')}${unread ? '<span class="dot"></span>' : ''}</button>
      <button class="me-btn" data-act="profile" aria-label="Perfil">${icon('person', 'i-s')}</button></div>`;
  const tabs = adm ? [['dash', 'Painel', 'dashboard'], ['users', 'Inscritos', 'group'], ['comms', 'Avisos', 'campaign'], ['live', 'Enquetes', 'how_to_vote']] : [['agenda', 'Agenda', 'calendar_month'], ['network', 'Networking', 'groups'], ['live', 'Ao Vivo', 'sensors'], ['event', 'Evento', 'domain']];
  const cur = adm ? (S.adminTab || 'dash') : S.tab;
  setApp(`<div class="shell"><div class="topbar"><div class="brand">${left}<div class="clip"><div class="eyebrow blue">OFG Recife 2026</div><h1>${esc(title)}</h1></div></div>${tools}</div>
    <main>${body}</main>
    ${S.chatWith ? composer() : `<nav class="nav"><div class="nav-inner">${tabs.map(([k, l, ic]) => `<button data-tab="${k}" class="${cur === k && !sub ? 'on' : ''} ${k === 'live' && !adm ? 'live-tab' : ''}"><span class="pill">${icon(ic, cur === k && !sub ? 'fill' : '')}</span>${l}${k === 'network' && !adm && pend ? `<span class="badge">${pend}</span>` : ''}</button>`).join('')}</div></nav>`}</div>`);
  if (adm && !sub && (S.adminTab || 'dash') === 'dash') drawQRs();
}

// ----- Autenticação (boas-vindas, criar conta, entrar, recuperar) -----
const field = (name, label, ph, o = {}) => `<div class="field"><div class="row between"><label>${label}${o.req ? ' <span style="color:var(--primary)">*</span>' : ''}</label>${o.hint ? `<span class="eyebrow" style="font-weight:500">${o.hint}</span>` : ''}</div>
  <div class="inp">${icon(o.icon || 'badge')}<input name="${name}" type="${o.type || 'text'}" placeholder="${esc(ph)}" ${o.req ? 'required' : ''} ${o.ac ? `autocomplete="${o.ac}"` : ''} ${o.min ? `minlength="${o.min}"` : ''} value="${esc(o.value || S.draft[name] || '')}">${o.pw ? `<button type="button" class="eye" data-act="togglepw" aria-label="Mostrar senha">${icon('visibility')}</button>` : ''}</div></div>`;
const authTop = (title) => `<div class="authbar"><button class="tool" data-act="authmode" data-v="welcome" aria-label="Voltar" style="background:none">${icon('arrow_back')}</button><span class="ofgtag">OFG</span><b class="grow clip">${title}</b></div>`;
const venueLine = () => { const v = S.ev.event.venue; return `<a class="card pad-s row" style="text-decoration:none;color:inherit" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.mapsQuery)}" target="_blank" rel="noopener"><div class="avatar" style="border-radius:12px;background:var(--elevated);color:var(--primary)">${icon('location_on')}</div><div class="grow"><b class="clip" style="display:block">Hub Plural Espinheiro · Recife</b><div class="muted clip">${esc(v.room)}</div></div>${icon('chevron_right')}</a>`; };
const googleBlock = (sepAfter) => S.ev.googleClientId ? `<div class="gwrap">${sepAfter ? '<div class="or"><span>ou</span></div>' : ''}<div id="gbtn" class="gbtn" aria-label="Continuar com Google"></div>${sepAfter ? '' : '<div class="or"><span>ou preencha o formulário</span></div>'}</div>` : '';
const legalLine = () => `<p class="muted" style="text-align:center">Ao continuar, aceita os <a href="/termos" target="_blank" rel="noopener">Termos de Serviço</a> e a <a href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.</p>`;
const supportCard = (txt) => `<div class="card pad-s row" style="gap:12px">${icon('support_agent')}<p class="muted" style="text-align:center;flex:1">${txt}</p></div>`;

let gisReady = null, gisInit = false;
const loadGIS = () => (gisReady ??= new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = () => { gisReady = null; fail(new Error('gis')); }; document.head.append(s); }));
async function onGoogle(resp) {
  setBusy(true);
  try { const r = await api('/google', { method: 'POST', body: { credential: resp.credential } }); await startSession(r.token, true); }
  catch (e) { S.err = e.message; toast('Login com Google', e.message); render(); }
  finally { setBusy(false); }
}
async function mountGoogle() {
  const el = document.getElementById('gbtn'); if (!el || !S.ev?.googleClientId) return;
  try { await loadGIS(); } catch { el.innerHTML = '<div class="muted" style="text-align:center">Login com Google indisponível sem ligação aos servidores do Google.</div>'; return; }
  const g = window.google?.accounts?.id; if (!g) return;
  if (!gisInit) {
    // com URL canónica configurada: o Google devolve o utilizador para lá (modo redirect); senão, popup na própria página
    const cfg = { client_id: S.ev.googleClientId, auto_select: false, cancel_on_tap_outside: true };
    if (S.ev.googleLoginUri) Object.assign(cfg, { ux_mode: 'redirect', login_uri: S.ev.googleLoginUri });
    else Object.assign(cfg, { ux_mode: 'popup', callback: onGoogle });
    g.initialize(cfg); gisInit = true;
  }
  const cur = document.getElementById('gbtn'); if (!cur) return;
  g.renderButton(cur, { type: 'standard', theme: getTheme() === 'dark' ? 'filled_black' : 'outline', size: 'large', text: 'continue_with', shape: 'pill', logo_alignment: 'left', locale: 'pt-BR', width: Math.min(400, Math.floor(cur.clientWidth) || 280) });
}

// perfil incompleto (conta criada com Google): empresa e cargo são obrigatórios antes de entrar
function onboardView() {
  const first = (S.me.name || '').split(' ')[0];
  return `<div class="shell"><main style="padding-top:calc(env(safe-area-inset-top) + 16px);padding-bottom:32px">
    <div class="card hero"><div class="eyebrow">Quase lá</div><h1 class="display" style="font-size:28px;color:var(--ink)">Olá, ${esc(first)}!</h1><p style="color:var(--hero-sub)">Complete o seu perfil para entrar no evento e receber sugestões de networking.</p></div>
    <form id="onbForm" class="card" style="gap:18px">
      ${field('company', 'Empresa', 'Nome da sua organização', { req: 1, icon: 'domain', ac: 'organization' })}
      ${field('role', 'Cargo', 'Ex: Diretor de RH, CEO, Conselheiro…', { req: 1, icon: 'work', ac: 'organization-title' })}
      ${field('phone', 'Telefone', '+55 81 90000-0000', { req: 1, hint: 'Com DDD / indicativo', icon: 'call', type: 'tel', ac: 'tel' })}
      ${field('linkedin', 'LinkedIn', 'linkedin.com/in/seuperfil', { hint: 'Opcional', icon: 'share' })}
      <div><div class="row between"><span class="label" style="max-width:60%">Interesses</span><b style="color:var(--primary);font-size:12px">${S.pickInterests.length} selecionados</b></div>
        <div class="chips" style="margin-top:10px">${S.ev.interests.map((i) => `<button type="button" class="chip ${S.pickInterests.includes(i) ? 'on' : ''}" data-act="pick" data-v="${esc(i)}">${esc(i)}</button>`).join('')}</div></div>
      ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
      <button class="btn block">Entrar no evento ${icon('arrow_forward', 'i-s')}</button>
      <button type="button" class="btn text block" data-act="logout" style="color:var(--text)">Sair</button></form>
  </main></div>`;
}

function authView() {
  const mode = S.authMode, e = S.ev.event;
  let inner;
  if (mode === 'welcome') inner = `
    <div class="card" style="padding:16px">
      <div class="hero-img"><video src="/media/intro.mp4" autoplay muted loop playsinline preload="metadata" aria-hidden="true"></video><img class="hero-logo" src="/media/logo-ofg.png" alt="Oporto Forte Group"><span class="pill-tag" style="position:absolute;top:12px;right:12px;background:rgba(17,20,24,.75);color:#F1F5F9"><span class="d" style="background:var(--live)"></span>Edição especial</span>
        <span class="pill-tag" style="position:absolute;left:12px;bottom:12px;background:var(--primary);color:var(--on-primary)">${icon('event', 'i-s')} 3 · 4 · 5 novembro 2026 · Recife</span></div>
      <div class="row" style="gap:10px;margin-top:4px"><span style="width:36px;height:4px;border-radius:2px;background:var(--primary)"></span><span class="eyebrow blue" style="color:var(--primary)">${esc(e.tagline.replace(' e ', ' & '))}</span></div>
      <h1 class="display" style="font-size:36px;line-height:42px;letter-spacing:-.03em">OFG Recife <span style="color:var(--primary)">2026</span></h1>
      <h2 class="h-md" style="color:var(--primary);font-weight:500">33 Anos Oporto Forte Group</h2>
      <p style="color:var(--text2);font-size:16px;line-height:26px">O ponto de encontro exclusivo para lideranças corporativas, governança e internacionalização no Hub Plural Espinheiro.</p>
      <div class="chips" style="flex-direction:column;align-items:flex-start">${[['groups', 'Encontro para Líderes e Gestores'], ['public', 'Portugal & Brasil'], ['lightbulb', 'Saúde Mental & Inovação']].map(([i, t]) => `<span class="chip static" style="min-height:38px;font-size:14px;color:var(--text)">${icon(i, 'i-s')} ${t}</span>`).join('')}</div></div>
    <div class="card pad-s"><div class="row top"><div class="avatar" style="border-radius:14px;background:var(--elevated);color:var(--primary)">${icon('qr_code_scanner')}</div>
      <div class="grow"><div class="row between" style="flex-wrap:wrap;gap:6px"><h3 class="h-md">Acesso Rápido</h3><span class="pill-tag green"><span class="d"></span>Check-in QR</span></div>
      <p class="muted">Já está no Hub Plural Espinheiro? Crie o seu perfil e faça check-in com o QR code da receção.</p></div></div></div>
    <button class="btn block" data-act="authmode" data-v="register">${icon('assignment_ind')} Criar meu perfil no evento</button>
    <button class="btn tonal block" data-act="authmode" data-v="login">${icon('login')} Já tenho conta / Entrar</button>
    ${legalLine()}
    ${venueLine()}
    <p class="muted" style="text-align:center">Precisa de suporte com a sua inscrição? Fale com a organização.</p>
    <div class="row" style="justify-content:center;gap:16px;flex-wrap:wrap"><b class="muted row" style="gap:6px">${icon('domain', 'i-s')} Oporto Forte Group</b><b class="muted row" style="gap:6px">${icon('public', 'i-s')} Porto Digital</b></div>
    <div class="eyebrow" style="text-align:center">Hub de conexões atlânticas · 1993 - 2026</div>`;
  else if (mode === 'register') inner = `${authTop('Executive Registration')}
    <div class="card hero" style="position:relative;overflow:hidden"><div class="row between"><span class="eyebrow" style="color:var(--hero-sub)">3 · 4 · 5 novembro 2026 · Recife</span><span class="pill-tag" style="background:var(--hero-tint);color:var(--ink)"><span class="d" style="color:var(--success)"></span>Exclusivo</span></div>
      <h1 class="display" style="font-size:30px;color:var(--ink)">OFG Recife 2026</h1><p style="color:var(--hero-sub)">${esc(e.tagline)}</p></div>
    <div><h2 class="title-l">Crie o seu perfil</h2><p class="muted">Apenas 250 executivos convidados. Os seus dados permitirão o networking inteligente e o agendamento de reuniões.</p></div>
    ${googleBlock(false)}
    <form id="authForm" class="card" style="gap:18px">
      ${field('name', 'Nome', 'Seu nome completo', { req: 1, hint: 'Como deseja ser chamado', icon: 'badge', ac: 'name' })}
      ${field('email', 'Email corporativo', 'seu.email@empresa.com', { req: 1, hint: 'Apenas e-mail empresarial', icon: 'alternate_email', type: 'email', ac: 'email' })}
      ${field('company', 'Empresa', 'Nome da sua organização', { req: 1, icon: 'domain', ac: 'organization' })}
      ${field('role', 'Cargo', 'Ex: Diretor de RH, CEO, Conselheiro…', { req: 1, icon: 'work', ac: 'organization-title' })}
      ${field('phone', 'Telefone', '+55 81 90000-0000', { req: 1, hint: 'Com DDD / indicativo', icon: 'call', type: 'tel', ac: 'tel' })}
      ${field('linkedin', 'LinkedIn', 'linkedin.com/in/seuperfil', { hint: 'Opcional', icon: 'share' })}
      ${field('password', 'Criar senha de acesso', 'Sua senha restrita', { req: 1, hint: 'Mínimo 8 dígitos', icon: 'lock', type: 'password', pw: 1, min: 8, ac: 'new-password' })}
      <div><div class="row between"><span class="label" style="max-width:60%">Interesses (para sugestões de networking)</span><b style="color:var(--primary);font-size:12px">${S.pickInterests.length} selecionados</b></div><p class="muted" style="margin:4px 0 10px">Toque para selecionar os tópicos que você deseja debater em mesas temáticas.</p>
        <div class="chips">${S.ev.interests.map((i) => `<button type="button" class="chip ${S.pickInterests.includes(i) ? 'on' : ''}" data-act="pick" data-v="${esc(i)}">${esc(i)}</button>`).join('')}</div></div>
      ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
      <button class="btn block">Entrar no evento ${icon('arrow_forward', 'i-s')}</button>
      <button type="button" class="btn text block" data-act="authmode" data-v="login" style="color:var(--text)">Já tenho conta</button></form>
    <p class="muted row" style="gap:8px">${icon('shield', 'i-s')} Os seus dados ficam visíveis apenas para os outros participantes do evento.</p>
    ${legalLine()}`;
  else if (mode === 'login') inner = `
    <div class="card"><div class="row between" style="flex-wrap:wrap;gap:8px"><div class="row" style="gap:12px"><div class="avatar" style="border-radius:12px;background:var(--elevated);color:var(--primary)">${icon('verified_user')}</div><b class="eyebrow" style="color:var(--text)">OFG Recife 2026 · 33 anos</b></div><span class="pill-tag gray"><span class="d" style="color:var(--success)"></span>Lobby ativo</span></div>
      <span class="pill-tag" style="align-self:flex-start;text-transform:none;letter-spacing:.02em">Rotas &amp; Oportunidades</span>
      <h1 class="display">Acessar Credencial</h1><p class="muted" style="font-size:15px">Entre com seu e-mail corporativo cadastrado para acessar a programação, reuniões e networking.</p></div>
    <div class="hero-img has-photo" style="height:170px;border-radius:20px"><img class="hero-photo" src="/media/hub-plural.jpg" alt="Hub Plural Espinheiro" loading="eager"><b class="photo-cap row">${icon('location_on')} Hub Plural Espinheiro · Recife/PE</b></div>
    <form id="authForm" class="field" style="gap:16px">
      ${field('email', 'E-mail corporativo', 'ex: nome@empresa.com', { req: 1, hint: 'Acesso homologado', icon: 'mail', type: 'email', ac: 'email' })}
      ${field('password', 'Senha de acesso', 'Sua senha de acesso', { req: 1, icon: 'lock', type: 'password', pw: 1, ac: 'current-password' })}
      <div class="row between"><label class="row" style="gap:10px"><input type="checkbox" name="remember" checked> Lembrar de mim</label><button type="button" class="btn text small" data-act="authmode" data-v="recover">Esqueceu a senha?</button></div>
      ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
      <button class="btn block">Entrar no App do Evento ${icon('arrow_forward', 'i-s')}</button></form>
    ${googleBlock(true)}
    <p style="text-align:center" class="muted">Ainda não tem cadastro? <button class="btn text small" data-act="authmode" data-v="register" style="padding:0 4px;height:auto">Crie o seu perfil</button></p>
    ${legalLine()}
    ${supportCard('Dúvidas com seu acesso? Fale com o credenciamento presencial (receção do evento).')}`;
  else if (mode === 'recover') inner = `${authTop('Identity Verification')}
    <div style="text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px"><div class="avatar lg" style="width:84px;height:84px;background:var(--elevated);color:var(--primary)">${icon('lock')}</div>
      <span class="pill-tag gray"><span class="d" style="color:var(--success)"></span>OFG Recife 2026 · Acesso seguro</span>
      <h1 class="display">Recuperar acesso</h1>
      <p class="muted" style="font-size:15px">${S.recoverSent ? `Enviámos um código PIN para <b>${esc(S.recoverEmail)}</b>. Introduza-o abaixo com a sua nova senha.` : 'Informe o e-mail corporativo que você utilizou no cadastro do evento. Enviaremos um link e código PIN para redefinir sua senha imediatamente.'}</p></div>
    ${S.recoverSent ? `<form id="resetForm" class="card" style="gap:16px">
        ${field('pin', 'Código PIN', '6 dígitos', { req: 1, icon: 'verified_user', ac: 'one-time-code' })}
        ${field('password', 'Nova senha', 'Mínimo 8 caracteres', { req: 1, icon: 'lock', type: 'password', pw: 1, min: 8, ac: 'new-password' })}
        ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}<button class="btn block">Redefinir e entrar ${icon('arrow_forward', 'i-s')}</button></form>`
    : `<form id="recoverForm" class="card" style="gap:16px">${field('email', 'E-mail corporativo cadastrado', 'seu.email@empresa.com', { req: 1, hint: 'Corporativo', icon: 'alternate_email', type: 'email', ac: 'email', value: S.recoverEmail })}
        ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}<button class="btn block">${icon('send', 'i-s')} Enviar Instruções de Recuperação</button></form>`}
    <div class="card pad-s row top" style="background:var(--input)"><div class="avatar" style="border-radius:12px;background:var(--elevated);color:var(--primary)">${icon('assignment_ind')}</div><div><div class="eyebrow blue" style="color:var(--primary)">Assistência presencial</div><p class="muted"><b style="color:var(--text)">Participantes no local:</b> caso esteja no Hub Plural Espinheiro, a equipa de credenciamento na <b style="color:var(--text)">receção do evento</b> pode ajudá-lo presencialmente.</p></div></div>
    <button class="btn text block" data-act="authmode" data-v="login">${icon('arrow_back', 'i-s')} Lembrou sua senha? Voltar para o login</button>
    <div class="eyebrow" style="text-align:center">Central OFG</div>
    <p class="muted" style="text-align:center">Não recebeu o e-mail? ${S.recoverSent ? '<button class="btn text small" data-act="resend" style="padding:0 4px;height:auto;text-decoration:underline">Reenviar código</button>' : 'Verifique o spam ou tente novamente.'}</p>`;
  return `<div class="shell"><main style="padding-top:calc(env(safe-area-inset-top) + 16px);padding-bottom:32px">${inner}</main></div>`;
}

// ----- Agenda -----
function sessionCard(s) {
  const fav = S.me.favorites.includes(s.id), live = isLive(s), past = sessionEnd(s) < nowTs();
  const hasSpeaker = s.speaker && s.speaker !== 'A confirmar';
  return `<div class="card clickable ${live ? 'now' : ''}" data-act="session" data-id="${s.id}" style="${past ? 'opacity:.6' : ''}">
    <div class="row between"><div class="time">${s.start} <small>- ${s.end}</small></div>
      <div class="row" style="gap:6px">${live ? '<span class="pill-tag live"><span class="d"></span>Ao vivo</span>' : ''}<span class="pill-tag ${TAGCLS[s.tag] || ''}">${esc(s.tag)}</span></div></div>
    <h3 class="h-md">${esc(s.title)}</h3>
    <p class="muted">${esc(s.desc)}</p>
    ${s.speaker ? `<div class="inner row"><div class="avatar sm">${hasSpeaker ? esc(initials(s.speaker)) : '?'}</div><div class="grow clip"><b>${hasSpeaker ? esc(s.speaker) : 'Palestrante a confirmar'}</b></div></div>` : ''}
    <div class="row between"><span class="muted row" style="gap:6px">${icon('domain', 'i-s')}${esc(s.room)}</span>
      <button class="btn-pill ${fav ? 'on' : ''}" data-act="fav" data-id="${s.id}">${icon(fav ? 'notifications_active' : 'notifications', 'i-s ' + (fav ? 'fill' : ''))}${fav ? 'Notificação ativa' : 'Notificar-me'}</button></div></div>`;
}

function agendaView() {
  const t = nowTs(), days = S.ev.event.days;
  const all = [...S.ev.sessions].sort((a, b) => sessionTs(a) - sessionTs(b));
  const next = all.find((s) => sessionEnd(s) > t);
  const live = next && isLive(next);
  const ann = S.ev.announcements[0];
  const list = all.filter((s) => s.day === S.day && (!S.room || s.room === S.room) && (!S.favOnly || S.me.favorites.includes(s.id)));
  const todayId = days.find((d) => d.date === new Date(t - 3 * 3600e3).toISOString().slice(0, 10))?.id;
  return `
    ${next ? `<div class="card glow clickable" data-act="session" data-id="${next.id}"><div class="row top"><div class="avatar" style="background:rgba(239,68,68,.2);color:var(--live);border-radius:12px">${icon('sensors', 'fill')}</div>
      <div class="grow"><div class="row" style="gap:2px 6px;flex-wrap:wrap"><span class="eyebrow" style="color:${live ? '#f87171' : 'var(--error)'}">${live ? 'Ao vivo' : 'Em breve'}</span><span class="eyebrow">· ${esc(next.room)}</span></div>
      <h3 class="title-m">${esc(next.title)}</h3><p class="muted clip">${esc(next.desc)}</p></div>
      <div class="inner" style="text-align:center;padding:8px 12px"><div class="eyebrow">${live ? 'Termina' : 'Inicia em'}</div><div class="mono" style="font-weight:700;font-size:18px">${live ? next.end : countdown(sessionTs(next) - t)}</div></div></div></div>` : ''}
    ${ann ? `<div class="banner ${ann.kind === 'alert' ? 'alert' : ''}"><b>${esc(ann.title)}</b><div>${esc(ann.body)}</div><div class="muted">${timeAgo(ann.at)}</div></div>` : ''}
    <div class="sec-title"><span class="label">Cronograma trienal</span><span class="muted row" style="gap:4px">${icon('schedule', 'i-s')}Fuso Recife (GMT-3)</span></div>
    <div class="chips scroll-x" style="gap:12px">${days.map((d) => `<button class="day ${S.day === d.id ? 'on' : ''}" data-act="day" data-id="${d.id}"><span class="eyebrow"><span>${new Date(d.date + 'T12:00:00').getDate().toString().padStart(2, '0')} NOV</span>${d.id === todayId ? '<span>●</span>' : ''}</span><span class="t">${esc(d.title)}</span><span class="s">${esc(d.subtitle)}</span></button>`).join('')}</div>
    <div class="chips scroll-x"><button class="chip solid ${!S.room && !S.favOnly ? 'on' : ''}" data-act="room" data-v="">Todas as Salas</button>${S.ev.event.rooms.map((r) => `<button class="chip ${S.room === r ? 'on' : ''}" data-act="room" data-v="${esc(r)}">${esc(r)}</button>`).join('')}<button class="chip ${S.favOnly ? 'on' : ''}" data-act="favonly">★ Minhas</button></div>
    ${list.map(sessionCard).join('') || '<div class="empty">Nada por aqui.</div>'}`;
}

function sessionView(id) {
  const s = S.ev.sessions.find((x) => x.id === id), fav = S.me.favorites.includes(id);
  const qs = S.questions.filter((q) => q.sessionId === id), polls = S.polls.filter((p) => p.sessionId === id);
  return `<div class="card"><div class="row" style="gap:6px;flex-wrap:wrap">${isLive(s) ? '<span class="pill-tag live"><span class="d"></span>Ao vivo</span>' : ''}<span class="pill-tag ${TAGCLS[s.tag] || ''}">${esc(s.tag)}</span></div>
    <div class="label">${fmtDay(S.ev.event.days.find((d) => d.id === s.day).date)} · ${s.start}–${s.end} · ${esc(s.room)}</div>
    <h2 class="title-l">${esc(s.title)}</h2>${s.speaker ? `<div class="muted">${esc(s.speaker)}</div>` : ''}<p>${esc(s.desc)}</p>
    <button class="btn ${fav ? 'tonal' : ''}" data-act="fav" data-id="${id}">${icon(fav ? 'notifications_active' : 'notifications', fav ? 'fill' : '')} ${fav ? 'Notificação ativa' : 'Notificar-me 10 min antes'}</button></div>
    ${polls.map(pollCard).join('')}
    <div class="sec-title"><h3>Perguntas ao vivo</h3></div>
    ${qaForm(id)}${qs.map(questionCard).join('')}`;
}

const qaForm = (sid) => `<form id="qForm" class="card filled" data-id="${sid}"><div class="field"><textarea name="text" maxlength="300" required placeholder="Faça uma pergunta objetiva para o palestrante…"></textarea></div>
  <div class="row between"><label class="row muted" style="gap:8px"><input type="checkbox" name="anon"> Enviar anonimamente</label><button class="btn small">Enviar ${icon('send', 'i-s')}</button></div></form>`;
const questionCard = (q) => `<div class="card pad-s row top"><div class="grow"><div>${esc(q.text)}</div><div class="muted">${esc(q.author)}</div></div>
  <button class="iconbtn ${q.mine ? 'on' : ''}" data-act="upvote" data-id="${q.id}" style="flex-direction:column;height:auto;padding:6px 0;gap:0;line-height:1.1">${icon('keyboard_arrow_up')}<b class="mono">${q.votes}</b></button></div>`;

function pollCard(p) {
  const total = p.counts.reduce((a, b) => a + b, 0), tot = total || 1;
  return `<div class="card"><div class="row between"><span class="eyebrow blue">Enquete ao vivo</span><span class="pill-tag ${p.open ? 'green' : 'gray'}">${p.open ? 'Votação aberta' : 'Encerrada'}</span></div>
    <h3 class="title-m">${esc(p.question)}</h3><div class="muted">${total} voto${total === 1 ? '' : 's'}</div>
    ${p.options.map((o, i) => `<div class="opt ${p.myVote === i ? 'mine' : ''}" ${p.open ? `data-act="vote" data-poll="${p.id}" data-opt="${i}"` : ''}><i style="width:${(p.counts[i] / tot) * 100}%"></i><span class="rad">${p.myVote === i ? icon('check', 'i-s') : ''}</span><span class="grow">${esc(o)}</span><b class="mono">${Math.round((p.counts[i] / tot) * 100)}%</b></div>`).join('')}</div>`;
}

// ----- Networking -----
function personRow(u) {
  const shared = u.shared || sharedWith(u);
  const connected = u.conn === 'accepted';
  const label = connected ? 'Conectados' : u.conn === 'pending' ? (u.incoming ? 'Aceitar' : 'Pendente') : 'Trocar Contato';
  const disabled = connected || (u.conn === 'pending' && !u.incoming);
  return `<div class="card pad-s clickable" data-act="person" data-id="${u.id}">
    <div class="row"><div class="avatar">${esc(initials(u.name))}</div><div class="grow"><div class="title-m clip">${esc(u.name)}</div><div class="muted clip">${esc([u.role, u.company].filter(Boolean).join(' · '))}</div></div></div>
    ${(u.interests || []).length ? `<div class="chips">${u.interests.slice(0, 4).map((i) => `<span class="chip static ${shared.includes(i) ? 'on' : ''}">${shared.includes(i) ? '✓ ' : ''}${esc(i)}</span>`).join('')}</div>` : ''}
    <div class="row"><button class="btn tonal small grow" data-act="${connected ? 'chat' : 'person'}" data-id="${u.id}">${icon('chat_bubble', 'i-s')} Mensagem 1:1</button>
      <button class="btn small grow" data-act="connect" data-id="${u.id}" ${disabled ? 'disabled' : ''}>${icon(connected ? 'check_circle' : 'contact_page', 'i-s')} ${label}</button></div></div>`;
}

function networkView() {
  const pend = S.conns.filter((c) => c.status === 'pending' && c.incoming);
  const mine = S.conns.filter((c) => c.status === 'accepted');
  const sub = S.netTab || 'all';
  const pc = profilePct();
  const people = S.interest ? S.people.filter((u) => u.interests.includes(S.interest)) : S.people;
  const filters = S.ev.interests.slice(0, 4);
  return `
    <div class="card pad-s row"><div class="avatar" style="background:none;border:2px solid var(--primary);color:var(--primary)">${icon(pc === 100 ? 'check_circle' : 'person')}</div>
      <div class="grow"><div class="eyebrow" style="color:var(--success)">Perfil ${pc}% completo</div><div class="title-m">${pc === 100 ? 'Pronto para fazer networking' : 'Complete para melhores sugestões'}</div></div>
      <button class="btn tonal small" data-act="profile">Editar</button></div>
    <div class="search">${icon('search')}<input id="search" type="search" placeholder="Buscar entre os participantes…" value="${esc(S.q)}"></div>
    <div class="chips scroll-x"><button class="chip solid ${sub === 'all' && !S.interest ? 'on' : ''}" data-act="interest" data-v="">Todos (${S.people.length})</button>
      ${filters.map((f) => `<button class="chip ${S.interest === f && sub === 'all' ? 'on' : ''}" data-act="interest" data-v="${esc(f)}">${esc(f)}</button>`).join('')}
      <button class="chip ${sub === 'conn' ? 'on' : ''}" data-act="nettab" data-id="${sub === 'conn' ? 'all' : 'conn'}">Conexões (${mine.length})</button></div>
    ${sub === 'all' ? `
      ${pend.map((c) => `<div class="card pad-s row"><div class="avatar">${esc(initials(c.user.name))}</div><div class="grow"><b>${esc(c.user.name)}</b><div class="muted">${esc(c.user.company || '')} quer trocar contacto</div></div>
        <button class="btn small" data-act="respond" data-id="${c.id}" data-v="1">Aceitar</button><button class="btn small text" data-act="respond" data-id="${c.id}" data-v="0">Ignorar</button></div>`).join('')}
      ${!S.q && !S.interest && S.sugg.length ? `<div class="sec-title"><h3 class="row" style="gap:8px;color:var(--primary)">${icon('auto_awesome')}Afinidade</h3><span class="eyebrow blue">Baseado nos seus interesses</span></div>
        <div class="h-scroll">${S.sugg.map((u) => `<div class="card clickable" data-act="person" data-id="${u.id}"><div class="row between"><div class="avatar">${esc(initials(u.name))}</div><span class="pill-tag">${icon('bolt', 'i-s')}${pct(u)}% match</span></div>
          <div><div class="title-m clip">${esc(u.name)}</div><div class="muted clip">${esc([u.role, u.company].filter(Boolean).join(' · '))}</div></div>
          <div class="chips">${(u.shared || []).slice(0, 3).map((i) => `<span class="chip static on">${esc(i)}</span>`).join('')}</div>
          <button class="btn small block" data-act="connect" data-id="${u.id}">${icon('person_add', 'i-s')} Trocar Contato</button></div>`).join('')}</div>` : ''}
      <div class="sec-title"><h3>Participantes no Evento</h3><span class="chip static">${people.length}</span></div>
      <div id="peopleList" style="display:flex;flex-direction:column;gap:12px">${people.map(personRow).join('') || '<div class="empty">Ninguém encontrado ainda.</div>'}</div>`
    : mine.map((c) => `<div class="card pad-s clickable" data-act="chat" data-id="${c.user.id}"><div class="row"><div class="avatar">${esc(initials(c.user.name))}</div>
        <div class="grow"><div class="title-m clip">${esc(c.user.name)}</div><div class="muted clip">${esc(c.lastMessage ? c.lastMessage.text : [c.user.role, c.user.company].filter(Boolean).join(' · '))}</div></div>${icon('chat_bubble')}</div></div>`).join('') || '<div class="empty">Ainda sem conexões. Troque contactos na aba Todos.</div>'}`;
}

function personView(id) {
  const conn = S.conns.find((c) => c.user.id === id);
  const u = conn?.user || S.people.find((p) => p.id === id) || S.sugg.find((p) => p.id === id);
  if (!u) return '<div class="empty">Não encontrado.</div>';
  const accepted = conn?.status === 'accepted';
  return `<div class="card"><div class="row"><div class="avatar lg">${esc(initials(u.name))}</div><div><h2 class="title-l">${esc(u.name)}</h2><div class="muted">${esc([u.role, u.company].filter(Boolean).join(' · '))}</div></div></div>
    <div class="chips">${(u.interests || []).map((i) => `<span class="chip static ${S.me.interests.includes(i) ? 'on' : ''}">${esc(i)}</span>`).join('')}</div>
    ${accepted ? `<div class="hr"></div><div class="label">Contactos partilhados</div><div>✉ <a href="mailto:${esc(u.email)}">${esc(u.email)}</a></div>${u.linkedin ? `<div>in <a href="${esc(u.linkedin.startsWith('http') ? u.linkedin : 'https://' + u.linkedin)}" target="_blank" rel="noopener">${esc(u.linkedin)}</a></div>` : ''}<button class="btn" data-act="chat" data-id="${u.id}">${icon('send')} Enviar mensagem</button>`
      : `<button class="btn" data-act="connect" data-id="${u.id}" ${conn && !conn.incoming ? 'disabled' : ''}>${icon('contact_page')} ${conn ? (conn.incoming ? 'Aceitar pedido' : 'Pedido enviado') : 'Trocar Contato'}</button><p class="muted">Ao aceitar, vocês trocam email e LinkedIn e podem conversar.</p>`}</div>`;
}

function chatView() {
  return `<div class="chat">${S.chat.map((m) => `<div class="bubble ${m.from === S.me.id ? 'me' : ''}">${esc(m.text)}</div>`).join('') || '<div class="empty">Diga olá 👋</div>'}</div>`;
}
const composer = () => `<form id="msgForm" class="composer"><input name="text" placeholder="Mensagem" autocomplete="off" maxlength="1000"><button class="btn" aria-label="Enviar">${icon('send')}</button></form>`;

// ----- Diálogo de confirmação (substitui window.confirm; acessível e com estilo da app) -----
function confirmDialog({ title, body = '', confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const el = document.createElement('div'); el.id = 'dlg';
    el.innerHTML = `<div class="dlg-box" role="alertdialog" aria-modal="true" aria-labelledby="dlgT" aria-describedby="dlgB">
      <div class="dlg-ic ${danger ? 'danger' : ''}">${icon(danger ? 'warning' : 'help')}</div>
      <h3 id="dlgT" class="h-md">${esc(title)}</h3><div id="dlgB" class="muted dlg-body">${body}</div>
      <div class="dlg-actions"><button class="btn tonal" data-d="0">Cancelar</button><button class="btn ${danger ? 'danger' : ''}" data-d="1">${esc(confirmLabel)}</button></div></div>`;
    const done = (v) => { document.removeEventListener('keydown', onKey, true); el.remove(); prev?.focus?.(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } else if (e.key === 'Tab') { const b = [...el.querySelectorAll('button')]; const i = b.indexOf(document.activeElement); e.preventDefault(); b[(i + (e.shiftKey ? b.length - 1 : 1)) % b.length].focus(); } };
    el.addEventListener('click', (e) => { if (e.target === el) done(false); const d = e.target.closest('[data-d]'); if (d) done(d.dataset.d === '1'); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(el);
    el.querySelector('[data-d="0"]').focus();
  });
}

// ----- Modo administrador -----
const adminOn = () => !!S.me?.isAdmin && localStorage.getItem('ofg_mode') !== 'user';
const fmtDT = (t) => new Date(t).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
async function loadAdmin() {
  try {
    const [stats, users] = await Promise.all([api('/admin/stats'), api('/admin/users')]);
    S.adm = { stats, users };
  } catch (e) { console.error('admin', e); S.adm = { ...(S.adm || {}), error: e.message }; }
}
const QR_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
async function drawQRs() {
  const els = [...document.querySelectorAll('[data-qr]')].filter((el) => !el.firstChild);
  if (!els.length) return;
  if (!window.QRCode) await new Promise((ok) => { const s = document.createElement('script'); s.src = QR_URL; s.onload = ok; s.onerror = ok; document.head.append(s); });
  if (!window.QRCode) return;
  els.forEach((el) => new window.QRCode(el, { text: `${location.origin}/?checkin=${el.dataset.qr}`, width: 148, height: 148, colorDark: '#000000', colorLight: '#ffffff' }));
}
const admErr = () => `<div class="card pad-s" style="border-color:rgba(239,68,68,.4)"><b>Não foi possível carregar o painel</b><div class="err">${esc(S.adm.error)}</div><button class="btn small" data-act="admrefresh">Tentar novamente</button></div>`;
const kpi = (label, value, sub = '', ic = '') => `<div class="card pad-s" style="gap:2px"><div class="eyebrow row" style="gap:6px">${ic ? icon(ic, 'i-s') : ''}${label}</div><div class="display mono" style="font-size:26px">${value}</div>${sub ? `<div class="muted">${sub}</div>` : ''}</div>`;
const hbar = (label, n, max, extra = '') => `<div><div class="row between"><span class="clip">${esc(label)}</span><b class="mono">${n}${extra}</b></div><div class="bar"><i style="width:${max ? Math.min(100, (n / max) * 100) : 0}%"></i></div></div>`;

function adminDash() {
  const st = S.adm?.stats;
  if (!st) return S.adm?.error ? admErr() : '<div class="empty">A carregar…</div>';
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const maxSign = Math.max(1, ...st.signups.map((x) => x[1]));
  return `
    <div class="row between"><span class="eyebrow blue">Visão geral</span><button class="btn small tonal" data-act="admrefresh">Atualizar</button></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${kpi('Inscritos', st.users, `${st.admins} admin`, 'group')}
      ${kpi('Com check-in', st.checkedIn, `${pct(st.checkedIn, st.users)}% dos inscritos`, 'check_circle')}
      ${kpi('Conexões', st.connections, `${st.pending} pendentes`, 'contact_page')}
      ${kpi('Mensagens', st.messages, '', 'chat_bubble')}
      ${kpi('Perguntas', st.questions, `${st.votes} votos em ${st.pollsCount} enquetes`, 'how_to_vote')}
      ${kpi('Push ativo', st.pushEnabled, `${pct(st.pushEnabled, st.users)}% dos inscritos`, 'notifications_active')}
    </div>
    <div class="card"><h3 class="h-md">Check-in por dia</h3>${st.perDay.map((d) => hbar(`${fmtDay(d.date)} · ${d.title}`, d.count, st.users, ` (${pct(d.count, st.users)}%)`)).join('')}</div>
    <div class="card"><h3 class="h-md">Inscrições (últimos dias)</h3>${st.signups.length ? st.signups.map(([d, n]) => hbar(fmtDay(d), n, maxSign)).join('') : '<div class="muted">Sem inscrições.</div>'}</div>
    <div class="card"><h3 class="h-md">Interesses mais populares</h3>${st.topInterests.map(([k, n]) => hbar(k, n, st.topInterests[0][1])).join('') || '<div class="muted">Sem dados.</div>'}</div>
    <div class="card"><h3 class="h-md">Empresas com mais inscritos</h3>${st.topCompanies.map(([k, n]) => hbar(k, n, st.topCompanies[0][1])).join('') || '<div class="muted">Sem dados.</div>'}</div>
    <div class="sec-title"><h3>QR codes de check-in</h3></div><p class="muted">Projete ou imprima na receção. Cada QR abre a app e faz o check-in do dia.</p>
    ${st.codes.map((c) => `<div class="card pad-s row top" style="flex-wrap:wrap"><div style="background:#fff;padding:8px;border-radius:12px" data-qr="${c.code}"></div><div style="flex:1 1 150px;min-width:0"><b>${esc(c.title)}</b><div class="muted">${fmtDay(c.date)}</div><div class="title-l mono" style="letter-spacing:.08em">${c.code}</div><button class="btn small tonal" data-act="copylink" data-v="${c.code}">${icon('content_copy', 'i-s')} Copiar link</button></div></div>`).join('')}
    <div class="sec-title"><h3>Documentos legais</h3></div><p class="muted">Páginas públicas do aplicativo. Use estes links na tela de consentimento do Google e onde for exigido.</p>
    ${[['Política de Privacidade', '/privacidade'], ['Termos de Serviço', '/termos']].map(([t, u]) => `<div class="card pad-s"><b>${t}</b><div class="muted clip">${esc(location.origin + u)}</div>
      <div class="row"><a class="btn small tonal grow" href="${u}" target="_blank" rel="noopener">${icon('open_in_new', 'i-s')} Abrir</a><button class="btn small grow" data-act="copyurl" data-v="${u}">${icon('content_copy', 'i-s')} Copiar link</button></div></div>`).join('')}`;
}

function adminUsers() {
  const list = S.adm?.users;
  if (!list) return S.adm?.error ? admErr() : '<div class="empty">A carregar…</div>';
  const f = S.admFilter || 'all', qs = (S.admQ || '').toLowerCase();
  const shown = list.filter((u) => (f === 'all' || (f === 'admin' && u.isAdmin) || (f === 'in' && Object.keys(u.checkins).length) || (f === 'out' && !Object.keys(u.checkins).length))
    && (!qs || [u.name, u.email, u.phone, u.company, u.role].join(' ').toLowerCase().includes(qs)));
  return `<div class="row between"><span class="eyebrow blue">${list.length} inscritos</span><button class="btn small tonal" data-act="exportcsv">${icon('download', 'i-s')} Exportar CSV</button></div>
    <div class="search">${icon('search')}<input id="admSearch" type="search" placeholder="Nome, email, empresa ou cargo…" value="${esc(S.admQ || '')}"></div>
    <div class="chips scroll-x">${[['all', 'Todos'], ['admin', 'Admins'], ['in', 'Com check-in'], ['out', 'Sem check-in']].map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-act="admfilter" data-v="${k}">${l}</button>`).join('')}</div>
    <div id="admList" style="display:flex;flex-direction:column;gap:12px">${shown.map(adminUserRow).join('') || '<div class="empty">Ninguém encontrado.</div>'}</div>`;
}
function adminUserRow(u) {
  const days = S.ev.event.days.filter((d) => u.checkins[d.id]).length;
  const self = u.id === S.me.id;
  return `<div class="card pad-s"><div class="row"><div class="avatar">${esc(initials(u.name))}</div><div class="grow"><div class="row" style="gap:6px"><b class="clip">${esc(u.name)}</b>${u.isAdmin ? '<span class="pill-tag">Admin</span>' : ''}</div><div class="muted clip">${esc([u.role, u.company].filter(Boolean).join(' · '))}</div><div class="muted clip">${esc(u.email)}</div>${u.phone ? `<div class="muted clip">${icon('call', 'i-s')} ${esc(u.phone)}</div>` : ''}</div></div>
    <div class="chips"><span class="chip static">Check-in ${days}/${S.ev.event.days.length}</span><span class="chip static">${u.points} pts</span>${u.push ? '<span class="chip static on">Push</span>' : ''}<span class="chip static">${fmtDT(u.createdAt)}</span></div>
    <button class="btn small ${u.isAdmin ? 'tonal' : ''}" data-act="role" data-id="${u.id}" data-v="${u.isAdmin ? '0' : '1'}" ${self && u.isAdmin ? 'disabled' : ''}>${icon('admin_panel_settings', 'i-s')} ${u.isAdmin ? (self ? 'Você é admin' : 'Remover admin') : 'Promover a admin'}</button>
    ${u.isAdmin ? '' : `<button class="btn small danger-o" data-act="deluser" data-id="${u.id}">${icon('delete', 'i-s')} Excluir inscrito</button>`}</div>`;
}

function adminComms() {
  const anns = S.ev.announcements;
  return `<form id="annForm" class="card" style="gap:14px"><h3 class="h-md">Enviar aviso a todos</h3>
      <div class="field"><label>Título <span style="color:var(--primary)">*</span></label><input name="title" required maxlength="80" placeholder="Ex.: Mudança de sala"></div>
      <div class="field"><label>Mensagem</label><textarea name="body" maxlength="400" placeholder="Detalhes do aviso"></textarea></div>
      <label class="row muted" style="gap:10px"><input type="checkbox" name="alert"> Marcar como alerta (mudança de sala, atraso…)</label>
      <button class="btn block">${icon('send', 'i-s')} Enviar aviso</button>
      <p class="muted">Chega em tempo real a quem tem a app aberta e por notificação push a quem as ativou.</p></form>
    <div class="sec-title"><h3>Avisos enviados</h3></div>
    ${anns.map((a) => `<div class="card pad-s ${a.kind === 'alert' ? '' : 'filled'}" ${a.kind === 'alert' ? 'style="border-color:rgba(239,68,68,.35)"' : ''}><div class="row between"><b>${esc(a.title)}</b><span class="muted">${fmtDT(a.at)}</span></div><div class="muted">${esc(a.body)}</div></div>`).join('') || '<div class="empty">Nenhum aviso enviado.</div>'}`;
}

function adminLive() {
  const st = S.adm?.stats;
  if (!st) return S.adm?.error ? admErr() : '<div class="empty">A carregar…</div>';
  const sess = S.ev.sessions.filter((s) => !['Receção', 'Networking'].includes(s.tag));
  const title = (id) => S.ev.sessions.find((s) => s.id === id)?.title || '';
  return `<form id="pollForm" class="card" style="gap:14px"><h3 class="h-md">Nova enquete</h3>
      <div class="field"><label>Sessão</label><select name="sessionId">${sess.map((s) => `<option value="${s.id}">${esc(s.start + ' · ' + s.title.slice(0, 48))}</option>`).join('')}</select></div>
      <div class="field"><label>Pergunta <span style="color:var(--primary)">*</span></label><input name="question" required maxlength="200"></div>
      <div class="field"><label>Opções (uma por linha, 2 a 6) <span style="color:var(--primary)">*</span></label><textarea name="options" required placeholder="Sim&#10;Não&#10;Talvez"></textarea></div>
      <button class="btn block">Abrir enquete</button></form>
    <div class="sec-title"><h3>Enquetes</h3></div>
    ${st.polls.map((p) => { const tot = p.counts.reduce((a, b) => a + b, 0); return `<div class="card pad-s"><div class="row between"><span class="pill-tag ${p.open ? 'green' : 'gray'}">${p.open ? 'Aberta' : 'Fechada'}</span><span class="muted">${tot} voto${tot === 1 ? '' : 's'}</span></div><b>${esc(p.question)}</b><div class="muted">${esc(title(p.sessionId))}</div>
      ${p.options.map((o, i) => hbar(o, p.counts[i], tot, tot ? ` · ${Math.round((p.counts[i] / tot) * 100)}%` : '')).join('')}
      <div class="row">${p.open ? `<button class="btn small tonal grow" data-act="closepoll" data-id="${p.id}">Fechar votação</button>` : ''}<button class="btn small text" data-act="delpoll" data-id="${p.id}">${icon('delete', 'i-s')} Apagar</button></div></div>`; }).join('') || '<div class="empty">Nenhuma enquete.</div>'}
    <div class="sec-title"><h3>Perguntas da audiência (${st.openQuestions.length})</h3></div>
    ${[...st.openQuestions].sort((a, b) => b.upvotes.length - a.upvotes.length || b.at - a.at).map((x) => `<div class="card pad-s row top"><div class="grow"><div>${esc(x.text)}</div><div class="muted">▲ ${x.upvotes.length} · ${esc(title(x.sessionId))}${x.anonymous ? ' · anónimo' : ''}</div></div><button class="iconbtn" data-act="delq" data-id="${x.id}" aria-label="Apagar pergunta">${icon('delete')}</button></div>`).join('') || '<div class="empty">Sem perguntas.</div>'}`;
}

function exportCSV() {
  const cols = ['Nome', 'Email', 'Telefone', 'Empresa', 'Cargo', 'LinkedIn', 'Interesses', 'Pontos', 'Check-ins', 'Admin', 'Inscrito em'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = S.adm.users.map((u) => [u.name, u.email, u.phone, u.company, u.role, u.linkedin, u.interests.join('; '), u.points, S.ev.event.days.filter((d) => u.checkins[d.id]).map((d) => d.date).join('; '), u.isAdmin ? 'sim' : '', new Date(u.createdAt).toISOString()]);
  const csv = '﻿' + [cols, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'inscritos-ofg-recife-2026.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ----- Leitor de QR code (câmera) -----
let scanner = null;
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const loadJsQR = () => window.jsQR ? Promise.resolve() : new Promise((ok, fail) => { const s = document.createElement('script'); s.src = JSQR_URL; s.onload = ok; s.onerror = fail; document.head.append(s); });
// aceita o link do QR (…/?checkin=CODIGO) ou o próprio código
function parseCheckinCode(text) {
  try { const c = new URL(text).searchParams.get('checkin'); if (c) return c.trim().toUpperCase(); } catch { /* não é URL */ }
  return /^[A-Za-z0-9]{6,12}$/.test(text.trim()) ? text.trim().toUpperCase() : null;
}
async function openScanner() {
  if (scanner) return;
  const ov = document.createElement('div'); ov.id = 'scanner';
  ov.innerHTML = '<video playsinline muted></video><div class="scan-frame"></div><div class="scan-bottom"><div class="scan-msg" id="scanMsg">A abrir a câmera…</div><button class="btn tonal" id="scanClose">Cancelar</button></div>';
  document.body.append(ov);
  const video = ov.querySelector('video'), msg = ov.querySelector('#scanMsg');
  let stream = null, stop = false, last = 0;
  const close = () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); ov.remove(); scanner = null; };
  scanner = { close };
  ov.querySelector('#scanClose').onclick = close;
  if (!navigator.mediaDevices?.getUserMedia) { msg.textContent = 'Este navegador não permite usar a câmera. Escreva o código manualmente.'; return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }); }
  catch (err) { msg.textContent = err.name === 'NotAllowedError' ? 'Permissão da câmera negada. Ative-a nas definições do navegador ou escreva o código.' : 'Não foi possível abrir a câmera. Escreva o código manualmente.'; return; }
  if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
  video.srcObject = stream; await video.play().catch(() => {});
  const detector = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
  if (!detector) { try { await loadJsQR(); } catch { msg.textContent = 'Não foi possível carregar o leitor de QR. Escreva o código manualmente.'; return; } }
  msg.textContent = 'Aponte a câmera para o QR code da receção';
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  let busyCall = false;
  const scan = async (ts) => {
    if (stop) return;
    if (!busyCall && ts - last > 120 && video.readyState >= 2 && video.videoWidth) {
      last = ts; let text = null;
      try {
        if (detector) text = (await detector.detect(video))[0]?.rawValue;
        else {
          const sc = Math.min(1, 640 / video.videoWidth); canvas.width = Math.round(video.videoWidth * sc); canvas.height = Math.round(video.videoHeight * sc);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          text = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data;
        }
      } catch { /* frame sem QR */ }
      if (text) {
        const code = parseCheckinCode(text);
        if (!code) { msg.textContent = 'Este QR code não é de check-in. Tente outro.'; }
        else {
          busyCall = true; msg.textContent = 'A validar…';
          try {
            const r = await api('/checkin', { method: 'POST', body: { code } });
            navigator.vibrate?.(80); close(); await loadMe(); S.err = ''; toast('Check-in feito ✔', r.title); render(); return;
          } catch (e) { msg.textContent = e.message; await new Promise((ok) => setTimeout(ok, 1500)); busyCall = false; msg.textContent = 'Aponte a câmera para o QR code da receção'; }
        }
      }
    }
    requestAnimationFrame(scan);
  };
  requestAnimationFrame(scan);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) scanner?.close(); });

// ----- Ao Vivo -----
function liveView() {
  const t = nowTs();
  const all = [...S.ev.sessions].sort((a, b) => sessionTs(a) - sessionTs(b));
  const cur = all.find(isLive), stage = cur || all.find((s) => sessionEnd(s) > t);
  const sid = S.qSession || stage?.id || all[0].id;
  const open = S.polls.filter((p) => p.open), closed = S.polls.filter((p) => !p.open);
  const pts = S.ev.points, days = S.ev.event.days;
  const todayId = days.find((d) => d.date === new Date(t - 3 * 3600e3).toISOString().slice(0, 10))?.id;
  const checked = Object.keys(S.me.checkins).length > 0, todayDone = todayId && S.me.checkins[todayId];
  const voted = S.polls.some((p) => p.myVote !== null), nconn = S.conns.filter((c) => c.status === 'accepted').length;
  const pts_ = S.board?.points ?? S.me.points;
  const qSessions = all.filter((s) => !['Receção', 'Networking'].includes(s.tag));
  return `
    <div class="row between"><span class="pill-tag ${cur ? 'live' : 'gray'}"><span class="d"></span>${cur ? esc(cur.room) + ' · Ao vivo' : 'Sem sessão ao vivo'}</span></div>
    ${stage ? `<div class="card glow clickable" data-act="session" data-id="${stage.id}"><div class="row between"><span class="eyebrow blue">${cur ? 'Palco principal' : 'A seguir'}</span><span class="pill-tag ${cur ? 'live' : ''}">${cur ? 'até ' + stage.end : stage.start}</span></div>
      <h3 class="title-l">${esc(stage.title)}</h3>${stage.speaker ? `<div class="muted">${esc(stage.speaker)}</div>` : ''}</div>` : ''}
    <div class="card hero row"><div class="grow"><div class="eyebrow">Check-in</div><div class="title-m" style="color:var(--ink)">${todayDone ? 'Check-in de hoje realizado ✔' : 'Faça o check-in do dia'}</div><div class="muted">${todayDone ? 'Bom evento!' : `Leia o QR da receção · +${pts.checkin} pts`}</div></div>
      <button class="btn small" style="background:var(--ink);color:var(--primary)" data-act="checkin">${icon('qr_code_scanner', 'i-s')} Abrir</button></div>
    <div class="card"><div class="row between"><div><div class="eyebrow blue">Gamificação OFG</div><div class="h-md">Trilha de Conexões</div></div><div style="text-align:right"><div class="display mono" style="font-size:26px">${pts_}</div><div class="muted">pts${S.board ? ' · Rank #' + S.board.rank : ''}</div></div></div>
      <div class="row">${icon('check_circle', checked ? 'fill' : '')}<span class="grow">Check-in realizado</span><b style="color:var(--success)">+${pts.checkin} pts</b></div>
      <div class="row">${icon('check_circle', voted ? 'fill' : '')}<span class="grow">Responder à enquete ao vivo</span><b style="color:var(--primary)">+${pts.vote} pts</b></div>
      <div class="row">${icon('contact_page')}<span class="grow">Trocas de contacto</span><b class="mono">${nconn}/5</b></div><div class="bar"><i style="width:${Math.min(100, nconn * 20)}%"></i></div></div>
    ${open.map(pollCard).join('') || '<div class="card pad-s muted" style="text-align:center">Nenhuma enquete aberta. Fique atento!</div>'}
    <div class="sec-title"><h3>Q&amp;A da Audiência</h3></div>
    <div class="chips scroll-x">${qSessions.map((s) => `<button class="chip ${s.id === sid ? 'on' : ''}" data-act="qsess" data-id="${s.id}">${esc(s.title.slice(0, 30))}${s.title.length > 30 ? '…' : ''}</button>`).join('')}</div>
    ${qaForm(sid)}
    ${S.questions.filter((q) => q.sessionId === sid).map(questionCard).join('') || '<div class="empty">Ainda sem perguntas.</div>'}
    ${closed.length ? `<div class="sec-title"><h3>Resultados</h3></div>${closed.map(pollCard).join('')}` : ''}
    <div class="sec-title"><h3>Ranking</h3></div>
    <div class="card pad-s">${(S.board?.top || []).slice(0, 10).map((u, i) => `<div class="list-item"><b class="mono" style="width:28px">${i + 1}</b><div class="grow clip">${esc(u.name)}<div class="muted">${esc(u.company)}</div></div><b class="mono">${u.points}</b></div>`).join('') || '<div class="empty">A carregar…</div>'}</div>`;
}

// ----- Evento -----
function eventView() {
  const e = S.ev.event, v = e.venue;
  return `
    <div class="card hero"><span class="pill-tag" style="background:var(--ink);color:var(--primary);align-self:flex-start">Edição especial · 33 anos</span>
      <h2 class="display" style="font-size:26px;line-height:32px">${esc(e.theme.title)}</h2><p class="muted" style="color:var(--hero-sub)">${esc(e.theme.subtitle)}</p>
      <div class="inner" style="background:var(--hero-tint);border:0"><div class="eyebrow">Tema central</div><b>${esc(e.theme.central)}</b></div></div>
    <div class="card"><div class="row between"><h3 class="h-md row" style="gap:8px">${icon('domain')}Local do Evento</h3></div>
      <div><b>${esc(v.name)}</b><div class="muted">${esc(v.address)}</div><div class="muted">${esc(v.room)}</div></div>
      <iframe class="map" title="Mapa" loading="lazy" src="https://maps.google.com/maps?q=${encodeURIComponent(v.mapsQuery)}&output=embed"></iframe>
      <div class="row"><a class="btn tonal grow" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.mapsQuery)}" target="_blank" rel="noopener">${icon('near_me', 'i-s')} Google Maps</a><a class="btn grow" href="${wazeUrl(v.mapsQuery)}" target="_blank" rel="noopener">Waze</a></div></div>
    <div class="card"><div class="row between"><h3 class="h-md row" style="gap:8px;color:#f87171">${icon('campaign')}Avisos em Tempo Real</h3><span class="pill-tag live"><span class="d"></span></span></div>
      ${S.ev.announcements.map((a) => `<div class="inner" ${a.kind === 'alert' ? 'style="border-color:rgba(239,68,68,.35)"' : ''}><div class="row between"><b>${esc(a.title)}</b><span class="muted">${timeAgo(a.at)}</span></div><div class="muted">${esc(a.body)}</div></div>`).join('') || '<div class="muted">Sem avisos por agora.</div>'}</div>
    <div class="sec-title"><h3>Informações &amp; Logística</h3></div>
    ${S.ev.faqs.map((f) => `<details class="card pad-s"><summary>${esc(f.q)}${icon('expand_more')}</summary><p>${esc(f.a)}</p></details>`).join('')}
    <div class="card" style="text-align:center"><div class="eyebrow">Alianças estratégicas</div><h3 class="h-md">Correalização &amp; Apoio Institucional</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${S.ev.sponsors.map((s) => `<div class="inner">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" style="text-decoration:none"><b>${esc(s.name)}</b></a>` : `<b>${esc(s.name)}</b>`}<div class="muted">${esc(s.tier)}</div></div>`).join('')}</div></div>`;
}

function notesView() {
  return S.notes.map((n) => `<div class="card pad-s ${n.read ? '' : 'filled'}"><b>${esc(n.title)}</b><div>${esc(n.body)}</div><div class="muted">${timeAgo(n.at)}</div></div>`).join('') || '<div class="empty">Sem notificações.</div>';
}

function checkinView() {
  const days = S.ev.event.days;
  return `<div class="card"><h2 class="title-l">Check-in</h2><p class="muted">Leia o QR code do dia na receção com a câmera ou escreva o código abaixo.</p>
      <button type="button" class="btn block" data-act="scan">${icon('photo_camera')} Ler QR code com a câmera</button>
      <div class="row" style="gap:10px"><span class="hr grow"></span><span class="eyebrow">ou digite o código</span><span class="hr grow"></span></div>
      <form id="ckForm" class="row"><div class="field grow"><input name="code" placeholder="Código" autocapitalize="characters" required></div><button class="btn">Validar</button></form>${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}</div>
    ${days.map((d) => `<div class="card pad-s row"><div class="grow"><b>${fmtDay(d.date)}</b><div class="muted">${esc(d.title)}</div></div>${S.me.checkins[d.id] ? `<span class="pill-tag green">${icon('check', 'i-s')} Presente</span>` : '<span class="muted">—</span>'}</div>`).join('')}`;
}

function profileView() {
  const dark = getTheme() === 'dark';
  return `<div class="card pad-s row"><div class="avatar" style="border-radius:12px">${icon(dark ? 'dark_mode' : 'light_mode')}</div><div class="grow"><div class="title-m">Modo escuro</div><div class="muted" id="themeLabel">${dark ? 'Ativo' : 'Desativado (modo claro)'}</div></div>
    <label class="switch"><input type="checkbox" id="themeSwitch" role="switch" aria-label="Alternar modo escuro" ${dark ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label></div>
    <form id="profForm" class="card" style="gap:16px">
      ${['name:Nome', 'company:Empresa', 'role:Cargo', 'phone:Telefone', 'linkedin:LinkedIn'].map((x) => { const [k, l] = x.split(':'); return `<div class="field"><label>${l}</label><input name="${k}" value="${esc(S.me[k])}"></div>`; }).join('')}
      <div class="label">Interesses</div><div class="chips">${S.ev.interests.map((i) => `<button type="button" class="chip ${S.me.interests.includes(i) ? 'on' : ''}" data-act="myint" data-v="${esc(i)}">${esc(i)}</button>`).join('')}</div>
      <button class="btn">Guardar</button>
      ${'Notification' in window && Notification.permission !== 'granted' ? '<button type="button" class="btn tonal" data-act="notif">Ativar notificações</button>' : ''}
      <button type="button" class="btn text" data-act="logout">Sair</button></form>
    <p class="muted" style="text-align:center"><a href="/termos" target="_blank" rel="noopener">Termos de Serviço</a> · <a href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a></p>`;
}

async function startSession(token, remember) {
  S.token = token; S.err = ''; S.recoverSent = false; S.draft = {};
  (remember ? localStorage : sessionStorage).setItem('ofg_token', token);
  await boot();
}

// ---------- eventos ----------
document.addEventListener('click', async (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    S.view = null; S.chatWith = null;
    if (adminOn()) { S.adminTab = tabBtn.dataset.tab; render(); toTop(); loadAdmin().then(() => { if (adminOn() && !S.view) render(); }); return; }
    S.tab = tabBtn.dataset.tab; render(); toTop(); if (S.tab === 'live') loadBoard().then(render); return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const { act, id, v } = el.dataset;
  e.stopPropagation();
  try {
    if (act === 'authmode') { S.authMode = v; S.err = ''; if (v !== 'recover') { S.recoverSent = false; } toTop(); }
    else if (act === 'togglepw') { const i = el.parentElement.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; el.innerHTML = icon(i.type === 'password' ? 'visibility' : 'visibility_off'); return; }
    else if (act === 'resend') { await api('/recover', { method: 'POST', body: { email: S.recoverEmail } }); toast('Código reenviado', 'Verifique o seu email.'); }
    else if (act === 'pick') { S.pickInterests = S.pickInterests.includes(v) ? S.pickInterests.filter((x) => x !== v) : [...S.pickInterests, v]; }
    else if (act === 'back') { S.view = null; S.chatWith = null; await loadConns(); }
    else if (act === 'notes') { S.view = { type: 'notes' }; const shown = S.notes.map((n) => ({ ...n })); await api('/notifications', { method: 'POST' }); S.notes = shown; render(); S.notes.forEach((n) => (n.read = true)); toTop(); return; }
    else if (act === 'profile') { S.view = { type: 'profile' }; S.chatWith = null; toTop(); }
    else if (act === 'checkin') { S.view = { type: 'checkin' }; S.err = ''; toTop(); }
    else if (act === 'scan') { openScanner(); return; }
    else if (act === 'mode') { localStorage.setItem('ofg_mode', adminOn() ? 'user' : 'admin'); S.view = null; S.chatWith = null; toTop(); if (adminOn()) { render(); await loadAdmin(); } }
    else if (act === 'admrefresh') { S.adm = null; render(); await loadAdmin(); if (!S.adm?.error) toast('Painel atualizado'); }
    else if (act === 'admfilter') S.admFilter = v;
    else if (act === 'role') {
      const u = S.adm.users.find((x) => x.id === id);
      if (!(await confirmDialog({ title: v === '1' ? 'Promover a administrador?' : 'Remover acesso de administrador?', body: v === '1' ? `<b>${esc(u.name)}</b> terá acesso total ao painel de administração.` : `<b>${esc(u.name)}</b> deixará de ter acesso ao painel de administração.`, confirmLabel: v === '1' ? 'Promover' : 'Remover' }))) return;
      await api('/admin/users/role', { method: 'POST', body: { id, admin: v === '1' } }); await loadAdmin(); toast('Permissões atualizadas', u.name);
    }
    else if (act === 'deluser') {
      const u = S.adm.users.find((x) => x.id === id);
      const ok = await confirmDialog({ title: 'Excluir inscrito?', danger: true, confirmLabel: 'Excluir definitivamente',
        body: `Vai excluir <b>${esc(u.name)}</b> (${esc(u.email)}). Serão apagados o perfil, as conexões, as mensagens, as notificações, os votos e as perguntas desta pessoa. <b>Esta ação não pode ser desfeita.</b>` });
      if (!ok) return;
      await api('/admin/users/delete', { method: 'POST', body: { id } }); await loadAdmin(); toast('Inscrito excluído', u.name);
    }
    else if (act === 'exportcsv') { exportCSV(); return; }
    else if (act === 'copyurl') { await navigator.clipboard?.writeText(location.origin + v); toast('Link copiado', location.origin + v); return; }
    else if (act === 'copylink') { await navigator.clipboard?.writeText(`${location.origin}/?checkin=${v}`); toast('Link copiado'); return; }
    else if (act === 'closepoll') { await api('/admin/poll/close', { method: 'POST', body: { id } }); await loadAdmin(); }
    else if (act === 'delpoll') { if (!(await confirmDialog({ title: 'Apagar enquete?', body: 'A enquete e todos os seus votos serão apagados.', confirmLabel: 'Apagar', danger: true }))) return; await api('/admin/poll/delete', { method: 'POST', body: { id } }); await loadAdmin(); }
    else if (act === 'delq') { if (!(await confirmDialog({ title: 'Apagar pergunta?', body: 'A pergunta será removida para todos os participantes.', confirmLabel: 'Apagar', danger: true }))) return; await api('/admin/question/delete', { method: 'POST', body: { id } }); await loadAdmin(); }
    else if (act === 'day') S.day = id;
    else if (act === 'room') { S.room = v; S.favOnly = false; }
    else if (act === 'favonly') { S.favOnly = !S.favOnly; if (S.favOnly) S.room = ''; }
    else if (act === 'fav') { const r = await api('/favorite', { method: 'POST', body: { sessionId: id } }); S.me.favorites = r.favorites; if ('Notification' in window && Notification.permission === 'default') enablePush(); }
    else if (act === 'session') { S.view = { type: 'session', id }; toTop(); }
    else if (act === 'person') { S.view = { type: 'person', id }; toTop(); }
    else if (act === 'nettab') S.netTab = id;
    else if (act === 'interest') { S.interest = v; S.netTab = 'all'; }
    else if (act === 'connect') { await api('/connect', { method: 'POST', body: { to: id } }); await Promise.all([loadConns(), loadPeople(), loadSugg()]); toast('Pedido enviado', 'Será avisado quando aceitarem.'); }
    else if (act === 'respond') { await api('/connect/respond', { method: 'POST', body: { id, accept: v === '1' } }); await Promise.all([loadConns(), loadPeople(), loadSugg()]); }
    else if (act === 'chat') { S.chatWith = id; S.chat = await api('/messages/' + id); S.view = null; }
    else if (act === 'vote') { await api('/polls/vote', { method: 'POST', body: { pollId: el.dataset.poll, option: +el.dataset.opt } }); await loadPolls(); }
    else if (act === 'upvote') { await api('/questions/upvote', { method: 'POST', body: { id } }); await loadQuestions(); }
    else if (act === 'qsess') S.qSession = id;
    else if (act === 'myint') { S.me.interests = S.me.interests.includes(v) ? S.me.interests.filter((x) => x !== v) : [...S.me.interests, v]; }
    else if (act === 'notif') { await enablePush(); }
    else if (act === 'logout') return logout();
  } catch (err) { toast('Erro', err.message); }
  render();
  if (S.chatWith) toBottom();
}, true);

// indicador de processamento central (spinner) enquanto uma operação de autenticação corre
let busyAt = 0;
function setBusy(on) {
  let el = document.getElementById('busy');
  if (on) {
    if (el) return; busyAt = Date.now();
    el = document.createElement('div'); el.id = 'busy'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="spinner" aria-hidden="true"></div><div class="busy-txt">A processar…</div>';
    document.body.append(el);
  } else el?.remove();
}
const AUTH_FORMS = ['authForm', 'recoverForm', 'resetForm', 'onbForm'];

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, d = Object.fromEntries(new FormData(f));
  if (!AUTH_FORMS.includes(f.id)) return onSubmit(f, d);
  if (document.getElementById('busy')) return; // evita duplo envio
  setBusy(true);
  try { await onSubmit(f, d); }
  finally { await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - busyAt)))); setBusy(false); } // evita "flash" se for muito rápido
});

async function onSubmit(f, d) {
  try {
    if (f.id === 'authForm') {
      const r = await api(S.authMode === 'register' ? '/register' : '/login', { method: 'POST', body: { ...d, interests: S.pickInterests } });
      await startSession(r.token, S.authMode === 'register' || !!d.remember); return;
    }
    if (f.id === 'recoverForm') { S.recoverEmail = d.email.trim().toLowerCase(); await api('/recover', { method: 'POST', body: { email: S.recoverEmail } }); S.recoverSent = true; S.err = ''; }
    if (f.id === 'resetForm') { const r = await api('/reset', { method: 'POST', body: { email: S.recoverEmail, pin: d.pin, password: d.password } }); await startSession(r.token, true); return; }
    if (f.id === 'annForm') { await api('/admin/announce', { method: 'POST', body: { title: d.title, body: d.body, kind: d.alert ? 'alert' : 'info' } }); const ev = await api('/event'); S.ev.announcements = ev.announcements; f.reset(); toast('Aviso enviado'); }
    if (f.id === 'pollForm') { await api('/admin/poll', { method: 'POST', body: { sessionId: d.sessionId, question: d.question, options: d.options.split('\n') } }); await loadAdmin(); f.reset(); toast('Enquete aberta'); }
    if (f.id === 'onbForm') {
      if (!d.company.trim() || !d.role.trim() || !d.phone.trim()) throw new Error('Empresa, cargo e telefone são obrigatórios');
      await api('/me', { method: 'PUT', body: { company: d.company, role: d.role, phone: d.phone, linkedin: d.linkedin, interests: S.pickInterests } });
      await Promise.all([loadMe(), loadSugg(), loadPeople()]); S.draft = {}; S.err = ''; S.pickInterests = [];
    }
    if (f.id === 'ckForm') { await doCheckin(d.code); }
    if (f.id === 'profForm') { await api('/me', { method: 'PUT', body: { ...d, interests: S.me.interests } }); await loadMe(); await Promise.all([loadSugg(), loadPeople()]); toast('Perfil guardado'); }
    if (f.id === 'qForm') { await api('/questions', { method: 'POST', body: { sessionId: f.dataset.id, text: d.text, anonymous: !!d.anon } }); await loadQuestions(); f.reset(); }
    if (f.id === 'msgForm') { if (!d.text.trim()) return; const txt = d.text; f.reset(); const msg = await api('/messages', { method: 'POST', body: { to: S.chatWith, text: txt } }); S.chat.push(msg); }
  } catch (err) { S.err = err.message; if (f.id !== 'ckForm') toast('Erro', err.message); }
  render();
  if (S.chatWith) { toBottom(); $('#msgForm input')?.focus(); }
}

// guarda o que foi escrito nos formulários de autenticação, para não perder ao voltar a desenhar a tela
document.addEventListener('input', (e) => {
  const f = e.target.form;
  if (f && ['authForm', 'resetForm', 'recoverForm', 'onbForm'].includes(f.id) && e.target.name && e.target.type !== 'checkbox') S.draft[e.target.name] = e.target.value;
});

document.addEventListener('change', (e) => {
  if (e.target.id !== 'themeSwitch') return;
  const dark = e.target.checked; applyTheme(dark ? 'dark' : 'light');
  const l = document.getElementById('themeLabel'); if (l) l.textContent = dark ? 'Ativo' : 'Desativado (modo claro)';
  const ic = e.target.closest('.card')?.querySelector('.avatar .material-symbols-outlined'); if (ic) ic.textContent = dark ? 'dark_mode' : 'light_mode';
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'admSearch') return;
  S.admQ = e.target.value; const l = document.getElementById('admList'); if (!l) return;
  const f = S.admFilter || 'all', qs = S.admQ.toLowerCase();
  l.innerHTML = S.adm.users.filter((u) => (f === 'all' || (f === 'admin' && u.isAdmin) || (f === 'in' && Object.keys(u.checkins).length) || (f === 'out' && !Object.keys(u.checkins).length)) && (!qs || [u.name, u.email, u.phone, u.company, u.role].join(' ').toLowerCase().includes(qs))).map(adminUserRow).join('') || '<div class="empty">Ninguém encontrado.</div>';
});

let searchT;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'search') return;
  S.q = e.target.value; clearTimeout(searchT);
  searchT = setTimeout(async () => { await loadPeople(); const l = $('#peopleList'); const ppl = S.interest ? S.people.filter((u) => u.interests.includes(S.interest)) : S.people; if (l) l.innerHTML = ppl.map(personRow).join('') || '<div class="empty">Ninguém encontrado.</div>'; }, 250);
});

boot();
