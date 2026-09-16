/**
 * Aparência da galeria: eixos independentes + presets.
 *
 * Por que eixos em vez de "temas prontos": um template fechado sempre erra para
 * alguém — o Sirius quer capa clara com tipografia grande, a Carol quer creme e
 * serifada, o próximo vai querer outra coisa. Combinando eixos, saem dezenas de
 * resultados sem escrever um template para cada. Os presets existem para quem
 * não quer escolher: um clique e está pronto, e ainda dá para ajustar depois.
 */

export type Capa =
  | "imersa"
  | "jornal"
  | "dividida"
  | "minima"
  | "convite"
  /* As duas de 10/09/2026, a pedido do Juan: "foto redonda com título embaixo,
   * mais minimalista. Foto em formato de arco, reta na parte inferior
   * horizontal, título embaixo." Ver `galeria-capa.tsx`. */
  | "redonda"
  | "arco";
export type Tema = "noite" | "claro" | "creme";
export type Tipografia =
  | "serifada"
  | "playfair"
  | "lora"
  | "moderna"
  | "jost"
  | "raleway"
  | "manuscrita"
  | "parisienne"
  | "petit"
  // segunda leva, 27/08/2026 — três opções por família viravam "nenhuma serve"
  | "garamond"
  | "baskerville"
  | "bodoni"
  | "josefin"
  | "work"
  | "outfit"
  | "dancing"
  | "sacramento"
  | "italianno"
  | "cinzel"
  | "marcellus"
  | "tenor"
  /* A fonte que o próprio estúdio enviou. Não é uma fonte nossa: o arquivo mora
   * no bucket do fotógrafo e a galeria injeta o @font-face. Ver lib/fonte-estudio.ts. */
  | "propria";
export type Grade = "colunas" | "linhas" | "quadrada" | "editorial" | "panorama";
export type Densidade = "compacta" | "normal" | "arejada";

export type TamanhoLogo = "discreta" | "media" | "grande" | "enorme";

/**
 * A grossura do título da capa.
 *
 * ── POR QUE ISTO É UM EIXO, E POR QUE ELE É TRAVADO EM ALGUMAS FONTES ─────
 *
 * Até 04/09/2026 `galeria-capa.tsx` cravava `font-bold` — 700 — nas quatro
 * capas. Para as fontes variáveis isso é um peso de manchete de jornal aplicado
 * a uma serifada de alto contraste em 7xl; para SETE fontes do catálogo é pior,
 * porque elas só têm o peso 400 no arquivo, e pedir 700 de quem não tem faz o
 * navegador ENGORDAR o traço artificialmente. Numa manuscrita de casamento o
 * negrito sintético deforma a caligrafia.
 *
 * Daí a regra que `pesoDoTitulo` implementa: onde não há peso de verdade, o
 * eixo não inventa um. Escolher "forte" numa Italianno continua desenhando 400
 * — e é o certo, porque a alternativa não é uma Italianno mais forte, é uma
 * Italianno borrada.
 */
export type Peso = "leve" | "normal" | "forte";

/**
 * Quanto da tela a capa ocupa.
 *
 * Pedido do Felipe em 04/09/2026: "permita uma função de diminuir o tamanho da
 * foto da capa". A capa imersa era `78vh` cravado — quase a tela inteira, e sem
 * nada para mexer. Numa foto de detalhe (aliança, buquê) isso vira um recorte
 * gigante de uma imagem que pedia respiro; e quem quer a galeria começando logo
 * não tinha como encurtar a entrada.
 *
 * `cheia` é o valor de antes, para nenhuma galeria entregue mudar de cara.
 */
export type AlturaCapa = "baixa" | "media" | "cheia";

/**
 * O canto das fotos na grade.
 *
 * Pedido do Felipe: "deixe selecionar se o canto das fotos será ondulado ou
 * quadrado e, se for ondulado, o quanto". Era `rounded-md` cravado no
 * componente — 6 px, uma escolha que ninguém tomou e ninguém podia desfazer.
 *
 * `suave` é esse mesmo 6 px, para as galerias que já estão no ar continuarem
 * idênticas ao pixel.
 */
export type CantoFoto = "reto" | "suave" | "redondo" | "muito";

/**
 * A fonte do CORPO da galeria — legenda, botão, nome do capítulo, rodapé.
 *
 * Pedido do Felipe em 05/09/2026: a fonte que o estúdio envia valia só no
 * título, e ele quis que valesse no texto também.
 *
 * ── POR QUE É UM EIXO SEPARADO, E NÃO UM EFEITO DA TIPOGRAFIA ───────────
 *
 * O caminho curto seria: escolheu `propria` no título, o corpo vai junto.
 * Ele quebra duas coisas de uma vez. Marca de fotógrafo costuma ser display
 * ou manuscrita, e arrastar o corpo junto tornaria ILEGÍVEL toda galeria que
 * hoje escolheu `propria` só para o título — mudança de cara em entrega já
 * feita, que é justamente o que o resto deste arquivo evita. E fecharia a
 * combinação mais provável de dar certo: título em Bodoni, corpo na
 * sem-serifa da marca.
 *
 * Separado, o padrão `padrao` não mexe em nada e a escolha existe.
 */
export type FonteDoTexto = "padrao" | "propria";

/**
 * Como o texto da capa se alinha.
 *
 * Juan, 05/09/2026: "me incomoda tudo estar torto. Não tá nem centralizado,
 * nem tudo pra esquerda. Cada coisa tá de um jeito".
 *
 * Ele estava olhando a capa jornal, e a queixa é precisa. Nome do estúdio,
 * título, data e botão são todos centralizados — e como têm larguras
 * diferentes, a borda ESQUERDA de cada um cai num lugar diferente.
 * Centralizado está certo em relação ao eixo do meio e torto em relação a
 * qualquer linha vertical, que é o que o olho procura quando lê de cima para
 * baixo. Não havia defeito a corrigir: havia uma escolha faltando.
 *
 * `centro` é o que as capas sempre desenharam, e continua sendo o padrão.
 */
export type Alinhamento = "centro" | "esquerda";

/**
 * QUANTAS LINHAS O NOME OCUPA — escolha do fotógrafo, não do navegador.
 *
 * Felipe, 16/09/2026: "o título fica obrigatoriamente um em cima do outro, eu
 * preferiria que tudo ficasse em uma linha só"; e depois, olhando de novo:
 * "permitir que o nome fique na mesma linha, escolha do usuário, na mesma
 * linha, ou em 2 ou em 3".
 *
 * ── DE ONDE VINHAM AS TRÊS LINHAS ────────────────────────────────────────
 *
 * As capas embrulhavam o título num `max-w-[18ch]`. A intenção era boa — "uns
 * 18 caracteres por linha" — mas a conta saía na fonte ERRADA: a classe estava
 * na `div` de fora, que herda a fonte do corpo em 16 px, então 18ch dava uns
 * 145 px. O título desenha ao lado em 48 px. O resultado é o que ele
 * fotografou: "Nathalia & Matheus", que cabe folgado numa linha, caindo em
 * três.
 *
 * Corrigir a conta (medir o `ch` na fonte do TÍTULO) resolve o caso dele e não
 * responde à pergunta seguinte, que é de gosto: duas linhas centradas são um
 * desenho legítimo de convite, e havia quem estivesse contando com elas. Por
 * isso virou eixo em vez de conserto silencioso.
 *
 * `auto` deixa o navegador quebrar onde couber, e é o padrão — mas agora com a
 * largura medida certo, o que na prática devolve a linha única para nome curto.
 */
export type LinhasTitulo = "auto" | "uma" | "duas" | "tres";

