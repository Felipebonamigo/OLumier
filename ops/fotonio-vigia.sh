#!/usr/bin/env bash
# Vigia do Fotonio — roda a cada 5 min pelo systemd (fotonio-vigia.timer).
#
# O que ele faz de diferente do vigia do Padelizou: aquele reinicia o servico
# sempre que o healthz nao responde 200. Aqui isso seria errado na metade dos
# casos — o /api/healthz do Fotonio testa banco e R2 de verdade, entao um 503
# costuma significar "o app esta de pe, a DEPENDENCIA caiu". Reiniciar nao
# conserta banco fora do ar; so apaga o processo que ainda servia as paginas
# em cache e atrapalha quem estava usando.
#
# Regra:
#   - nao respondeu nada (000/timeout)  -> app travado, REINICIA e confere
#   - 503 com banco/R2 em falso         -> dependencia caiu, AVISA (nao reinicia)
#   - 200                               -> silencio
#
# Log: /var/log/fotonio-vigia.log
set -uo pipefail

URL="https://fotonio.com.br/api/healthz"
SERVICO=fotonio
LOG=/var/log/fotonio-vigia.log
SEGREDOS=/opt/atomatiza-secrets.env
# Nao repetir o mesmo aviso a cada 5 min: um problema de madrugada viraria 100
# e-mails e a pessoa acordaria com a caixa entupida em vez de informada.
ESPERA_AVISO=$((60 * 60))
CARIMBO=/var/lib/fotonio-vigia-ultimo-aviso

registrar() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

avisar() {
  local assunto="$1" texto="$2"
  local agora ultimo
  agora=$(date +%s)
  ultimo=$(cat "$CARIMBO" 2>/dev/null || echo 0)
  if [ $((agora - ultimo)) -lt "$ESPERA_AVISO" ]; then
    registrar "  (aviso silenciado — ja avisei ha menos de 1h)"
    return 0
  fi
  echo "$agora" > "$CARIMBO"

  [ -f "$SEGREDOS" ] || { registrar "  (sem arquivo de segredos — nao consegui avisar)"; return 0; }
  local chave dest
  chave=$(sed -n 's/^RESEND_API_KEY=//p' "$SEGREDOS" | tail -1)
  dest=$(sed -n 's/^ALERTA_EMAIL_DESTINO=//p' "$SEGREDOS" | tail -1)
  [ -n "$chave" ] && [ -n "$dest" ] || { registrar "  (chave/destino ausentes)"; return 0; }

  curl -s --max-time 30 -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $chave" -H "Content-Type: application/json" \
    -d "{\"from\":\"Vigia do Fotonio <contato@atomatiza.com.br>\",\"to\":[\"$dest\"],\"subject\":\"$assunto\",\"text\":\"$texto\"}" \
    >/dev/null && registrar "  (aviso enviado para $dest)"
}

CORPO=$(curl -s --max-time 20 "$URL" 2>/dev/null || true)
CODIGO=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$URL" 2>/dev/null || echo "000")

case "$CODIGO" in
  200)
    exit 0
    ;;
  000)
    # Nem respondeu: o processo provavelmente morreu ou travou. Aqui reiniciar
    # e a acao certa.
    registrar "sem resposta ($CODIGO) -> reiniciando $SERVICO"
    systemctl restart "$SERVICO"
    sleep 12
    DEPOIS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$URL" 2>/dev/null || echo "000")
    registrar "  apos reiniciar: $DEPOIS"
    if [ "$DEPOIS" != "200" ]; then
      avisar "Fotonio fora do ar" \
        "O site nao respondeu, foi reiniciado automaticamente e CONTINUA fora (codigo $DEPOIS).\n\nConferir: systemctl status fotonio; journalctl -u fotonio -n 80; tail -40 $LOG"
    fi
    ;;
  *)
    # Respondeu, mas alguma dependencia esta em falso. Reiniciar nao resolveria.
    registrar "healthz=$CODIGO corpo=$CORPO (dependencia fora — nao reinicio)"
    QUEM=""
    echo "$CORPO" | grep -q '"banco":false' && QUEM="banco de dados"
    echo "$CORPO" | grep -q '"armazenamento":false' && QUEM="${QUEM:+$QUEM e }armazenamento (R2)"
    avisar "Fotonio: ${QUEM:-dependencia} fora do ar" \
      "O app esta de pe, mas o healthz acusou falha em: ${QUEM:-desconhecida}.\n\nResposta: $CORPO\n\nReiniciar o servico NAO resolve isso. Conferir o Postgres (systemctl status postgresql) e as credenciais do R2 em /opt/fotonio/.env.production."
    ;;
esac
