# Nova home — leitura crítica do briefing e estrutura implementada

*26/09/2026. Lado técnico, a partir do [briefing-mestre](briefing-home.md) e da
[estratégia de marca](estrategia-de-marca.md). Cada afirmação sobre o produto
abaixo foi conferida no código desta data.*

## 1. Conflitos técnicos — o briefing pede algo que o produto não sustenta hoje

| # | O briefing | O que o código diz | O que a home faz |
|---|---|---|---|
| C1 | Mostrar `galeria.seuestudio.com.br` "se domínio próprio estiver disponível" (§7, FAQ) | `docs/dominio-proprio.md`: **"CONSTRUÍDO, menos o Caddy"** — o bloco do Caddy e o ensaio com domínio real estão ❌. Sem o Caddy, o domínio do estúdio não recebe certificado. A home antiga já anunciava o recurso. | Mostra só o subdomínio. FAQ responde que o domínio próprio **ainda não está liberado**. Um interruptor (`DOMINIO_PROPRIO_LIBERADO` em `config/lancamentos.ts`) liga a menção quando o Felipe confirmar. |
| C2 | Foto + vídeo só quando validado (§14) | Player, envio multipart e "filme como espaço" **existem**. Não há registro de validação com entrega real. | Seção escondida atrás de `VIDEO_LIBERADO = false`. Nada de "4K", "filme" ou "filmmakers" na página; o montador de planos esconde a escolha Foto/Filme. |
| C3 | Comentários na seleção (§10, "só se disponível") | **Não existem.** | Não aparecem. |
| C4 | "Exportação" da seleção (§10) | Existe como **copiar os nomes dos arquivos para o filtro do Lightroom** — não é arquivo exportado. | Descrito assim, literalmente. |
| C5 | Imagens reais da equipe (§11) | **Não temos nenhuma.** Foto de banco no lugar de "a equipe" seria mentira. | Seção feita de provas concretas (preço em real, Pix, WhatsApp de quem constrói), com o espaço da foto da equipe reservado e comentado no código. |
| C6 | "Redundância", "criptografia" como possíveis claims (§18) | `/seguranca` diz, por escrito: **os originais têm UMA cópia** (Backblaze, 11 noves declarados); **não** há segunda cópia em outra empresa. O que está em dois lugares, criptografado e com trava de 30 dias, é o **cadastro**. | Só entram: links assinados de validade curta, senha por galeria, lixeira de 30 dias, backup diário criptografado do cadastro com restauração ensaiada e trava contra exclusão, vigia a cada 5 minutos — e a frase honesta sobre a cópia única dos originais. |
| C7 | "Quem aparece mais para meu cliente?" (§17, Q3) | A galeria do cliente leva logo, cores e endereço do estúdio, e **um selo discreto "entregue com Galeria Átomo" no rodapé**. | A resposta diz isso, com o selo incluído. Omitir o selo seria a primeira mentira da página. |
| C8 | "Central de ajuda" no rodapé (§21) | **Não existe.** O único canal que responde é o WhatsApp (nenhum dos domínios recebe e-mail — ver `marca.ts`). | Rodapé com WhatsApp; sem central de ajuda nem e-mail. |
| C9 | Instagram no rodapé | Não há perfil registrado em lugar nenhum do código. | Fora, até existir. |
| C10 | "Salvar no rolo da câmera" (§9) | O botão "Salvar no celular" existe (menu de compartilhar do aparelho), mas não foi validado em todos os ambientes. | Não é afirmado. |
| C11 | Fotos por curadoria A–E (§24) | O ambiente de desenvolvimento **não alcança bancos de imagem**; só existem as 8 fotos de casamento que já estavam em `public/home`. Não há nenhuma do grupo E (fora do casamento). | Placeholders com as 8 fotos, organizados por slot de curadoria em `config/home-demonstracao.ts` — trocar é mudar o caminho do arquivo. A galeria "editorial" usa as fotos em preto e branco para ler como outro fotógrafo; é placeholder, e sai quando chegar a curadoria. **Atualização 28/09/2026:** chegaram as 5 primeiras fotos autorais (capas dos quatro exemplos, cartão do Cofre e foto grande do fim); `foto5`–`foto8` seguem provisórias. As fotos passaram a ser trocáveis pelo admin, em `/painel/admin/home` (migração 043). |

## 2. Redundâncias no briefing

