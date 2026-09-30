#!/usr/bin/env bash
# Instala (ou atualiza) o servidor de ZIP numa máquina Debian/Ubuntu limpa.
#
# O repositório é PRIVADO, então a máquina precisa de uma chave de leitura antes
# de qualquer coisa (deploy key no GitHub — ver docs/servidor-zip.md):
#
#   ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519 -C zip-hetzner
#   cat /root/.ssh/id_ed25519.pub     → colar em Settings → Deploy keys (só leitura)
#
# Depois, como root:
#
#   ssh-keyscan github.com >> /root/.ssh/known_hosts
#   git clone --depth 1 git@github.com:Felipebonamigo/GaleriaAtomo.git /opt/fotonio-zip
#   bash /opt/fotonio-zip/ops/instalar-servidor-zip.sh
#
# Rodar o script de novo atualiza o código e reinicia o serviço.
#
# O que faz, na ordem:
#   1. Node 22+ oficial, com suporte a TypeScript (o do Ubuntu vem sem)
#   2. usuário de sistema `fotonio-zip`, sem shell, dono só do cache
#   3. o código em /opt/fotonio-zip (clone raso do master; rodar de novo atualiza)
#   4. /etc/fotonio-zip.env — pergunta o que falta, nunca sobrescreve o que existe
#   5. a unidade systemd, ligada e no ar
#   6. Caddy com TLS automático na frente, se houver um domínio
#   7. a rede para download longe e grande (BBR, buffers, sem HTTP/3) —
#      ver ops/ajustar-rede-zip.sh
#
# Rodar de novo é seguro: cada passo confere antes de fazer.
set -euo pipefail

REPO="git@github.com:Felipebonamigo/GaleriaAtomo.git"
DESTINO=/opt/fotonio-zip
ENV=/etc/fotonio-zip.env
CACHE=/var/lib/fotonio-zip

if [[ $EUID -ne 0 ]]; then
  echo "rode como root (sudo)"; exit 1
fi

echo "── 1. Node ──────────────────────────────────────────────────────────"
# O servidor roda TypeScript direto (--experimental-strip-types), e isso exige
# um Node compilado COM o suporte a TypeScript. O pacote `nodejs` do Ubuntu
# (26.04, conferido em 23/09/2026) vem sem ele — sobe e morre com
# ERR_NO_TYPESCRIPT. Por isso o binário oficial do nodejs.org, em /usr/local,
# que é o mesmo em qualquer distribuição.
node_serve() {
  command -v node >/dev/null &&
    [[ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -ge 22 ]] &&
    [[ "$(node -p 'process.features.typescript ? 1 : 0')" == "1" ]]
}
if ! node_serve; then
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates git xz-utils >/dev/null
  apt-get remove -y -qq nodejs >/dev/null 2>&1 || true
  ARQUIVO=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -o 'node-v22[0-9.]*-linux-x64.tar.xz' | head -1)
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$ARQUIVO" | tar -xJ -C /usr/local --strip-components=1
  ln -sf /usr/local/bin/node /usr/bin/node
fi
if ! node_serve; then
  echo "   node $(node --version 2>/dev/null || echo ausente) — precisa de 22+ com suporte a TypeScript"; exit 1
fi
echo "   node $(node --version), com TypeScript"

echo "── 2. usuário ───────────────────────────────────────────────────────"
id fotonio-zip >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin fotonio-zip
mkdir -p "$CACHE"
chown fotonio-zip:fotonio-zip "$CACHE"
chmod 750 "$CACHE"

echo "── 3. código ────────────────────────────────────────────────────────"
command -v git >/dev/null || apt-get install -y -qq git >/dev/null
# O clone é por SSH, com a deploy key da máquina (ver o cabeçalho).
mkdir -p /root/.ssh && chmod 700 /root/.ssh
grep -q "github.com" /root/.ssh/known_hosts 2>/dev/null || ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null
if [[ -d "$DESTINO/.git" ]]; then
  git -C "$DESTINO" fetch --depth 1 origin master -q
  git -C "$DESTINO" reset --hard origin/master -q
else
  git clone --depth 1 --branch master "$REPO" "$DESTINO" -q
fi
# O servidor importa só três arquivos de src/lib e não tem dependência de npm:
# não há `npm ci` aqui, e é de propósito — nada para instalar, nada para vazar.
chown -R root:root "$DESTINO"
echo "   $(git -C "$DESTINO" log -1 --format='%h %s')"

