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
 * certificado TLS; o segundo é o endereço que a página de privacidade, os
 * termos e o rodapé mandam a pessoa escrever.
 *
 * ── FASE 2 FEITA EM 26/08/2026 ────────────────────────────────────────────
 * Os dois passaram para `galeriaatomo.com.br`, fechando a linha
 * Fotônio → Olumier → Galeria Átomo. O `olumier.com.br` continua ATENDIDO
 * (ver `config/dominios.ts`) e redireciona no Caddy: link de galeria já
 * entregue não pode quebrar, e por isso o antigo não sai junto com a troca.
 *
 * ⚠️ O `email` mudou sabendo de um defeito que o endereço antigo escondia:
 * NENHUM dos dois domínios recebe mensagem. `olumier.com.br` tem MX nulo
 * (`0 .` — RFC 7505, "este domínio não aceita e-mail") e SPF `-all`;
 * `galeriaatomo.com.br` não tem MX nenhum. Ou seja, `contato@olumier.com.br`
 * NUNCA recebeu nada, e a página de privacidade promete resposta em 15 dias
 * para uma caixa que devolve. Mover para o domínio novo não piorou coisa
 * alguma; o que falta é CRIAR a caixa, e isso é trabalho de DNS, não de código.
 *
 * `scripts/testar-marca-plataforma.mjs` é o freio disso, e foi exercitado
 * contra o find-replace cego antes de existir.
 */

/* O nome sai daqui e entra no objeto abaixo. Existe porque propriedade de
 * objeto não enxerga irmã, e a alternativa seria escrever "Galeria Átomo" duas
 * vezes — numa marca que já mudou duas vezes (Fotônio → Olumier → Galeria
 * Átomo), a segunda cópia é a que fica para trás. */
const NOME = "Galeria Átomo";

export const marca = {
  nome: NOME,
  nomeSimples: "galeria-atomo",
  simbolo: "GA",
  tagline: "Onde o instante permanece.",
  /* FASE 2 — ver o bloco acima antes de tocar nestes dois. */
  dominio: "galeriaatomo.com.br",
  descricao: "Galerias inteligentes para fotógrafos.",
  email: "contato@galeriaatomo.com.br",

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
    "Estamos em beta: o produto está no ar e funcionando, mas você está entre os primeiros a usar.",

  /*
   * ENTREGA, NÃO BACKUP — e por que isto NÃO mora no texto do beta.
   *
   * Até 27/08/2026 esta frase era a segunda metade do `betaExplicacao`. Ou seja:
   * no dia em que o beta acabasse, o aviso mais importante do produto sumiria
   * junto, em silêncio, por causa de uma linha trocada em outro lugar — e sem
   * ninguém decidir isso.
   *
   * Ele não tem nada a ver com beta. Vale enquanto o produto existir: o arquivo
   * aqui é a cópia que o CLIENTE recebe, não a cópia que salva o fotógrafo. A
   * expectativa errada sobre isso é a única que custa um casamento inteiro.
   */
  entregaNaoBackup:
    "O " +
    NOME +
    " é uma ferramenta de entrega, não de backup: o arquivo aqui é a cópia que o seu cliente " +
    "recebe. Guarde os seus originais onde você já guarda — nenhum serviço deveria ser a sua " +
    "única cópia, e o nosso também não.",
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