- **Personalização aparece quatro vezes:** hero (três galerias), §6 (várias
  identidades), §7 (marca e endereço) e o bloco "Personalização" de Recursos.
  → O hero **mostra** a variedade; §6 **compara** galerias completas; §7 vira o
  lugar onde o visitante **mexe** (capa, fonte, cor mudam a galeria ao vivo — a
  microinteração do §23). O bloco "Personalização" sai de Recursos.
- **O Cofre aparece cinco vezes:** seção própria, Recursos, pergunta 2 e duas
  perguntas do FAQ. → Fica a seção, a pergunta 2 (é pergunta de comprador, faz
  sentido lá) e o FAQ (quem procura resposta vai direto nele). Sai de Recursos.
- **Favoritos, domínio e segurança** também se repetiam em Recursos. →
  **Recursos passa a mostrar só o que não tem seção própria:** download da
  galeria inteira, prova de entrega (aberturas e downloads contados), capítulos
  que nascem das pastas, lixeira de 30 dias, senha e prazo por galeria, e a
  vitrine do estúdio. Assim nada é dito duas vezes e o que existe de verdade
  não fica mudo.

## 3. Oportunidades e mudanças propostas (com o motivo)

1. **As galerias da página são a galeria de verdade.** Hero, exemplos,
   personalização, celular e CTA final renderizam os **mesmos componentes** que
   o cliente vê (`GaleriaCapa`, `GaleriaGrade`) com os **mesmos estilos, fontes
   e temas** do editor. Não é mockup desenhado: se o produto mudar, a home muda
   junto. É o princípio do §28 levado ao pé da letra.
2. **Telas do painel** (envio, editor, seleção) são prints reais, gerados por
   `scripts/capturar-telas-home.mjs` contra um banco e um armazenamento locais —
   refazer os prints quando a interface mudar é rodar o script.
3. **A home fica clara e neutra, sem seletor de tema.** A página antiga seguia o
   tema do sistema, e no claro virava um véu leitoso sobre a foto; o seletor
   ainda oferecia o tema "Movimento Átomo", de outra marca (conflito 6 da
   estratégia). Neutra, as fotos trazem a cor (§3). O painel continua com os
   temas dele.
4. **Tipografia própria da home:** Bricolage Grotesque nos títulos e Inter no
   texto, carregadas **só na home** (galeria do cliente não baixa nada a mais).
   É escolha provisória de direção de arte: trocar é uma linha em
   `components/home/fontes.ts`.
5. **O CTA é tinta, não dourado nem verde.** Preto quase puro sobre papel
   neutro, para a cor vir das fotos. Cor de marca de destaque fica para a camada
   estratégica decidir; é um token só.
6. **Pergunta 2 do comparativo:** o briefing troca "a senha tranca a página ou
   o arquivo?" pelo Cofre. A troca foi feita como pedido — e o teste dos dez
   segundos (abrir a foto numa aba anônima), que é a prova mais forte que
   tínhamos, foi para a seção **Segurança**, onde ele é prova e não pergunta.
7. **"Explorar possibilidades"** (§6) não tem página de exemplos para onde ir.
   Leva ao bloco interativo do §7, onde o visitante troca capa, fonte e cor.
8. **Título e cartão do link.** "Onde o instante permanece" saía no título de
   toda página e no cartão do WhatsApp. `marca.tagline` passou a ser descritivo
   — "galeria brasileira para fotógrafos" — até a camada estratégica aprovar uma
   assinatura. A frase do hero não virou tagline: o §15 pede validação antes.
9. **Consertos técnicos que vieram de graça:** o botão cortado do cabeçalho no
   celular, o circunflexo desalinhado da Cormorant, os números contraditórios
   de estilos e fontes (agora saem de `PRESETS` e `OPCOES`) e o texto corrido
   sem a fonte da marca — tudo isso deixa de existir na home nova.
   **Não consertado, e fica para decisão:** a Montserrat não carrega no painel,
   no login e nas páginas institucionais (a variável `--font-sans` é resolvida
   no `:root`, antes de a da Montserrat existir, e cai na fonte do sistema). A
   **galeria do cliente não é afetada** — ela usa a variável da Montserrat
   direto (`FONTES_TEXTO`). Consertar é uma linha no `layout.tsx`, mas muda a
   cara do painel inteiro, então fica para o Felipe decidir.

## 4. Estrutura implementada