/**
 * O TAMANHO DO TÍTULO, EM PORCENTAGEM DO QUE A CAPA JÁ DESENHAVA.
 *
 * Felipe, 16/09/2026: "poderia ter um tipo de barrinha que a gente pudesse
 * definir o tamanho do texto dentro do mesmo espaço de formatação. Assim
 * poderia ir definindo, pela barrinha, se o texto ficaria tudo em uma única
 * linha, ou se aumentando o tamanho do texto ele iria pra linhas de baixo".
 *
 * ── POR QUE PORCENTAGEM, E NÃO PIXELS ───────────────────────────────────
 *
 * Cada capa tem o seu tamanho: a imersa escreve o nome grande sobre a foto, a
 * redonda escreve pequeno embaixo do círculo. Um número em pixels serviria a
 * uma e estragaria a outra — e mudaria de significado toda vez que a pessoa
 * trocasse de desenho de capa. A porcentagem multiplica o tamanho PRÓPRIO de
 * cada capa, então 120% quer dizer a mesma coisa nas sete.
 *
 * 100 é o que a capa já desenhava, e é o padrão: quem não mexer na barrinha
 * não vê diferença nenhuma.
 */
export const TAMANHO_TITULO = { min: 60, max: 180, passo: 5, padrao: 100 } as const;


/**
 * Como o link da galeria aparece no WhatsApp.
 *
 * Carol, 08/09/2026, olhando o cartão já corrigido: "não acho bonita a
 * prévia, não gosto daquele gradiente branco ali, queria que fosse mais
 * clean".
 *
 * ── POR QUE DESLIGAR O VÉU NÃO PERDE NADA ───────────────────────────────
 *
 * O véu existe para o texto ler sobre qualquer foto, e é uma boa razão
 * enquanto há texto. Só que desde 06/09/2026 o WhatsApp já escreve, ao lado
 * da imagem, o nome da galeria e o do estúdio: o texto sobre a foto virou a
 * segunda cópia da mesma informação — e o gradiente era o preço dela.
 *
 * `foto` entrega a capa inteira, sem véu e sem letra. `sobreposto` é o que
 * existia, e continua sendo o padrão: galeria já entregue não muda de cara.
 *
 * Sem foto para mostrar (galeria com senha, derivada ilegível), `foto` volta
 * ao cartão com fundo e nome — retângulo vazio não é opção.
 */
export type CartaoDoLink = "sobreposto" | "foto";

/**
 * Quantas fotos a prévia do editor desenha.
 *
 * A prévia é a galeria pública de verdade, renderizada no tamanho de uma tela
 * e reduzida em escala (ver `VIEWPORTS_PREVIA`) — e isso é qualidade do
 * produto, não atalho: o que se vê ali é o que o cliente vê. O custo era
 * carregar a galeria INTEIRA a cada mudança de eixo; com 192 fotos, trocar de
 * fonte assinava 576 URLs e baixava 192 miniaturas para mostrar meia dúzia.
 *
 * Doze fotos enchem a primeira dobra de um computador (grade de quatro colunas,
 * três linhas) com folga para rolar um pouco, sem que a conta dependa do
 * tamanho da entrega. Não é teto de nada além da prévia: o botão "Visualizar
 * galeria" abre a galeria completa, e `testar-previa.mjs` existe principalmente
 * para prender essa diferença.
 */
export const AMOSTRA_PREVIA = 12;

/**
 * ── A PRÉVIA TEM O TAMANHO DE UMA TELA, NÃO DE UMA CAIXA (05/09/2026) ─────
 *
 * Até aqui o iframe da prévia tinha 460 px de altura e a largura do painel. A
 * galeria é desenhada para tela cheia: a capa imersa pede `78vh`, as capas
 * dividida e jornal viram duas colunas a partir de 768 px. Numa caixa de 460 px
 * a capa virava uma faixa, e num notebook o painel ficava abaixo de 768 px e a
 * prévia mostrava o layout de celular — enquanto o cliente, no computador, via
 * outro. O dono disse, com razão: a publicação tem de ser fiel à prévia, porque
 * é na prévia que ele decide.
 *
 * Agora o iframe é renderizado no tamanho de uma tela DE VERDADE e reduzido em
 * escala para caber na coluna. A galeria dentro dele bate nos mesmos
 * breakpoints, desenha as mesmas proporções, carrega as mesmas fontes — só
 * aparece menor. Continua sendo a galeria pública, não uma imitação.
 *
 * Dois tamanhos, porque o cliente do fotógrafo abre em dois lugares: o
 * computador de quem escolhe as fotos do álbum, e o celular de quem recebeu o
 * link no WhatsApp. 1280×800 é um notebook comum; 390×844 é um iPhone comum.
 * Nem o maior nem o menor de cada categoria — o típico.
 */
export const VIEWPORTS_PREVIA = [
  { id: "computador", nome: "Computador", largura: 1280, altura: 800 },
  { id: "celular", nome: "Celular", largura: 390, altura: 844 },
] as const;
export type ViewportPrevia = (typeof VIEWPORTS_PREVIA)[number]["id"];

/**
 * ── CORES PRÓPRIAS (05/09/2026) ───────────────────────────────────────────
 *
 * Três temas prontos serviam a todo mundo mais ou menos e a ninguém exatamente.
 * O dono pediu cores editáveis, "inclusive dos botões".
 *
 * TRÊS cores, e não as oito variáveis do tema: fundo, texto e destaque (o botão,
 * o coração marcado, o traço do play). O resto — superfície, texto suave, texto
 * tênue, linha, texto sobre o botão — é DERIVADO dessas três em
 * `variaveisDoTema`. Oito seletores seriam oito jeitos de quebrar a
 * legibilidade; três, com derivação, mantêm a paleta coerente por construção.
 *
 * Cada uma é opcional: quem mexe só no botão fica com fundo e texto do tema.
 * Toda cor é `#rrggbb` minúsculo, e SÓ isso — ver `lerCores` para o porquê.
 */
export interface CoresProprias {
  fundo?: string;
  texto?: string;
  destaque?: string;
}

export interface Aparencia {
  capa: Capa;
  tema: Tema;
  tipografia: Tipografia;
  grade: Grade;
  densidade: Densidade;
  logo: TamanhoLogo;
  peso: Peso;
  alturaCapa: AlturaCapa;
  canto: CantoFoto;
  fonteTexto: FonteDoTexto;
  alinhamento: Alinhamento;
  /** Em quantas linhas o nome cai. Ver `LinhasTitulo`. */
  linhasTitulo: LinhasTitulo;
  /** Porcentagem do tamanho próprio da capa: 100 é o de sempre. Ver `TAMANHO_TITULO`. */
  tamanhoTitulo: number;
  /**
   * O QUE é o evento, antes de dizer de QUEM ele é.
   *
   * Juan, 10/09/2026: "adicionar a opção de subtítulo para a capa: por exemplo,
   * casamento, aniversário, prewedding. Para não ocupar tanto espaço visual se
   * estivesse no título em si."
   *
   * NÃO é o `subtitulo` da galeria, que já tem dono: ali mora o LOCAL ("Casa na
   * Chácara"), e ele sai na legenda junto da data. Enfiar "Casamento" lá
   * empurraria o local para uma terceira informação na mesma linha — que é
   * exatamente o "ocupar espaço visual" de que ele reclamou.
   *
   * Vazio é o normal, e é o que toda galeria existente tem: a capa que não
   * recebe rótulo desenha exatamente o que desenhava antes.
   */
  rotulo: string;
  cartao: CartaoDoLink;
  /** Ausente na maioria das galerias: só existe quando alguém escolheu uma cor. */
  cores?: CoresProprias;
}

/*
 * O PADRÃO DA LOGO É `media`, e isso MUDA a capa de quem nunca escolheu.
 *
 * Até 31/08/2026 a altura era um `max-h-14` dentro do componente — 56 px fixos,
 * o mesmo para logo quadrada e para logo horizontal fina. Como `lerAparencia`
 * completa o que falta com o padrão, toda galeria gravada antes deste eixo passa
 * a desenhar a logo em 88 px.
 *
 * É mudança de cara em galeria já existente, que é justamente o que a regra dos
 * ids de tipografia proíbe — e aqui é DE PROPÓSITO, porque o pedido do dono foi
 * "a logo tem que ser maior". Um padrão que repetisse os 56 px atenderia à letra
 * e não ao pedido: quem não mexesse em nada continuaria com a logo miúda.
 */
