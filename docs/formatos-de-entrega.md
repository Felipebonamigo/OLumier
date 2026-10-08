# Formatos de entrega — Galeria, Pastas e Stream

*30/09/2026. Pedido: "hoje temos a entrega em formato de galeria. Estamos
pensando em adicionar a forma de entregar em Pastas (com capa na pasta e os
arquivos dentro) e uma outra forma de Stream (estilo Netflix), que vai passando
os episódios — mais para vídeos, pois hoje nossa entrega de vídeos ainda é meio
feia/pobre."*

## Quem vê

### Hoje: todas as contas (07/10/2026)

"Libere as pastas e stream para todos." A chave `FORMATOS_ABERTOS_A_TODOS`
(`src/config/formatos-liberados.ts`) está ligada: toda conta vê o grupo Formato
no Design, a escolha na criação da galeria e o "capa da pasta", e a galeria
pública desenha o formato gravado. Nenhuma migração — a 054 e o carimbo
`formatos_liberados_em` continuam no banco.

- **No Admin**, o bloco "Pastas e Stream" da ficha diz "Aberto a todas as
  contas" e o botão sai (com a chave ligada ele não mudaria nada para ninguém).
- **Fechar de novo** é trocar a chave por `false`: volta a regra de baixo, e as
  contas que tinham o carimbo (inclusive as que a 054 liberou) seguem vendo.
- **Abrir o painel não abre a comunicação.** Entrega real para um cliente em
  Pastas ou Stream segue **não validada** (tabela abaixo), então home e vendas
  continuam sem falar dos formatos — §6 da estratégia de marca.

### A regra por conta (30/09/2026, guardada)

"Isso só ficará visível para sócios primeiramente (eu, Carol, Sirius)."
Pastas e Stream aparecem só para a conta **liberada** na ficha do estúdio no
Admin (botão "Liberar Pastas e Stream", `tenants.formatos_liberados_em`,
migração 054) e para as contas de **admin** (`ADMINS`), que não precisam
liberar a si mesmas. Regra em `src/config/formatos-liberados.ts`, valendo só
com a chave `FORMATOS_ABERTOS_A_TODOS` em `false`.

Sem liberação: o grupo Formato some do Design, a escolha some da criação, o
"capa da pasta" some da aba Fotos, e a galeria pública desenha a galeria de
sempre mesmo que a aparência gravada diga outra coisa (o servidor decide —
`aparenciaPermitida`). A migração 054 já nasce liberando quem usou pastas ou
stream no intervalo em que estiveram abertos, para nenhuma entrega mudar
sozinha. Preso em `scripts/testar-formatos-liberados.mjs`, que vale nos dois estados da
chave (a regra por conta é conferida com ela fechada à força).

## Estado

| | Situação |
|---|---|
| Código das três telas, escolha no painel, capa da pasta, duração do vídeo | **existe** (branch `claude/relaxed-dirac-opy782`) |
| Conferido no navegador com fotos e vídeos de teste, computador e celular | **feito** na bancada local |
| Aberto a todas as contas do painel | **sim, desde 07/10/2026** (pedido do Felipe) |
| Entrega real para um cliente em Pastas ou Stream | **não validado** |
| Comunicação pública (home, vendas) | **não fazer ainda** — §6 da estratégia: vídeo e filmmaker só entram na comunicação depois de testados com entrega real |

## O que o fotógrafo escolhe

Aba **Design → Formato**, três cartões com o esquema da tela:

- **Galeria** — o de sempre, e o padrão. Nenhuma galeria existente muda.
- **Pastas** — a galeria abre com os capítulos como pastas; as fotos ficam dentro.
- **Stream** — os vídeos numa tela de cinema, em fileiras, com próximo episódio.

