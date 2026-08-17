#!/usr/bin/env bash
# Publica o Fotonio no VPS em um comando.
#
#   bash deploy.sh
#
# Empacota o que esta COMMITADO (git archive HEAD) e extrai POR CIMA de
# /opt/fotonio - de proposito, sem apagar a pasta: assim node_modules e o
# .env.production (que so existe no servidor) sobrevivem.
set -euo pipefail

VPS="root@179.197.233.184"
DESTINO="/opt/fotonio"
SERVICO="fotonio"

cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "! Ha mudancas nao commitadas. O deploy publica so o que esta no commit."
  read -rp "  Continuar mesmo assim? [s/N] " r
  [[ "$r" =~ ^[sS]$ ]] || exit 1
fi

echo "→ empacotando $(git rev-parse --short HEAD)"
git archive --format=tar.gz -o /tmp/fotonio-deploy.tar.gz HEAD

echo "→ enviando"
scp -q /tmp/fotonio-deploy.tar.gz "$VPS:/tmp/fotonio.tar.gz"

echo "→ instalando e construindo no servidor"
ssh "$VPS" "bash -s" <<REMOTE
set -e
tar -xzf /tmp/fotonio.tar.gz -C $DESTINO
cd $DESTINO
npm ci --no-audit --no-fund >/dev/null 2>&1
npm run build 2>&1 | tail -3
systemctl restart $SERVICO
sleep 6
systemctl is-active $SERVICO
REMOTE

echo "→ conferindo"
ssh "$VPS" "curl -s -o /dev/null -w 'HTTP %{http_code}\n' --max-time 20 http://127.0.0.1:3300/entrar"
echo "✓ publicado"
