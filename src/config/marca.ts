/**
 * IDENTIDADE DA MARCA — ponto único de verdade.
 *
 * NADA no resto do código escreve o nome da plataforma direto: tudo lê daqui.
 * Trocar de nome = editar este arquivo. Bucket, tabelas e pastas usam termos
 * neutros ("galerias", "app") de propósito, para não precisarem migrar junto.
 *
 * ── NOME E ENDEREÇO NÃO ANDAM JUNTOS (26/08/2026) ─────────────────────────
 * Segunda troca de marca: Fotônio → Olumier → Galeria Átomo. Nas duas, a
 * tentação foi a mesma — um localizar-e-substituir em "olumier" no repositório
 * inteiro. Ele levaria junto quatro coisas que carregam a palavra e NÃO são
 * nome nenhum: o prefixo do Asaas (gravado em toda assinatura viva, e a conta é
 * dividida com o Atomatiza), os nomes dos buckets (onde os arquivos moram), o
 * cookie de sessão, e os dois campos abaixo.
 *
 * `dominio` e `email` PARECEM texto e moram neste arquivo, mas não são: o
 * primeiro monta o link do "esqueci minha senha" e autoriza a emissão de
 * certificado TLS; o segundo é uma caixa que precisa existir para receber. Eles
 * mudam na FASE 2, quando galeriaatomo.com.br estiver respondendo e com e-mail
 * configurado — e o domínio antigo continua redirecionando, porque link de
 * galeria já entregue não pode quebrar.
 *
 * `scripts/testar-marca-plataforma.mjs` é o freio disso, e foi exercitado
 * contra o find-replace cego antes de existir.
 */

export const marca = {
  nome: "Galeria Átomo",
  nomeSimples: "galeria-atomo",
  simbolo: "GA",
  tagline: "Sua luz, entregue.",
  /* FASE 2 — ver o bloco acima antes de tocar nestes dois. */
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