Também na **criação da galeria** (etapa 2. Estilo, acima dos estilos), com os
mesmos cartões — pedido do Felipe em 30/09/2026: o formato é decisão que o
fotógrafo já traz ao criar. A tela abre no formato do padrão do estúdio; o
escolhido ali vence o do padrão (`aparenciaComFormato`). Escolhendo Pastas, a
etapa de capítulos avisa enquanto houver menos de dois.

O formato é um eixo da aparência (`formato` em `config/aparencia.ts`), então
herda rascunho, prévia, publicar e o padrão do estúdio. **Estilo não mexe no
formato**: aplicar "Revista" numa entrega em Stream troca a cara e mantém o
Stream (`comFormatoDe`). Um filmmaker que salva o Stream no padrão do estúdio
tem toda galeria nova nascendo em Stream.

## Quando o formato não tem com o que trabalhar

A regra mora em `lib/formato-da-entrega.ts` e está presa em
`scripts/testar-formato-da-entrega.mjs`:

- Pastas com **menos de dois grupos** (capítulos com arquivo, mais as soltas) →
  o cliente vê a galeria de sempre. Uma pasta sozinha é um clique a mais.
- Stream **sem vídeo** → galeria de sempre.
- O editor avisa nos dois casos, mas não impede: o formato costuma ser escolhido
  antes de subir o casamento, e passa a valer sozinho quando o conteúdo chega.
- Sempre abrem a galeria: um capítulo aberto (é entrar na pasta), a busca por
  rosto (`?fotos=`) e o "Ver as fotos" do stream (`?ver=galeria`).

## Estilos de cada formato (30/09/2026)

"Vamos pensar em estilos para pastas e stream" — e, no meio do trabalho: "um
dos formatos pode ser igual Netflix, e outros parecidos com streamings". Cada
formato ganhou desenhos próprios, escolhidos em **Design → Formato**, logo
abaixo dos três cartões (eixos `estiloPastas` e `estiloStream`). Andam com o
formato, não com o estilo: aplicar "Revista" não muda o desenho das pastas.

| Pastas | |
|---|---|
| **Pilha** (padrão) | a capa e cópias atrás, em leque no hover |
| **Capas** | cartaz: foto alta, nome escrito sobre ela (branco sobre véu, em qualquer tema) |
| **Índice** | sumário: número e nome grandes na letra do título, tira de fotos ao lado |
| **Mosaico** | folha de contato: capa e duas fotos, com "+N" do que falta ver |

| Stream | inspiração | |
|---|---|---|
| **Cinema** (padrão) | plataformas de série | sala escura **sempre** (troca o tema claro pela `SALA_ESCURA`), capa em tela cheia à esquerda, botão branco, fileiras com o nome sobre o cartão |
| **Episódios** | página de série | capa dividida, capítulos como temporadas em abas, lista de episódios |
| **Vitrine** | lojas de filme mais limpas | título-manchete, destaque em cartão grande arredondado, grade de cartões largos; segue o tema |
| **Mostra** | sites de festival | programa tipográfico em lista, a imagem aparece à direita no hover (no toque, miniatura na linha) |

Os nomes na tela são nossos e neutros — nenhum cita serviço de streaming: a
entrega é do fotógrafo e não pode anunciar a marca de ninguém.

## Pastas

Cada pasta é uma **pilha de cópias** — a capa na frente e duas fotos do mesmo
capítulo aparecendo atrás, levemente tortas; no hover elas se abrem em leque.
Não é o ícone de pasta do computador de propósito: essa é a cara de nuvem
genérica que a estratégia evita (§12). Cor, canto e letra são os da galeria.

- A capa é a **escolhida no painel** (Design → Formato → Capa de cada pasta,
  ou aba Fotos → hover na foto → "capa da pasta"; migração 052) ou a primeira
  foto do capítulo. Foto movida para outro
  capítulo deixa de valer como capa na pasta antiga.
- Abrir a pasta é a rota de capítulo que já existia (`/…/<galeria>/<capitulo>`):
  menu de baixar, favoritas, visualizador e rolagem infinita são os de sempre.
  O link leva `#conteudo`, que pula a capa; a âncora sai da barra depois
  (`ancora-de-chegada.tsx`), para o link copiado continuar limpo.
