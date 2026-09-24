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

# ── O ALVO E O DOMINIO CANONICO, E ELE JA MUDOU DUAS VEZES (17/09/2026) ─────
#
# Ate hoje esta linha apontava para `fotonio.com.br` — a PRIMEIRA marca, de
# antes do Olumier e do Galeria Atomo. Ele nao esta em `DOMINIOS_ATENDIDOS`
# (src/config/dominios.ts), que e a lista que o Caddy consulta antes de emitir
# certificado; o proprio `testar-cors.mjs` ja o chamava de DOMINIO_ANTERIOR.
#
# Um vigia mirando no endereco errado e pior do que vigia nenhum, porque parece
# que tem: ou ele nao alcanca nada e cai no ramo 000, que REINICIA O SERVICO a
# cada 5 minutos para sempre; ou alcanca outra coisa e um Fotonio de verdade
# fora do ar passa batido. Nos dois casos o painel diz "vigiado".
#
# A copia fica aqui (bash nao importa TypeScript), mas PRESA: o
# `scripts/testar-vigia.mjs` exige que este endereco seja o `marca.dominio`. Na
# proxima troca de marca o teste fica vermelho antes de alguem descobrir pelo
# cliente.
URL="${VIGIA_URL:-https://galeriaatomo.com.br/api/healthz}"

# ── POR QUE OS CAMINHOS ACEITAM SER TROCADOS ────────────────────────────────
#
# Os valores de producao sao os padroes e nao mudam. O `${VAR:-padrao}` existe
# para este arquivo poder ser EXERCITADO — pelo mesmo motivo que o
# `portao-origin.sh` e um script separado: um vigia cujos ramos ninguem
# consegue rodar sem derrubar o servidor e um vigia que ninguem nunca testou.
#
# `scripts/testar-vigia.mjs` roda ESTE arquivo com um `curl` de mentira no PATH
# e confere os tres desfechos: aviso que sai, aviso que o Resend recusa (e que
# portanto NAO pode gravar o carimbo de silencio), e segredo ausente.
SERVICO="${VIGIA_SERVICO:-fotonio}"
LOG="${VIGIA_LOG:-/var/log/fotonio-vigia.log}"
SEGREDOS="${VIGIA_SEGREDOS:-/opt/atomatiza-secrets.env}"
# Nao repetir o mesmo aviso a cada 5 min: um problema de madrugada viraria 100
# e-mails e a pessoa acordaria com a caixa entupida em vez de informada.
ESPERA_AVISO=$((60 * 60))
CARIMBO="${VIGIA_CARIMBO:-/var/lib/fotonio-vigia-ultimo-aviso}"

registrar() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# ── "AVISO ENVIADO" PRECISA QUERER DIZER ENVIADO (17/09/2026) ───────────────
#
# Esta funcao terminava em:
#
#     curl -s ... >/dev/null && registrar "  (aviso enviado para $dest)"
#
# `curl -s` sai 0 sempre que a REQUISICAO completa — inclusive quando o Resend
# responde 401, 403 ou 422. Chave vencida, dominio nao verificado, destino
# recusado: o log registrava "aviso enviado" e ninguem foi avisado. Luz verde
# por cima de silencio, no unico lugar cujo trabalho e contar que o resto
# quebrou.
#
# Agora o codigo HTTP e lido e o corpo da recusa vai para o log. E o CARIMBO da
# espera de 1h so e gravado quando o envio DEU CERTO: antes ele era gravado
# antes de tentar, entao uma recusa custava mais uma hora de silencio alem do
# aviso perdido.
avisar() {
  local assunto="$1" texto="$2"
  local agora ultimo
  agora=$(date +%s)
  ultimo=$(cat "$CARIMBO" 2>/dev/null || echo 0)
  if [ $((agora - ultimo)) -lt "$ESPERA_AVISO" ]; then
    registrar "  (aviso silenciado — ja avisei ha menos de 1h)"
    return 0
  fi

  [ -f "$SEGREDOS" ] || { registrar "  (!! SEM AVISO: $SEGREDOS nao existe)"; return 0; }
  local chave dest
  chave=$(sed -n 's/^RESEND_API_KEY=//p' "$SEGREDOS" | tail -1)
  dest=$(sed -n 's/^ALERTA_EMAIL_DESTINO=//p' "$SEGREDOS" | tail -1)
  # Nomeia QUAL falta: "chave/destino ausentes" mandava conferir as duas.
  [ -n "$chave" ] || { registrar "  (!! SEM AVISO: RESEND_API_KEY ausente em $SEGREDOS)"; return 0; }
  [ -n "$dest" ] || { registrar "  (!! SEM AVISO: ALERTA_EMAIL_DESTINO ausente em $SEGREDOS)"; return 0; }

  local corpo http
  corpo=$(mktemp)
  http=$(curl -s -o "$corpo" -w '%{http_code}' --max-time 30 \
    -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $chave" -H "Content-Type: application/json" \
    -d "{\"from\":\"Vigia do Fotonio <contato@atomatiza.com.br>\",\"to\":[\"$dest\"],\"subject\":\"$assunto\",\"text\":\"$texto\"}" \
    2>/dev/null || echo "000")

  case "$http" in
    2*)
      echo "$agora" > "$CARIMBO"
      registrar "  (aviso enviado para $dest)"
      ;;
    *)
      registrar "  (!! O AVISO NAO SAIU — Resend respondeu $http: $(tr -d '\n' < "$corpo" | cut -c1-300))"
      registrar "  (!! ninguem foi avisado. Conferir RESEND_API_KEY e o dominio do remetente.)"
      ;;
  esac
  rm -f "$corpo"
}

