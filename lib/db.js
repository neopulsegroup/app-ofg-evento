// Armazenamento: Upstash Redis (produção na Vercel) ou memória (desenvolvimento local).
import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export const persistent = !!(url && token);

function memory() {
  const m = new Map();
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const h = (k) => m.get(k) ?? m.set(k, {}).get(k);
  const l = (k) => m.get(k) ?? m.set(k, []).get(k);
  const api = {
    hget: async (k, f) => clone(h(k)[f]) ?? null,
    hset: async (k, o) => { Object.assign(h(k), clone(o)); return 1; },
    hgetall: async (k) => (Object.keys(h(k)).length ? clone(h(k)) : null),
    rpush: async (k, v) => l(k).push(clone(v)),
    lpush: async (k, v) => l(k).unshift(clone(v)),
    ltrim: async (k, a, b) => { m.set(k, l(k).slice(a, b + 1)); return 'OK'; },
    lrange: async (k, a, b) => { const x = l(k), n = x.length; return clone(x.slice(a < 0 ? Math.max(n + a, 0) : a, b < 0 ? n + b + 1 : b + 1)); },
    hdel: async (k, f) => { delete h(k)[f]; return 1; },
    lindex: async (k, i) => clone(l(k).at(i)) ?? null,
    incr: async (k) => { const v = (m.get(k) || 0) + 1; m.set(k, v); return v; },
    mget: async (...ks) => ks.map((k) => m.get(k) ?? null),
    set: async (k, v) => { m.set(k, v); return 'OK'; },
    sadd: async (k, v) => { const s = m.get(k) ?? m.set(k, new Set()).get(k); if (s.has(v)) return 0; s.add(v); return 1; },
  };
  api.pipeline = () => {
    const q = [];
    const p = new Proxy({}, { get: (_, name) => (name === 'exec' ? async () => Promise.all(q.map((f) => f())) : (...a) => { q.push(() => api[name](...a)); return p; }) });
    return p;
  };
  return api;
}

export const r = persistent ? new Redis({ url, token }) : memory();