- **Download fica dentro das pastas.** O menu de lá já oferece "esta pasta" e
  "a galeria inteira"; a tela das pastas diz isso numa linha.

## Stream

- **Capa de cinema**: a capa da galeria de fundo (ou o pôster do primeiro
  vídeo), logo do estúdio, título na letra da galeria, "Assistir" e "Ver as
  fotos". Os véus são da cor de fundo do tema, então funciona no claro e no creme.
- **Fileiras**: um capítulo com vídeo = uma fileira. Título escrito pelo
  fotógrafo ou, sem ele, tirado do nome do arquivo sem extensão, sublinhado e
  número de ordenação; duração no canto. As fotos viram a última
  fileira, com amostra de 12 e link para todas.
- **Player** em tela cheia: pede o endereço do filme à rota `urls` na hora do
  play (a mesma régua de acesso do visualizador), registra `assistiu`, e ao
  terminar oferece o **próximo episódio** com contagem de 8 s. Esc fecha;
  Shift+N / Shift+P andam entre episódios.
- **Continuar de onde parou**: guardado no `localStorage` do navegador de quem
  assiste — conveniência daquele aparelho, não dado do fotógrafo. Os 10 s
  iniciais e os 20 s finais não contam como "parei aqui".
- **Baixar** no player, se o download estiver liberado, com a mesma porta do
  nome/e-mail da galeria (`/api/g/<id>/eu`).

### Duração do vídeo

`medias.duracao_seg` existia no esquema e nunca era preenchida. Agora o
navegador a lê no envio, do mesmo `<video>` que já abria para tirar o pôster.

- Vídeo enviado **antes** disto fica sem duração no cartão (não mostra "0min").
- Trocar a capa do vídeo escolhendo o **próprio arquivo** (aba Vídeo) preenche
  a duração de um vídeo antigo.
- Quem já assistiu num aparelho passa a ver a duração naquele aparelho.

## O retorno do Juan (30/09/2026)

Depois de ver o Stream no ar: *"Manter a ideia de customização. No STREAM:
poder mudar o título/subtítulo 'Episódios'. Tirar o EP1 minúsculo que fica no
vídeo. Adicionar possibilidade de trocar o nome do arquivo que aparece na
visualização. Adicionar opção de escolher 'scrollar' para baixo também, além
dessa de scrollar para o lado. Corrigir os formatos de CAPA quando o formato de
entrega foi o STREAM. Pro formato PASTAS: adicionar opção de escolher a capa de
cada capítulo."* Referência citada: `finals.vicentefilms.com/lumarino` — **não
consegui abrir** (a rede do ambiente de desenvolvimento bloqueia o endereço);
o que foi feito segue a descrição dele, não a página.

| Pedido | O que mudou | Onde |
|---|---|---|
| Título/subtítulo "Episódios" | **Título dos vídeos** e **subtítulo** no Design → Formato. Valem para o bloco dos vídeos fora de capítulo; vídeo em capítulo usa o nome do capítulo (a tela diz isso quando é o caso). | eixos de texto `nomeDosVideos` (40) e `fraseDosVideos` (120) |
| Tirar o "E1" | Saiu do cartão, do player, do "próximo episódio", do "Continuar" e do "Episódio N" da Vitrine. Ficou o número grande das salas que são lista (Episódios e Mostra), onde ele é desenho. | `galeria-stream.tsx` |
| Nome do vídeo na tela | **Nome de cada vídeo** no Design → Formato, com o pôster ao lado. Grava na hora (não é aparência). Vazio volta ao nome tirado do arquivo. **O download continua com o nome original.** | `medias.titulo`, migração 055 |
| Rolar para baixo | **Os vídeos rolam: para o lado / para baixo.** Na Cinema, cada fileira vira grade; na Episódios, as abas somem e todos os capítulos ficam abertos. Vitrine e Mostra já descem — ali a opção não aparece. | eixo `rolagemStream` |
| Capa no Stream | **Capa do stream: a do estilo / a do grupo Capa.** Com a do grupo Capa, a página desenha a capa escolhida (convite, arco, imersa…) e o stream começa embaixo, com uma barra de "Assistir". Escolher um desenho no grupo Capa com a entrega em Stream já passa para essa opção — clicar em "Convite" e ver o Convite. | eixo `capaStream` |
| Capa de cada pasta | **Capa de cada pasta** no Design → Formato: o cartão de cada capítulo com a capa de hoje; "trocar" abre as fotos dele (60 por vez). O botão da aba Fotos continua existindo. | `lib/entrega-no-design.ts` |

