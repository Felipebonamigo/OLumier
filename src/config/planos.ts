/**
 * PLANOS — um quebra-cabeça de três peças, não uma lista fixa.
 *
 * O fotógrafo monta o dele:
 *   1. tipo de trabalho  — foto, filme ou os dois
 *   2. tamanho da galeria — o espaço que fica NO AR para o cliente baixar
 *   3. cofre (opcional)   — o arquivo do que já saiu do ar
 *
 * Por que deixou de ser lista fixa: seis pacotes prontos obrigam a pagar por
 * espaço que não se usa (quem faz ensaio não precisa de 1 TB) ou a estourar o
 * único tamanho que servia. Peça avulsa vende melhor e explica melhor.
 *
 * ── A REGRA QUE SUSTENTA O DISCURSO ───────────────────────────────────────
 * O tipo de trabalho NÃO muda o preço. Vídeo aqui é só espaço.
 * O Pixieset cobra vídeo por HORA (US$ 5/mês por hora extra) e só entrega HD;
 * é o buraco de mercado que nos abre espaço, e a home promete isso em voz alta.
 * `scripts/testar-planos.mjs` prende essa promessa: qualquer adicional por
 * segmento deixa a suíte vermelha antes de a mentira ir pro ar.
 *
 * ── PREÇOS (revisão de 24/08/2026) ────────────────────────────────────────
 * A grade de foto anterior perdia feio para o Pixieset Pro — R$ 132/mês por
 * 1 TB no anual (US$ 24, verificado na página deles), contra R$ 179 nossos por
 * 500 GB. Fotógrafo que comparasse lado a lado escolhia eles.
 * Foi corrigido descendo o preço do espaço no ar, contando com a rota barata:
 * acima de 500 GB, servir pelo B2 com Cloudflare na frente, R$ 0,033/GB em vez
 * dos R$ 0,0825/GB do R2 — mesma promessa de download ilimitado por 40% do custo.
 *
 * ⚠️  Essa rota AINDA NÃO FOI CONSTRUÍDA (ver `ROTA_EM_PRODUCAO` abaixo). A
 * grade aposta que a obra sai antes de o primeiro cliente grande encher o
 * espaço; enquanto isso, montagem que não cobre o custo atual retém 100% do
 * dinheiro no split — nada é distribuído abaixo do custo.
 */

export type Segmento = "foto" | "filme" | "ambos";

/** Peça 1 — o que a galeria aceita. Não altera o preço, só liga recurso. */
export const SEGMENTOS: { id: Segmento; nome: string; descricao: string }[] = [
  { id: "foto", nome: "Foto", descricao: "Galerias de fotos com download em alta." },
  { id: "filme", nome: "Filme", descricao: "Player 4K com streaming, sem limite de horas." },
  { id: "ambos", nome: "Foto e filme", descricao: "Os dois na mesma galeria, pelo mesmo preço." },
];

export interface Faixa {
  gb: number;
  precoCentavos: number;
}

/**
 * Peça 2 — espaço NO AR. É a única peça obrigatória.
 *
 * Custo ALVO por GB/mês (primário + espelho): R$ 0,1155 até 500 GB (R2 +
 * espelho B2) e R$ 0,046 acima disso (B2 + espelho frio). O degrau de custo em
 * 1 TB é o que permite o preço de 1 TB quase não subir em relação a 500 GB — e
 * é de propósito: é justamente a faixa onde o Pixieset Pro nos batia.
 */
export const GALERIAS: Faixa[] = [
  { gb: 100, precoCentavos: 4900 },
  { gb: 250, precoCentavos: 7900 },
  { gb: 500, precoCentavos: 10900 },
  { gb: 1000, precoCentavos: 13900 },
  { gb: 2000, precoCentavos: 21900 },
  { gb: 5000, precoCentavos: 44900 },
  /*
   * O topo, para quem filma casamento em 4K o ano inteiro. R$ 0,080/GB, contra
   * R$ 0,0898 do 5 TB: o degrau continua barateando o GB, como todos os
   * anteriores. No custo ALVO (rota B2 + espelho frio, R$ 0,046/GB), a reserva
   * fica em R$ 601 e sobra lucro — é o piso real da faixa. Na rota atual o
   * custo passa do preço e a montagem retém tudo, por desenho.
   *
   * Existia como cofre desde o começo e faltava na galeria, o que travava
   * justamente o lado que ocupa espaço de verdade.
   */
  { gb: 10000, precoCentavos: 79900 },
];

