#!/usr/bin/env bash
# Instala (ou atualiza) o servidor de ZIP numa máquina Debian/Ubuntu limpa.
#
#   curl -fsSL https://raw.githubusercontent.com/Felipebonamigo/GaleriaAtomo/master/ops/instalar-servidor-zip.sh | sudo bash
#
# ou, com o repositório já clonado:  sudo ops/instalar-servidor-zip.sh
#
# O que faz, na ordem:
#   1. Node 22 (o servidor roda TypeScript direto, com --experimental-strip-types)
#   2. usuário de sistema `fotonio-zip`, sem shell, dono só do cache
#   3. o código em /opt/fotonio-zip (clone raso do master; rodar de novo atualiza)
#   4. /etc/fotonio-zip.env — pergunta o que falta, nunca sobrescreve o que existe
#   5. a unidade systemd, ligada e no ar
#   6. Caddy com TLS automático na frente, se houver um domínio
#
# Rodar de novo é seguro: cada passo confere antes de fazer.
set -euo pipefail

REPO="https://github.com/Felipebonamigo/GaleriaAtomo.git"
DESTINO=/opt/fotonio-zip
ENV=/etc/fotonio-zip.env
CACHE=/var/lib/fotonio-zip

if [[ $EUID -ne 0 ]]; then
  echo "rode como root (sudo)"; exit 1
fi

echo "── 1. Node ──────────────────────────────────────────────────────────"
if ! command -v node >/dev/null || [[ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 22 ]]; then
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates git >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "   node $(node --version)"

echo "── 2. usuário ───────────────────────────────────────────────────────"
id fotonio-zip >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin fotonio-zip
mkdir -p "$CACHE"
chown fotonio-zip:fotonio-zip "$CACHE"
chmod 750 "$CACHE"

echo "── 3. código ────────────────────────────────────────────────────────"
command -v git >/dev/null || apt-get install -y -qq git >/dev/null
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
ZIP_BUSCAS_PARALELAS=4
EOF
  chmod 600 "$ENV"
  echo "   escrito em $ENV"
else
  echo "   $ENV já existe — mantido"
fi

echo "── 5. systemd ───────────────────────────────────────────────────────"
cp "$DESTINO/ops/fotonio-zip.service" /etc/systemd/system/fotonio-zip.service
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

echo
echo "Pronto. No app, defina:"
echo "   ZIP_SERVIDOR_URL=https://${DOMINIO:-<domínio-deste-servidor>}"
echo "   ZIP_SEGREDO=<o mesmo de $ENV>"
echo "e reinicie o app. A partir daí todo ZIP sai por aqui. Ver docs/servidor-zip.md."
