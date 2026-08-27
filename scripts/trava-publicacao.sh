#!/usr/bin/env bash
#
# Uma publicacao por vez, imposta pelo SERVIDOR.
#
#   bash scripts/trava-publicacao.sh pegar  <carimbo>   # 0 = peguei, 1 = ocupado
#   bash scripts/trava-publicacao.sh soltar
#   bash scripts/trava-publicacao.sh ver
#
# ── POR QUE ESTA TRAVA EXISTE ────────────────────────────────────────────────
#
# Em 27/08/2026 uma sessao publicou a release `113102-aaaaded` no meio da vez de
# outra, que tinha reclamado a pista por mensagem. Nao houve estrago por SORTE
# de topologia: o commit em voo era filho direto do que subiu, entao nada se
# perdeu. Divergentes, seriam duas trocas de symlink brigando por /opt/fotonio
# com cliente dentro.
#
# Foi a QUARTA corrida do mesmo dia. As tres anteriores -- arvore suja no
# portao, HEAD andando entre portao e empacotamento, servidor servindo arvore
# alheia -- foram fechadas por worktree fixado e servidor proprio do portao.
# Nenhuma delas cobre esta.
#
# ── POR QUE NO SERVIDOR, E NAO NUM ARQUIVO DO REPOSITORIO ───────────────────
#
# O conflito nao acontece na maquina de quem publica: acontece no `ln -sfn` do
# servidor. Duas maquinas diferentes passariam por todos os portoes locais e
# colidiriam la mesmo assim. Trava local so protege de si mesmo.
#
# E ela existe justamente para quem NAO leu o canal de mensagens: a fila por
# conversa so funciona entre quem conversa.
#
# ── POR QUE `mkdir` E NAO UM ARQUIVO ────────────────────────────────────────
#
# `mkdir` e atomico em POSIX: ou cria, ou falha porque ja existe, sem janela
# entre conferir e criar. Um `[ -f trava ] || touch trava` tem essa janela --
# duas publicacoes que chegam no mesmo instante passam as duas, que e
# exatamente o defeito que esta trava existe para impedir.
set -euo pipefail

VPS="root@179.197.233.184"
TRAVA="/opt/fotonio-trava-publicacao"
# Publicacao demora ~7 minutos. Uma hora e folga larga de proposito: o dano de
# soltar cedo (duas publicacoes ao mesmo tempo) e maior que o de esperar.
VALIDADE_MIN=60

acao="${1:-ver}"
carimbo="${2:-sem-carimbo}"

case "$acao" in
pegar)
	quem="${USER:-$USERNAME}@$(hostname) carimbo=$carimbo em $(date '+%d/%m %H:%M:%S')"
	# Trava velha e trava esquecida: um deploy morto (janela fechada, maquina
	# reiniciada) deixaria a publicacao presa para todos ate alguem limpar a mao.
	if ssh -n "$VPS" "
		if [ -d '$TRAVA' ] && [ -n \"\$(find '$TRAVA' -maxdepth 0 -mmin +$VALIDADE_MIN 2>/dev/null)\" ]; then
			echo '  (trava com mais de $VALIDADE_MIN min — publicacao abandonada, liberando)' >&2
			rm -rf '$TRAVA'
		fi
		mkdir '$TRAVA' 2>/dev/null
	"; then
		ssh -n "$VPS" "echo '$quem' > '$TRAVA/dono'" 2>/dev/null || true
		echo "  trava obtida"
		exit 0
	fi
	dono=$(ssh -n "$VPS" "cat '$TRAVA/dono' 2>/dev/null" || echo "desconhecido")
	echo "✗ ja ha uma publicacao em andamento."
	echo "  dono: $dono"
	echo
	echo "  Espere ela terminar. Se tiver certeza de que aquela publicacao morreu:"
	echo "    bash scripts/trava-publicacao.sh soltar"
	exit 1
	;;
soltar)
	ssh -n "$VPS" "rm -rf '$TRAVA'" && echo "  trava solta"
	;;
ver)
	if ssh -n "$VPS" "[ -d '$TRAVA' ]"; then
		echo "ocupada: $(ssh -n "$VPS" "cat '$TRAVA/dono' 2>/dev/null" || echo desconhecido)"
		exit 1
	fi
	echo "livre"
	;;
*)
	echo "uso: trava-publicacao.sh pegar <carimbo> | soltar | ver" >&2
	exit 2
	;;
esac
