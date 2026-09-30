# Formatos de entrega — Galeria, Pastas e Stream

*30/09/2026. Pedido: "hoje temos a entrega em formato de galeria. Estamos
pensando em adicionar a forma de entregar em Pastas (com capa na pasta e os
arquivos dentro) e uma outra forma de Stream (estilo Netflix), que vai passando
os episódios — mais para vídeos, pois hoje nossa entrega de vídeos ainda é meio
feia/pobre."*

## Estado

| | Situação |
|---|---|
| Código das três telas, escolha no painel, capa da pasta, duração do vídeo | **existe** (branch `claude/relaxed-dirac-opy782`) |
| Conferido no navegador com fotos e vídeos de teste, computador e celular | **feito** na bancada local |
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

- A capa é a **escolhida no painel** (aba Fotos → hover na foto → "capa da
  pasta", migração 052) ou a primeira foto do capítulo. Foto movida para outro
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
- **Fileiras**: um capítulo com vídeo = uma fileira. Episódios numerados na
  galeria inteira (E1, E2…), título tirado do nome do arquivo sem extensão,
  sublinhado e número de ordenação, duração no canto. As fotos viram a última
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

## O que ficou de fora, e por quê

- **Trailer tocando sozinho no fundo da capa**, como na Netflix: o arquivo é o
  original de 4K, às vezes dezenas de GB. Tocar isso de fundo no 4G do convidado
  é o custo que a entrega existe para não ter. Precisaria de uma derivada de
  vídeo leve, que não existe hoje.
- **Pôster em alta para a capa**: o pôster do vídeo tem 640 px. Em monitor
  grande, sem capa de galeria escolhida, o fundo fica macio. A saída hoje é o
  fotógrafo escolher uma capa da galeria.
- **Legenda, qualidade adaptativa (HLS)**: o player toca o arquivo original,
  como o visualizador já fazia.

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