| # | Seção | O que mostra | De onde vem |
|---|---|---|---|
| 0 | Cabeçalho fixo | símbolo + Galeria Átomo + beta discreto · Exemplos · Recursos · Planos · Entrar · **Começar grátis** | — |
| 1 | Hero | eyebrow, headline e texto do briefing; três galerias reais em identidades diferentes, uma na frente, alternando devagar | `GaleriaCapa` + `GaleriaGrade` |
| 2 | Uma galeria. Várias identidades. (`#exemplos`) | quatro galerias completas (capa + grade), com a combinação real de cada uma escrita embaixo | `PRESETS`/`OPCOES` |
| 3 | Seu trabalho. Sua marca. Seu endereço. | uma galeria dentro de um navegador com `seuestudio.galeriaatomo.com.br`; o visitante troca capa, fonte e cor e ela muda na hora | opções reais do editor |
| 4 | Suba. Personalize. Entregue. (`#como-funciona`; era "Da pasta ao cliente.") | 01 Suba · 02 Personalize · 03 Entregue, cada um com a tela real | prints do painel + galeria |
| 5 | Intuitiva para quem entrega. Intuitiva para quem recebe. | celular com a galeria rolando + a lista do que o cliente faz | componentes reais |
| 6 | A seleção acontece dentro da própria galeria. | grade com corações marcando, contador "12 de 40", o painel da seleção | componentes reais + print |
| 7 | Brasileira desde o começo. | quatro provas concretas + o complemento do beta | `planos.ts`, `marca.ts` |
| 8 | Cofre | no ar → prazo encerrado → no Cofre → restaurada, animado; aviso de backup | `prazos.ts` |
| 9 | Tudo o que sustenta a entrega. (`#recursos`) | seis recursos que não têm seção própria | código |
| 10 | Foto + filme | **escondida** até `VIDEO_LIBERADO` | `config/lancamentos.ts` |
| 11 | Respiro | foto sangrando + "O trabalho é seu. A entrega também." | curadoria |
| 12 | Planos (`#planos`) | montador real, sem a escolha Foto/Filme enquanto o vídeo não sai | `MontadorPlano` |
| 13 | Três perguntas | espaço · vencimento · quem aparece mais | — |
| 14 | Segurança | só mecanismos da página `/seguranca` | `/seguranca` |
| 15 | FAQ | a ordem do briefing, respostas conferidas | — |
| 16 | CTA final | as identidades de novo, deslizando devagar | componentes reais |
| 17 | Rodapé | Produto · Suporte (WhatsApp) · Legal | — |

## 5. Como foi verificado

- Bateria completa (`npm test`) contra Postgres e MinIO locais, no mesmo
  arranjo do CI. Três suítes prendiam a home antiga e foram atualizadas **sem
  afrouxar o que protegem**: `testar-marca-plataforma` (agora impede a frase
  rejeitada de voltar, em vez de exigir que ela seja o H1),
  `testar-comparativo` (o número de fontes sai de `OPCOES` em vez de "nove"
  escrito; o filme segue `VIDEO_LIBERADO` — desligado, a home é proibida de
  falar de vídeo) e `testar-tema` (a home trava a própria luz; o contraste das
  três tintas da home é medido sobre os três fundos, piso AA).
- Prints no computador (1440) e no celular (390), sem erro no console e sem
  rolagem lateral. Cabeçalho medido de 320 a 1024 px: o botão de criar conta cabe inteiro em todas.
- Os prints do painel são reais: `scripts/capturar-telas-home.mjs` sobe as
  fotos pelo painel, marca favoritas pelo caminho do cliente e fotografa.

**Achado de passagem, não consertado (fora do escopo da home):** a prévia do
fotógrafo com a galeria vazia (`/g/...` com `ehDono` e nenhum item) passa
`capitulos={[]}` para o `GaleriaCliente`, e ele só desenha grade por
capítulo — as fotos de exemplo nunca aparecem. A página de demonstração da home
precisou passar o grupo das soltas (`sem-capitulo`) para as fotos aparecerem.

## 6. O que depende de alguém

**Felipe (validação técnica):**
- Domínio próprio está no ar em produção? Se sim, ligar `DOMINIO_PROPRIO_LIBERADO`.
- Vídeo está validado com entrega real? Se sim, ligar `VIDEO_LIBERADO`.
- Consertar a Montserrat no painel, login e páginas institucionais? (A galeria
  do cliente não muda; o painel passa a ter a fonte que sempre deveria ter.)

**Juan / camada estratégica:**
- Fotos autorais por slot (`config/home-demonstracao.ts`), incluindo o grupo E
  (fora do casamento), que hoje não tem nenhuma.
- Fotos reais da equipe para "Brasileira desde o começo".
- Tipografia e cor de destaque definitivas (hoje provisórias, um token cada).
- Assinatura para o título e o cartão do link (hoje descritiva).
