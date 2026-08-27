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

# O portao do origin vem ANTES de tudo que custa tempo: conferir e um fetch, e
# recusar aqui poupa os sete minutos do portao de qualidade. A regra e o porque
# estao em scripts/portao-origin.sh -- resumo: `git archive HEAD` empacota a
# arvore LOCAL, entao publicar de uma copia atrasada tira de producao o trabalho
# de quem empurrou, com o hash carimbado batendo certinho.
echo "→ conferindo o origin"
bash scripts/portao-origin.sh master origin

# O `node_modules` precisa ser DIRETORIO DE VERDADE, e a checagem e aqui em cima
# porque falhar depois custa o portao inteiro.
#
# Publicar de um worktree pede node_modules, e a tentacao e economizar com uma
# juncao (`mklink /J`) apontando para o da arvore principal: instantanea, sem
# copia, e funciona para `tsc` e para `npm test`. Nao funciona para o `next dev`
# que o portao levanta -- o turbopack recusa com "Symlink [project]/node_modules
# is invalid, it points out of the filesystem root" e o servidor nao sobe.
#
# Descoberto em 27/08/2026, na primeira publicacao com o servidor do portao.
# O `npm ci --prefer-offline` no worktree leva 26 segundos com o cache local, o
# que torna a juncao uma economia que nao vale o risco.
if [ -L node_modules ]; then
	echo "✗ node_modules e um link/juncao — o servidor do portao nao sobe assim."
	echo "  No worktree, troque por instalacao de verdade:"
	echo "    cmd //c rmdir \"\$(cygpath -w \"\$PWD/node_modules\")\""
	echo "    npm ci --prefer-offline --no-audit --no-fund"
	exit 1
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

  # AUTORIZADA, E AINDA NAO APLICADA. O bloco que aplica de verdade esta depois
  # do portao de qualidade -- procure por "aplicando migracao" mais abaixo.
  #
  # Ate 27/08/2026 a aplicacao acontecia AQUI, e portao vermelho depois dela
  # deixava o banco de producao com estrutura nova e o codigo velho no ar. Nao
  # ha desfazer automatico: `migrar.mjs` registra o que aplicou, e voltar exige
  # SQL a mao com o dump ao lado.
  #
  # Aconteceu em 26/08/2026 com a `023-dominio-proprio.sql`. Deu certo por sorte,
  # porque a coluna nova era so ignorada pelo codigo velho. Com um `not null`
  # sem valor padrao, teria sido escrita quebrada em producao.
  #
  # A PERGUNTA continua aqui de proposito. Perguntar cedo deixa voce recusar sem
  # gastar os sete minutos do portao; so a ACAO e que espera.
  APLICAR_MIGRACAO=1
  echo "  autorizada — será aplicada DEPOIS do portão de qualidade"
else
  APLICAR_MIGRACAO=0
  [ "$TEM_TABELA" = "t" ] && echo "  banco em dia"
fi

# ── O portão de qualidade ────────────────────────────────────────────────────
#
# Até 26/08/2026 este script publicava sem conferir NADA: nem tipo, nem teste,
# nem lint. Havia 14 erros de lint no repositório e a publicação seguia normal,
# porque ninguém perguntava.
#
# Roda ANTES do `git archive` de propósito. Portão depois do empacotamento é
# decoração: o custo de descobrir o problema já foi pago, e a tentação de
# "deixa subir" é máxima justamente ali.
#
# O `--exigir-tudo` é o detalhe que faz este portão valer alguma coisa. A suíte
# PULA em silêncio tudo que fala HTTP quando o servidor de desenvolvimento está
# fora do ar, e mesmo assim sai com 0 — um portão ingênuo aprovaria com 11 de
# 36 suítes e diria que conferiu. Segurança sem conferência é pior que portão
# nenhum. Com a bandeira, pular vira reprovação. Ver `scripts/resultado-suite.mjs`.
#
# CONFERE A ÁRVORE DE TRABALHO, não o commit. Publicar árvore suja já é
# perguntado lá em cima; se você respondeu "sim" ali, o que este portão mede
# não é exatamente o que vai para o servidor.
echo "→ conferindo antes de publicar"

if ! npx tsc --noEmit; then
  echo "✗ tipos quebrados — nada foi publicado."
  exit 1
fi
echo "  tipos ok"

