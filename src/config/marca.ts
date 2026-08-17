/**
 * IDENTIDADE DA MARCA — ponto único de verdade.
 *
 * O nome da plataforma ainda pode mudar (decisão pendente com os sócios).
 * Por isso NADA no resto do código escreve "Fotônio" direto: tudo lê daqui.
 * Trocar de nome = editar este arquivo. Bucket, tabelas e pastas usam termos
 * neutros ("galerias", "app") de propósito, para não precisarem migrar junto.
 */

export const marca = {
  nome: "Fotônio",
  nomeSimples: "fotonio",
  simbolo: "Ft",
  tagline: "O elemento que guarda sua luz.",
  dominio: "fotonio.com.br",
  descricao:
    "Galerias de entrega para fotógrafos e filmakers. Downloads e streaming ilimitados, com a sua marca.",
  email: "contato@fotonio.com.br",
} as const;

/** Paleta — o âmbar sai do conceito de luz; o fundo escuro faz as fotos brilharem. */
export const cores = {
  void: "#0d0b09",
  carbon: "#16120e",
  carbon2: "#1d1813",
  luz: "#f0c268",
  luzAlta: "#ffe9bf",
  texto: "#ece4d6",
  textoSoft: "#b3a58f",
  textoFaint: "#7d715f",
  linha: "rgba(240, 221, 190, 0.14)",
  linhaForte: "rgba(240, 221, 190, 0.28)",
} as const;
