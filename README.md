# App OFG Recife 2026 (PWA)

PWA estática (`public/`) + API serverless (`api/index.js` (rewrite `/api/*` no `vercel.json`) → `lib/handler.js`) na Vercel.
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
2. Variáveis: preencher `.env.local` e correr `vercel link` seguido de `npm run vercel:env` (aceita `-- --dry-run`, `-- --target preview`). Gera `ADMIN_KEY`, `APP_SECRET` e chaves VAPID se faltarem e guarda-os em `.env.vercel.generated` (ignorado pelo git).
3. Email: criar conta no [Resend](https://resend.com), verificar o domínio e definir `RESEND_API_KEY` e `MAIL_FROM`.
4. Abrir `/admin.html` e imprimir os QR codes de check-in.

## Login com Google
Gratuito (Google Identity Services). No Google Cloud Console: *APIs e serviços > Credenciais > ID do cliente OAuth* (tipo **Web**), com as origens JavaScript autorizadas `https://<domínio>` e `http://localhost:<porta>`; o ecrã de consentimento deve estar **"Em produção"**. Definir `GOOGLE_CLIENT_ID`.
**Redirecionamento:** em produção (ou com `PUBLIC_URL` definido) o login usa o modo *redirect* do Google e termina sempre em `https://app.oportofortegroup.com` (URL canónica; sem `PUBLIC_URL`, a Vercel de produção usa esse valor). É preciso adicionar `https://app.oportofortegroup.com/api/google` em *URIs de redirecionamento autorizados* do cliente OAuth. O servidor valida o CSRF do Google, cria um código de uso único (60 s) e a app troca-o pela sessão (o token nunca aparece na URL). Em desenvolvimento local, sem `PUBLIC_URL`, usa popup.
O servidor valida o ID token localmente (`lib/google.js`: assinatura RS256, `aud`, `iss`, `exp`, `email_verified`) e entra/cria a conta pelo email verificado; contas novas completam empresa e cargo antes de entrar. Conta existente com o mesmo email é ligada automaticamente.

## Limites a ter em conta (250 pessoas)
- **Supabase Realtime Free: 200 conexões simultâneas.** Com 250 convidados use o plano Pro (500). Quem não conectar recebe atualizações pelo heartbeat de 60 s.
- Vercel Hobby é só não comercial; para uso da empresa use Pro.
- Lembretes "começa em 10 min" são disparados pelo heartbeat (`/api/sync`, 60 s) de quem estiver com a app aberta (sem cron).
- Push no iPhone só após "Adicionar ao ecrã principal" (iOS 16.4+).
- Autenticação por email + senha (scrypt); bloqueio de 10 min após 8 falhas; recuperação por PIN de 6 dígitos (15 min, 5 tentativas).
