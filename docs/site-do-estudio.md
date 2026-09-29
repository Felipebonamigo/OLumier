# Site do estúdio (a vitrine em `<slug>.olumier.com.br`)

A raiz do subdomínio deixou de ser só uma lista de galerias. Com o site ligado
no painel, ela vira a página que o fotógrafo mostra para quem **ainda não
contratou**: capa, quem é ele, o portfólio, depoimentos e contato.

Ver também [subdominio-por-estudio.md](subdominio-por-estudio.md), que cobre o
roteamento, o certificado e o DNS.

## Por que existe

O concorrente que os nossos fotógrafos usam (Pixieset) vende isso como produto
separado, e é a **primeira** página que o casal vê. Um exemplo real —
`siriusfotografia.mypixieset.com` — tem três páginas: início com foto e texto,
depoimentos, e um botão de WhatsApp.

Onde a nossa é melhor, e são diferenças de mecanismo, não de gosto:

| | Lá | Aqui |
|---|---|---|
| Endereço | `estudio.mypixieset.com` | `estudio.olumier.com.br` |
| Portfólio | fotos escolhidas à mão, soltas do resto | as galerias publicadas, atualiza sozinho |
| Foto da capa | upload à parte | a capa de uma galeria que já existe |
| Estilo | template fechado | os mesmos eixos da galeria (tema, tipografia) |

O portfólio que se atualiza sozinho é a diferença que importa: lá, entregar um
casamento novo e mostrá-lo no site são dois trabalhos, então o site envelhece
parado. Aqui é o mesmo trabalho.

## Como está montado

| Peça | Onde |
|---|---|
| Regras puras (formato, limites, normalização, quais seções existem) | `src/lib/site-estudio.ts` |
| A página pública | `src/app/e/[estudio]/page.tsx` |
| O editor | `src/components/editor-site.tsx` + `/painel/site` |
| Gravação | `salvarSiteAction`, em `src/app/painel/actions.ts` |
| Guardado em | `tenants.site jsonb` (migração `017-site-estudio.sql`) |
| Testes | `scripts/testar-site-estudio.mjs` (puro) e `scripts/testar-vitrine.mjs` (HTML pronto) |

**JSONB e não colunas**, pelo mesmo motivo da aparência da galeria (migração
002): campo novo é chave nova no objeto, não migração. Estúdio antigo que não
tem a chave cai no padrão de `lerSite`.

**Não existe um `if` de "layout novo/antigo".** As seções vazias simplesmente
não entram em `secoesComConteudo`, e o resultado de um site em branco é
exatamente a página de antes. Um segundo layout envelheceria sem ninguém olhar.

### Campos fixos, e não blocos que se arrastam

Um construtor de blocos dá liberdade e entrega feio: quem usa é fotógrafo, não
designer, e esta é a primeira coisa que o casal vê. Com campos fixos o layout é
nosso e o texto é dele — qualquer combinação de preenchimento sai apresentável.

**Preço:** quem quiser uma seção que não previmos não tem como criá-la. É a
troca certa por ora, e é a primeira coisa a revisitar se alguém pedir.

### `ligado` é o mesmo contrato de `publicada` na galeria

O fotógrafo escreve em paz e decide quando o mundo vê. Enquanto está desligado,
a vitrine mostra só a capa e as galerias — e o que ele escreveu **não sai no
HTML**, nem escondido por CSS. `testar-vitrine.mjs` prende isso.

## ⚠️ A parte perigosa: texto de usuário virando `href`

Quase tudo aqui é texto dentro de um nó do React, que escapa sozinho. As
exceções são o **WhatsApp** e o **Instagram**: eles viram `href`, e um
`javascript:` num href é execução de script no domínio do estúdio, escolhida por
quem preencheu o campo.

Por isso o banco **não guarda endereço**. Guarda dígitos (`5554999998888`) e um
nome de usuário (`sirius.fotografia`), e quem monta o endereço é
`urlDoWhatsapp` / `urlDoInstagram`.

Os montadores validam **de novo** antes de devolver o endereço, e isso não é
redundância: a peneira da gravação não protege o que **já está** gravado. Um
valor posto no banco por outro caminho — `psql` na mão, uma importação, uma
action futura que esqueça de normalizar — chega cru em quem desenha o `href`.
Essa é a última fronteira, então é ali que a garantia precisa valer.

`testar-vitrine.mjs` grava `javascript:alert(1)` direto no banco e confere que
nenhum `href` de script sai na página.

## Defeito que só apareceu no HTML pronto

Estúdio **com logo** ficava sem `<h1>` nenhum: a capa desenhava a logo num
`<img>` e o `<h1>` só existia no caminho sem logo. A página pública que existe
para o casal *achar* o fotógrafo ficava sem o título que o buscador lê primeiro
e sem cabeçalho para um leitor de tela anunciar.

Não dava para ver lendo o código — só contando as tags do HTML pronto. É a razão
de `testar-vitrine.mjs` existir ao lado da suíte pura.

## O que o buscador e o WhatsApp veem (26/09/2026)

A vitrine é a única página do estúdio que **deve** aparecer no Google — as
galerias saem com `noindex`. Até 26/09/2026 ela herdava tudo da casa: o cartão
de link dizia "Galeria Átomo", a aba terminava em "· Galeria Átomo", e
`/robots.txt` e `/sitemap.xml` do subdomínio caíam na rota de galeria (404).

- **Cartão próprio.** `app/e/[estudio]/opengraph-image.tsx` desenha a foto do
  topo com o nome do estúdio, nas cores do tema do site. A foto é baixada no
  servidor e o que sai é um PNG com endereço estável — era a pendência que
  impedia o `og:image` aqui. A regra de quais galerias podem dar a foto é a
  mesma da página (`lib/vitrine.ts`): publicada, no ar, sem senha, no prazo.
- **Canônico.** A mesma vitrine abre pelo domínio próprio, pelo subdomínio nos
  dois domínios atendidos e por `/e/<estudio>`. `enderecoDaVitrine` escolhe um:
  o domínio próprio verificado, senão `<estudio>.galeriaatomo.com.br`.
- **Robots e sitemap do estúdio.** O proxy reescreve os dois para
  `app/e/[estudio]/regras-para-robos` e `mapa-do-site` — nomes neutros porque o
  Next trata caminho terminado em `/sitemap.xml` como rota especial. O sitemap
  lista só a vitrine.
- **Ícone da aba.** A logo do estúdio, ou nenhum — nunca o átomo da plataforma
  (`lib/icone-do-estudio.ts`).
- **`<h1>` com texto e descrição do estúdio (29/09/2026).** Com logo, o nome vai
  também em texto dentro do `<h1>` (só para leitor de tela e buscador). A
  descrição é a frase da capa; sem ela, o começo do "sobre" (só com o site
  ligado); só então o genérico. E um bloco `Organization` com o endereço
  canônico e, se a seção de contato estiver no ar, os canais dela.

`scripts/testar-seo.mjs` prende tudo isso. O plano geral de SEO está em
`docs/seo.md`.

## Aberto

- A capa sai da capa de uma galeria. Quem não tem galeria pública sem senha fica
  com a capa só tipográfica — que é bonita, mas não é o que a pessoa espera.
- Uma seção livre ("blocos") continua fora, de propósito. Ver acima.
