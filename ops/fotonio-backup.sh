#!/usr/bin/env bash
# Backup diario do banco do Fotonio.
#
# POR QUE A COPIA DE FORA E OBRIGATORIA: diferente do Atomatiza (cujo banco mora
# no Supabase), o Postgres do Fotonio roda NESTE MESMO VPS. Um dump guardado so
# aqui e o para-quedas dentro do aviao: se o disco morrer, morrem os dois juntos.
# Por isso a copia no Backblaze B2 e FATAL quando falha — sem ela, nao ha backup,
# so a sensacao de ter um.
#
# O QUE ENTRA: o banco `fotonio` inteiro (5 tabelas). E pequeno — dezenas de KB
# comprimido — entao nao ha motivo para escolher partes.
#
# O QUE **NAO** ENTRA: as FOTOS. Elas moram no Cloudflare R2 e sao copia unica.
# Isso e um risco conhecido e ainda aberto — ver docs/backup.md.
#
# Roda pelo systemd (fotonio-backup.timer). Para rodar na mao:
#   /opt/fotonio-backup.sh

set -uo pipefail

# pg_dump 14, igual ao servidor (14.23). Usar o 17 funcionaria para DUMPAR, mas
# o dump poderia sair com sintaxe que o 14 nao restaura — e o dia da restauracao
# e o pior dia para descobrir isso.
PG_DUMP=/usr/lib/postgresql/14/bin/pg_dump
BANCO=fotonio
DESTINO=/opt/fotonio-backups
RCLONE=/usr/local/bin/rclone
COFRE=cofre-b2:fotonio/banco   # remote "crypt" — sobe criptografado
DIARIOS=7
SEMANAIS=4
# Chave do Resend para avisar quando falha. Reaproveita a do Atomatiza (mesmo
# dono, mesmo servidor) em vez de duplicar um segredo em dois lugares.
SEGREDOS=/opt/atomatiza-secrets.env

avisar() {
  local assunto="$1"
  [ -f "$SEGREDOS" ] || return 0
  local chave dest
  chave=$(sed -n 's/^RESEND_API_KEY=//p' "$SEGREDOS" | tail -1)
  dest=$(sed -n 's/^ALERTA_EMAIL_DESTINO=//p' "$SEGREDOS" | tail -1)
  [ -n "$chave" ] && [ -n "$dest" ] || return 0
  curl -s --max-time 30 -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $chave" -H "Content-Type: application/json" \
    -d "{\"from\":\"Vigia do Fotonio <contato@atomatiza.com.br>\",\"to\":[\"$dest\"],\"subject\":\"$assunto\",\"text\":\"$assunto\n\nO backup do banco do Fotonio nao completou. Enquanto isso, o banco esta sem copia do dia.\n\nConferir com: systemctl status fotonio-backup; journalctl -u fotonio-backup -n 50\"}" >/dev/null || true
}

falhou() {
  echo "BACKUP FALHOU: $*" >&2
  avisar "Backup do Fotonio falhou"
  exit 1
}

mkdir -p "$DESTINO"
HOJE=$(date +%Y-%m-%d)
ARQ="$DESTINO/fotonio-$HOJE.sql.gz"
TMP="$ARQ.parcial"
ERRO=/tmp/fotonio-backup.err

# --no-owner / --no-privileges: na restauracao os papeis podem ter outro nome,
# e dono/grant do original so atrapalhariam.
sudo -u postgres "$PG_DUMP" "$BANCO" \
  --no-owner --no-privileges --quote-all-identifiers \
  2>"$ERRO" | gzip -9 > "$TMP"

ESTADO=("${PIPESTATUS[@]}")
[ "${ESTADO[0]}" -eq 0 ] || falhou "pg_dump saiu com ${ESTADO[0]} — $(tail -3 "$ERRO" | tr '\n' ' ')"

# Um dump que "deu certo" mas veio vazio e PIOR que backup nenhum: da a sensacao
# de estar protegido. Conferir o conteudo, nao so o codigo de saida.
TAM=$(stat -c%s "$TMP")
[ "$TAM" -gt 500 ] || falhou "dump com apenas $TAM bytes — vazio ou truncado"

# grep -c, nao grep -q: o -q fecha o cano no primeiro acerto, o zcat morre com
# SIGPIPE e isso reprovaria um backup CORRETO. Licao herdada do Atomatiza.
TABELAS=$(zcat "$TMP" | grep -c "^CREATE TABLE" || true)
[ "${TABELAS:-0}" -ge 5 ] || falhou "dump com ${TABELAS:-0} tabela(s) — esperado 5 (tenants, galerias, medias, secoes, acessos)"

# Conferir NOMINALMENTE as tabelas que sustentam o negocio. Contagem sozinha
# passaria num dump de outro banco qualquer com 5 tabelas.
zcat "$TMP" > /tmp/fotonio-conferir.sql
for t in tenants galerias medias; do
  grep -q "\"$t\"" /tmp/fotonio-conferir.sql || {
    rm -f /tmp/fotonio-conferir.sql
    falhou "dump nao contem a tabela $t"
  }
done
rm -f /tmp/fotonio-conferir.sql

mv "$TMP" "$ARQ"
echo "[$(date -Is)] dump ok: $ARQ ($(numfmt --to=iec "$TAM"))"

# --- copia FORA do servidor (a que realmente protege) ------------------------
$RCLONE copy "$DESTINO" "$COFRE" \
  --include "fotonio-*.sql.gz" \
  --transfers 4 --retries 3 2>&1 \
  || falhou "rclone nao conseguiu subir para o B2 — o banco esta sem copia fora do servidor"

# Confiar no codigo de saida do rclone nao basta: conferir que o arquivo do dia
# esta MESMO la, com tamanho compativel.
REMOTO=$($RCLONE size "$COFRE" --json 2>/dev/null | grep -o '"count":[0-9]*' | cut -d: -f2)
[ "${REMOTO:-0}" -ge 1 ] || falhou "o B2 aceitou o envio mas nao ha nenhum arquivo la"
echo "  copia fora do servidor: $COFRE ($REMOTO arquivo(s))"

# Domingo vira copia semanal, com rotacao propria e mais longa.
if [ "$(date +%u)" -eq 7 ]; then
  cp "$ARQ" "$DESTINO/semanal-$HOJE.sql.gz"
fi

# Rotacao local. O historico longo fica no B2, que tem espaco e nao morre com o VPS.
ls -1t "$DESTINO"/fotonio-*.sql.gz 2>/dev/null | tail -n +$((DIARIOS + 1)) | xargs -r rm -f
ls -1t "$DESTINO"/semanal-*.sql.gz 2>/dev/null | tail -n +$((SEMANAIS + 1)) | xargs -r rm -f

echo "  local: $(ls -1 "$DESTINO"/*.sql.gz 2>/dev/null | wc -l) arquivo(s), $(du -sh "$DESTINO" | cut -f1)"
