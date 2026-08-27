#!/usr/bin/env bash
#
# Recusa publicar quando o HEAD local diverge do remoto.
#
#   bash scripts/portao-origin.sh [ramo] [remoto]     # padrao: master origin
#
# Sai 0 quando pode publicar, 1 quando nao pode. Nao imprime nada em silencio:
# recusa sempre diz o que seria perdido.
#
# ── POR QUE ESTE PORTAO EXISTE ───────────────────────────────────────────────
#
# `git archive HEAD` empacota a arvore LOCAL. Se outra sessao empurrou e esta
# maquina nao puxou, a publicacao sobe SEM o trabalho dela, e o hash carimbado
# bate certinho enquanto isso acontece -- ele descreve o que foi empacotado, nao
# o que deveria ter sido. Foi a sessao do Atomatiza que levantou isso em
# 27/08/2026, depois de publicar um HEAD que nao tinha cinco commits de outra
# sessao e deixar producao sem o trabalho dela por alguns minutos.
#
# ── POR QUE ESTAR A FRENTE TAMBEM RECUSA, AQUI ───────────────────────────────
#
# No Atomatiza estar a frente do origin e so aviso, e faz sentido la: cada
# sessao tem seu clone, e commit local nao empurrado e recuperavel -- ele
# existe, e so empurrar.
#
# Aqui nao. Todas as sessoes desta maquina dividem UMA arvore de trabalho.
# Publicar commit que nao esta no origin poe producao a rodar codigo que mais
# ninguem tem, e o proximo deploy feito depois de um `git pull` desfaz sem saber
# que desfez. A diferenca nao e de rigor, e de topologia.
#
# ── POR QUE E UM SCRIPT SEPARADO ─────────────────────────────────────────────
#
# Para poder ser EXERCITADO. Um worktree fixado num commit velho roda este
# arquivo e a recusa acontece de verdade, sem publicar nada.
#
# Testar a mesma regra de dentro do deploy.sh exigiria fazer checkout do
# repositorio para criar a divergencia -- e o checkout troca o proprio deploy.sh
# no disco pela versao SEM o portao. O script entao publica achando que
# conferiu. Aconteceu no Atomatiza e custou uma publicacao errada; a saida deles
# foi copia nao rastreada montada ANTES do checkout, porque arquivo nao
# rastreado sobrevive a troca de branch e arquivo versionado nao.
set -euo pipefail

RAMO="${1:-master}"
REMOTO="${2:-origin}"
ALVO="$REMOTO/$RAMO"

# `git fetch` sem -q imprime na stderr e sujaria a saida do deploy; o que importa
# aqui e o codigo de saida.
if ! git fetch -q "$REMOTO" "$RAMO" 2>/dev/null; then
	echo "! nao consegui falar com $REMOTO — sem rede, ou o remoto mudou."
	echo "  Publicar sem conferir significa aceitar que talvez falte trabalho de"
	echo "  outra sessao no que vai subir."
	read -rp "  Publicar assim mesmo? [s/N] " r
	# Sem terminal, `read` recebe EOF e `r` fica vazio: recusa. Portao de
	# seguranca falha FECHADO de proposito -- o custo de recusar e outra
	# tentativa, o de aceitar e producao sem o trabalho de alguem.
	[[ "$r" =~ ^[sS]$ ]] || exit 1
	exit 0
fi

if ! git rev-parse --verify -q "$ALVO" >/dev/null; then
	echo "! $ALVO nao existe. Confira o nome do ramo e do remoto."
	exit 1
fi

ATRAS=$(git rev-list --count "HEAD..$ALVO")
FRENTE=$(git rev-list --count "$ALVO..HEAD")

if [ "$ATRAS" != "0" ]; then
	echo "✗ o HEAD local esta ATRAS de $ALVO em $ATRAS commit(s)."
	echo
	echo "  Publicar agora tiraria de producao o trabalho abaixo, sem aviso e sem"
	echo "  que o hash carimbado acusasse:"
	git log --oneline "HEAD..$ALVO" | sed 's/^/    · /'
	echo
	echo "  Antes de publicar:  git pull --ff-only $REMOTO $RAMO"
	exit 1
fi

if [ "$FRENTE" != "0" ]; then
	echo "✗ o HEAD local esta A FRENTE de $ALVO em $FRENTE commit(s)."
	echo
	echo "  Estes existem so nesta maquina. Publicados, producao passa a rodar"
	echo "  codigo que mais ninguem tem -- e o proximo deploy feito depois de um"
	echo "  pull desfaz isso sem saber:"
	git log --oneline "$ALVO..HEAD" | sed 's/^/    · /'
	echo
	echo "  Antes de publicar:  git push $REMOTO HEAD:$RAMO"
	exit 1
fi

echo "  local e $ALVO batem"
exit 0
