# O servidor de ZIP — a entrega dos arquivos grandes fora do VPS

**Status: construído em 23/09/2026, à espera do servidor na Hetzner.** Enquanto
`ZIP_SERVIDOR_URL` e `ZIP_SEGREDO` não estiverem no ambiente do app, o ZIP
continua sendo montado no VPS como desde 16/09 — nada muda até as duas
variáveis entrarem.

## Por que existe

Três frases do Felipe, no mesmo dia, que juntas só fecham de um jeito:

- "não podemos limitar os downloads: eles pagam pelo armazenamento, não pelo
  download";
- "não podemos limitar o VPS, que tem outros sites, nem deixá-lo lento";
- "ele é baixado muito no início, quando lança a galeria; depois fica semanas,
  talvez meses, parado".

O ZIP era montado dentro da rota do VPS: cada original vinha do B2 e passava
pelo servidor da Hostinger, que atende mais 13 sites e tem 8 TB de banda por
mês (passou disso, cai para 10 Mbps até a virada — todos os sites juntos).
Dez ZIPs de um casamento de 20 GB são 200 GB por essa banda, na semana do
lançamento. Cem convidados baixando tudo seriam 2 TB numa noite.

A saída é uma máquina só para isso, barata, que **monta o ZIP uma vez, guarda
e entrega quantas vezes pedirem**. O B2 lê os originais uma vez por galeria; a
banda dos outros 99 downloads é do servidor de ZIP, que tem 20 TB por mês
incluídos. O VPS volta a fazer só o que fazia com as miniaturas: assinar links
e servir páginas.

## O desenho

```
navegador ──(1) GET /api/g/<id>/zip──▶ app (VPS)
                                        │ travas de sempre (prepararEntrega)
                                        │ grava o PEDIDO com a lista resolvida
          ◀─(2) 302 zip.../z/<id>.<hmac>┘
navegador ──(3) GET /z/<id>.<hmac>────▶ servidor de ZIP (Hetzner)
                                        │ confere a assinatura
                                        │ (4) pede o MANIFESTO ao app
                                        │ (5) monta uma vez → disco, ou serve do disco
          ◀─(6) application/zip ────────┤ com Range: retomável
                                        └ (7) RELATA ao app: montado / servido / abortado
```

**O servidor não tem banco, nem credencial de bucket, nem cookie.** Tudo que
ele sabe de uma galeria vem do manifesto (nomes, tamanhos e URLs assinadas de
6 h); tudo que ele conta de volta vai pelo relato. Perder a máquina perde ZIPs
guardados, que se montam de novo. Trocar de máquina é apontar duas variáveis.

O contrato entre os dois lados mora em `src/lib/zip-remoto.ts` (importado pelo
app e pelo servidor); o lado do app em `src/lib/pedidos-zip.ts` e
`src/app/api/interno/zip/*`; o servidor em `servidor-zip/`.

### Por que o pedido vira linha no banco

O navegador é redirecionado, e do outro lado não há cookie: nem a senha da
galeria nem a identificação de quem escolheu as favoritas atravessam. Então o
app decide TUDO antes do 302 — as travas, a lista de fotos, o nome de cada
arquivo dentro do zip — e grava em `pedidos_zip` (migração 039). O servidor só
lê o resultado pelo id, que vai assinado na URL (HMAC com o segredo
compartilhado) para não ser adivinhável. Pedido vale 12 horas.

### O que é guardado, e por quanto tempo

| Pedido | Guardado? | Por quê |
|---|---|---|
| galeria inteira | sim | a mesma pergunta dá a mesma resposta para todo mundo |
| um capítulo | sim | idem |
| favoritas | não, em fluxo | cada pessoa marca fotos diferentes |
| recorte da busca por rosto | não, em fluxo | idem; até 300 fotos |

A chave do arquivo guardado leva a **versão do conteúdo**: nomes, tamanhos e
`medias.versao` (que sobe a cada republicação pelo Lightroom). Foto nova, foto
apagada ou foto republicada mudam a chave, e o arquivo velho simplesmente não é
mais encontrado. Não há "invalidar o cache" para esquecer.

Um ZIP pronto sem pedido há `ZIP_CACHE_DIAS` (14) é apagado; passando de
`ZIP_CACHE_MAX_GB` (150), o mais antigo sai primeiro. Bate com o padrão de uso:
muito na semana do lançamento, nada depois.

### Montagem única

Trinta cliques no mesmo segundo (o link chegou no grupo da família) viram UMA
montagem. A primeira requisição abre o `.part` e escreve; as outras leem o
mesmo arquivo enquanto ele cresce. Como o tamanho final é conhecido desde o
primeiro byte (`tamanhoDoZip`), o `Content-Length` sai certo para todo mundo, e
ninguém espera a montagem acabar para começar a receber.

### Retomada

Arquivo guardado responde a `Range` com 206. O "Retomar" do navegador, depois
de uma queda, continua de onde parou em vez de recomeçar 20 GB. Em fluxo
(favoritas, recorte) não há Range — são pequenos.

### Tolerância a falha na montagem