/**
 * Peça 3 — cofre, opcional. Custo ALVO: R$ 0,046/GB/mês (B2 + espelho frio).
 *
 * Margem menor de propósito. O cofre não está aqui para dar lucro: ele existe
 * para o fotógrafo nunca perder uma entrega — e, de quebra, é o que faz ninguém
 * cancelar, porque sair leva o arquivo junto. Nenhum concorrente vende isso.
 */
export const COFRES: Faixa[] = [
  /*
   * Revisão de 25/08/2026: o espelho passou a copiar TUDO (galeria e cofre)
   * para uma segunda empresa, e o custo do cofre dobrou — a grade anterior
   * (39/59/99/149/239/449) ficava abaixo do custo em todas as faixas ≥ 1 TB.
   * A grade nova cobre o custo alvo com folga de 1,5 (ver socios.ts) e margem
   * de propósito pequena: cofre não existe para dar lucro, existe para o
   * fotógrafo nunca perder uma entrega — e para ninguém cancelar.
   */
  { gb: 500, precoCentavos: 3900 },
  { gb: 1000, precoCentavos: 7900 },
  { gb: 2000, precoCentavos: 14900 },
  { gb: 3000, precoCentavos: 21900 },
  { gb: 5000, precoCentavos: 35900 },
  { gb: 10000, precoCentavos: 71900 },
];

/** Custo real por GB/mês, em centavos — a fonte de verdade da margem. */
const CUSTO_R2_CENTAVOS_GB = 8.25;
const CUSTO_B2_CENTAVOS_GB = 3.3;
/** Espelho frio (Hetzner Storage Box via rclone) — alvo da obra, ainda não existe. */
const CUSTO_ESPELHO_FRIO_CENTAVOS_GB = 1.3;
/** Acima disto a galeria será servida pelo B2 com Cloudflare na frente. */
const LIMITE_ROTA_R2_GB = 500;

/**
 * Onde os arquivos moram de verdade HOJE vs. onde a arquitetura quer que morem.
 *
 *   atual — TUDO (galeria de qualquer tamanho e cofre) no R2 a R$ 0,0825/GB,
 *           mais o espelho no B2 a R$ 0,033/GB. A rota B2 prometida nos
 *           comentários de 24/08 nunca foi construída: `arquivar-vencidas.mjs`
 *           só muda estado no banco, e `r2.ts` serve de um bucket só.
 *   alvo  — galeria ≤ 500 GB fica como está; galeria grande e cofre migram o
 *           primário para o B2 (servido pela Cloudflare) e o espelho deles vai
 *           para armazenamento frio em OUTRA empresa — a promessa "duas
 *           empresas diferentes" da página de segurança vale para tudo.
 *
 * Quando a obra sair, `ROTA_EM_PRODUCAO` vira "alvo" e reserva e margem se
 * corrigem sozinhas. Até lá, o custo que o código conta é o que a fatura cobra.
 */
export type Rota = "atual" | "alvo";
export const ROTA_EM_PRODUCAO: Rota = "atual";

export interface Montagem {
  segmento: Segmento;
  galeriaGb: number;
  /** 0 = sem cofre. */
  cofreGb: number;
}

/** O plano já resolvido — o formato que o resto do sistema consome. */
export interface Plano {
  id: string;
  segmento: Segmento;
  nome: string;
  /** Espaço da galeria online, em GB. */
  quotaGb: number;
  /** Cofre contratado, em GB (0 = sem cofre). */
  cofreGb: number;
  /** Preço mensal em centavos de real — dinheiro nunca em float. */
  precoCentavos: number;
  destaque?: boolean;
}

export const formatarGb = (gb: number) => (gb >= 1000 ? `${gb / 1000} TB` : `${gb} GB`);

const faixa = (lista: Faixa[], gb: number) => lista.find((f) => f.gb === gb);

