// Foto de perfil (recorte inteligente) e crachá do evento (Profile Card).
const TASKS = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const QR_URL = '/vendor/qrcode.min.js';
// 5 marcas da logo espalhadas pelo fundo: [esquerda %, topo %, rotação °, largura %]
const MARKS = [[7, 6, -14, 24], [66, 3, 10, 26], [4, 43, 16, 22], [71, 40, -12, 23], [10, 66, 8, 20]];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const OUT_W = 480, OUT_H = 600; // retrato 4:5

// ---------- recorte inteligente ----------
let segP;
const segmenter = () => (segP ??= (async () => {
  const { FilesetResolver, ImageSegmenter } = await import(`${TASKS}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${TASKS}/wasm`);
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false });
  try { return await ImageSegmenter.createFromOptions(fileset, opts('GPU')); } catch { return ImageSegmenter.createFromOptions(fileset, opts('CPU')); }
})().catch((e) => { segP = null; throw e; }));

const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });
const toBlob = (c, type, q) => new Promise((ok) => c.toBlob(ok, type, q));
const blobToDataUrl = (b) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(b); });

// devolve { dataUrl, cutout }: retrato 4:5 centrado na pessoa; com fundo removido quando o modelo carrega
export async function processPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const src = canvasOf(bmp.width * k, bmp.height * k);
  src.getContext('2d').drawImage(bmp, 0, 0, src.width, src.height);
  bmp.close?.();

  let person = null; // { box: {x0,y0,x1,y1} em px de src, mask: canvas com alfa }
  try {
    const seg = await segmenter();
    const res = seg.segment(src);
    const m = res.confidenceMasks[0], data = new Float32Array(m.getAsFloat32Array()), w = m.width, h = m.height;
    res.close();
    // o polo da máscara varia entre modelos: a pessoa é a região mais central
    let border = 0, nb = 0, center = 0, nc = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      if (x < w * 0.08 || x > w * 0.92 || y < h * 0.08) { border += v; nb++; }
      else if (x > w * 0.3 && x < w * 0.7 && y > h * 0.3 && y < h * 0.8) { center += v; nc++; }
    }
    const inv = border / nb > center / nc;
    const mc = canvasOf(w, h), mctx = mc.getContext('2d'), img = mctx.createImageData(w, h);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < w * h; i++) {
      let v = inv ? 1 - data[i] : data[i];
      v = Math.min(1, Math.max(0, (v - 0.35) / 0.3)); // borda suave
      img.data[i * 4 + 3] = Math.round(v * 255);
      if (v > 0.5) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    mctx.putImageData(img, 0, 0);
    if (x1 > x0 && y1 > y0 && (x1 - x0) * (y1 - y0) > w * h * 0.04) {
      const sx = src.width / w, sy = src.height / h;
      person = { box: { x0: x0 * sx, y0: y0 * sy, x1: (x1 + 1) * sx, y1: (y1 + 1) * sy }, mask: mc };
    }
  } catch { /* sem modelo (offline / navegador sem WebAssembly): só recorte */ }

  let crop, layer = src;
  if (person) {
    const { x0, y0, x1, y1 } = person.box, bw = x1 - x0, bh = y1 - y0;
    // enquadra do topo da cabeça até ao peito; fotos de corpo inteiro ficam cortadas na zona superior
    let H = Math.min(bh * 1.1, bw * 1.12 * 1.25 * 1.4), W = H * 0.8;
    if (W < bw * 1.12) { W = bw * 1.12; H = W * 1.25; }
    crop = { x: (x0 + x1) / 2 - W / 2, y: y0 - H * 0.05, w: W, h: H };
    layer = canvasOf(src.width, src.height);
    const lctx = layer.getContext('2d');
    lctx.drawImage(src, 0, 0);
    lctx.globalCompositeOperation = 'destination-in';
    lctx.drawImage(person.mask, 0, 0, layer.width, layer.height);
  } else {
    let W = Math.min(src.width, src.height * 0.8), H = W * 1.25;
    if (H > src.height) { H = src.height; W = H * 0.8; }
    crop = { x: (src.width - W) / 2, y: Math.max(0, (src.height - H) * 0.15), w: W, h: H };
  }
  const out = canvasOf(OUT_W, OUT_H), octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  if (!person) { octx.fillStyle = '#fff'; octx.fillRect(0, 0, OUT_W, OUT_H); }
  octx.drawImage(layer, crop.x, crop.y, crop.w, crop.h, 0, 0, OUT_W, OUT_H);

  const blob = person ? ((await toBlob(out, 'image/webp', 0.9)) || (await toBlob(out, 'image/png'))) : await toBlob(out, 'image/jpeg', 0.88);
  return { dataUrl: await blobToDataUrl(blob), cutout: !!person };
}