/*
 * O PADRÃO DO PESO É `normal` (400), e isso ALIVIA o título de quem nunca
 * escolheu — de propósito, pelo mesmo motivo do padrão da logo acima.
 *
 * Toda galeria gravada antes deste eixo desenhava o título em 700, porque era
 * o que o componente cravava. Com o padrão em 400 elas passam a desenhar mais
 * leve. É mudança de cara em galeria entregue, e é exatamente o pedido: "o
 * título tá muito grosso". Um padrão que repetisse os 700 atenderia à letra
 * (o eixo existe!) e não ao pedido — quem não mexesse em nada continuaria com
 * o título grosso, inclusive nas manuscritas, onde o 700 nem era real.
 */
export const APARENCIA_PADRAO: Aparencia = {
  capa: "imersa",
  tema: "noite",
  tipografia: "serifada",
  grade: "colunas",
  densidade: "normal",
  logo: "media",
  peso: "normal",
  /* Os dois nasceram em 04/09/2026 com o valor que o componente já cravava:
     78vh de capa e 6 px de canto. Galeria entregue não muda de cara — ao
     contrário da logo e do peso, aqui não havia queixa a corrigir, só falta
     de escolha. */
  alturaCapa: "cheia",
  canto: "suave",
  /* Nasceu `padrao` em 05/09/2026 e tem de continuar assim: quem escolheu a
     fonte própria antes deste eixo a escolheu PARA O TÍTULO, e o corpo dessas
     galerias não pode mudar sozinho. Ver o comentário de `FonteDoTexto`. */
  fonteTexto: "padrao",
  alinhamento: "centro",
  /* Os dois nasceram em 16/09/2026 sem mexer em nada: `auto` é a quebra que o
     navegador já fazia e 100% é o tamanho que a capa já desenhava. O que MUDA
     as galerias existentes não é o padrão — é a largura do título ter passado
     a ser medida na fonte certa. Ver `LinhasTitulo`. */
  linhasTitulo: "auto",
  tamanhoTitulo: TAMANHO_TITULO.padrao,
  /* `sobreposto` é o cartão de sempre. Ver o comentário de `CartaoDoLink`:
     o modo limpo é escolha, não correção. */
  cartao: "sobreposto",
  rotulo: "",
};

/**
 * As fontes que só têm o peso 400 no arquivo — conferidas uma a uma em
 * `src/app/layout.tsx`, onde o `next/font` as declara com `weight: "400"`.
 *
 * `propria` entra aqui porque é a fonte que o ESTÚDIO enviou: não sabemos o que
 * tem dentro do arquivo, e pedir 700 de uma fonte desconhecida é a mesma aposta
 * que criou o defeito. Na dúvida, não engorda.
 */
const SEM_NEGRITO_REAL = new Set<Tipografia>([
  "manuscrita", // Great Vibes
  "parisienne",
  "petit", // Petit Formal Script
  "sacramento",
  "italianno",
  "marcellus",
  "tenor", // Tenor Sans
  "propria",
]);

/**
 * As fontes que NÃO têm nada abaixo de 400 — conferidas contra a tabela de
 * pesos do próprio `next/font` (`@next/font/dist/google/font-data.json`).
 *
 * ── A QUEIXA QUE ISTO RESPONDE ───────────────────────────────────────────
 *
 * Felipe, 16/09/2026: "a normal pra fina não muda nada. Só muda da normal para
 * forte". Ele estava na serifada, e ali era defeito nosso: a Cormorant TEM 300,
 * e `layout.tsx` carregava só 400, 600 e 700 — o navegador caía no 400 por
 * falta do arquivo. Isso virou a fonte variável e está resolvido.
 *
 * Nas quinze desta lista, porém, não há defeito a corrigir: a família não
 * desenha nada mais leve que 400, e não existe arquivo para carregar. Pedir
 * 300 continua sendo inofensivo — o navegador escolhe o mais próximo para cima
 * e desenha 400 —, mas o botão fica sem resposta, e é exatamente essa a
 * experiência de que ele reclamou.
 *
 * O simétrico de `SEM_NEGRITO_REAL`, e pelo mesmo motivo: o eixo não inventa um
 * peso que a fonte não tem. A diferença é o RISCO — para cima o navegador
 * engorda o traço artificialmente e estraga a letra; para baixo ele apenas
 * ignora. Por isso aqui a lista não muda o que é desenhado: ela serve para o
 * editor AVISAR, em vez de deixar a pessoa clicar três vezes achando que
 * quebrou.
 */
const SEM_LEVE_REAL = new Set<Tipografia>([
  "playfair", // 400–900
  "lora", // 400–700
  "garamond", // 400–800
  "baskerville", // 400–700
  "bodoni", // 400–900
  "dancing", // 400–700
  "cinzel", // 400–900
  /* As sete de peso único já estão travadas em 400 pela lista de cima; entram
     aqui também porque a pergunta é outra e a resposta seria a mesma. */
  "manuscrita",
  "parisienne",
  "petit",
  "sacramento",
  "italianno",
  "marcellus",
  "tenor",
  "propria", // arquivo do estúdio: não sabemos o que tem dentro
]);

/** A fonte tem traço mais fino que o normal para dar? Usado só para avisar. */
export function temPesoLeve(t: Tipografia): boolean {
  return !SEM_LEVE_REAL.has(t);
}

/** O que cada opção pede, quando a fonte tem peso de verdade para dar. */
const PESO_ALVO: Record<Peso, number> = { leve: 300, normal: 400, forte: 700 };

/**
 * O `font-weight` que a capa deve pedir.
 *
 * Pedir 300 de uma fonte cujo eixo começa em 400 é inofensivo: o navegador
 * escolhe o mais próximo para baixo e, não havendo, sobe — nunca afina nada
 * artificialmente. O risco só existe para CIMA, e é dele que a lista acima
 * protege.
 */
export function pesoDoTitulo(t: Tipografia, p: Peso): number {
  return SEM_NEGRITO_REAL.has(t) ? 400 : PESO_ALVO[p];
}

/** Apara a barrinha para dentro da faixa e para cima de um passo inteiro. */
function lerTamanhoTitulo(bruto: unknown): number {
  const n = typeof bruto === "number" && Number.isFinite(bruto) ? bruto : TAMANHO_TITULO.padrao;
  const dentro = Math.min(TAMANHO_TITULO.max, Math.max(TAMANHO_TITULO.min, n));
  return Math.round(dentro / TAMANHO_TITULO.passo) * TAMANHO_TITULO.passo;
}

/** Lê o JSON do banco garantindo valores válidos — galeria antiga cai no padrão. */
export function lerAparencia(bruto: unknown): Aparencia {
  const o = (bruto ?? {}) as Partial<Aparencia>;
  const valida = <T extends string>(v: unknown, opcoes: readonly T[], padrao: T): T =>
    opcoes.includes(v as T) ? (v as T) : padrao;

  const cores = lerCores(o.cores);
  return {
    capa: valida(o.capa, OPCOES.capa.map((x) => x.id), APARENCIA_PADRAO.capa),
    tema: valida(o.tema, OPCOES.tema.map((x) => x.id), APARENCIA_PADRAO.tema),
    tipografia: valida(o.tipografia, OPCOES.tipografia.map((x) => x.id), APARENCIA_PADRAO.tipografia),
    grade: valida(o.grade, OPCOES.grade.map((x) => x.id), APARENCIA_PADRAO.grade),
    densidade: valida(o.densidade, OPCOES.densidade.map((x) => x.id), APARENCIA_PADRAO.densidade),
    logo: valida(o.logo, OPCOES.logo.map((x) => x.id), APARENCIA_PADRAO.logo),
    peso: valida(o.peso, OPCOES.peso.map((x) => x.id), APARENCIA_PADRAO.peso),
    alturaCapa: valida(o.alturaCapa, OPCOES.alturaCapa.map((x) => x.id), APARENCIA_PADRAO.alturaCapa),
    canto: valida(o.canto, OPCOES.canto.map((x) => x.id), APARENCIA_PADRAO.canto),
    fonteTexto: valida(o.fonteTexto, OPCOES.fonteTexto.map((x) => x.id), APARENCIA_PADRAO.fonteTexto),
    alinhamento: valida(o.alinhamento, OPCOES.alinhamento.map((x) => x.id), APARENCIA_PADRAO.alinhamento),
    linhasTitulo: valida(o.linhasTitulo, OPCOES.linhasTitulo.map((x) => x.id), APARENCIA_PADRAO.linhasTitulo),
    /*
     * A barrinha é NÚMERO, e por isso não passa por `valida` — não há lista de
     * valores certos entre 60 e 180. Apara para dentro da faixa em vez de
     * recusar: um 400 gravado por engano vira 180, e não um título que some.
     *
     * O arredondamento para o passo é o que faz a barrinha voltar exatamente
     * onde a pessoa a soltou. Sem ele, um 103 gravado assentaria em 105 na tela
     * e a galeria continuaria em 103 — a prévia mentindo por dois por cento.
     */
    tamanhoTitulo: lerTamanhoTitulo(o.tamanhoTitulo),
    /*
     * O rótulo é TEXTO LIVRE, e por isso não passa por `valida` — não há lista
     * de valores certos para "aniversário de 15 anos". O que existe é um teto:
     * 40 caracteres é o que cabe numa sobrancelha sem virar parágrafo em cima
     * do nome do casal. Apara em vez de recusar, porque recusar apagaria o
     * rótulo inteiro por causa de um caractere a mais.
     *
     * O que NÃO é texto vira vazio, pela mesma regra de todo eixo.
     */
    rotulo: typeof o.rotulo === "string" ? o.rotulo.trim().slice(0, 40) : APARENCIA_PADRAO.rotulo,
    cartao: valida(o.cartao, OPCOES.cartao.map((x) => x.id), APARENCIA_PADRAO.cartao),
    /* Só entra quando sobrou alguma cor válida. Galeria sem cor própria não
       ganha um `cores: {}` — é o que mantém `presetEquivalente` e a comparação
       "sujo/publicado" do editor iguais ao que eram. */
    ...(cores ? { cores } : {}),
  };
}