echo "── 4. ambiente ──────────────────────────────────────────────────────"
if [[ ! -f "$ENV" ]]; then
  read -rp "   URL do app (ex.: https://galeriaatomo.com.br): " APP_URL
  read -rp "   ZIP_SEGREDO (o mesmo do .env.production do app; vazio = gerar um novo): " SEGREDO
  if [[ -z "$SEGREDO" ]]; then
    SEGREDO=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    echo "   gerado. COPIE para o app: ZIP_SEGREDO=$SEGREDO"
  fi
  cat > "$ENV" <<EOF
ZIP_APP_URL=$APP_URL
ZIP_SEGREDO=$SEGREDO
ZIP_PORTA=3400
ZIP_CACHE_DIR=$CACHE
ZIP_CACHE_DIAS=14
ZIP_CACHE_MAX_GB=150
ZIP_BUSCAS_PARALELAS=8
EOF
  chmod 600 "$ENV"
  echo "   escrito em $ENV"
else
  echo "   $ENV já existe — mantido"
fi

echo "── 5. systemd ───────────────────────────────────────────────────────"
cp "$DESTINO/ops/fotonio-zip.service" /etc/systemd/system/fotonio-zip.service
# A unidade roda com ProtectSystem=strict: só escreve onde ReadWritePaths
# permite. Se o cache foi movido para um volume (ZIP_CACHE_DIR fora de
# /var/lib/fotonio-zip), a permissão vai num drop-in gerado a partir do .env —
# num arquivo à parte, que a cópia da unidade acima não apaga. Sem isto o
# servidor sobe, mas toda montagem morre com EROFS (23/09/2026).
CACHE_DIR=$(grep -E '^ZIP_CACHE_DIR=' "$ENV" | cut -d= -f2-)
mkdir -p "${CACHE_DIR:-$CACHE}"
# O teto do cache segue o DISCO onde ele está: 85% do tamanho, para o volume
# nunca encostar em cheio. Um teto escrito à mão maior que o disco (os 150 GB
# padrão num volume de 100 GB) nunca seria atingido antes de o disco lotar.
DISCO_GB=$(df --output=size -BG "${CACHE_DIR:-$CACHE}" | tail -1 | tr -dc '0-9')
if [[ -n "$DISCO_GB" && "$DISCO_GB" -gt 0 ]]; then
  TETO_GB=$(( DISCO_GB * 85 / 100 ))
  sed -i "s|^ZIP_CACHE_MAX_GB=.*|ZIP_CACHE_MAX_GB=$TETO_GB|" "$ENV"
  echo "   cache em ${CACHE_DIR:-$CACHE} (${DISCO_GB} GB no disco, teto ${TETO_GB} GB)"
fi
mkdir -p /etc/systemd/system/fotonio-zip.service.d
printf '[Service]\nReadWritePaths=%s\n' "${CACHE_DIR:-$CACHE}" > /etc/systemd/system/fotonio-zip.service.d/cache.conf
mkdir -p "${CACHE_DIR:-$CACHE}" && chown fotonio-zip:fotonio-zip "${CACHE_DIR:-$CACHE}"
systemctl daemon-reload
systemctl enable fotonio-zip -q
systemctl restart fotonio-zip
sleep 2
if curl -fsS http://127.0.0.1:3400/saude >/dev/null; then
  echo "   no ar: $(curl -fsS http://127.0.0.1:3400/saude)"
else
  echo "   NÃO SUBIU — veja: journalctl -u fotonio-zip -n 50"; exit 1
fi

echo "── 6. Caddy (TLS) ───────────────────────────────────────────────────"
read -rp "   domínio deste servidor (ex.: zip.galeriaatomo.com.br; vazio = pular): " DOMINIO
if [[ -n "$DOMINIO" ]]; then
  if ! command -v caddy >/dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  if ! grep -q "$DOMINIO" /etc/caddy/Caddyfile 2>/dev/null; then
    cat >> /etc/caddy/Caddyfile <<EOF

$DOMINIO {
	reverse_proxy 127.0.0.1:3400 {
		# Um download de 20 GB leva horas: nenhum tempo limite no meio.
		transport http {
			response_header_timeout 0
		}
	}
	log {
		output file /var/log/caddy/fotonio-zip.log
		format json
	}
}
EOF
    systemctl reload caddy || systemctl restart caddy
  fi
  echo "   https://$DOMINIO → 127.0.0.1:3400 (o DNS precisa apontar para cá, nuvem cinza)"
fi

echo "── 7. Rede para download longe ──────────────────────────────────────"
bash "$DESTINO/ops/ajustar-rede-zip.sh"

echo
echo "Pronto. No app, defina:"
echo "   ZIP_SERVIDOR_URL=https://${DOMINIO:-<domínio-deste-servidor>}"
echo "   ZIP_SEGREDO=<o mesmo de $ENV>"
echo "e reinicie o app. A partir daí todo ZIP sai por aqui. Ver docs/servidor-zip.md."
