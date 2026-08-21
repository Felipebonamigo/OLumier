#!/usr/bin/env bash
# Publica o Fotonio no VPS em um comando.
#
#   bash deploy.sh
#
# COMO FUNCIONA: cada publicacao vira uma RELEASE nova em /opt/fotonio-releases,
# construida ao lado enquanto a versao atual continua servindo. So no fim o link
# /opt/fotonio passa a apontar para a nova.
#
# Antes o deploy extraia por cima de /opt/fotonio e rodava `npm ci` ali mesmo —
# com o app no ar. Durante um minuto o processo servia uma arvore sem
# node_modules e com o .next sendo reescrito por baixo: quem estivesse usando
# tomava erro. Agora o unico momento de indisponibilidade e o restart.
#
# O que persiste entre releases fica em /opt/fotonio-shared (hoje: o
# .env.production, que so existe no servidor e nunca entra no git).
set -euo pipefail

VPS="root@179.197.233.184"
ATUAL="/opt/fotonio"
RELEASES="/opt/fotonio-releases"
COMPARTILHADO="/opt/fotonio-shared"
SERVICO="fotonio"
MANTER=3 # quantas releases antigas guardar, para poder voltar atras

cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "! Ha mudancas nao commitadas. O deploy publica so o que esta no commit."
  read -rp "  Continuar mesmo assim? [s/N] " r
  [[ "$r" =~ ^[sS]$ ]] || exit 1
fi

SHA=$(git rev-parse --short HEAD)
CARIMBO="$(date +%Y%m%d-%H%M%S)-$SHA"

# Publicar código que depende de uma coluna que ninguém criou quebra para o
# USUÁRIO, não para quem publicou. Conferir antes é barato; descobrir depois, não.
echo "→ conferindo migrações do banco"
ESTADO=$(ssh "$VPS" "
  if [ -f $ATUAL/scripts/migrar.mjs ]; then
    cd $ATUAL && /usr/local/bin/node --env-file=.env.production scripts/migrar.mjs >/dev/null 2>&1
    echo \$?
  else
    echo ausente
  fi
")
if [ "$ESTADO" = "2" ]; then
  echo "! Há migração pendente em produção. Aplique ANTES de publicar:"
  echo "    ssh $VPS '/opt/fotonio-backup.sh'"
  echo "    ssh $VPS 'cd $ATUAL && /usr/local/bin/node --env-file=.env.production scripts/migrar.mjs --aplicar'"
  exit 1
elif [ "$ESTADO" = "ausente" ]; then
  echo "  (controle de migrações ainda não instalado — será nesta publicação)"
else
  echo "  banco em dia"
fi

echo "→ empacotando $SHA"
git archive --format=tar.gz -o /tmp/fotonio-deploy.tar.gz HEAD

echo "→ enviando"
scp -q /tmp/fotonio-deploy.tar.gz "$VPS:/tmp/fotonio.tar.gz"

echo "→ construindo a release $CARIMBO (a versão atual segue no ar)"
# pipefail nao e detalhe: sem ele, `npm run build | tail -3` devolve o status do
# TAIL (sempre 0), o `set -e` nao ve falha nenhuma e a release quebrada seria
# promovida. O `set -euo pipefail` da linha 17 vale so para a maquina local —
# este heredoc roda em outro shell, no servidor, e nao herda nada.
ssh "$VPS" "bash -s" <<REMOTE
set -eo pipefail

NOVA="$RELEASES/$CARIMBO"
mkdir -p "\$NOVA" "$COMPARTILHADO"
tar -xzf /tmp/fotonio.tar.gz -C "\$NOVA"

# O .env.production nunca entra no git: vive no compartilhado e cada release
# aponta para ele. Assim tudo que le /opt/fotonio/.env.production continua
# funcionando sem saber que mudou de lugar.
ln -sfn "$COMPARTILHADO/.env.production" "\$NOVA/.env.production"

cd "\$NOVA"
npm ci --no-audit --no-fund >/dev/null 2>&1
npm run build 2>&1 | tail -3

# Troca ATOMICA: cria o link ao lado e move por cima. Um "rm + ln" deixaria uma
# fresta em que /opt/fotonio nao existe, e qualquer coisa que lesse o caminho
# nesse instante falharia.
ln -sfn "\$NOVA" "$ATUAL.novo"
mv -Tf "$ATUAL.novo" "$ATUAL"

systemctl restart $SERVICO
sleep 6
systemctl is-active $SERVICO

# Guarda as ultimas para poder voltar atras; o resto sai.
ls -1dt $RELEASES/*/ 2>/dev/null | tail -n +$((MANTER + 1)) | xargs -r rm -rf
REMOTE

# Conferir /entrar so provava que o Next respondia: aquela pagina nao toca banco
# nem R2. O healthz testa as duas dependencias de verdade.
echo "→ conferindo"
ssh "$VPS" "
  set -e
  for r in / /entrar; do
    c=\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 http://localhost:3300\$r)
    echo \"  \$r -> HTTP \$c\"
    [ \"\$c\" = 200 ] || { echo '  ! resposta inesperada'; exit 1; }
  done
  corpo=\$(curl -s --max-time 25 http://localhost:3300/api/healthz)
  c=\$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 http://localhost:3300/api/healthz)
  echo \"  /api/healthz -> HTTP \$c \$corpo\"
  [ \"\$c\" = 200 ] || { echo '  ! o app subiu mas alguma dependencia esta fora'; exit 1; }
  echo \"  release no ar: \$(readlink -f $ATUAL | xargs basename)\"
"
echo "✓ publicado"