/**
 * Custo TETO de cada peça da montagem (espaço 100% ocupado), em centavos.
 *
 * É teto porque os fornecedores cobram o que está guardado de verdade — conta
 * nova começa vazia e custa quase nada. Usar o teto é o que garante que
 * nenhuma combinação do quebra-cabeça sangre no pior caso.
 *
 * Separado por peça porque as folgas de câmbio são diferentes: a galeria tem
 * lucro gordo que absorve dólar alto, o cofre vive de margem ~zero e precisa
 * de folga maior (ver socios.ts).
 */
export function custoPecasCentavos(
  m: Montagem,
  rota: Rota = ROTA_EM_PRODUCAO,
): { galeria: number; cofre: number } {
  if (rota === "atual") {
    // Tudo no R2, espelhado no B2 — o que a fatura cobra hoje.
    const porGb = CUSTO_R2_CENTAVOS_GB + CUSTO_B2_CENTAVOS_GB;
    return { galeria: m.galeriaGb * porGb, cofre: m.cofreGb * porGb };
  }
  // Alvo: primário barato + espelho em OUTRA empresa, para cada peça.
  const galeriaPorGb =
    m.galeriaGb > LIMITE_ROTA_R2_GB
      ? CUSTO_B2_CENTAVOS_GB + CUSTO_ESPELHO_FRIO_CENTAVOS_GB
      : CUSTO_R2_CENTAVOS_GB + CUSTO_B2_CENTAVOS_GB;
  const cofrePorGb = CUSTO_B2_CENTAVOS_GB + CUSTO_ESPELHO_FRIO_CENTAVOS_GB;
  return { galeria: m.galeriaGb * galeriaPorGb, cofre: m.cofreGb * cofrePorGb };
}

/** Custo teto da montagem inteira — soma das peças. */
export function custoTetoCentavos(m: Montagem, rota: Rota = ROTA_EM_PRODUCAO): number {
  const pecas = custoPecasCentavos(m, rota);
  return Math.round(pecas.galeria + pecas.cofre);
}

/** `g:` na frente para nunca colidir com os ids antigos, que são texto solto. */
export function idDaMontagem(m: Montagem): string {
  return `g:${m.segmento}:${m.galeriaGb}:${m.cofreGb}`;
}

function nomeDaMontagem(m: Montagem): string {
  const tipo = SEGMENTOS.find((s) => s.id === m.segmento)?.nome ?? m.segmento;
  const base = `${tipo} · ${formatarGb(m.galeriaGb)}`;
  return m.cofreGb > 0 ? `${base} + cofre ${formatarGb(m.cofreGb)}` : base;
}

/** Monta o plano a partir das peças. Lança se a combinação não existir. */
export function montar(m: Montagem): Plano {
  const g = faixa(GALERIAS, m.galeriaGb);
  if (!g) throw new Error(`galeria de ${m.galeriaGb} GB não existe`);
  if (!SEGMENTOS.some((s) => s.id === m.segmento)) {
    throw new Error(`tipo de trabalho "${m.segmento}" não existe`);
  }

  let precoCentavos = g.precoCentavos;
  if (m.cofreGb > 0) {
    const c = faixa(COFRES, m.cofreGb);
    if (!c) throw new Error(`cofre de ${m.cofreGb} GB não existe`);
    precoCentavos += c.precoCentavos;
  }

  return {
    id: idDaMontagem(m),
    segmento: m.segmento,
    nome: nomeDaMontagem(m),
    quotaGb: m.galeriaGb,
    cofreGb: m.cofreGb,
    precoCentavos,
  };
}

/** Todas as combinações possíveis — usado pelos testes de margem. */
export function todasAsMontagens(): Montagem[] {
  const saida: Montagem[] = [];
  for (const s of SEGMENTOS) {
    for (const g of GALERIAS) {
      for (const cofreGb of [0, ...COFRES.map((c) => c.gb)]) {
        saida.push({ segmento: s.id, galeriaGb: g.gb, cofreGb });
      }
    }
  }
  return saida;
}

/**
 * ── IDS ANTIGOS ───────────────────────────────────────────────────────────
 * Gravados em `tenants.plano_id` (e no default da coluna) desde antes do
 * quebra-cabeça existir. Ficam congelados no tamanho E no preço que tinham:
 * reinterpretar um id antigo pela grade nova encolheria a quota de quem já
 * assinou, na próxima `sincronizar-quotas`, sem erro e sem aviso.
 *
 * Ninguém novo recebe estes ids — só resolvem para trás.
 */