# ── O servidor do portao ────────────────────────────────────────────────────
#
# A suite fala HTTP. Ate 27/08/2026 ela falava com o servidor de desenvolvimento
# da 3040 -- compartilhado, e servindo a ARVORE DE TRABALHO, que nesta maquina e
# a mesma pasta para todas as sessoes. Duas consequencias, ambas vistas no mesmo
# dia: o servidor caiu no meio de uma publicacao e nove suites reprovaram com
# `fetch failed`; e outra sessao editava a home enquanto o portao rodava, e o
# portao teria julgado uma pagina pela metade que nao estava no pacote.
#
# O worktree fixado NAO resolvia isso. Ele isola a arvore e o HEAD; o servidor e
# de quem esta editando. Era a unica das tres corridas que nada acusava.
#
# Agora o portao sobe o SEU servidor, deste diretorio, numa porta sorteada livre.
#
# O NEXT RECUSA UM SEGUNDO SERVIDOR PARA O MESMO DIRETORIO -- ele detecta o que
# ja existe e sai. Isso e bom aqui: se estamos no worktree (o caso normal), a
# porta sobe limpa; se estamos na arvore principal com um `npm run dev` aberto,
# aquele servidor JA serve exatamente este diretorio, entao reusar esta certo.
# O `if` abaixo cobre os dois sem adivinhar.
PORTA_PORTAO=$(node -e "const n=require('net');const s=n.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
LOG_PORTAO="/tmp/portao-servidor-$$.log"
echo "  → subindo servidor do portão na porta $PORTA_PORTAO"
node node_modules/next/dist/bin/next dev --port "$PORTA_PORTAO" > "$LOG_PORTAO" 2>&1 &

# Derruba PELA PORTA e nunca por nome: a porta foi sorteada livre e e so deste
# processo, entao nao ha como acertar o servidor de outra sessao por engano.
# O `$!` do git-bash NAO e o PID do Windows -- taskkill com ele diz "processo nao
# encontrado" e o servidor fica de pe. Custou um teste para descobrir.
derrubar_portao() {
	[ -n "${PORTA_PORTAO:-}" ] || return 0
	local pid
	pid=$(powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort $PORTA_PORTAO -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess" 2>/dev/null | tr -d '\r')
	[ -n "$pid" ] && taskkill //T //F //PID "$pid" >/dev/null 2>&1
	rm -f "$LOG_PORTAO"
}
# `trap` na saida: sem ele, o `exit 1` de uma suite reprovada deixa um `next dev`
# orfao comendo memoria -- e mais um a cada tentativa de publicacao.
trap derrubar_portao EXIT

BASE_PORTAO="http://localhost:$PORTA_PORTAO"
for _ in $(seq 1 60); do
	c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE_PORTAO/api/healthz" 2>/dev/null || true)
	[ "$c" = "200" ] && break
	# A primeira requisicao compila a rota, entao "Ready in 600ms" no log nao
	# significa que healthz responde. Esperar pelo healthz, e nao pelo log.
	if grep -q "Another next dev server is already running" "$LOG_PORTAO" 2>/dev/null; then
		BASE_PORTAO=$(grep -oE "http://localhost:[0-9]+" "$LOG_PORTAO" | tail -1)
		echo "  (já havia servidor para ESTE diretório — usando $BASE_PORTAO)"
		PORTA_PORTAO=""   # nao e nosso: nao derrubar
		break
	fi
	sleep 2
done

if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_PORTAO/api/healthz" 2>/dev/null || true)" != "200" ]; then
	echo "✗ o servidor do portão não subiu — nada foi publicado."
	tail -15 "$LOG_PORTAO" 2>/dev/null | sed 's/^/    /'
	exit 1
fi
echo "  servidor do portão no ar"

if ! BASE_URL="$BASE_PORTAO" npm test -- --exigir-tudo; then
  echo
  echo "✗ suíte reprovada ou incompleta — nada foi publicado."
  echo "  A suíte falou com o servidor DESTE commit ($BASE_PORTAO), não com o da 3040."
  echo "  Então 'cobertura parcial' aqui é defeito de verdade, não servidor fora."
  exit 1
fi

# ATALHO DELIBERADO: o lint PERGUNTA em vez de bloquear, porque hoje há 14 erros
# conhecidos (react-hooks e um <a> no error.tsx) e travar a publicação agora
# seria travar o produto por dívida antiga. Assim que esses 14 forem a zero,
# trocar este bloco por um `exit 1` seco — a pergunta existe só para atravessar
# a dívida, não para conviver com ela.
LINT=$( (npx eslint --format json 2>/dev/null || true) | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let e=0;for(const f of JSON.parse(s||"[]"))e+=f.errorCount;console.log(e)})' )
if [ "${LINT:-0}" != "0" ]; then
  echo "  ! eslint: $LINT erro(s)"
  read -rp "  Publicar mesmo assim? [s/N] " r
  [[ "$r" =~ ^[sS]$ ]] || exit 1
else
  echo "  lint ok"
fi

# ── A migracao, agora que o codigo passou ───────────────────────────────────
#
# Esta e a posicao certa e ela custou um susto para ser descoberta: aqui o
# codigo JA provou que compila e que a suite inteira passa. Se o portao acima
# tivesse reprovado, o script ja teria saido e o banco continuaria intacto.
#
# Ainda ha uma janela, e vale nomear em vez de fingir que nao existe: entre
# aplicar a migracao e o symlink trocar, a producao roda codigo velho com
# esquema novo por alguns segundos. Isso e inerente a publicar sem parar o site,
# e e o motivo de toda migracao daqui precisar ser compativel para tras --
# coluna nova entra opcional, coluna velha sai numa publicacao DEPOIS de o
# codigo parar de usa-la. A janela de segundos e aceitavel; a de sete minutos,
# que era o que existia antes, nao era.
if [ "${APLICAR_MIGRACAO:-0}" = "1" ]; then
	echo "→ aplicando migração(ões) — o código já passou pelo portão"

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