/**
 * As cores próprias, ou nada.
 *
 * ── SEGURANÇA, E NÃO CAPRICHO ─────────────────────────────────────────────
 * Estes valores vão parar num `style` em linha, como variáveis CSS, na galeria
 * que o CLIENTE do fotógrafo abre. `"#fff; background:url(x)"` dentro de um
 * style é CSS injetado. Por isso a regra é a mais burra possível: seis
 * hexadecimais depois de `#`, e mais nada. Não se corrige, não se apara, não se
 * aceita `#fff` nem `rgb()` — o que não casar é descartado, como todo eixo de
 * `lerAparencia` descarta o que não está na lista.
 *
 * `<input type="color">` sempre emite `#rrggbb` minúsculo, então a regra não
 * custa nada para quem usa a tela; custa só para quem tenta passar por fora.
 */
const COR_HEX = /^#[0-9a-f]{6}$/;

function lerCores(bruto: unknown): CoresProprias | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const cores: CoresProprias = {};
  for (const chave of ["fundo", "texto", "destaque"] as const) {
    const v = o[chave];
    if (typeof v !== "string") continue;
    const t = v.toLowerCase();
    if (COR_HEX.test(t)) cores[chave] = t;
  }
  return Object.keys(cores).length ? cores : null;
}

/** Altura da capa em vh — a capa é medida contra a tela, não contra a foto. */
export const alturaCapaVh = (a: AlturaCapa): number =>
  OPCOES.alturaCapa.find((o) => o.id === a)?.vh ?? OPCOES.alturaCapa[2].vh;

/** Raio do canto das fotos, em pixels. Zero é canto vivo, e é uma escolha. */
export const raioDoCantoPx = (c: CantoFoto): number =>
  OPCOES.canto.find((o) => o.id === c)?.px ?? OPCOES.canto[1].px;

/**
 * Altura máxima da logo na capa, em pixels.
 *
 * Máxima, e não fixa: a largura acompanha (`w-auto`) e o `object-contain` cabe a
 * imagem dentro. Logo horizontal fina chega no teto de altura sem esticar; logo
 * quadrada usa o teto inteiro. Um número só serve para as duas porque quem
 * limita é a ALTURA, que é o que aperta contra o título logo abaixo.
 */
export const alturaLogoPx = (t: TamanhoLogo): number =>
  OPCOES.logo.find((o) => o.id === t)?.px ?? OPCOES.logo[1].px;

// --- eixos, com rótulos para a interface --------------------------------------

