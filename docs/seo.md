# SEO — o que está feito, o que falta, e de quem é cada parte

*Escrito em 29/09/2026. As medições "no ar" são do site publicado nessa data,
lidas pelo conector AdvisorPPC (auditoria de página, PageSpeed Insights e
prontidão para buscadores de IA). O que depende do branch
`claude/system-seo-audit-ra3lu2` só vale depois de publicado.*

> **Regra que vale para tudo abaixo.** Texto público novo — página, título de
> venda, narrativa comercial — é decisão da camada estratégica
> (`docs/estrategia-de-marca.md`). E recurso que existe no código não é, só por
> isso, recurso que se anuncia (`src/config/lancamentos.ts`). Por isso a parte
> de conteúdo deste documento é **rascunho para aprovação**, e não página no ar.

## 1. Como está, medido no ar em 29/09/2026

| O quê | No ar | Depois deste branch |
|---|---|---|
| Desempenho no celular (Lighthouse) | 96 · maior pintura 2,3 s · sem deslocamento de layout | — |
| Dados de usuários reais (CrUX) | nenhum: tráfego ainda baixo demais para o Google medir | — |
| `robots.txt` e `sitemap.xml` da casa | existem, 4 URLs | + canônico em cada uma |
| `<link rel="canonical">` | **nenhuma página** | todas as públicas |
| `<h1>` na home | **12** (as galerias de exemplo marcam o nome do casal como título) | 1 |
| Cartão de link de `/seguranca`, `/termos`… | o da home (título e endereço) | o de cada página |
| Vitrine do estúdio (ex.: Caroline Tedesco) | título "… · Galeria Átomo", **`<h1>` sem texto** (só a logo), descrição de 28 caracteres, cartão da plataforma | nome do estúdio, `<h1>` com texto, descrição do próprio estúdio, cartão com a foto dele |
| `robots.txt` / `sitemap.xml` no endereço do estúdio | 404 | próprios do estúdio |
| Dados estruturados | só a FAQ | + site, organização, produto com o preço da home; organização em cada vitrine |
| `/llms.txt` (buscadores de IA) | não existe | existe, gerado de `marca.ts` e `planos.ts` |
| Robôs de IA (GPTBot, ClaudeBot, Perplexity) | liberados | liberados |
| `www.galeriaatomo.com.br` | já redireciona para a raiz | idem (o app redireciona também) |
| **`olumier.com.br` e subdomínios** | **não resolvem DNS** — ver 3.1 | fora do alcance do código |

`scripts/testar-seo.mjs` prende cada linha da coluna da direita.

## 2. O que o branch faz

- **Canônico, título e cartão por página** (`src/lib/metadados.ts`). O layout
  tinha `url: "/"` no Open Graph, e o Next herda o bloco inteiro: toda página
  saía com o endereço da home.
- **Vitrine do estúdio com cara de site dele.** Título sem o nosso nome, cartão
  com a foto do topo (`e/[estudio]/opengraph-image.tsx`), canônico no endereço
  dele (domínio próprio verificado, senão o subdomínio), `robots.txt` e
  `sitemap.xml` próprios, ícone da aba com a logo dele (ou nenhum), `<h1>` com
  o nome em texto e descrição tirada da frase ou do "sobre" que ele escreveu.
- **Galeria e capítulo**: a aba não termina em "· Galeria Átomo", e o link de um
  capítulo desdobra com a foto (antes, sem imagem nenhuma).
- **Home**: um `<h1>` só (prop `ilustracao` de `GaleriaCapa`), dados
  estruturados de site/organização/produto, e toda `<img>` declarando quando
  carrega.
- **`/llms.txt`**: o resumo para buscador de IA, só com o que já é público.
- **`www` → raiz** no próprio app (menos `/api`), como segunda camada do Caddy.
- **Arquivo na raiz do endereço do estúdio** (`/llms.txt`, `/apple-touch-icon.png`,
  `/wp-login.php`…) recebe 404 do proxy, sem passar pela rota de galeria. Antes,
  cada sondagem de robô custava uma renderização com consulta ao banco.

## 3. O que depende de alguém — em ordem

### 3.1 URGENTE, e não é SEO: o `olumier.com.br` não resolve