Cada original tem três tentativas com espera crescente. Uma URL vencida (6 h se
passaram) renova o manifesto sem gastar tentativa. `ZIP_BUSCAS_PARALELAS` (4)
originais são abertos à frente do que está sendo escrito, porque o B2 está a
150–220 ms daqui e cada foto é um pedido novo.

## Instalar

1. Contratar um Hetzner Cloud pequeno (2 vCPU, 4 GB, 20 TB de tráfego) e um
   volume de ~100 GB, ou o degrau com 80 GB de disco. Debian ou Ubuntu.
2. DNS: `zip.galeriaatomo.com.br` → IP do servidor, **nuvem cinza** (DNS only).
   Com o proxy laranja da Cloudflare na frente, o ZIP cairia exatamente no caso
   restrito dos termos da CDN deles (arquivo grande de origem externa).
3. O repositório é privado: a máquina precisa de uma chave de leitura. Na
   máquina, como root, gerar a chave e cadastrá-la no GitHub em
   Settings → Deploy keys (sem permissão de escrita):

   ```
   ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519 -C zip-hetzner
   cat /root/.ssh/id_ed25519.pub
   ```

4. Ainda como root, clonar e rodar o instalador:

   ```
   ssh-keyscan github.com >> /root/.ssh/known_hosts
   git clone --depth 1 git@github.com:Felipebonamigo/GaleriaAtomo.git /opt/fotonio-zip
   bash /opt/fotonio-zip/ops/instalar-servidor-zip.sh
   ```

   Ele instala o Node, cria o usuário, pergunta a URL do app e o segredo (ou
   gera um), sobe a unidade `fotonio-zip` e configura o Caddy com TLS. Rodar
   de novo atualiza o código.
5. No app (`.env.production` do VPS), acrescentar e reiniciar:

   ```
   ZIP_SERVIDOR_URL=https://zip.galeriaatomo.com.br
   ZIP_SEGREDO=<o mesmo de /etc/fotonio-zip.env>
   ```

   O próximo clique em "baixar" já vai pelo servidor. Sem deploy.
6. Conferir no painel de administração, bloco **Tráfego e custo da entrega**:
   o aviso "servidor de ZIP não configurado" some, e os ZIPs passam a aparecer
   como montados/entregues com origem no servidor.

Atualizar o código depois: rodar o mesmo script de novo (ele faz `git reset
--hard origin/master` e reinicia). O `systemctl restart` espera os downloads
em andamento terminarem (`TimeoutStopSec=6h`).

## Acompanhar

O bloco **Tráfego e custo da entrega** do `/painel/admin` mostra, para o mês
corrente:

- ZIPs montados (o que leu o B2) e entregues (e a fração que saiu do disco);
- download avulso estimado (foto a foto e lotes do celular, que vão direto do
  B2 — estimativa pelo tamanho médio de uma mídia);
- download do B2 contra a franquia de 3× o guardado; tráfego do servidor
  contra os 20 TB; ZIP pelo VPS (deveria ser zero);
- custo do tráfego, custo fixo do servidor e **custo por TB guardado com tudo
  somado** — é o "R$ 50 por TB" acompanhado mês a mês;
- avisos com a ação: reserva em uso, 60%/90% da franquia, excedente cobrado,
  cache que não segura, downloads caindo.

As contas estão em `src/lib/metricas-entrega.ts` (puras, testadas em
`scripts/testar-metricas-entrega.mjs`); os preços e franquias em
`src/config/trafego.ts`, com a data em que foram conferidos.

Os degraus previstos, quando os avisos começarem a aparecer:

| Sinal | Degrau |
|---|---|
| servidor acima de 60–90% dos 20 TB | dedicado Hetzner com tráfego ilimitado (~R$ 300/mês) ou segundo servidor |
| B2 acima da franquia com frequência | originais quentes no R2 (egress grátis) ou Hetzner Object Storage (€ 1/TB) |
| VPS apertando em CPU (páginas, links) | app e banco em servidor próprio — não tem a ver com download |

## O que fica de fora, de propósito

- **Limite de download.** Nenhum. O que protege é o custo marginal quase zero
  do arquivo guardado, não uma trava.
- **CDN na frente do B2.** Os termos da Cloudflare restringem servir arquivos
  grandes de origem externa em planos que não sejam Enterprise; a exceção
  nomeada é a plataforma paga de Workers, e o texto é ambíguo. Vale uma
  pergunta por escrito à Cloudflare: se a resposta for sim, é a opção mais
  barata de todas, e este servidor pode virar um Worker.
- **Vídeo.** O player toca o original do B2; uma versão leve no R2 continua na
  lista, pela velocidade e pelo egress.

## Testes

- `scripts/testar-zip-remoto.mjs` — o contrato (assinatura, chave de cache,
  relato, nomes dentro do zip, Range).
- `scripts/testar-servidor-zip.mjs` — o servidor de verdade num processo
  filho, com app e balde falsos: montagem única com dois cliques simultâneos,
  nova tentativa numa foto que caiu, ZIP julgado por descompactador de verdade,
  terceiro clique sem tocar o balde, Range, HEAD, favoritas em fluxo, download
  abandonado relatado como abortado.
- `scripts/testar-metricas-entrega.mjs` — cada aviso do painel provocado de
  propósito.
