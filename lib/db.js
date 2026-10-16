// Supabase (Postgres + Realtime). O servidor usa a service role (nunca exposta ao navegador).
import { createClient } from '@supabase/supabase-js';

export const supaUrl = process.env.SUPABASE_URL;
export const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const configured = !!(supaUrl && serviceKey);
export const sb = configured ? createClient(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

// resolve a query do supabase-js ou lança o erro
export const q = async (p) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };

// Broadcast (Realtime) por REST: só envia um "sinal" sem dados; o cliente refaz o fetch autenticado.
const pending = [];
export function broadcast(messages) {
  if (!configured || !messages.length) return;
  pending.push(fetch(`${supaUrl}/realtime/v1/api/broadcast`, {
    method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: messages.map((m) => ({ topic: m.topic, event: m.event, payload: {}, private: false })) }),
  }).catch((e) => console.error('broadcast', e.message)));
}
export const track = (p) => pending.push(p.catch((e) => console.error(e.message)));
export const flush = () => Promise.allSettled(pending.splice(0));
