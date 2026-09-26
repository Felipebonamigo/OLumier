import type { Metadata } from "next";
import { marca } from "@/config/marca";

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