**Player (segundo recado, no mesmo dia):** *"o layout dos vídeos tá bugado,
não aparece os menus de botão e dá o start sozinho. Não consigo diminuir o
volume do áudio também."* Eram os controles nativos num `<video>` do tamanho
da tela: no iPhone o Safari os desenha no pé do elemento, embaixo da barra do
navegador, e os controles nativos do iPhone não têm volume. Agora o player tem
controles próprios — play/pausa, linha do filme, tempo, som, próximo e tela
cheia —, numa tela de `100dvh`; somem 3 s depois de o filme andar e voltam ao
toque ou ao mouse. **Abre parado**, com o play grande no meio; só o próximo
episódio começa sozinho. O slider de volume aparece onde o navegador obedece —
**no iPhone o volume é só o do aparelho** (regra da Apple); lá fica o botão de
mudo. Teclado: espaço/K, setas ±10 s, M, F, Esc, Shift+N/P.

Os eixos novos são **estrutura** (`EIXOS_DA_ESTRUTURA`): andam com o formato,
não com o estilo, e não tiram a galeria do "meu padrão". O padrão de cada um é
o Stream como estava — ninguém que já usa vê mudança sem mexer, exceto o "E1",
que sumiu para todos.

O nome dos vídeos e a capa das pastas gravam fora do rascunho, como o nome de
um capítulo; a prévia recarrega sozinha (entram na assinatura da prévia em
`design/page.tsx`).

## A cena da capa do filme é do fotógrafo (08/10/2026)

Juan, vendo a aba Vídeo com 24 filmes "sem capa": *"existe a opção de a pessoa
selecionar uma cena do próprio vídeo para ser a capa? Ou um 'selecionar cena
aleatória do vídeo'."* Até então o quadro saía sozinho (segundo 1, ou 25% e 50%
quando o primeiro vinha preto).

Aba **Vídeo → Escolher a capa**: escolhido o arquivo do filme (do computador, como
sempre — nada do filme sobe), abre uma janela com o filme, a linha do tempo, **−1 s /
+1 s**, **Cena aleatória** e **Usar esta cena**. O quadro sai do `<video>` por um
canvas, é conferido (o Safari já devolveu quadro transparente sem erro) e sobe pelo
mesmo caminho do JPG que o fotógrafo exporta; a duração do filme vai junto.

- **Cena aleatória** nunca cai nos 5% das pontas (letreiro, tela preta, créditos);
  mostra a cena antes de gravar, e dá para sortear de novo.
- **Quadro automático** continua na janela: é o comportamento de antes, para quem
  não quer escolher.
- **Escolher uma imagem** no lugar do filme segue igual, sem janela — é a saída de
  quem tem um codec que o navegador não abre. Um filme que o navegador não abre mostra
  isso na janela (com o prazo de 15 s) em vez de ficar esperando.
- `src/components/escolher-cena.tsx` (a janela), `src/lib/cena-do-filme.ts` (sorteio e
  limites), preso em `scripts/testar-cena-do-filme.mjs`. Conferido no Chromium com um
  filme de teste: escolher, sortear, ±1 s, Esc, cancelar, filme que não abre, quadro
  automático e imagem direta.