export const OPCOES = {
  capa: [
    { id: "imersa", nome: "Imersa", desc: "Foto em tela cheia com o título por cima" },
    { id: "jornal", nome: "Jornal", desc: "Fundo limpo, tipografia grande, botão de entrada" },
    { id: "dividida", nome: "Dividida", desc: "Foto de um lado, texto do outro" },
    { id: "minima", nome: "Mínima", desc: "Só tipografia, sem foto de capa" },
    { id: "convite", nome: "Convite", desc: "Foto emoldurada, título no pé e botão de entrada" },
    { id: "redonda", nome: "Redonda", desc: "Foto em círculo, título embaixo — a mais discreta" },
    { id: "arco", nome: "Arco", desc: "Foto com topo arredondado e base reta, título embaixo" },
  ],
  tema: [
    { id: "noite", nome: "Noite", desc: "Fundo escuro — as fotos brilham" },
    { id: "claro", nome: "Claro", desc: "Fundo branco, ar de revista" },
    { id: "creme", nome: "Creme", desc: "Tons terrosos, clima quente" },
  ],
  /*
   * ── DE CATEGORIA PARA FONTE (26/08/2026) ────────────────────────────────
   * Antes eram três categorias — "Serifada", "Moderna", "Manuscrita" — e o
   * fotógrafo não escolhia a fonte, escolhia um adjetivo. Agora a lista tem
   * nome de fonte, agrupada por família para continuar navegável.
   *
   * Os três ids ORIGINAIS ficam, apontando para as mesmas fontes de sempre.
   * Eles estão gravados em galerias já ENTREGUES: mudar o que `serifada`
   * significa trocaria a cara da galeria de um casal sem ninguém tocar nela.
   * `scripts/testar-aparencia.mjs` prende isso.
   */
  tipografia: [
    { id: "serifada", nome: "Cormorant", desc: "Serifada · clássica e fina", familia: "Serifadas" },
    { id: "playfair", nome: "Playfair", desc: "Serifada · contraste alto", familia: "Serifadas" },
    { id: "lora", nome: "Lora", desc: "Serifada · encorpada, boa em texto", familia: "Serifadas" },
    { id: "moderna", nome: "Montserrat", desc: "Sem serifa · geométrica", familia: "Sem serifa" },
    { id: "jost", nome: "Jost", desc: "Sem serifa · seca e moderna", familia: "Sem serifa" },
    { id: "raleway", nome: "Raleway", desc: "Sem serifa · leve e arejada", familia: "Sem serifa" },
    { id: "manuscrita", nome: "Great Vibes", desc: "Manuscrita · assinatura", familia: "Manuscritas" },
    { id: "parisienne", nome: "Parisienne", desc: "Manuscrita · convite", familia: "Manuscritas" },
    { id: "petit", nome: "Petit Formal", desc: "Manuscrita · formal e legível", familia: "Manuscritas" },
    { id: "garamond", nome: "EB Garamond", desc: "Serifada · quente e clássica", familia: "Serifadas" },
    { id: "baskerville", nome: "Baskerville", desc: "Serifada · editorial, muito legível", familia: "Serifadas" },
    { id: "bodoni", nome: "Bodoni", desc: "Serifada · contraste extremo, ar de moda", familia: "Serifadas" },
    { id: "josefin", nome: "Josefin Sans", desc: "Sem serifa · art déco, delicada", familia: "Sem serifa" },
    { id: "work", nome: "Work Sans", desc: "Sem serifa · neutra e sólida", familia: "Sem serifa" },
    { id: "outfit", nome: "Outfit", desc: "Sem serifa · geométrica e atual", familia: "Sem serifa" },
    { id: "dancing", nome: "Dancing Script", desc: "Manuscrita · solta e alegre", familia: "Manuscritas" },
    { id: "sacramento", nome: "Sacramento", desc: "Manuscrita · fina e discreta", familia: "Manuscritas" },
    { id: "italianno", nome: "Italianno", desc: "Manuscrita · caligrafia de convite", familia: "Manuscritas" },
    /* MAIÚSCULAS é família nova: a tipografia que o fotógrafo reconhece do papel
     * do convite, e que não cabia em nenhuma das três anteriores. */
    { id: "cinzel", nome: "Cinzel", desc: "Maiúsculas · romana, de convite", familia: "Maiúsculas" },
    { id: "marcellus", nome: "Marcellus", desc: "Maiúsculas · clássica e serena", familia: "Maiúsculas" },
    { id: "tenor", nome: "Tenor Sans", desc: "Maiúsculas · limpa e espaçada", familia: "Maiúsculas" },
    /* Só aparece para quem enviou uma fonte — o editor filtra pela família. Fica
     * na lista mesmo assim porque  precisa aceitá-la ao ler uma
     * galeria já gravada, inclusive depois de a fonte ter sido removida. */
    { id: "propria", nome: "A minha fonte", desc: "O arquivo que você enviou em Conta", familia: "Sua fonte" },
  ],
  grade: [
    { id: "colunas", nome: "Colunas", desc: "Alturas variadas, estilo mural" },
    { id: "linhas", nome: "Linhas", desc: "Fileiras alinhadas, sem cortar foto" },
    { id: "quadrada", nome: "Quadrada", desc: "Tudo no mesmo tamanho" },
    { id: "editorial", nome: "Editorial", desc: "Destaques maiores intercalados" },
    /* Pedido do sócio em 04/09/2026: "um modo em que a foto horizontal seja
       mais valorizada". A regra é a própria foto, não a posição dela na fila —
       ao contrário do editorial, que promove uma a cada cinco sem olhar. */
    { id: "panorama", nome: "Panorama", desc: "Fotos deitadas ocupam o dobro da largura" },
  ],
  densidade: [
    { id: "compacta", nome: "Compacta", desc: "Mais fotos por tela" },
    { id: "normal", nome: "Normal", desc: "Equilibrada" },
    { id: "arejada", nome: "Arejada", desc: "Espaço para respirar" },
  ],
  /*
   * O `px` é a altura MÁXIMA na capa, e é a fonte única desse número: o
   * componente lê daqui em vez de trazer a própria tabela. `testar-aparencia`
   * confere que a escada sobe e que a capa não tem altura escrita à mão.
   *
   * O teto é 200 px porque acima disso a logo passa a disputar a tela com o
   * título do casal na capa imersa — deixa de ser marca e vira cabeçalho.
   */
  logo: [
    { id: "discreta", nome: "Discreta", desc: "Assinatura no canto", px: 56 },
    { id: "media", nome: "Média", desc: "Marca visível, sem roubar o título", px: 88 },
    { id: "grande", nome: "Grande", desc: "A marca conduz a capa", px: 136 },
    { id: "enorme", nome: "Enorme", desc: "Logo em primeiro plano", px: 200 },
  ],
  /* Os rótulos falam do RESULTADO, não do número: ninguém escolhe "400". E o
     aviso da terceira é honesto — em manuscrita ela de fato não muda nada, e
     dizer isso aqui evita a pessoa clicar três vezes achando que quebrou. */
  peso: [
    { id: "leve", nome: "Fina", desc: "Traço delicado, ar de convite" },
    { id: "normal", nome: "Normal", desc: "O peso natural da fonte" },
    { id: "forte", nome: "Forte", desc: "Título encorpado — sem efeito nas manuscritas" },
  ],
  /* Em vh: a capa é medida contra a TELA, não contra a foto. É o que faz a
     escolha significar a mesma coisa num notebook e num celular. */
  alturaCapa: [
    { id: "baixa", nome: "Baixa", desc: "Uma faixa — a galeria começa logo", vh: 42 },
    { id: "media", nome: "Média", desc: "Metade da tela", vh: 60 },
    { id: "cheia", nome: "Cheia", desc: "Quase a tela inteira", vh: 78 },
  ],
  canto: [
    { id: "reto", nome: "Reto", desc: "Canto vivo, ar de impresso", px: 0 },
    { id: "suave", nome: "Suave", desc: "Só tira a ponta", px: 6 },
    { id: "redondo", nome: "Redondo", desc: "Arredondado de verdade", px: 14 },
    { id: "muito", nome: "Bem redondo", desc: "Cantos macios, ar de aplicativo", px: 24 },
  ],
  cartao: [
    { id: "sobreposto", nome: "Com o nome", desc: "A capa com o título e o estúdio por cima" },
    { id: "foto", nome: "Só a foto", desc: "A capa limpa — o WhatsApp já escreve o nome ao lado" },
  ],
  fonteTexto: [
    { id: "padrao", nome: "A do sistema", desc: "Sem serifa, feita para ler em tela" },
    { id: "propria", nome: "A minha fonte", desc: "O arquivo que você enviou em Conta" },
  ],
  /* "Automático" primeiro porque é o padrão, e os números depois em ordem: a
     lista se lê como uma frase — quebra sozinho, ou em 1, 2, 3. O texto de
     ajuda de cada um fala do RESULTADO na capa, não do mecanismo. */
  linhasTitulo: [
    { id: "auto", nome: "Automático", desc: "Quebra onde couber" },
    { id: "uma", nome: "1 linha", desc: "O nome inteiro numa linha só" },
    { id: "duas", nome: "2 linhas", desc: "Parte no meio, em duas linhas" },
    { id: "tres", nome: "3 linhas", desc: "Em três linhas, uma sobre a outra" },
  ],
  alinhamento: [
    { id: "centro", nome: "Centralizado", desc: "Tudo no eixo do meio" },
    { id: "esquerda", nome: "À esquerda", desc: "Tudo encostado na mesma linha" },
  ],
} as const;

// --- presets ------------------------------------------------------------------

export interface Preset {
  id: string;
  nome: string;
  desc: string;
  aparencia: Aparencia;
}

/*
 * OS NOVE PRESETS USAM A MESMA ALTURA DE CAPA E O MESMO CANTO — de propósito.
 *
 * Os dois eixos nasceram em 04/09/2026 com o valor que o componente já cravava
 * (78vh e 6 px). Quem já tem galeria no ar cai nesse mesmo par por
 * `lerAparencia`, e é `presetEquivalente` que decide qual card aparece
 * marcado: um preset que escolhesse `reto` ou `baixa` desmarcaria o card de
 * toda galeria antiga que usava aquele preset, sem que ninguém tivesse mexido
 * em nada.
 *
 * Quando o par deixar de ser novidade — digamos, quando a maioria das galerias
 * já tiver escolha própria gravada —, dá para dar a cada preset o canto que
 * combina com ele (Moda com `reto`, Papel com `redondo`) sem esse efeito.
 */
