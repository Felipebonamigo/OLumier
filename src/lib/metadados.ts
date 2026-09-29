import type { Metadata } from "next";
import { marca } from "@/config/marca";
import { ESPACOS } from "@/config/planos";

/**
 * O TÍTULO, O CARTÃO E O ENDEREÇO CANÔNICO DE CADA PÁGINA DA CASA.
 *
 * ── POR QUE CADA PÁGINA DECLARA O SEU (26/09/2026) ────────────────────────
 *
 * O Open Graph morava só no layout raiz, com `url: "/"`. O Next herda o bloco
 * INTEIRO quando a página não define o dela, então `/termos`, `/seguranca` e
 * `/cadastrar` saíam com o título, a descrição e o endereço da HOME: quem
 * mandava o link da página de segurança no WhatsApp via o cartão da home, e o
 * `og:url` dizia a robô nenhum que aquela página existia.
 *
 * E nenhuma página tinha `<link rel="canonical">`. O mesmo conteúdo responde
 * pelo domínio com e sem `www`, e com `?utm=` de qualquer campanha — sem o
 * canônico, o buscador escolhe sozinho qual cópia vale e divide a relevância
 * entre elas.
 *
 * ── A IMAGEM VAI EXPLÍCITA, E NÃO É ENFEITE ───────────────────────────────
 *
 * Página que define `openGraph` próprio SUBSTITUI o do layout, e a imagem do
 * `opengraph-image.tsx` da raiz vai embora junto — o Next só a pendura de volta
 * no segmento que tem o arquivo. Sem a linha abaixo, consertar o título do
 * cartão trocaria "cartão errado" por "cartão sem imagem".
 */

/** O modelo do `<title>` das páginas internas. O layout raiz lê daqui. */
export const MODELO_DO_TITULO = `%s · ${marca.nome}`;

const IMAGEM_DA_CASA = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: `${marca.nome} — ${marca.tagline}`,
};

/**
 * Metadados de uma página pública da casa.
 *
 * `caminho` é relativo: o `metadataBase` do layout raiz o torna absoluto no
 * domínio canônico, e é isso que faz o canônico apontar para
 * `galeriaatomo.com.br` mesmo quando a visita chegou pelo `www`.
 *
 * `tituloInteiro` é para a home, cujo título já começa com o nome da marca — o
 * modelo acrescentaria o nome uma segunda vez.
 */
export function metadadosDaCasa({
  titulo,
  descricao,
  caminho,
  tituloInteiro = false,
}: {
  titulo: string;
  descricao: string;
  caminho: string;
  tituloInteiro?: boolean;
}): Metadata {
  const completo = tituloInteiro ? titulo : MODELO_DO_TITULO.replace("%s", titulo);
  return {
    title: { absolute: completo },
    description: descricao,
    alternates: { canonical: caminho },
    openGraph: {
      type: "website",
      siteName: marca.nome,
      locale: "pt_BR",
      url: caminho,
      title: completo,
      description: descricao,
      images: [IMAGEM_DA_CASA],
    },
    twitter: {
      card: "summary_large_image",
      title: completo,
      description: descricao,
      images: [IMAGEM_DA_CASA.url],
    },
  };
}

/**
 * QUEM É A CASA, para o buscador — o bloco `@graph` da home (29/09/2026).
 *
 * Três peças, e cada uma responde a uma pergunta que o robô faz:
 *
 *   · `WebSite` — como o site se CHAMA. É daqui que o Google tira o nome que
 *     escreve acima do resultado ("Galeria Átomo" em vez do endereço cru).
 *   · `Organization` — quem responde por ele: nome, logo e o canal que atende.
 *     O contato vai como LINK do WhatsApp, e não como `telephone`: o número já
 *     está na página, mas é o celular pessoal do Felipe (ver `marca.ts`), e um
 *     campo de telefone estruturado é o formato que raspador de contato colhe.
 *   · `SoftwareApplication` — o que se compra, com o preço que a própria home
 *     mostra: o do plano de entrada. Só o piso (`lowPrice`), porque a grade
 *     continua de tera em tera e um teto aqui seria a mentira calada que
 *     `planos.ts` já recusou.
 *
 * O que NÃO entra, de propósito: `aggregateRating` e `review`. Sem eles o
 * Google não desenha estrelas nem preço no resultado — e o único jeito de
 * tê-los hoje seria inventar, que é o que `PRODUCT.md` proíbe.
 */
export function dadosEstruturadosDaCasa(descricao: string) {
  const raiz = `https://${marca.dominio}/`;
  const organizacao = `${raiz}#organizacao`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizacao,
        name: marca.nome,
        url: raiz,
        logo: `${raiz}icon.svg`,
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          url: marca.whatsappLink,
          areaServed: "BR",
          availableLanguage: "Portuguese",
        },
      },
      {
        "@type": "WebSite",
        "@id": `${raiz}#site`,
        name: marca.nome,
        url: raiz,
        inLanguage: "pt-BR",
        publisher: { "@id": organizacao },
      },
      {
        "@type": "SoftwareApplication",
        name: marca.nome,
        url: raiz,
        description: descricao,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: "pt-BR",
        publisher: { "@id": organizacao },
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "BRL",
          lowPrice: (ESPACOS[0].precoCentavos / 100).toFixed(2),
        },
      },
    ],
  };
}

/**
 * O `<script>` de um bloco estruturado. O `<` escapado: um `</script>` dentro
 * de um texto fecharia a tag e o resto viraria HTML.
 */
export function jsonLd(dados: unknown): string {
  return JSON.stringify(dados).replace(/</g, "\\u003c");
}