const LEGADOS: Record<string, Plano> = {
  "foto-100": { id: "foto-100", segmento: "foto", nome: "Foto 100 GB", quotaGb: 100, cofreGb: 500, precoCentavos: 9900 },
  "foto-200": { id: "foto-200", segmento: "foto", nome: "Foto 200 GB", quotaGb: 200, cofreGb: 1000, precoCentavos: 12900 },
  "foto-500": { id: "foto-500", segmento: "foto", nome: "Foto 500 GB", quotaGb: 500, cofreGb: 2000, precoCentavos: 17900 },
  "filme-1000": { id: "filme-1000", segmento: "filme", nome: "Filme 1 TB", quotaGb: 1000, cofreGb: 3000, precoCentavos: 24900 },
  "filme-2000": { id: "filme-2000", segmento: "filme", nome: "Filme 2 TB", quotaGb: 2000, cofreGb: 5000, precoCentavos: 34900 },
  "filme-5000": { id: "filme-5000", segmento: "filme", nome: "Filme 5 TB", quotaGb: 5000, cofreGb: 10000, precoCentavos: 69900 },
};

/**
 * Resolve qualquer id de plano — montagem nova ou id antigo.
 *
 * Devolve `undefined` em vez de lançar porque quem chama isto está quase sempre
 * validando entrada de formulário ou lendo o banco; um id estranho tem de virar
 * "Plano inválido" na tela, não erro 500.
 */
export function planoPorId(id: string): Plano | undefined {
  if (!id) return undefined;
  if (LEGADOS[id]) return LEGADOS[id];
  if (!id.startsWith("g:")) return undefined;

  const partes = id.split(":");
  if (partes.length !== 4) return undefined;
  const [, segmento, galeria, cofre] = partes;

  const galeriaGb = Number(galeria);
  const cofreGb = Number(cofre);
  if (!Number.isInteger(galeriaGb) || !Number.isInteger(cofreGb)) return undefined;
  if (!SEGMENTOS.some((s) => s.id === segmento)) return undefined;
  if (!faixa(GALERIAS, galeriaGb)) return undefined;
  if (cofreGb !== 0 && !faixa(COFRES, cofreGb)) return undefined;

  return montar({ segmento: segmento as Segmento, galeriaGb, cofreGb });
}

/**
 * Combos prontos — atalhos para quem não quer montar nada.
 *
 * Não são planos separados: cada um é uma montagem que o quebra-cabeça também
 * produz. Servem à home e a quem abre a tela de plano querendo só escolher e
 * sair. Todos vêm com cofre maior que a galeria, que é a proporção que faz
 * sentido (o arquivo sempre cresce mais que o que está no ar).
 */
export const planos: Plano[] = [
  { ...montar({ segmento: "foto", galeriaGb: 100, cofreGb: 500 }) },
  { ...montar({ segmento: "foto", galeriaGb: 250, cofreGb: 1000 }), destaque: true },
  { ...montar({ segmento: "foto", galeriaGb: 500, cofreGb: 2000 }) },
  { ...montar({ segmento: "filme", galeriaGb: 1000, cofreGb: 3000 }) },
  { ...montar({ segmento: "filme", galeriaGb: 2000, cofreGb: 5000 }) },
  { ...montar({ segmento: "filme", galeriaGb: 5000, cofreGb: 10000 }) },
];

/**
 * Plano com que uma conta nova nasce.
 *
 * O cadastro não pergunta o plano: quem está criando conta ainda não sabe
 * quantos GB usa por mês, e obrigar essa escolha antes do primeiro upload é
 * pedir um chute — que depois vira migração de plano ou, pior, desistência no
 * formulário. A escolha acontece na Conta, quando a assinatura começa.
 *
 * Derivado do combo em destaque, e não escrito à mão, porque um id fixo aqui
 * quebraria o cadastro inteiro no dia em que a tabela mudasse — e quebraria
 * calado, na validação, com "Plano inválido".
 */
export const PLANO_INICIAL = planos.find((p) => p.destaque)?.id ?? planos[0].id;

export const formatarReais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const GB = 1024 ** 3;