// ---------- crachá ----------
export const vcard = (u) => ['BEGIN:VCARD', 'VERSION:3.0', `FN:${u.name}`, u.company && `ORG:${u.company}`, u.role && `TITLE:${u.role}`, u.phone && `TEL:${u.phone}`, u.email && `EMAIL:${u.email}`, 'END:VCARD'].filter(Boolean).join('\n');

const loadQR = async () => {
  if (!window.QRCode) await new Promise((ok) => { const s = document.createElement('script'); s.src = QR_URL; s.onload = ok; s.onerror = ok; document.head.append(s); });
  return window.QRCode;
};
// QR do contacto (vCard) como canvas
async function qrCanvas(text, size) {
  const Q = await loadQR(); if (!Q) return null;
  for (const t of [text, text.split('\n').filter((l) => /^(FN|TEL|EMAIL)/.test(l)).join('\n')]) { // se os dados não couberem, tenta uma versão curta
    try {
      const box = document.createElement('div');
      new Q(box, { text: t, width: size, height: size, colorDark: '#0b1d3a', colorLight: '#ffffff', correctLevel: Q.CorrectLevel.L });
      const c = box.querySelector('canvas'); if (c) return c;
    } catch { /* tenta a próxima */ }
  }
  return null;
}

export function badgeHtml(u, ev) {
  const sub = [u.role, u.company].filter(Boolean).join(' · ');
  return `<div class="pc-wrap" id="pcWrap"><div class="pc" id="pc">
    <div class="pc-inside">
      ${MARKS.map(([x, y, r, w]) => `<i class="pc-mark" style="left:${x}%;top:${y}%;width:${w}%;--r:${r}deg"></i>`).join('')}
      ${u.photo ? `<img class="pc-avatar" src="${esc(u.photo)}" alt="" crossorigin="anonymous">` : `<div class="pc-initials">${esc(initials(u.name))}</div>`}
      <div class="pc-shine"></div><div class="pc-glare"></div>
      <div class="pc-head"><div class="pc-event">${esc(ev.name)} · 3 NOV 2026</div><h2>${esc(u.name)}</h2><p>${esc(sub)}</p></div>
      <div class="pc-foot"><div class="pc-who"><span class="pc-tag">PARTICIPANTE</span><b>${esc(u.company || ev.venue.name)}</b><span>${esc(u.role || ev.tagline)}</span></div><div class="pc-qr" id="pcQr" title="QR do contacto"></div></div>
    </div></div></div>`;
}

// inclinação + brilho holográfico que seguem o ponteiro (ou o toque)
export function mountBadge(u) {
  const wrap = document.getElementById('pcWrap'), card = document.getElementById('pc');
  if (!wrap || !card) return;
  let raf = 0;
  const set = (px, py) => { // px/py em 0..100
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      card.style.setProperty('--px', px + '%'); card.style.setProperty('--py', py + '%');
      card.style.setProperty('--rx', ((50 - py) / 50 * 12).toFixed(2) + 'deg'); card.style.setProperty('--ry', ((px - 50) / 50 * 12).toFixed(2) + 'deg');
      card.style.setProperty('--o', Math.min(1, Math.hypot(px - 50, py - 50) / 50 + 0.35).toFixed(2));
    });
  };
  const move = (e) => { const r = wrap.getBoundingClientRect(); set(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100))); card.classList.add('active'); };
  const leave = () => { card.classList.remove('active'); set(50, 50); card.style.setProperty('--o', '0'); };
  wrap.addEventListener('pointermove', move); wrap.addEventListener('pointerenter', move); wrap.addEventListener('pointerleave', leave); wrap.addEventListener('pointercancel', leave);
  leave();
  if (u) qrCanvas(vcard(u), 120).then((c) => { const el = document.getElementById('pcQr'); if (c && el && !el.firstChild) { const im = new Image(); im.alt = 'QR do contacto'; im.style.cssText = 'display:block;width:100%;height:auto'; im.src = c.toDataURL('image/png'); el.append(im); } });
}