# ── O RESUMO SEMANAL DA ENTREGA (24/09/2026) ────────────────────────────────
#
# Felipe: "vou ser avisado quando precisar aumentar o espaço?". Uma vez por
# semana o vigia pergunta ao app se o bloco "Tráfego e custo da entrega" tem
# aviso de erro (disco do servidor de ZIP pequeno, franquia do B2 passando,
# servidor de ZIP perto dos 20 TB) e, se tiver, manda pelo MESMO caminho do
# Resend deste arquivo. Quem calcula é `scripts/avisos-da-entrega.mjs`, com as
# contas do painel; aqui só se decide QUANDO perguntar e se envia.
#
# O carimbo guarda QUANDO perguntar de novo: sete dias depois de uma resposta
# (com ou sem e-mail), uma hora depois de uma falha — banco fora ou Resend
# recusando não podem custar uma semana de silêncio.
#
# Roda antes do healthz, porque o ramo 200 sai do script. Só roda onde o app
# está instalado: em qualquer outra máquina (a bancada de `testar-vigia.mjs`,
# o CI) o diretório não existe e o bloco some.
APP_DIR="${VIGIA_APP_DIR:-/opt/fotonio}"
PROXIMO_RELATORIO="${VIGIA_PROXIMO_RELATORIO:-/var/lib/fotonio-vigia-proximo-relatorio}"
NODE_BIN="${VIGIA_NODE:-/usr/local/bin/node}"
if [ -d "$APP_DIR/scripts" ] && [ -f "$APP_DIR/scripts/avisos-da-entrega.mjs" ]; then
  agora=$(date +%s)
  quando=$(cat "$PROXIMO_RELATORIO" 2>/dev/null || echo 0)
  if [ "$agora" -ge "$quando" ]; then
    saida=$(cd "$APP_DIR" && "$NODE_BIN" --env-file=.env.production \
      --experimental-strip-types --no-warnings --import ./scripts/registrar-ts.mjs \
      scripts/avisos-da-entrega.mjs 2>>"$LOG")
    rc=$?
    case "$rc" in
      3)
        echo $((agora + 7 * 24 * 3600)) > "$PROXIMO_RELATORIO"
        ;;
      0)
        assunto_json=$(printf '%s\n' "$saida" | sed -n 1p)
        texto_json=$(printf '%s\n' "$saida" | sed -n 2p)
        chave=$(sed -n 's/^RESEND_API_KEY=//p' "$SEGREDOS" 2>/dev/null | tail -1)
        dest=$(sed -n 's/^ALERTA_EMAIL_DESTINO=//p' "$SEGREDOS" 2>/dev/null | tail -1)
        if [ -z "$chave" ] || [ -z "$dest" ]; then
          registrar "resumo semanal: !! SEM ENVIO — RESEND_API_KEY ou ALERTA_EMAIL_DESTINO ausente em $SEGREDOS"
          echo $((agora + 3600)) > "$PROXIMO_RELATORIO"
        else
          corpo_resp=$(mktemp)
          http=$(curl -s -o "$corpo_resp" -w '%{http_code}' --max-time 30 \
            -X POST https://api.resend.com/emails \
            -H "Authorization: Bearer $chave" -H "Content-Type: application/json" \
            -d "{\"from\":\"Vigia do Fotonio <contato@atomatiza.com.br>\",\"to\":[\"$dest\"],\"subject\":$assunto_json,\"text\":$texto_json}" \
            2>/dev/null || echo "000")
          case "$http" in
            2*)
              registrar "resumo semanal enviado para $dest"
              echo $((agora + 7 * 24 * 3600)) > "$PROXIMO_RELATORIO"
              ;;
            *)
              registrar "resumo semanal: !! NAO SAIU — Resend respondeu $http: $(tr -d '\n' < "$corpo_resp" | cut -c1-300)"
              echo $((agora + 3600)) > "$PROXIMO_RELATORIO"
              ;;
          esac
          rm -f "$corpo_resp"
        fi
        ;;
      *)
        registrar "resumo semanal: falhou ao calcular (saida $rc) — nova tentativa em 1h"
        echo $((agora + 3600)) > "$PROXIMO_RELATORIO"
        ;;
    esac
  fi
fi

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
