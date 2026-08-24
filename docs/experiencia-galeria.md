# Experiência da galeria — design a partir da referência do Sirius

*17/08/2026 — análise de https://siriusfotografia.pixieset.com/-lu-marino---wedding/ (a galeria
que o Sirius considera o melhor exemplo dele) + requisitos que ele passou ao Felipe.*

> **Leia isto antes: este documento é o PLANO original.** Quase tudo já está no ar, e o
> texto abaixo ainda fala no futuro ("plano:", "caminho:", "pendências:"). Mantive assim de
> propósito — o raciocínio de por que cada coisa foi decidida continua valendo — mas o
> estado real é este:
>
> | Requisito | Onde está |
> |---|---|
> | Velocidade (derivadas no navegador) | ✅ no ar |
> | Aparência (4 capas, 3 temas, 3 tipografias, 4 grades) | ✅ no ar |
> | Capítulos | ✅ no ar |
> | Salvar na galeria do celular | ✅ no ar |
> | Envio em massa e envio em partes | ✅ no ar |
> | Prazo e cofre automático | ✅ no ar |
> | Subdomínio por estúdio | ✅ no ar — **mas não como está descrito na seção 3** |
> | Logo do estúdio na capa | ✅ no ar |
> | Swipe no lightbox | ✅ no ar |
> | Modal de onboarding no primeiro acesso mobile | ❌ não feito |
> | Cofre mover objetos R2 → B2 | ❌ fase 2, ainda pendente |
>
> ⚠️ **Duas correções de fato**, porque seguir o que está escrito daria trabalho à toa:
>
> 1. **Não foi preciso certificado curinga.** A seção 3 diz que o subdomínio exige DNS-01 e
>    um certificado `*.olumier.com.br`. Tentamos, e o binário do Caddy no servidor não tem o
>    módulo de DNS — pior, usar `*.olumier.com.br` como endereço de site derrubou o TLS do
>    `www`. O que funciona é **TLS sob demanda** com um porteiro que só libera subdomínio de
>    estúdio existente. Ver `docs/subdominio-por-estudio.md`.
> 2. **O CORS do bucket já cobre `*.olumier.com.br`** (desde 21/08/2026). Até então a
>    política listava `app.fotonio.com.br` (domínio antigo) — um endereço que nunca existiu — e não cobria o
>    subdomínio dos estúdios, então "salvar na galeria do celular" caía no download comum
>    justamente no endereço que o fotógrafo manda para o cliente. O curinga é honrado de
>    verdade, inclusive para estúdio ainda não cadastrado, e `scripts/testar-cors.mjs`
>    guarda isso dentro do `npm test`.

## 1. O que a galeria de referência faz (dissecada no navegador)

- **Capa estilo "journal"** (`collection-cover--journal--animates`): fundo claro, logo do
  estúdio no topo, data em caps espaçado, título "Lu & Marino" em fonte display própria
  ("MADE Mirage" — serifada de alto contraste), botão "VER GALERIA", com animação de entrada.
- **Tema claro** (fundo branco puro).
- **Seções/capítulos**: Making Of · Cerimônia · Decoração · Recepção · Festa · Última Prova —
  navegação por âncora no topo.
- **Grade masonry de colunas** (`gamma-container regular-grid-spacing`): ~3 colunas de ~300px,
  alturas variadas (retrato/paisagem preservados), espaçamento regular.
- **⚡ O segredo da velocidade**: a grade NÃO carrega os originais — carrega derivadas
  `-large.jpg` de **640px** (~40–80 KB cada). Original só no download.
- **Ação por foto** (download/favorito aparecem no hover — 210 elementos de ação na página).
- **Modal de onboarding** ensinando o convidado a baixar ("Como baixar fotos facilmente").
- Rodapé "Desenvolvido pela PIXIESET" (nosso selo "entregue com Olumier" é o equivalente).

## 2. Sistema de aparência: eixos + presets

**Arquitetura:** `galerias.config` (JSONB) com eixos independentes. Preset = combinação
nomeada dos eixos. Nada de template hard-coded: a página pública renderiza a partir da
config, e o painel edita a config com preview ao vivo. Opção nova = chave nova no JSON,
sem migração.

| Eixo | Opções (v1) |
|---|---|
| **Capa** | `imersa` (foto tela cheia, texto sobreposto) · `jornal` (como a do Sirius: fundo claro, logo, tipografia grande, botão) · `dividida` (foto à esquerda, texto à direita) · `minima` (só tipografia) |
| **Tema** | `noite` (nosso dark atual) · `claro` · `creme` (paleta terrosa, cara da Carol) |
| **Tipografia do título** | `serifada` (Cormorant) · `moderna` (Montserrat) · `manuscrita` (script) |
| **Grade** | `colunas` (masonry, como o Sirius) · `linhas` (fileiras justificadas) · `quadrada` (crop 1:1) · `editorial` (destaques maiores intercalados) |
| **Densidade** | `compacta` · `normal` · `arejada` (espaçamento) + tamanho da miniatura (2–4 colunas no desktop) |
| **Seções** | capítulos ordenados (Making Of, Cerimônia…), cada mídia pertence a uma seção; navegação por âncora |

**Presets de partida** (1 clique, depois ajusta fino):
- **Sirius** — jornal + claro + serifada + colunas (réplica da referência dele)
- **Olumier** — imersa + noite + serifada + editorial (nossa cara)
- **Clássico** — dividida + creme + serifada + linhas
- **Mínima** — minima + claro + moderna + quadrada

