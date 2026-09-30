#!/usr/bin/env bash
# Ajusta a rede do servidor de ZIP para download LONGE e GRANDE.
#
# ── POR QUE (30/09/2026) ────────────────────────────────────────────────────
#
# Uma fotógrafa testou uma galeria de 527 MB e viu 270–470 KB/s, com a
# internet dela normal. O Felipe: "abaixo de 400 KB/s é muito baixo". Nenhum
# limite nosso explica isso — o servidor não tem freio (docs/servidor-zip.md).
# O que explica é a distância com a configuração de fábrica do Linux:
#
#   1. O Caddy entrega por HTTP/3 (QUIC, sobre UDP) sempre que o navegador
#      aceita — e o Chrome aceita. O quic-go precisa de buffer de UDP de ~7 MB;
#      o Linux dá ~200 KB. A ~250 ms de ida e volta (Europa ↔ sul do Brasil),
#      200 KB por volta são uns 800 KB/s de TETO, e perda de pacote no caminho
#      derruba para metade disso. É o número que ela viu.
#   2. Em TCP, o controle de congestionamento padrão (cubic) desaba com pouca
#      perda num caminho longo. O BBR não: ele mede a banda em vez de recuar
#      a cada pacote perdido. É o que o Google usa para servir vídeo longe.
#
# O que este script faz, e por que cada coisa:
#
#   - BBR + fila `fq` (o BBR precisa dela para espaçar os pacotes);
#   - buffers de TCP de até 64 MB — a janela que cabe 250 ms a ~2 Gbit/s;
#   - buffers de UDP de 8 MB, o que o quic-go pede, para o caso de o HTTP/3
#     voltar a ser ligado;
#   - HTTP/3 DESLIGADO no Caddy desta máquina: o QUIC tem controle de
#     congestionamento próprio, fora do kernel, e o BBR não chega nele. Para
#     um arquivo de horas numa conexão só, TCP com BBR é o caminho previsível.
#
# Rodar de novo é seguro: cada passo confere antes de fazer. Nada disto mexe
# no código do servidor nem nos ZIPs guardados; os downloads em andamento
# continuam (o Caddy recarrega sem derrubar conexão).
#
# Uso, como root, na máquina do ZIP:
#   bash /opt/fotonio-zip/ops/ajustar-rede-zip.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "rode como root (sudo)"; exit 1
fi

echo "── rede: BBR e buffers ──────────────────────────────────────────────"
modprobe tcp_bbr 2>/dev/null || true
if ! grep -qw bbr /proc/sys/net/ipv4/tcp_available_congestion_control; then
  echo "   este kernel não tem BBR — ficam só os buffers"
  CONTROLE=""
else
  CONTROLE="net.ipv4.tcp_congestion_control = bbr"
fi
cat > /etc/sysctl.d/90-fotonio-zip.conf <<EOF
# Servidor de ZIP: download longe e grande. Ver ops/ajustar-rede-zip.sh.
net.core.default_qdisc = fq
${CONTROLE}
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.ipv4.tcp_rmem = 4096 131072 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
net.ipv4.tcp_notsent_lowat = 131072
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_mtu_probing = 1
EOF
echo "tcp_bbr" > /etc/modules-load.d/fotonio-zip.conf
sysctl -q --system
echo "   controle: $(cat /proc/sys/net/ipv4/tcp_congestion_control) · fila: $(cat /proc/sys/net/core/default_qdisc)"

echo "── Caddy: só HTTP/1.1 e HTTP/2 ──────────────────────────────────────"
CADDY=/etc/caddy/Caddyfile
if [[ ! -f "$CADDY" ]]; then
  echo "   sem Caddyfile — pulado"
elif grep -q "protocols h1 h2" "$CADDY"; then
  echo "   já estava"
else
  cp "$CADDY" "$CADDY.antes-da-rede"
  # As opções globais do Caddy são o PRIMEIRO bloco do arquivo, e só pode
  # haver um. Se ele já existe, a linha entra dentro dele; se não, nasce.
  if awk 'NF && $1 !~ /^#/ { print; exit }' "$CADDY" | grep -q '^{'; then
    awk 'BEGIN{feito=0} { print } !feito && /^\{/ { print "\tservers {\n\t\tprotocols h1 h2\n\t}"; feito=1 }' \
      "$CADDY" > "$CADDY.novo"
  else
    { printf '{\n\tservers {\n\t\tprotocols h1 h2\n\t}\n}\n\n'; cat "$CADDY"; } > "$CADDY.novo"
  fi
  if caddy validate --config "$CADDY.novo" --adapter caddyfile >/dev/null 2>&1; then
    mv "$CADDY.novo" "$CADDY"
    systemctl reload caddy || systemctl restart caddy
    echo "   HTTP/3 desligado (cópia do anterior em $CADDY.antes-da-rede)"
  else
    rm -f "$CADDY.novo"
    echo "   o Caddyfile novo não validou — mantido o anterior, nada mudou"
  fi
fi

echo
echo "Pronto. Para conferir de um computador no Brasil, baixe a mesma galeria"
echo "duas vezes: a segunda sai do disco e mostra a velocidade da entrega."
