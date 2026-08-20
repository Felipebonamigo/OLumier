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
# pipefail nao e detalhe: sem ele, `npm run build | tail -3` devolve o status do
# TAIL (sempre 0), o `set -e` nao ve falha nenhuma e o servico reinicia com build
# quebrado. O `set -euo pipefail` da linha 9 vale so para a maquina local — este
# heredoc roda em outro shell, no servidor, e nao herda nada.
ssh "$VPS" "bash -s" <<REMOTE
set -eo pipefail
tar -xzf /tmp/fotonio.tar.gz -C $DESTINO
cd $DESTINO
npm ci --no-audit --no-fund >/dev/null 2>&1
npm run build 2>&1 | tail -3
systemctl restart $SERVICO
sleep 6
systemctl is-active $SERVICO
REMOTE

# Conferir /entrar so provava que o Next respondia: aquela pagina nao toca banco
# nem R2. A raiz e renderizada no servidor e a de conta exige sessao — juntas,
# provam que o processo subiu de pe. O banco tem prova propria logo abaixo.
echo "→ conferindo"
ssh "$VPS" "
  set -e
  for r in / /entrar; do
    c=\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 http://localhost:3300\$r)
    echo \"  \$r -> HTTP \$c\"
    [ \"\$c\" = 200 ] || { echo '  ! resposta inesperada'; exit 1; }
  done
  # Bate numa rota que consulta o banco de verdade (o porteiro do TLS faz SELECT).
  c=\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 'http://localhost:3300/api/tls/permitir?domain=fotonio.com.br')
  echo \"  banco (via /api/tls/permitir) -> HTTP \$c\"
  [ \"\$c\" = 200 ] || { echo '  ! o app subiu mas nao fala com o banco'; exit 1; }
"
echo "✓ publicado"