UI no painel: aba "Aparência" na galeria → presets em cards com miniatura → ajustes finos
embaixo → preview ao vivo (iframe da própria galeria pública).

## 3. Subdomínio por estúdio (`siriusfotografia.olumier.com.br/lu-marino`)

**Sim, planejado — em duas etapas:**
1. **Hoje** já funciona como `olumier.com.br/g/siriusfotografia/lu-marino` (path-based).
2. **Subdomínio** exige DNS wildcard `*.olumier.com.br` + certificado wildcard (desafio
   DNS-01). O Registro.br não tem API para isso; a Cloudflare tem. Caminho: mover os
   nameservers para a Cloudflare (a zona já foi criada lá) → Caddy com desafio DNS
   emite `*.olumier.com.br` → o app resolve o tenant pelo header Host. O código de
   resolução por Host pode entrar antes; o TLS destrava quando o DNS migrar.

## 4. Velocidade ("extremamente rápido")

O gargalo hoje: a grade carrega os ORIGINAIS (uma foto de 8 MB por miniatura). Plano:

- **Derivadas geradas no navegador durante o upload** (canvas → WebP): `thumb` ~640px
  (~50 KB) e `preview` ~2048px (~400 KB), enviadas direto pro bucket junto com o original.
  Zero custo de servidor — coerente com a arquitetura "arquivo não passa pelo VPS".
- Grade usa `thumb`; lightbox usa `preview` (com prefetch da próxima/anterior);
  download usa o original. É exatamente o modelo do Pixieset (640px na grade).
- Schema: colunas `chave_thumb` e `chave_preview` em `medias` (nulas para vídeo).
- Lazy loading (já temos), `fetchpriority=high` nas primeiras miniaturas, HTTP/2 do Caddy.
- Futuro (escala): servir mídia por subdomínio atrás da Cloudflare para cache de borda.

## 5. Cofre automático com prazo escolhido pelo fotógrafo

- Ao criar/editar a galeria: **"Quanto tempo no ar?"** → 6 meses · 12 meses (padrão) ·
  24 meses · sempre. Texto fixo ao lado, sem letra miúda:
  *"Quando o prazo terminar, a galeria desce para o cofre: o link sai do ar, mas nada é
  apagado. Você reativa em 1 clique quando quiser."*
- Implementação: `expira_em` já existe; um **systemd timer diário** no VPS marca
  `estado = 'arquivada'` ao vencer (fase 2: mover objetos R2 → B2 de verdade).
- Painel mostra badge "arquiva em N dias" (e futuramente avisa por e-mail antes).
- Cliente final que abrir depois vê a página "está no cofre — fale com o estúdio"
  (já implementada).

## 6. Upload em massa ("subir tudo de uma vez")

Já existe fila multi-arquivo com progresso. Evoluções, em ordem:
1. **Selecionar/arrastar a PASTA inteira** (`webkitdirectory` + drag de diretório) —
   ele escolhe a pasta do casamento e deixa rodando.
2. **2–3 envios paralelos** (hoje é 1 por vez) — upload de 800 fotos cai de horas pra fração.
3. **Retry automático** em falha de rede (3 tentativas com espera progressiva) — a fila
   não para no arquivo 412.
4. **Multipart para >5 GB** — destrava filme de casamento em 4K (limite atual do PUT único).
5. Aviso "não feche a aba" + Wake Lock enquanto a fila roda.

## 7. Download indo pra galeria do celular (a dor real do Sirius)

**A verdade técnica primeiro:** nenhum site consegue gravar direto no rolo da câmera —
o navegador não tem essa permissão (iOS manda downloads pro app Arquivos; é a reclamação
dele com o Pixieset, que sofre do mesmo).

**O que dá pra fazer — e vira nosso diferencial:**
- **Web Share API com arquivos**: botão **"Salvar no celular"** busca a foto e abre o
  menu NATIVO de compartilhar → **"Salvar imagem" → vai direto pras Fotos** (iPhone e
  Android). Funciona com VÁRIAS fotos de uma vez → "Salvar 30 imagens".
- Estratégia por plataforma (detectada): celular mostra "Salvar no celular" (share sheet);
  desktop mostra "Baixar" (download normal).
- **Lotes**: seleção/favoritas salvam em lote pelo share sheet. Álbum INTEIRO (700 fotos,
  vários GB) não cabe na memória do share sheet — solução honesta: salvar em lotes de ~30
  com progresso ("salvando 90 de 700…"), ou orientar o download completo no computador.
- Modal de onboarding no primeiro acesso mobile (como o Pixieset faz) explicando o gesto.

## 8. Responsividade

Base já é responsiva (Tailwind, grid fluida). Pendências específicas de mobile:
lightbox com **swipe** (gesto de arrastar entre fotos), áreas de toque ≥44px,
testar cabeçalho da capa em telas estreitas, e o preset mobile do navegador nos testes.

## Ordem de implementação sugerida

1. **Derivadas (velocidade)** — muda a experiência inteira e destrava grades bonitas
2. **Aparência: eixos + presets** (incluindo o preset "Sirius") + seções/capítulos
3. **"Salvar no celular"** (Web Share) + swipe no lightbox
4. **Prazo no ar + arquivamento automático** (timer)
5. **Upload em massa** (pasta, paralelo, retry)
6. **Multipart >5 GB** (filmes)
7. **Subdomínio por estúdio** (depende de DNS na Cloudflare)
