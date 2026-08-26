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

  /*
   * BETA — a chave que liga o aviso, e a frase que o explica.
   *
   * O produto funciona de ponta a ponta: sobe, entrega, cobra, arquiva. O que
   * ele ainda não tem é ESTRADA — pouquíssimos estúdios rodando, nenhuma
   * temporada inteira de casamento passada por aqui. Quem entrega o casamento
   * de um cliente pelo nosso link merece saber disso antes, e não depois.
   *
   * O aviso custa assinatura. Custa menos que a primeira conversa em que um
   * fotógrafo descobre sozinho que era o primeiro.
   *
   * Sair do beta é virar isto para `false`: o selo some da marca inteira e do
   * cadastro de uma vez. `scripts/testar-beta.mjs` confere que as páginas
   * concordam com esta linha nos DOIS sentidos — inclusive que ninguém ficou
   * chamando de beta um produto que já saiu dele.
   */
  beta: true,
  betaExplicacao:
    "Estamos em beta: o produto está no ar e funcionando, mas você está entre os primeiros a usar. " +
    "Como em qualquer serviço, guarde os seus originais — os seus arquivos aqui são a entrega, não o seu backup.",
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
