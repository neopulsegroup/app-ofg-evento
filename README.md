# App OFG Recife 2026 (PWA)

PWA estática (`public/`) + API serverless (`api/[...path].js` → `lib/handler.js`) na Vercel.
Dados no **Upstash Redis**; "tempo real" por polling leve (`/api/sync`, ~6 s, só com a app aberta) e **Web Push** (VAPID) para avisos com a app fechada.
A Vercel não suporta WebSockets nem disco persistente, por isso não há servidor Node permanente.

## Desenvolvimento local
```bash
npm install && npm start     # http://localhost:3000, dados em memória, admin em /admin.html (chave: admin-dev)
```

## Deploy na Vercel
1. Importar o repositório na Vercel (Framework: *Other*; `vercel.json` já define `public/`).
2. Storage → Marketplace → **Upstash Redis** → ligar ao projeto (cria `KV_REST_API_URL/TOKEN`).
3. Gerar chaves push: `npm run vapid` e definir `VAPID_PUBLIC`, `VAPID_PRIVATE`.
4. Definir `ADMIN_KEY`, `APP_SECRET` (ver `.env.example`) e fazer redeploy.
5. Abrir `/admin.html`, imprimir os QR codes de check-in.

## Custos e limites (250 pessoas)
- Cada telemóvel com a app aberta faz ~1 pedido/6 s (1 comando Redis). Num dia de evento estimam-se centenas de milhares de invocações: o plano **Hobby da Vercel é só não comercial e limitado**; para uso da empresa usar **Pro**. O Upstash gratuito (500 mil comandos/mês) não chega; usar pay-as-you-go (poucos USD).
- Lembretes "começa em 10 min" são disparados por quem estiver a fazer polling (sem cron).
- Push no iPhone só após "Adicionar ao ecrã principal" (iOS 16.4+).
- Login por email sem verificação: quem souber o email entra na conta. Avaliar código por email.
