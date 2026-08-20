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

# Publicar código que depende de uma coluna que ninguém criou quebra para o
# USUÁRIO, não para quem publicou. Conferir antes é barato; descobrir depois, não.
echo "→ conferindo migrações do banco"
# O `|| true` e o teste de existência não são frouxidão: na PRIMEIRA publicação
# depois desta mudança o script ainda não existe no servidor, e abortar aí
# impediria justamente o deploy que o instala.
ESTADO=$(ssh "$VPS" "
  if [ -f /opt/fotonio/scripts/migrar.mjs ]; then
    cd /opt/fotonio && /usr/local/bin/node --env-file=.env.production scripts/migrar.mjs >/dev/null 2>&1
    echo \$?
  else
    echo ausente
  fi
")
if [ "$ESTADO" = "2" ]; then
  echo "! Há migração pendente em produção. Aplique ANTES de publicar:"
  echo "    ssh $VPS '/opt/fotonio-backup.sh'"
  echo "    ssh $VPS 'cd /opt/fotonio && /usr/local/bin/node --env-file=.env.production scripts/migrar.mjs --aplicar'"
  exit 1
elif [ "$ESTADO" = "ausente" ]; then
  echo "  (controle de migrações ainda não instalado — será nesta publicação)"
else
  echo "  banco em dia"
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
  # O healthz testa banco E R2 de verdade — se ele passa, o app trabalha mesmo.
  corpo=\$(curl -s --max-time 25 http://localhost:3300/api/healthz)
  c=\$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 http://localhost:3300/api/healthz)
  echo \"  /api/healthz -> HTTP \$c \$corpo\"
  [ \"\$c\" = 200 ] || { echo '  ! o app subiu mas alguma dependencia esta fora'; exit 1; }
"
echo "✓ publicado"
