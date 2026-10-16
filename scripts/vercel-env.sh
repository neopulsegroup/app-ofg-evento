#!/usr/bin/env bash
# Cadastra as variáveis de ambiente na Vercel a partir de um ficheiro .env (por omissão .env.local).
#
# Uso:
#   scripts/vercel-env.sh [--env-file .env.local] [--target production|preview|development] [--dry-run]
#
# Requisitos: Vercel CLI (npm i -g vercel), `vercel login` e `vercel link` já feitos neste projeto.
# - Os valores vão por stdin (não aparecem na linha de comandos nem no histórico) e nunca são impressos.
# - ADMIN_KEY / APP_SECRET ausentes ou com valor de desenvolvimento são gerados aleatoriamente.
# - VAPID_PUBLIC / VAPID_PRIVATE ausentes são gerados (npm run vapid). Guarde-os: trocá-los invalida as subscrições push.
# - Variáveis já existentes na Vercel são sobrescritas (--force).
set -euo pipefail

ENV_FILE=".env.local"; TARGET="production"; DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --target)   TARGET="$2"; shift 2 ;;
    --dry-run)  DRY=1; shift ;;
    -h|--help)  sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")/.."
[[ -f "$ENV_FILE" ]] || { echo "Ficheiro $ENV_FILE não encontrado (copie .env.example)." >&2; exit 1; }
if [[ $DRY -eq 0 ]]; then
  command -v vercel >/dev/null || { echo "Vercel CLI não instalada: npm i -g vercel" >&2; exit 1; }
  [[ -d .vercel ]] || { echo "Projeto não ligado: corra 'vercel link' primeiro." >&2; exit 1; }
fi

# nomes enviados para a Vercel (obrigatórios primeiro)
REQUIRED=(SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY ADMIN_KEY APP_SECRET VAPID_PUBLIC VAPID_PRIVATE)
OPTIONAL=(VAPID_SUBJECT RESEND_API_KEY MAIL_FROM PUBLIC_URL)

get() { # lê KEY do ficheiro (ignora comentários, remove aspas)
  local v; v=$(grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"; printf '%s' "$v"
}

GENERATED=()
for k in "${REQUIRED[@]}" "${OPTIONAL[@]}"; do printf -v "V_$k" '%s' "$(get "$k")"; done
val() { local n="V_$1"; printf '%s' "${!n}"; }
setv() { printf -v "V_$1" '%s' "$2"; }

# gerar segredos ausentes / de desenvolvimento
for k in ADMIN_KEY APP_SECRET; do
  cur="$(val "$k")"
  if [[ -z "$cur" || "$cur" == admin-dev || "$cur" == dev-secret || "$cur" == gerar-* ]]; then
    setv "$k" "$(openssl rand -hex 32)"; echo "• $k gerado aleatoriamente"
    GENERATED+=("$k")
  fi
done
if [[ -z "$(val VAPID_PUBLIC)" || -z "$(val VAPID_PRIVATE)" ]]; then
  KEYS="$(node -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)")"
  setv VAPID_PUBLIC "${KEYS%% *}"; setv VAPID_PRIVATE "${KEYS##* }"
  echo "• chaves VAPID geradas"; GENERATED+=(VAPID_PUBLIC VAPID_PRIVATE)
fi
[[ -n "$(val VAPID_SUBJECT)" ]] || setv VAPID_SUBJECT "mailto:eventos@oportofortegroup.com"

missing=()
for k in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do [[ -n "$(val "$k")" ]] || missing+=("$k"); done
if [[ ${#missing[@]} -gt 0 ]]; then echo "Faltam no $ENV_FILE: ${missing[*]}" >&2; exit 1; fi
[[ -n "$(val RESEND_API_KEY)" ]] || echo "⚠ RESEND_API_KEY vazio: a recuperação de senha por email não funcionará em produção."

echo "Destino: $TARGET"
for k in "${REQUIRED[@]}" "${OPTIONAL[@]}"; do
  [[ -n "$(val "$k")" ]] || { echo "- $k: ignorado (vazio)"; continue; }
  if [[ $DRY -eq 1 ]]; then echo "- $k: (dry-run) seria cadastrado"; continue; fi
  printf '%s' "$(val "$k")" | vercel env add "$k" "$TARGET" --force >/dev/null
  echo "- $k: cadastrado"
done

if [[ ${#GENERATED[@]} -gt 0 && $DRY -eq 0 ]]; then
  # guarda os valores gerados localmente para não os perder (ficheiro ignorado pelo git)
  OUT=".env.vercel.generated"; : > "$OUT"; chmod 600 "$OUT"
  for k in "${GENERATED[@]}"; do echo "$k=$(val "$k")" >> "$OUT"; done
  echo "Valores gerados guardados em $OUT (não faça commit). Use ADMIN_KEY para entrar em /admin.html."
fi
[[ $DRY -eq 1 ]] || echo "Concluído. Faça um novo deploy para aplicar: vercel --prod"
