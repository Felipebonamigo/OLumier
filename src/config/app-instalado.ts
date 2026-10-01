import type { Metadata } from "next";
import { marca } from "./marca";

/**
 * O SITE COMO APP NO CELULAR — o ícone da tela de início e o manifesto
 * (01/10/2026).
 *
 * Felipe, com a foto da tela de início do iPhone: "o atalho não está igual o
 * logo". Era um "G" branco num quadrado preto: o iPhone INVENTA esse ícone
 * quando o site não entrega um `apple-touch-icon` em PNG, e o site só tinha o
 * `icon.svg` da aba do navegador. Os PNGs saem de
 * `scripts/gerar-icones-do-app.mjs`, com o mesmo símbolo do logo.
 *
 * ── SÓ NAS PÁGINAS DA PLATAFORMA ─────────────────────────────────────────
 *
 * Home, entrar, cadastrar e o painel — e NÃO a galeria do cliente nem o site do
 * estúdio. Lá, quem salva o atalho é o casal, e a estratégia de marca é clara:
 * "a Galeria Átomo fica por trás, a marca do fotógrafo fica na frente". Um
 * átomo na tela de início do casal seria o contrário. Por isso isto é um
 * pedaço de metadado que cada página da plataforma inclui, e não um arquivo
 * `app/apple-icon.png`, que valeria para o site inteiro.
 *
 * ── O APP ABRE NO PAINEL ─────────────────────────────────────────────────
 *
 * `public/app.webmanifest` começa em `/painel` e abre sem a barra do
 * navegador (`standalone`) — é o app do fotógrafo. Escopo `/`: o login e a
 * troca de senha continuam dentro do app em vez de saltar para o Safari.
 */
export const ICONE_DA_TELA_DE_INICIO = "/icones/apple-touch-icon.png";

export const METADADOS_DO_APP: Pick<Metadata, "manifest" | "appleWebApp" | "icons"> = {
  manifest: "/app.webmanifest",
  /* O favicon vai junto de propósito: `icons` numa página SUBSTITUI o da raiz,
     e sem esta linha a aba do navegador ficava sem o átomo (visto no HTML). */
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: ICONE_DA_TELA_DE_INICIO, sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: marca.nome, statusBarStyle: "default" },
};
