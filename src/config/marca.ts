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
  void: "#0c0a07",
  carbon: "#171310",
  carbon2: "#201a13",
  luz: "#e6c17a",
  luzAlta: "#f8ecd0",
  texto: "#f0e9db",
  textoSoft: "#b8ab90",
  textoFaint: "#847860",
  linha: "rgba(240, 228, 200, 0.14)",
  linhaForte: "rgba(240, 228, 200, 0.28)",
  marfim: "#f7f1e6",
  tinta: "#2a2318",
} as const;