export const PRESETS: Preset[] = [
  {
    /* O estilo da casa. O id NAO e gravado no banco — `galerias.aparencia`
     * guarda os cinco eixos, e `presetEquivalente` deduz o preset a partir
     * deles. Por isso renomear aqui nao orfana galeria nenhuma. */
    id: "atomo",
    nome: "Átomo",
    desc: "Escura e cinematográfica. A foto é a única fonte de luz.",
    aparencia: { capa: "imersa", tema: "noite", tipografia: "serifada", grade: "editorial", densidade: "normal", logo: "media", peso: "normal", alturaCapa: "cheia", canto: "suave", fonteTexto: "padrao", alinhamento: "centro", cartao: "sobreposto", rotulo: "", linhasTitulo: "auto", tamanhoTitulo: 100 },
  },
  {
    id: "revista",
    nome: "Revista",
    desc: "Fundo claro, tipografia grande, mural de colunas.",
    aparencia: { capa: "jornal", tema: "claro", tipografia: "serifada", grade: "colunas", densidade: "normal", logo: "media", peso: "forte", alturaCapa: "cheia", canto: "suave", fonteTexto: "padrao", alinhamento: "centro", cartao: "sobreposto", rotulo: "", linhasTitulo: "auto", tamanhoTitulo: 100 },
  },
  {
    id: "atelie",
    nome: "Ateliê",
    desc: "Tons terrosos e manuscrita. Clima de convite de casamento.",
    aparencia: { capa: "dividida", tema: "creme", tipografia: "manuscrita", grade: "linhas", densidade: "arejada", logo: "media", peso: "normal", alturaCapa: "cheia", canto: "suave", fonteTexto: "padrao", alinhamento: "centro", cartao: "sobreposto", rotulo: "", linhasTitulo: "auto", tamanhoTitulo: 100 },
  },
  {
    id: "essencial",
    nome: "Essencial",
    desc: "Sem firula: entra direto nas fotos, tudo do mesmo tamanho.",
    aparencia: { capa: "minima", tema: "claro", tipografia: "moderna", grade: "quadrada", densidade: "compacta", logo: "media", peso: "normal", alturaCapa: "cheia", canto: "suave", fonteTexto: "padrao", alinhamento: "centro", cartao: "sobreposto", rotulo: "", linhasTitulo: "auto", tamanhoTitulo: 100 },
  },
  {
    /*
     * Pedido da Carol em 31/08/2026, a partir de uma galeria de casamento que
     * ela viu no Pixieset. As peças que fazem aquela cara, e por quê:
     *
     *   capa convite  — foto emoldurada, título e botão no pé
     *   tema claro    — papel branco; o destaque vira o preto do botão
     *   Bodoni        — serifada de contraste extremo, a letra de convite
     *   grade linhas  — fileiras alinhadas, sem cortar foto
     *   compacta      — as fotos quase se encostando, como um contato impresso
     *   logo discreta — a marca assina no alto, não disputa com o título
     */
    id: "convite",
    nome: "Convite",
    desc: "Papel branco, serifada de convite e fotos coladas. A capa chama para entrar.",
    aparencia: { capa: "convite", tema: "claro", tipografia: "bodoni", grade: "linhas", densidade: "compacta", logo: "discreta", peso: "leve", alturaCapa: "cheia", canto: "suave", fonteTexto: "padrao", alinhamento: "centro", cartao: "sobreposto", rotulo: "", linhasTitulo: "auto", tamanhoTitulo: 100 },
  },
  /*
   * ── A SEGUNDA LEVA (27/08/2026) ─────────────────────────────────────────
   *
   * Quatro presets eram pouco para o que eles fazem: preset é o atalho de quem
   * NÃO quer abrir o ajuste fino, e com quatro a chance de nenhum servir é alta
   * — aí a pessoa abre os cinco eixos e monta na mão, que é exatamente o
   * trabalho que o preset existe para poupar.
   *
   * Os quatro novos não são variações de cor dos antigos: cada um combina capa,
   * grade e densidade diferentes, e usa a família de fonte que os primeiros não
   * alcançavam. Preset que muda só o tema seria uma quinta pastilha sem quinta
   * decisão.
   */
  {
    /* Nasceu como um segundo "Convite", nome e id iguais aos do preset de
     * 31/08/2026. Duas pastilhas com o mesmo nome e resultados diferentes: a
     * pessoa clicava numa e a outra continuava apagada. O id não vai para o
     * banco (ver o comentário do preset Átomo), então renomear é seguro. */
    id: "caligrafia",
    nome: "Caligrafia",
    desc: "Caligrafia sobre creme, fotos em fileiras. Clima de papel timbrado.",
    aparencia: { capa: "dividida", tema: "creme", tipografia: "italianno", grade: "linhas", densidade: "arejada", logo: "media", peso: "normal", alturaCapa: "cheia", canto: "suave", fonteTexto: "padrao", alinhamento: "centro", cartao: "sobreposto", rotulo: "", linhasTitulo: "auto", tamanhoTitulo: 100 },
  },
  {
    id: "moda",
    nome: "Moda",
    desc: "Contraste alto e destaques grandes, como editorial de revista.",
    aparencia: { capa: "jornal", tema: "claro", tipografia: "bodoni", grade: "editorial", densidade: "normal", logo: "media", peso: "forte", alturaCapa: "cheia", canto: "suave", fonteTexto: "padrao", alinhamento: "centro", cartao: "sobreposto", rotulo: "", linhasTitulo: "auto", tamanhoTitulo: 100 },
  },
  {
    id: "cerimonia",
    nome: "Cerimônia",
    desc: "Maiúsculas romanas sobre fundo escuro. Solene, sem ser pesada.",
    aparencia: { capa: "imersa", tema: "noite", tipografia: "cinzel", grade: "colunas", densidade: "normal", logo: "media", peso: "normal", alturaCapa: "cheia", canto: "suave", fonteTexto: "padrao", alinhamento: "centro", cartao: "sobreposto", rotulo: "", linhasTitulo: "auto", tamanhoTitulo: 100 },
  },
  {
    id: "papel",
    nome: "Papel",
    desc: "Branco, ar déco e muito espaço. As fotos respiram.",
    aparencia: { capa: "minima", tema: "claro", tipografia: "josefin", grade: "colunas", densidade: "arejada", logo: "media", peso: "leve", alturaCapa: "cheia", canto: "suave", fonteTexto: "padrao", alinhamento: "centro", cartao: "sobreposto", rotulo: "", linhasTitulo: "auto", tamanhoTitulo: 100 },
  },
];

export const presetPorId = (id: string) => PRESETS.find((p) => p.id === id);

/** Qual preset corresponde à aparência atual (para marcar o card selecionado). */
/*
 * TODOS os eixos entram na comparação, `logo` inclusive.
 *
 * Ele ficou de fora quando nasceu, e o efeito era o editor marcar "Convite"
 * numa galeria em que a pessoa tinha aumentado a logo — dizendo que ela estava
 * num preset em que não estava. Marcação que mente é pior que marcação nenhuma:
 * quem confia nela deixa de olhar o resto.
 *
 * Com o eixo dentro, quem mexeu num detalhe vê "personalizado", que é a
 * verdade — e o editor abre o ajuste fino sozinho nesse caso, para a escolha
 * atual continuar visível em vez de virar oito botões apagados.
 */
export function presetEquivalente(a: Aparencia): string | null {
  /* Cor própria tira a galeria de qualquer preset: "no ar: Átomo" com o botão
     rosa seria a tela descrevendo uma galeria que não existe. */
  if (a.cores && Object.keys(a.cores).length > 0) return null;
  const igual = (x: Aparencia, y: Aparencia) =>
    x.capa === y.capa && x.tema === y.tema && x.tipografia === y.tipografia &&
    x.grade === y.grade && x.densidade === y.densidade && x.logo === y.logo &&
    x.peso === y.peso && x.alturaCapa === y.alturaCapa && x.canto === y.canto && x.fonteTexto === y.fonteTexto && x.alinhamento === y.alinhamento && x.rotulo === y.rotulo && x.cartao === y.cartao &&
    x.linhasTitulo === y.linhasTitulo && x.tamanhoTitulo === y.tamanhoTitulo;
  return PRESETS.find((p) => igual(p.aparencia, a))?.id ?? null;
}

// --- tradução para CSS --------------------------------------------------------

/** Cada tema é um conjunto de variáveis; os componentes leem sempre as mesmas. */
export const TEMAS: Record<Tema, Record<string, string>> = {
  /*
   * NOITE — a sala de projeção, mesma paleta do painel.
   *
   * Preto azulado de propósito: num fundo quente, pele de retrato fica lavada,
   * porque fundo e pele disputam a mesma faixa de cor. Frio, a foto salta.
   * O destaque é âmbar e aparece só em ação (botão, coração marcado).
   */
  noite: {
    "--g-fundo": "#07080b",
    "--g-superficie": "#101319",
    "--g-texto": "#eef1f6",
    "--g-suave": "#a4adbd",
    "--g-tenue": "#6b7484",
    "--g-linha": "rgba(190,205,230,.16)",
    "--g-destaque": "#d9a441",
    "--g-sobre-destaque": "#0a0906",
  },
  claro: {
    "--g-fundo": "#ffffff",
    "--g-superficie": "#f6f4ef",
    "--g-texto": "#211d16",
    "--g-suave": "#5d574b",
    "--g-tenue": "#938b7c",
    "--g-linha": "rgba(33,29,22,.14)",
    "--g-destaque": "#211d16",
    "--g-sobre-destaque": "#ffffff",
  },
  creme: {
    "--g-fundo": "#f7f1e6",
    "--g-superficie": "#ede2cd",
    "--g-texto": "#43382a",
    "--g-suave": "#77694f",
    "--g-tenue": "#a3947c",
    "--g-linha": "rgba(67,56,42,.16)",
    "--g-destaque": "#8c6f3f",
    "--g-sobre-destaque": "#f9f4ea",
  },
};