Em 29/09/2026, `olumier.com.br`, `www.olumier.com.br` e
`caroline-tedesco-fotografia.olumier.com.br` falharam na resolução de nome
("temporary failure"), enquanto `galeriaatomo.com.br` resolvia do mesmo lugar.
Falha *temporária* e não *nome inexistente* é o sintoma típico de **DNSSEC
quebrado** — e a zona tem DS publicado (`ops/caddy-galeriaatomo.md`).

O custo: **todo link de galeria entregue com o endereço antigo está fora do
ar**, que é exatamente o que `config/dominios.ts` existe para evitar.

Conferir, na ordem: o registro.br (o domínio venceu? os servidores DNS ainda são
os da Cloudflare?), o DS publicado lá contra a chave DNSSEC da Cloudflare, e
`dig +dnssec olumier.com.br` de uma máquina qualquer. **Dono: Felipe.**

### 3.2 Publicar este branch

Merge em `master` publica sozinho (`.github/workflows/publicar.yml`). Nada de
SEO desta lista existe no ar antes disso.

### 3.3 Google Search Console e Bing — 20 minutos, uma vez

1. search.google.com/search-console → **Adicionar propriedade → Domínio** →
   `galeriaatomo.com.br`. Ele pede um registro TXT; entra na Cloudflare.
   (Propriedade de *domínio* cobre a raiz, o `www` e todo subdomínio de
   estúdio de uma vez.)
2. **Sitemaps** → enviar `https://galeriaatomo.com.br/sitemap.xml`.
3. **Inspeção de URL** → a home → "Solicitar indexação".
4. bing.com/webmasters → "Importar do Google Search Console" (um clique).

Depois de umas três semanas, o relatório **Desempenho** mostra as buscas reais
que trazem gente — é ele que deve decidir as páginas da seção 4, e não
palpite. Se o Search Console for ligado ao AdvisorPPC, dá para ler esses dados
daqui. **Dono: Felipe.**

### 3.4 Links de quem já é da família

Para um site novo, o que mais pesa no começo é quem aponta para ele. Os
primeiros links são os mais fáceis e os mais legítimos: sites da **Atomatiza**,
do **Movimento Átomo** e da **Sirius Fotografia**, e a bio do Instagram de cada
um. A estratégia de marca pede função própria para cada marca — um link com
texto descritivo ("galerias de entrega para fotógrafos") respeita isso.
**Dono: camada estratégica (Juan) + Felipe.**

### 3.5 Decisões de produto que movem SEO

- **"entregue com Galeria Átomo" como link, na vitrine.** Hoje é texto. Como
  link, cada vitrine de estúdio vira um link para a casa — o jeito clássico de
  uma plataforma ganhar autoridade. Pesa contra o princípio "a marca da tela é a
  do estúdio"; por isso não foi feito. Na galeria não faz diferença (ela é
  `nofollow`).
- **A frase da capa e o "sobre" dos estúdios reais.** A vitrine da Caroline
  está sem frase: o Google recebe "Galerias de fotos de Caroline Tedesco". É o
  fotógrafo preencher em *Site do estúdio*.
- **Depoimentos, quando existirem de verdade.** Só então entram avaliações nos
  dados estruturados (as estrelas no resultado). Antes disso, seria inventar.
- **Ligar `VIDEO_LIBERADO` e `DOMINIO_PROPRIO_LIBERADO`** abre duas páginas de
  conteúdo com demanda própria (4.4 e 4.5). O `/llms.txt` precisa ganhar a
  linha do vídeo no mesmo dia — o teste recusa que ele fale de vídeo antes.

## 4. Conteúdo — rascunhos para aprovação

Hoje o site tem **quatro páginas indexáveis**, e só a home fala do produto. É
pouco para aparecer em qualquer busca que não seja o nome da marca — e o nome
ainda não é buscado. Cada página abaixo responde a uma intenção de busca
diferente, usa só o que a home já promete, e cabe no layout de `/seguranca`
(que já é uma página de conteúdo e prova o formato).

**Nada disto está no ar.** Falta: aprovação do texto pela camada estratégica e,
de preferência, os números de busca (3.3) para escolher a ordem.

### 4.1 Entrega de fotos para o cliente — `/entregar-fotos-para-o-cliente`