## A lista de capítulos diz o que é foto e o que é vídeo (08/10/2026)

Juan, na aba Fotos: *"tá escrito só 'fotos', poderia descrever o que são fotos e o que
são vídeos"* — um capítulo "Vídeos - Júlia e Gustavo" dizia "ver as 7 fotos". A
contagem do capítulo sempre foi de mídias prontas, e a tela chamava tudo de foto. Agora
`listarSecoes` traz `total_videos` e a lista fala: **229 fotos**, **7 vídeos**, ou
**229 fotos · 3 vídeos** (o link vira "ver as 229 fotos", "ver os 7 vídeos", "ver 229
fotos · 3 vídeos"). O mesmo vale para o grupo das soltas e para as confirmações de
"tirar" e "apagar". A régua das palavras é `src/lib/contagem-de-midias.ts`, presa em
`scripts/testar-contagem-de-midias.mjs`.

## O vídeo que abre e não toca (08/10/2026)

Felipe, na galeria do Mirna e Diogo (GM Creative): *"os vídeos abrem e nem
executam"*, e o Juan antes: *"a galeria que testei o vídeo estava demorando a
carregar"*. Medido nos 32 vídeos, lendo só o cabeçalho de cada um:

| | |
|---|---|
| formato | **HEVC** (`hvc1`) nos 32 — `.MOV` exportado do iPhone, 8 bits, 30 fps |
| peso | **13 a 18 Mbps** em 23; **52 a 54 Mbps** em 9 (um clipe de 1 min = 400 MB) |
| índice (`moov`) | no **fim** do arquivo nos 32 |
| de onde tocava | o original, no B2 (EUA): 100–850 ms por pedido |
| capa | 4 sem capa — o navegador de quem enviou não abriu o HEVC |

HEVC não abre no Firefox nem em boa parte dos Chrome de computador; onde abre,
54 Mbps não passam num 4G. O `<video>` ficava parado no pôster — ou tocava só o
SOM com a tela preta, que foi o que o Chrome fez no teste.

**O conserto tem três partes, e nenhuma custa servidor:**

1. **A versão leve** (`src/lib/versao-leve.ts`, migração 064). Depois que o
   original sobe, o navegador do FOTÓGRAFO converte uma cópia H.264, no máximo
   1080p, ~5 Mbps, quadro-chave a cada 2 s, som AAC copiado, e o índice na
   frente (`src/lib/indice-na-frente.ts`, que move o índice montando o arquivo
   por fatias — não copia o filme). A cópia mora no R2, em
   `medias.chave_reproducao`; a galeria e o Stream tocam ela, o download
   continua sendo o original. Vídeo que já é H.264 até 1080p e até 10 Mbps é
   dispensado (`precisaDeVersaoLeve`). Coluna própria e não `chave_preview`
   porque capa, vitrine, cartão de link e e-mail leem `chave_preview` como
   IMAGEM.
2. **O botão "Preparar para assistir"**, na aba Vídeo, para o que subiu antes:
   lê o original do armazém aos pedaços (`UrlSource`), converte e sobe, um por
   vez — o fotógrafo não precisa ter o arquivo. Vídeo sem capa ganha uma tirada
   da própria cópia (H.264 abre onde o HEVC não abriu).
3. **O player que avisa** (`src/components/aviso-do-video.tsx`), na tela cheia
   da galeria e no Stream: erro de formato ou "som sem imagem" viram *"Este
   vídeo não abre neste navegador"* com o botão de baixar (e o som para); 10 s
   esperando depois do play viram *"O vídeo está demorando para carregar"*.

**O que depende do navegador de quem converte.** A conversão é WebCodecs: precisa
abrir o original e gravar H.264. Safari e Chrome no Mac abrem HEVC; Chrome no
Linux não (testado), e aí a linha do envio diz *"toca o original (este navegador
não abre HEVC — no Safari, ou no Chrome do Mac, ele abre)"*. Conferido no Chrome
155 em 08/10/2026: 25 Mbps → 4,9 Mbps, 1080×1920, 20 s em ~12 s de conversão por
software; envio + conversão de dois vídeos em 16–20 s; a galeria tocou
`_leve.mp4` e o HEVC mostrou o aviso.

