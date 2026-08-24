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
BANCO="fotonio"   # banco de PRODUCAO, consultado pelo portao de migracao
MANTER=3 # quantas releases antigas guardar, para poder voltar atras

cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "! Ha mudancas nao commitadas. O deploy publica so o que esta no commit."
  read -rp "  Continuar mesmo assim? [s/N] " r
  [[ "$r" =~ ^[sS]$ ]] || exit 1
fi

SHA=$(git rev-parse --short HEAD)
CARIMBO="$(date +%Y%m%d-%H%M%S)-$SHA"

# ── O portão de migração ─────────────────────────────────────────────────────
#
# Publicar código que depende de uma coluna que ninguém criou quebra para o
# USUÁRIO, não para quem publicou. Conferir antes é barato; descobrir depois, não.
#
# A PERGUNTA CERTA é: "o COMMIT que estou publicando traz migração que o banco
# ainda não viu?".
#
# Antes este portão perguntava isso ao release QUE ESTÁ NO AR — rodava o
# migrar.mjs de lá e lia o código de saída. Só que o release no ar, por
# definição, NÃO conhece as migrações novas: elas viajam dentro do commit que
# está sendo publicado. O portão respondia "banco em dia" justamente quando
# havia migração pendente.
#
# Aconteceu em 21/08/2026 com a 008 (renome de logo_url → logo_chave): o portão
# deu passagem, e só não subiu código procurando uma coluna inexistente porque a
# migração foi aplicada na mão antes. Com cliente dentro, seria o site fora do ar.
#
# Agora a comparação é entre as duas únicas fontes que importam: os arquivos do
# COMMIT e a tabela `migracoes_aplicadas` do banco de PRODUÇÃO.
# -n em todo ssh que nao precisa de stdin: sem ele o ssh CONSOME a entrada
# do script. Em 24/08/2026 as duas consultas abaixo engoliram a resposta do
# "Aplicar agora?", o read recebeu EOF e o deploy abortou dizendo que nada foi
# aplicado. O unico ssh que fica sem -n e o do heredoc, que usa stdin de proposito.
echo "→ conferindo migrações do banco"

# Do commit, não do diretório de trabalho: é isso que vai ser publicado.
LOCAIS=$(git ls-tree --name-only HEAD -- db/migracoes/ | sed 's|.*/||' | grep '\.sql$' | sort || true)

TEM_TABELA=$(ssh -n "$VPS" "sudo -u postgres psql -d $BANCO -tAc \"select to_regclass('public.migracoes_aplicadas') is not null\" 2>/dev/null" | tr -d '[:space:]')

if [ "$TEM_TABELA" != "t" ]; then
  echo "  (controle de migrações ainda não instalado — será nesta publicação)"
  PENDENTES=""
else
  APLICADAS=$(ssh -n "$VPS" "sudo -u postgres psql -d $BANCO -tAc 'select arquivo from migracoes_aplicadas' 2>/dev/null" | sed 's/[[:space:]]*$//' | sed '/^$/d' | sort)
  PENDENTES=$(comm -23 <(echo "$LOCAIS") <(echo "$APLICADAS"))
fi

if [ -n "$PENDENTES" ]; then
  echo "! Este commit traz migração que o banco de produção ainda não tem:"
  echo "$PENDENTES" | sed 's/^/    · /'
  echo
  echo "  Aplicar agora? Faço dump antes (com cópia fora do servidor), envio os"
  echo "  arquivos e aplico pelo controle de migrações."
  read -rp "  Aplicar? [s/N] " r
  if [[ ! "$r" =~ ^[sS]$ ]]; then
    echo
    echo "  Nada foi aplicado. Para fazer na mão:"
    echo "    ssh $VPS '/opt/fotonio-backup.sh'"
    echo "$PENDENTES" | sed "s|^|    scp db/migracoes/|; s|$| $VPS:$ATUAL/db/migracoes/|"
    echo "    ssh $VPS 'cd $ATUAL && /usr/local/bin/node --env-file=.env.production scripts/migrar.mjs --aplicar'"
    exit 1
  fi

  # Dump ANTES de mexer na estrutura. Sem rede, sem publicação.
  echo "  → dump de segurança"
  ssh -n "$VPS" "/opt/fotonio-backup.sh" | sed 's/^/    /'

  # Os arquivos precisam estar no servidor para o migrar.mjs enxergá-los. Vão
  # para o release ATUAL; o registro fica no banco, que sobrevive à troca.
  echo "  → enviando migração(ões)"
  while read -r m; do
    [ -n "$m" ] && scp -q "db/migracoes/$m" "$VPS:$ATUAL/db/migracoes/$m"
  done <<< "$PENDENTES"

  echo "  → aplicando"
  ssh -n "$VPS" "cd $ATUAL && /usr/local/bin/node --env-file=.env.production scripts/migrar.mjs --aplicar" | sed 's/^/    /'
else
  [ "$TEM_TABELA" = "t" ] && echo "  banco em dia"
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
ssh -n "$VPS" "
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
