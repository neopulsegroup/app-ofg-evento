// Verificação local (sem dependências) de um ID token do Google (Sign in with Google / GIS).
import crypto from 'node:crypto';

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
let cache = { keys: null, exp: 0 };

async function googleKeys() {
  if (process.env.GOOGLE_JWKS_JSON) return JSON.parse(process.env.GOOGLE_JWKS_JSON).keys; // apenas para testes automáticos
  if (cache.keys && cache.exp > Date.now()) return cache.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('chaves do Google indisponíveis');
  cache = { keys: (await r.json()).keys, exp: Date.now() + 3600e3 };
  return cache.keys;
}
const part = (s) => Buffer.from(s, 'base64url');

export async function verifyGoogleIdToken(idToken, clientId) {
  const p = String(idToken || '').split('.');
  if (p.length !== 3) throw new Error('token malformado');
  const header = JSON.parse(part(p[0]).toString()), payload = JSON.parse(part(p[1]).toString());
  if (header.alg !== 'RS256') throw new Error('algoritmo inválido');
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('chave desconhecida');
  const valid = crypto.verify('RSA-SHA256', Buffer.from(`${p[0]}.${p[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), part(p[2]));
  if (!valid) throw new Error('assinatura inválida');
  if (payload.aud !== clientId) throw new Error('audiência inválida');
  if (!ISSUERS.includes(payload.iss)) throw new Error('emissor inválido');
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error('token expirado');
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw new Error('email não verificado');
  if (!payload.email) throw new Error('sem email');
  return payload;
}