const img = (src) => new Promise((ok) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
const fit = (ctx, text, max) => { let s = text; while (ctx.measureText(s).width > max && s.length > 1) s = s.slice(0, -2) + '…'; return s; };

// PNG do crachá (para partilhar/guardar), com o mesmo desenho do cartão
export async function badgeBlob(u, ev) {
  const W = 900, H = 1250, c = canvasOf(W, H), x = c.getContext('2d');
  x.beginPath(); x.roundRect(0, 0, W, H, 70); x.clip();
  const g = x.createLinearGradient(0, 0, W * 0.6, H); g.addColorStop(0, '#0b1d3a'); g.addColorStop(0.55, '#14396b'); g.addColorStop(1, '#0a1730');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const r1 = x.createRadialGradient(W * 0.2, H * 0.15, 0, W * 0.2, H * 0.15, W * 0.7); r1.addColorStop(0, 'rgba(120,180,255,.45)'); r1.addColorStop(1, 'rgba(120,180,255,0)'); x.fillStyle = r1; x.fillRect(0, 0, W, H);
  const r2 = x.createRadialGradient(W * 0.9, H * 0.55, 0, W * 0.9, H * 0.55, W * 0.6); r2.addColorStop(0, 'rgba(190,120,255,.30)'); r2.addColorStop(1, 'rgba(190,120,255,0)'); x.fillStyle = r2; x.fillRect(0, 0, W, H);
  const [logo, photo] = await Promise.all([img('/media/logo-metal.png'), u.photo ? img(u.photo) : null]);
  if (logo) { // 5 marcas da logo com acabamento metálico
    const t = canvasOf(W, H), tx = t.getContext('2d'), mg = tx.createLinearGradient(0, 0, W, H);
    ['#6f7f97', '#f6f9ff', '#8190a8', '#dfe8f6', '#75849c', '#f2f6fd', '#6f7f97'].forEach((c, i, a) => mg.addColorStop(i / (a.length - 1), c));
    tx.fillStyle = mg; tx.fillRect(0, 0, W, H);
    tx.globalCompositeOperation = 'destination-in';
    for (const [mx, my, rot, mw] of MARKS) {
      const sz = (W * mw) / 100; tx.save(); tx.translate((W * mx) / 100 + sz / 2, (H * (my * 0.72)) / 100 + sz / 2); tx.rotate((rot * Math.PI) / 180); tx.drawImage(logo, -sz / 2, -sz / 2, sz, sz); tx.restore();
    }
    x.globalAlpha = 0.85; x.drawImage(t, 0, 0); x.globalAlpha = 1;
  }
  if (photo) { const ph = H * 0.74, pw = ph * (photo.width / photo.height); x.drawImage(photo, (W - pw) / 2, H - ph - 40, pw, ph); }
  else { x.fillStyle = 'rgba(255,255,255,.14)'; x.beginPath(); x.arc(W / 2, H * 0.58, 230, 0, 7); x.fill(); x.fillStyle = '#fff'; x.font = '800 190px "Plus Jakarta Sans", Inter, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(initials(u.name), W / 2, H * 0.58); }
  x.textAlign = 'center'; x.textBaseline = 'alphabetic'; x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '700 30px Inter, sans-serif';
  x.fillText(`${ev.name.toUpperCase()} · 3 NOV 2026`, W / 2, 96);
  x.fillStyle = '#fff'; x.font = '800 84px "Plus Jakarta Sans", Inter, sans-serif'; x.fillText(fit(x, u.name, W - 120), W / 2, 196);
  x.fillStyle = 'rgba(255,255,255,.85)'; x.font = '500 38px Inter, sans-serif'; x.fillText(fit(x, [u.role, u.company].filter(Boolean).join(' · '), W - 120), W / 2, 252);
  // barra inferior com empresa e QR
  x.fillStyle = 'rgba(8,18,40,.62)'; x.beginPath(); x.roundRect(40, H - 230, W - 80, 190, 40); x.fill();
  x.textAlign = 'left'; x.fillStyle = '#9cc6ff'; x.font = '800 24px Inter, sans-serif'; x.fillText('PARTICIPANTE', 80, H - 160);
  x.fillStyle = '#fff'; x.font = '800 44px "Plus Jakarta Sans", Inter, sans-serif'; x.fillText(fit(x, u.company || ev.venue.name, 470), 80, H - 108);
  x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '500 30px Inter, sans-serif'; x.fillText(fit(x, u.role || ev.tagline, 470), 80, H - 64);
  const qr = await qrCanvas(vcard(u), 240);
  if (qr) { x.fillStyle = '#fff'; x.beginPath(); x.roundRect(W - 250, H - 222, 170, 170, 20); x.fill(); x.drawImage(qr, W - 244, H - 216, 158, 158); }
  return toBlob(c, 'image/png');
}
