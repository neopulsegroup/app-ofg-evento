# App OFG Recife 2026 (PWA)

PWA estática (`public/`) + API serverless (`api/[...path].js` → `lib/handler.js`) na Vercel.
Dados em **Supabase Postgres** (`supabase/schema.sql`); tempo real por **Supabase Realtime** (broadcast: o servidor envia só um sinal e o cliente refaz o fetch autenticado) e **Web Push** (VAPID) para avisos com a app fechada.

## Desenvolvimento local
```bash
npm install
cp .env.example .env.local   # preencher SUPABASE_* (e ADMIN_KEY/APP_SECRET)
npm start                    # http://localhost:3000 · admin em /admin.html
```
Em dev o PIN de recuperação de senha aparece no log do servidor (sem `RESEND_API_KEY`).

## Supabase
1. Criar o projeto e executar `supabase/schema.sql` no SQL Editor (RLS ativo, sem políticas: só a service role acede às tabelas).
2. Copiar *Project URL*, *anon key* e *service_role key* (Settings > API) para as variáveis de ambiente.
3. A `service_role` nunca vai para o navegador nem para o git.

## Deploy na Vercel
1. Importar o repositório (Framework: *Other*; `vercel.json` já define `public/`).
2. Definir todas as variáveis de `.env.example`. Chaves push: `npm run vapid`.
3. Email: criar conta no [Resend](https://resend.com), verificar o domínio e definir `RESEND_API_KEY` e `MAIL_FROM`.
4. Abrir `/admin.html` e imprimir os QR codes de check-in.

## Limites a ter em conta (250 pessoas)
- **Supabase Realtime Free: 200 conexões simultâneas.** Com 250 convidados use o plano Pro (500). Quem não conectar recebe atualizações pelo heartbeat de 60 s.
- Vercel Hobby é só não comercial; para uso da empresa use Pro.
- Lembretes "começa em 10 min" são disparados pelo heartbeat (`/api/sync`, 60 s) de quem estiver com a app aberta (sem cron).
- Push no iPhone só após "Adicionar ao ecrã principal" (iOS 16.4+).
- Autenticação por email + senha (scrypt); bloqueio de 10 min após 8 falhas; recuperação por PIN de 6 dígitos (15 min, 5 tentativas).
