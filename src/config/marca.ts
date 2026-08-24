/**
 * IDENTIDADE DA MARCA — ponto único de verdade.
 *
 * O nome da plataforma ainda pode mudar (decisão pendente com os sócios).
 * Por isso NADA no resto do código escreve "Olumier" direto: tudo lê daqui.
 * Trocar de nome = editar este arquivo. Bucket, tabelas e pastas usam termos
 * neutros ("galerias", "app") de propósito, para não precisarem migrar junto.
 */

export const marca = {
  nome: "Olumier",
  nomeSimples: "olumier",
  simbolo: "Ol",
  tagline: "Sua luz, entregue.",
  dominio: "olumier.com.br",
  descricao:
    "Galerias de entrega para fotógrafos e filmakers. Downloads e streaming ilimitados, com a sua marca.",
  email: "contato@olumier.com.br",
} as const;

/** Paleta — a sala de projeção: preto quente, dourado-champanhe, marfim. Espelha globals.css. */
export const cores = {
  // A sala de projeção. Espelha src/app/globals.css — quando um mudar, mude o
  // outro; este objeto existe para quem precisa da cor em JS (e-mail, SVG).
  void: "#07080b",
  carbon: "#101319",
  carbon2: "#171b23",
  luz: "#cfd9ea", // o feixe: prata fria
  luzAlta: "#ffffff",
  acento: "#d9a441", // o âmbar: SÓ ação
  acentoAlto: "#f2c877",
  texto: "#eef1f6",
  textoSoft: "#a4adbd",
  textoFaint: "#6b7484",
  linha: "rgba(190, 205, 230, 0.13)",
  linhaForte: "rgba(190, 205, 230, 0.26)",
} as const;