- **Para quem busca:** "como entregar fotos para o cliente", "galeria de fotos
  para cliente", "link para entregar fotos".
- **Título:** Como entregar fotos para o cliente, com a sua marca · Galeria Átomo
- **Descrição:** Um link, a galeria no celular do cliente, sem cadastro e sem
  aplicativo. Com a sua marca, no seu endereço, do jeito do seu estúdio.
- **Roteiro:** o problema (nuvem genérica, "não consegui baixar") → suba,
  personalize, entregue (as três etapas da home) → o que o cliente faz sem criar
  conta → o endereço `seuestudio.galeriaatomo.com.br` → planos.
- **De onde vem cada afirmação:** seções 3, 4 e 5 da home.

### 4.2 Seleção de fotos para o álbum — `/selecao-de-fotos`

- **Para quem busca:** "cliente escolher fotos para álbum", "seleção de fotos
  online", "filtro de fotos Lightroom lista do cliente".
- **Título:** Seleção de fotos para o álbum, dentro da galeria · Galeria Átomo
- **Descrição:** O cliente marca as favoritas enquanto navega; você define o
  número combinado, trava a lista e cola os nomes direto no filtro do Lightroom.
- **Roteiro:** marcar com coração → sem limite ou o número combinado, com prazo
  → cada pessoa com a sua lista → escolha encerrada, lista travada, reabrir em
  um clique → copiar os nomes para o Lightroom.
- **De onde vem:** seção 6 da home. Atenção ao C4 de
  `docs/home-leitura-critica.md`: é **copiar os nomes**, não "exportar arquivo".

### 4.3 O que acontece quando a galeria vence — `/cofre`

- **Para quem busca:** "galeria de fotos expirou", "por quanto tempo deixar
  galeria no ar", "arquivar galeria de fotos do cliente".
- **Título:** Galeria que vence não precisa ser apagada · Galeria Átomo
- **Descrição:** No prazo que você escolher, a galeria sai do ar e vai para o
  Cofre, sem apagar nada. Quando o cliente voltar, restaure e continue.
- **Roteiro:** prazos (6 meses, 12 meses, 2 anos ou sem prazo —
  `config/prazos.ts`) → o que o cliente vê depois → restaurar → mesmo espaço do
  plano → **o Cofre não substitui backup** (a frase da home, obrigatória aqui).
- **De onde vem:** seção 8 da home, `/seguranca`, FAQ.

### 4.4 Quando `VIDEO_LIBERADO` ligar — `/video`

- **Para quem busca:** "galeria de vídeo para filmmaker", "entregar vídeo de
  casamento em 4K", "como enviar vídeo grande para cliente".
- O argumento está pronto em `PRODUCT.md` (vídeo pelo preço de foto). Nomear
  concorrente na página é decisão à parte, e jurídica.

### 4.5 Quando `DOMINIO_PROPRIO_LIBERADO` ligar — `/dominio-proprio`

- **Para quem busca:** "galeria de fotos com domínio próprio", "site para
  fotógrafo com domínio".
- O passo a passo está em `docs/dominio-proprio.md`.

## 5. O que ficou de fora de propósito

- **Foto do topo em formato menor.** Ela cobre a tela do celular em pé, então
  uma versão mais estreita sairia borrada. O ganho real viria de um corte
  vertical próprio para celular — decisão de direção de arte.
- **`alt` nas fotos das galerias de exemplo.** A auditoria contou 337 imagens
  e 5 com `alt`. São ilustração (a galeria de exemplo inteira é `aria-hidden`),
  e `alt` vazio é o certo para imagem decorativa; o Google não pune.
- **Blog.** Sem alguém para escrever com regularidade, página abandonada
  pesa mais do que ajuda. As páginas da seção 4 vêm antes.
- **Os pré-carregamentos da home nova.** No build de produção ela pede 10
  imagens logo na abertura, 4 com prioridade alta: a capa de cada galeria de
  exemplo herda o `fetchPriority="high"` da capa de verdade, onde ela é mesmo o
  maior elemento da tela. Com o Lighthouse em 96 não é urgente; se um dia o
  celular piorar, o lugar é a prop `ilustracao` de `GaleriaCapa` (prioridade
  alta só para a galeria da frente do hero). Fica para quem cuida da home.