// --- cores próprias por cima do tema ------------------------------------------

/*
 * Aritmética de cor em hexadecimal puro, sem `color-mix()`.
 *
 * Poderia ser CSS: `color-mix(in srgb, var(--g-fundo) 94%, var(--g-texto))`
 * faria a superfície sozinho no navegador. Não é, por dois motivos. O primeiro
 * é medir: `testar-cores-galeria.mjs` confere o contraste do texto sobre o botão
 * contra um piso, e não dá para medir contraste de uma expressão que só o
 * navegador resolve. O segundo é o e-mail: a capa da galeria vai num cartão
 * para o WhatsApp e num e-mail, e cliente de e-mail não conhece color-mix.
 * Número concreto serve nos dois lugares; expressão serve num só.
 */
const hexParaRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const rgbParaHex = (r: number, g: number, b: number): string =>
  "#" + [r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("");

/** `t` de `a`: 0 devolve `a`, 1 devolve `b`. */
function misturar(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexParaRgb(a);
  const [r2, g2, b2] = hexParaRgb(b);
  return rgbParaHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** Luminância relativa (WCAG 2), a mesma conta de `lib/marca-estudio.ts`. */
function luminancia(hex: string): number {
  const [r, g, b] = hexParaRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * As variáveis CSS da galeria: o tema, com as cores próprias por cima.
 *
 * Sem `cores`, devolve EXATAMENTE `TEMAS[tema]` — toda galeria de antes de
 * 05/09/2026 continua idêntica ao pixel. Com cores, as três escolhidas entram
 * no lugar das do tema, e as derivadas são refeitas a partir delas:
 *
 *   superfície  fundo puxado 6% para o texto — o cartão que "sobe" do fundo
 *   suave       texto puxado 25% para o fundo — o secundário, ainda ≥ 4,5:1
 *   tênue       texto puxado 40% para o fundo — rótulo miúdo, ≥ 3:1
 *
 * Os dois números foram medidos, não escolhidos: a 30% o suave caía a 4,34:1
 * no par creme (fundo #f7f1e6, texto #43382a), abaixo do piso; a 25% o pior
 * par dá 5,00:1. A 50% o tênue caía a 2,64:1; a 40% dá 3,37:1 — melhor que os
 * 2,64:1 do tênue do próprio tema creme, feito à mão.
 *   linha       o texto a 16% de opacidade — divisória que não grita
 *   sobre-destaque  preto ou branco, o que contrastar mais com o botão
 *
 * A única promessa medida é a última: o texto do botão passa de 4,5:1 para
 * QUALQUER cor de botão — cinza médio é o pior caso e ainda passa. Fundo e
 * texto são escolha da pessoa; se ela pôr cinza sobre cinza, a galeria vai
 * ficar cinza sobre cinza, e a prévia vai mostrar isso antes de publicar.
 */
/**
 * As duas medidas de FORMA da galeria, como variáveis de CSS.
 *
 * Elas saem daqui em vez de virarem classe do Tailwind por um motivo simples:
 * o Tailwind gera as classes lendo o código-fonte, e `min-h-[78vh]` só existe
 * porque está escrito assim em algum arquivo. Uma altura escolhida em tempo de
 * execução nunca teria classe gerada. Com variável, a classe é uma só —
 * `min-h-[var(--g-capa-h)]` — e o VALOR muda por galeria.
 *
 * A segunda razão é o `md:`. As capas convite e dividida mudam de altura no
 * breakpoint; `style` inline não tem breakpoint, variável tem — a classe
 * continua sendo `md:` e só o número vem daqui.
 *
 * Ficam separadas de `variaveisDoTema` porque tema é COR: aquela função
 * promete contraste medido, e um vh no meio dela não teria o que provar.
 */
export function variaveisDeForma(a: Aparencia): Record<string, string> {
  return {
    "--g-capa-h": `${alturaCapaVh(a.alturaCapa)}vh`,
    "--g-canto": `${raioDoCantoPx(a.canto)}px`,
  };
}

export function variaveisDoTema(a: Aparencia): Record<string, string> {
  const base = TEMAS[a.tema];
  const c = a.cores;
  if (!c || Object.keys(c).length === 0) return base;

  const fundo = c.fundo ?? base["--g-fundo"];
  const texto = c.texto ?? base["--g-texto"];
  const destaque = c.destaque ?? base["--g-destaque"];
  const [tr, tg, tb] = hexParaRgb(texto);

  /* Preto ou branco: o que der mais contraste. `contraste()` de marca-estudio
     é (L1+0,05)/(L2+0,05); aqui basta comparar as duas luminâncias contra a do
     botão, que é a mesma decisão sem importar o módulo do servidor. */
  const L = luminancia(destaque);
  const sobreDestaque = (1.05) / (L + 0.05) >= (L + 0.05) / 0.05 ? "#ffffff" : "#000000";

  return {
    "--g-fundo": fundo,
    "--g-superficie": misturar(fundo, texto, 0.06),
    "--g-texto": texto,
    "--g-suave": misturar(texto, fundo, 0.25),
    "--g-tenue": misturar(texto, fundo, 0.4),
    "--g-linha": `rgba(${tr},${tg},${tb},.16)`,
    "--g-destaque": destaque,
    "--g-sobre-destaque": sobreDestaque,
  };
}

/**
 * Aponta para as variáveis que o next/font define no <body> — e NÃO para os
 * tokens do Tailwind (--font-serif e afins). O `@theme inline` embute os valores
 * nas classes utilitárias em vez de publicar a variável no :root, então
 * `var(--font-serif)` não existe em tempo de execução e o título cairia na fonte
 * padrão do sistema.
 */
/*
 * Cada fonte com uma PILHA de reserva de verdade, não só o nome.
 *
 * Se o woff2 não chegar — rede ruim no celular do convidado, bloqueador —, o
 * título cai no reserva. Um reserva da mesma família mantém a página parecida
 * com o que o fotógrafo escolheu; sem ele, cai em Times e a entrega inteira
 * muda de tom no pior momento possível.
 *
 * As três primeiras variáveis são as antigas (`serif-app`, `sans-app`,
 * `script-app`) e não podem ser renomeadas: os ids que as usam estão gravados
 * em galerias entregues.
 */
/**
 * A família do CORPO da galeria.
 *
 * `padrao` repete o que o <body> já aplica (ver globals.css) em vez de deixar
 * o campo vazio: quem lê este arquivo vê as duas opções escritas lado a lado, e
 * a página não precisa de um `if` para o caso de não haver escolha.
 *
 * Em `propria` a família do estúdio vem PRIMEIRO e a do sistema logo atrás.
 * Não é redundância: o @font-face só entra no HTML quando o arquivo existe, e
 * sem ele o navegador cai na segunda — que é o comportamento certo para quem
 * removeu a fonte depois de escolhê-la.
 */
export const FONTES_TEXTO: Record<FonteDoTexto, string> = {
  padrao: 'var(--font-sans-app), system-ui, "Segoe UI", sans-serif',
  propria: '"FonteDoEstudio", var(--font-sans-app), system-ui, "Segoe UI", sans-serif',
};

export const FONTES_TITULO: Record<Tipografia, string> = {
  /* Não é uma fonte nossa: o nome da família é declarado pelo @font-face que a
     galeria injeta quando o estúdio tem arquivo enviado. Sem esse @font-face
     (fonte removida, ou estúdio que nunca enviou), o navegador cai na serifada
     do fim da lista — que é o comportamento certo, e não um erro a tratar. */
  propria: '"FonteDoEstudio", var(--font-serif-app), Georgia, serif',
  serifada: 'var(--font-serif-app), "Iowan Old Style", Palatino, Georgia, serif',
  playfair: 'var(--font-titulo-playfair), "Times New Roman", Georgia, serif',
  lora: 'var(--font-titulo-lora), Georgia, "Times New Roman", serif',
  moderna: 'var(--font-sans-app), system-ui, "Segoe UI", sans-serif',
  jost: 'var(--font-titulo-jost), "Futura", "Century Gothic", system-ui, sans-serif',
  raleway: 'var(--font-titulo-raleway), "Segoe UI", system-ui, sans-serif',
  manuscrita: 'var(--font-script-app), "Segoe Script", cursive',
  parisienne: 'var(--font-titulo-parisienne), "Segoe Script", cursive',
  petit: 'var(--font-titulo-petit), "Segoe Script", cursive',
  garamond: 'var(--font-titulo-garamond), Garamond, Georgia, serif',
  baskerville: 'var(--font-titulo-baskerville), Baskerville, Georgia, serif',
  bodoni: 'var(--font-titulo-bodoni), "Bodoni MT", Didot, Georgia, serif',
  josefin: 'var(--font-titulo-josefin), "Century Gothic", system-ui, sans-serif',
  work: 'var(--font-titulo-work), "Segoe UI", system-ui, sans-serif',
  outfit: 'var(--font-titulo-outfit), "Segoe UI", system-ui, sans-serif',
  dancing: 'var(--font-titulo-dancing), "Segoe Script", cursive',
  sacramento: 'var(--font-titulo-sacramento), "Segoe Script", cursive',
  italianno: 'var(--font-titulo-italianno), "Segoe Script", cursive',
  cinzel: 'var(--font-titulo-cinzel), "Trajan Pro", Georgia, serif',
  marcellus: 'var(--font-titulo-marcellus), Georgia, serif',
  tenor: 'var(--font-titulo-tenor), "Optima", "Segoe UI", sans-serif',
};

/** Espaçamento entre as fotos e quantas cabem por linha. */
/*
 * O respiro entre as fotos, em PIXELS.
 *
 * Era `"0.25rem"` — texto, direto para o CSS. Virou número em 04/09/2026 porque
 * o mural passou a MEDIR a largura para decidir quantas colunas cabem, e essa
 * conta precisa do espaçamento em pixels. Manter os dois formatos (o texto para
 * o CSS, o número para a conta) seria manter duas verdades sobre o mesmo
 * espaço, e a que ninguém olha é a que envelhece errada. O CSS monta o texto a
 * partir do número.
 *
 * Os valores são os mesmos de antes: 0,25rem = 4px, 0,5rem = 8px, 1,25rem =
 * 20px, com a raiz em 16px. Nenhuma galeria muda de aparência.
 */
/*
 * ── PISO E TETO DE COLUNAS (05/09/2026) ──────────────────────────────────
 *
 * Juan: "achei ruim a visualização no celular só ficar boa quando está em
 * 'compacta'. No pc fica MUITA informação e no celular fica só uma foto por
 * vez."
 *
 * A grade escolhia as colunas por uma largura-alvo por foto, e só. A conta
 * explica as duas queixas de uma vez. Num iPhone sobram ~366 px de largura
 * útil:
 *
 *   compacta  (366+4)  / (170+4)  = 2 colunas
 *   normal    (366+8)  / (230+8)  = 1 coluna
 *   arejada   (366+20) / (320+20) = 1 coluna
 *
 * Num notebook de 1280 sobram ~1232, e a compacta dá SETE colunas.
 *
 * Uma largura-alvo só não serve para as duas pontas da tela. O piso salva o
 * celular, o teto salva o monitor, e a largura-alvo continua mandando no meio —
 * que é a faixa em que ela acerta. `colunasDaGrade` faz a conta;
 * `testar-grade-mural.mjs` prende os dois extremos.
 *
 * O campo `colunas` que morava aqui não era lido por ninguém desde que a grade
 * passou a medir a largura de verdade. Saiu.
 */
export const DENSIDADES: Record<
  Densidade,
  { gapPx: number; minColunas: number; maxColunas: number }
> = {
  compacta: { gapPx: 4, minColunas: 3, maxColunas: 6 },
  normal: { gapPx: 8, minColunas: 2, maxColunas: 5 },
  arejada: { gapPx: 20, minColunas: 2, maxColunas: 4 },
};

/**
 * Largura-alvo de cada foto, por densidade. Menor = mais fotos por tela.
 *
 * Mora aqui, e não no componente, porque anda de mãos dadas com o piso e o teto
 * acima: mexer num sem olhar o outro é como o celular acabou com uma foto por
 * vez. Juntos, dá para ler a densidade inteira de um lugar só.
 */
export const LARGURA_DA_FOTO: Record<Densidade, number> = {
  compacta: 170,
  normal: 230,
  arejada: 320,
};

/**
 * ── AS CARTELAS PRONTAS (05/09/2026) ──────────────────────────────────────
 *
 * Juan: "adorei isso das cores, mas podemos deixar ainda melhor fazendo
 * sugestões de cores mais direcionadas. Essas principais cores que aparecem são
 * difíceis de encaixar. Talvez alguma cartela de cores diferentes?"
 *
 * O que ele viu foi a cartela do SISTEMA: o `<input type="color">` abre o
 * seletor do macOS, com vermelho, verde e azul puros e um degradê de 12
 * colunas. São cores de interface. Nenhuma delas encaixa numa galeria de
 * casamento, e achar o tom certo ali é um trabalho de designer feito com o
 * mouse.
 *
 * ── O QUE UMA PALETA É, E O QUE ELA NÃO É ─────────────────────────────────
 *
 * Ela escolhe as TRÊS cores juntas, e é aí que está o valor: o problema do Juan
 * não era achar um verde, era achar um verde que combinasse com o fundo e com o
 * texto. Escolhida a cartela, os três seletores continuam ali — a paleta é um
 * ponto de partida bom, não uma gaiola.
 *
 * Não substitui os TEMAS. Tema é a base de quem não quer escolher cor nenhuma;
 * paleta é para quem quer, e grava em `cores` como qualquer escolha manual.
 *
 * ── A REGRA QUE ELAS TÊM DE CUMPRIR ───────────────────────────────────────
 *
 * Texto sobre fundo ≥ 4,5:1, o piso do WCAG AA para texto corrido, medido em
 * `testar-cores-galeria.mjs`. Paleta bonita e ilegível é pior que cartela ruim,
 * porque a pessoa confia nela — e quem paga o preço é o convidado lendo o nome
 * do casal no celular, no sol.
 *
 * Metade clara, metade escura, também medido: uma cartela em que tudo é bege
 * não é cartela, é um bege com variações.
 */
export interface Paleta {
  id: string;
  nome: string;
  cores: Required<CoresProprias>;
}

export const PALETAS: Paleta[] = [
  // — claras —
  { id: "areia", nome: "Areia", cores: { fundo: "#f6f1ea", texto: "#3a332b", destaque: "#b08968" } },
  { id: "oliva", nome: "Oliva", cores: { fundo: "#f4f5ef", texto: "#2f3327", destaque: "#5d6d42" } },
  { id: "terracota", nome: "Terracota", cores: { fundo: "#fbf5f1", texto: "#40312b", destaque: "#b45733" } },
  { id: "marinho", nome: "Marinho", cores: { fundo: "#f5f7fa", texto: "#1e2a3a", destaque: "#2f5d8c" } },
  { id: "rose", nome: "Rosé", cores: { fundo: "#faf3f3", texto: "#3d2f31", destaque: "#a45965" } },
  { id: "bruma", nome: "Bruma", cores: { fundo: "#eef0f1", texto: "#2b3033", destaque: "#5c7076" } },
  // — escuras —
  { id: "carvao", nome: "Carvão", cores: { fundo: "#101113", texto: "#ece9e4", destaque: "#cbb08a" } },
  { id: "mata", nome: "Verde-mata", cores: { fundo: "#0f1512", texto: "#e8ece7", destaque: "#7f9c6d" } },
  { id: "vinho", nome: "Vinho", cores: { fundo: "#14100f", texto: "#efe7e2", destaque: "#a35b5b" } },
  { id: "dourado", nome: "Dourado", cores: { fundo: "#12100c", texto: "#f0eade", destaque: "#c9a227" } },
];
