# App OFG Recife 2026 (PWA)

## Desenvolvimento
```bash
npm install && npm start      # http://localhost:3000 · admin em /admin.html
```
Conteúdo do evento (sessões, FAQs, parceiros, local): `event-data.js`.

## Deploy com HTTPS (VPS com Docker)
1. Apontar um domínio (registo A) para o IP do servidor; abrir portas 80 e 443.
2. `cp .env.example .env` e preencher `DOMAIN`, `ADMIN_KEY`, `APP_SECRET`.
3. `docker compose up -d --build` — o Caddy obtém o certificado sozinho.
4. Abrir `https://DOMAIN/admin.html`, imprimir os QR codes de check-in.

Dados em `./data` (db.json e chaves VAPID): fazer backup; **não perder vapid.json** (senão as subscrições push deixam de funcionar).

## Notificações push
Web Push com VAPID. No iPhone só funciona depois de "Adicionar ao ecrã principal" (iOS 16.4+).