**Custo.** A cópia é ~1/3 a 1/10 do original e fica no R2 (R$ 0,1155/GB/mês):
as 32 cópias da galeria do Mirna e Diogo dariam ~0,7 GB, uns R$ 0,08/mês. Cada
play deixa de puxar o original do B2, que cobra saída acima da franquia de 3×.

**A grade.** Na mesma galeria, o Making Of (5 vídeos) saía grande e a Cerimônia
(13) pequena: o capítulo só de vídeo crescia até 6 itens. O teto saiu — capítulo
só de vídeo é grande com 3 ou com 30 (`capitulosDeVideo`,
`scripts/testar-videos-maiores.mjs`).

## O que ficou de fora, e por quê

- **Trailer tocando sozinho no fundo da capa**, como na Netflix: tocar o
  original de fundo no 4G do convidado é o custo que a entrega existe para não
  ter. A versão leve (acima) existe desde 08/10/2026, mas só para os vídeos que
  a ganharam — o trailer de fundo precisaria contar com ela sempre.
- **Pôster em alta para a capa**: o pôster do vídeo tem 640 px. Em monitor
  grande, sem capa de galeria escolhida, o fundo fica macio. A saída hoje é o
  fotógrafo escolher uma capa da galeria.
- **Legenda, qualidade adaptativa (HLS)**: o player toca um arquivo só — a
  versão leve quando existe, o original quando não.
- **HDR do iPhone (Dolby Vision, HEVC 10 bits)** não foi testado: a cópia é
  H.264 de 8 bits, e sem ajuste de tom as cores podem sair lavadas. Os 32 da
  galeria do Mirna e Diogo eram 8 bits, sem HDR.
- **Filme acima de ~2 h** não ganha versão leve: a cópia passaria de 4,5 GB, o
  teto de um envio único ao R2. Precisaria de envio em partes da cópia.

## Arquivos

| | |
|---|---|
| `src/config/aparencia.ts` | eixo `formato`, `comFormatoDe`, `mesmaAparencia` sem formato |
| `src/lib/formato-da-entrega.ts` | que tela abre, títulos, duração, retomada |
| `src/components/galeria-pastas.tsx` | a tela das pastas e o "← Todas as pastas" |
| `src/components/galeria-stream.tsx` | capa de cinema, fileiras, player, porta do nome |
| `src/app/g/[estudio]/[galeria]/page.tsx` | decide a tela antes de assinar a grade |
| `src/components/editor-aparencia.tsx` | grupo Formato |
| `src/components/grade-medias.tsx` | botão e selo "capa da pasta" |
| `db/migracoes/052-capa-da-pasta.sql` | `secoes.capa_media_id` |
| `db/migracoes/055-titulo-do-video.sql` | `medias.titulo` — o nome do vídeo na tela |
| `db/migracoes/064-versao-leve-do-video.sql` | `medias.chave_reproducao` — a cópia para assistir |
| `src/lib/versao-leve.ts`, `src/lib/indice-na-frente.ts` | conversão no navegador, índice na frente |
| `src/app/api/medias/[id]/reproducao/route.ts` | recebe e confere a cópia |
| `src/components/preparar-videos.tsx`, `src/lib/videos-para-preparar.ts` | o botão da aba Vídeo |
| `src/components/aviso-do-video.tsx` | o player que diz que não abriu |
| `scripts/testar-versao-leve.mjs` | régua, índice byte a byte, rota, URL da galeria, apagar |
| `src/lib/entrega-no-design.ts`, `src/components/entrega-no-design.tsx` | nomes dos vídeos e capas das pastas no Design |
