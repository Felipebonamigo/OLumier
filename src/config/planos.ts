/**
 * PLANOS — duas peças: o que você entrega, e quanto espaço o estúdio tem.
 *
 *   1. tipo de trabalho  — foto, filme ou os dois
 *   2. tamanho do espaço — tudo que o estúdio guarda, no ar e arquivado juntos
 *
 * ── A REGRA QUE SUSTENTA O DISCURSO ───────────────────────────────────────
 * O tipo de trabalho NÃO muda o preço. Vídeo aqui é só espaço.
 * O Pixieset cobra vídeo por HORA (US$ 5/mês por hora extra) e só entrega HD;
 * é o buraco de mercado que nos abre espaço, e a home promete isso em voz alta.
 * `scripts/testar-planos.mjs` prende essa promessa: qualquer adicional por
 * segmento deixa a suíte vermelha antes de a mentira ir pro ar.
 *
 * ── POR QUE O COFRE DEIXOU DE SER PEÇA (25/08/2026) ───────────────────────
 * Durante um dia o plano teve três peças, e a terceira era o cofre: espaço de
 * arquivo, cobrado 36% mais barato por GB que o espaço no ar. Essa diferença
 * fazia sentido enquanto galeria e arquivo custassem diferente — e deixou de
 * fazer quando a conta foi refeita com tudo no Backblaze B2: lá o GB no ar e o
 * GB parado custam o MESMO (a franquia de download de 3× cobre a entrega nos
 * casos reais), então o desconto virou desconto sem lastro.
 *
 * A peça saiu, e três coisas melhoraram de uma vez:
 *   - a venda passou a ter uma pergunta em vez de duas ("quanto espaço?"), e a
 *     segunda era impossível de responder na hora da compra: ninguém sabe
 *     quanto vai arquivar em 2027;
 *   - arquivar deixou de poder FALHAR. Antes `quota_cofre_bytes` nascia zero e
 *     o botão recusava o cliente padrão — o recurso que faz ninguém cancelar
 *     estava atrás de uma segunda compra;
 *   - o preço de ninguém subiu: esta grade é a de galeria, intacta, mais o
 *     degrau de 3 TB que só existia no cofre.
 *
 * O cofre continua existindo como COMPORTAMENTO (galeria vence, sai do ar, o
 * arquivo fica, um clique reativa) — ver `lib/cofre.ts`. O que sumiu foi a
 * cobrança separada, não a promessa.
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
 * Peça 2 — o espaço do estúdio. Galeria no ar e arquivo somam aqui.
 *
 * Custo ALVO: R$ 0,0512/GB/mês (B2 a R$ 0,0382 + espelho frio a R$ 0,013),
 * igual em toda faixa — não há mais degrau de rota, porque não há mais duas
 * rotas: o arquivo pesado inteiro vai para o B2.
 *
 * O R$/GB cai a cada degrau de propósito (0,490 → 0,080): é o que faz valer a
 * pena subir de faixa em vez de apagar entrega quando o espaço aperta. O teste
 * prende essa monotonicidade — uma inversão aqui é erro de digitação em
 * dinheiro, e passaria despercebida numa tabela.
 */
export const ESPACOS: Faixa[] = [
  { gb: 100, precoCentavos: 4900 },
  { gb: 250, precoCentavos: 7900 },
  { gb: 500, precoCentavos: 10900 },
  /* A faixa que briga com o Pixieset Pro (1 TB por ~R$ 135 no cartão do
   * brasileiro). Empate no preço, e lá o vídeo é 1 hora em HD. */
  { gb: 1000, precoCentavos: 13900 },
  { gb: 2000, precoCentavos: 21900 },
  /* Degrau herdado do cofre: existia lá e faltava aqui. É o passo que evita o
   * salto de R$ 219 para R$ 449 bater de frente com quem só precisava de 3 TB. */
  { gb: 3000, precoCentavos: 29900 },
  { gb: 5000, precoCentavos: 44900 },
  /* O topo, para quem filma casamento em 4K o ano inteiro. Acima do Pixieset
   * Ultimate, que nem aceita vídeo 4K — aqui não existe concorrente. */
  { gb: 10000, precoCentavos: 79900 },
];

/*
 * Custo real por GB/mês, em centavos — a fonte de verdade da margem.
 * Convertidos a R$ 5,50/US$ e R$ 6,30/€; a folga em socios.ts cobre o câmbio.
 * Conferidos na página de preços de cada fornecedor em 25/08/2026.
 */
/** Cloudflare R2: US$ 0,015/GB. Egress ilimitado grátis. Onde tudo está hoje. */
const CUSTO_R2_CENTAVOS_GB = 8.25;
/**
 * Backblaze B2: US$ 6,95/TB. Era US$ 6,00 até 01/05/2026 — o aumento de 16% é
 * o que obrigou a revisão da grade. Na mesma data as transações (Class A/B/C)
 * ficaram grátis, então não há custo por requisição a somar.
 */
const CUSTO_B2_CENTAVOS_GB = 3.82;
/**
 * Espelho frio (Hetzner Storage Box via rclone) — alvo da obra, ainda não existe.
 *
 * É o preço da caixa CHEIA: BX31, 10 TB por € 20,80. A caixa é cobrada inteira
 * mesmo vazia, então na BX11 (1 TB, € 3,20) o GB efetivo é 2,02 — 55% mais caro.
 * Usar o número da caixa cheia é seguro porque a obra só compra caixa depois que
 * existe cliente para enchê-la, e o excesso cai em cima da folga.
 */
const CUSTO_ESPELHO_FRIO_CENTAVOS_GB = 1.3;

/**
 * Onde os arquivos moram de verdade HOJE vs. onde a arquitetura quer que morem.
 *
 *   atual — TUDO no R2 a R$ 0,0825/GB mais o espelho no B2 a R$ 0,0382. É o que
 *           a fatura cobra enquanto a obra da rota B2 não termina.
 *   alvo  — TUDO no B2 (R$ 0,0382) com espelho frio em Hetzner (R$ 0,013). A
 *           promessa "duas empresas diferentes" da página de segurança vale nas
 *           duas rotas: o que muda é qual delas é o primário.
 *
 * Medido em 25/08/2026, da máquina do Felipe: o B2 responde em 153 ms contra
 * 26 ms da Cloudflare, entrega 131 Mbps num fluxo e 207 Mbps em blocos
 * paralelos, e uma tela de 300 miniaturas leva 11,8 s contra 9,4 s. Mais lento,
 * porém a metade do preço — e o navegador continua tocando só as derivadas, que
 * ficam no R2 (ver `lib/armazem.ts`).
 *
 * Quando a obra sair, isto vira "alvo" e reserva e margem se corrigem sozinhas.
 * Até lá, o custo que o código conta é o que a fatura cobra.
 */
export type Rota = "atual" | "alvo";
export const ROTA_EM_PRODUCAO: Rota = "atual";

export interface Montagem {
  segmento: Segmento;
  /** Espaço total do estúdio, em GB — no ar e arquivado juntos. */
  espacoGb: number;
}

/** O plano já resolvido — o formato que o resto do sistema consome. */
export interface Plano {
  id: string;
  segmento: Segmento;
  nome: string;
  /** Espaço total contratado, em GB. */
  quotaGb: number;
  /** Preço mensal em centavos de real — dinheiro nunca em float. */
  precoCentavos: number;
  destaque?: boolean;
}

export const formatarGb = (gb: number) => (gb >= 1000 ? `${gb / 1000} TB` : `${gb} GB`);

const faixa = (gb: number) => ESPACOS.find((f) => f.gb === gb);

/**
 * Custo TETO da montagem (espaço 100% ocupado), em centavos.
 *
 * É teto porque os fornecedores cobram o que está guardado de verdade — conta
 * nova começa vazia e custa quase nada. Usar o teto é o que garante que
 * nenhuma faixa sangre no pior caso.
 */
export function custoEspacoCentavos(m: Montagem, rota: Rota = ROTA_EM_PRODUCAO): number {
  const porGb =
    rota === "atual"
      ? CUSTO_R2_CENTAVOS_GB + CUSTO_B2_CENTAVOS_GB
      : CUSTO_B2_CENTAVOS_GB + CUSTO_ESPELHO_FRIO_CENTAVOS_GB;
  return m.espacoGb * porGb;
}

/** Custo teto arredondado — o que o resto do sistema consome. */
export function custoTetoCentavos(m: Montagem, rota: Rota = ROTA_EM_PRODUCAO): number {
  return Math.round(custoEspacoCentavos(m, rota));
}

/** `g:` na frente para nunca colidir com os ids antigos, que são texto solto. */
export function idDaMontagem(m: Montagem): string {
  return `g:${m.segmento}:${m.espacoGb}`;
}

function nomeDaMontagem(m: Montagem): string {
  const tipo = SEGMENTOS.find((s) => s.id === m.segmento)?.nome ?? m.segmento;
  return `${tipo} · ${formatarGb(m.espacoGb)}`;
}

/** Monta o plano a partir das peças. Lança se a faixa não existir. */
export function montar(m: Montagem): Plano {
  const e = faixa(m.espacoGb);
  if (!e) throw new Error(`espaço de ${m.espacoGb} GB não existe`);
  if (!SEGMENTOS.some((s) => s.id === m.segmento)) {
    throw new Error(`tipo de trabalho "${m.segmento}" não existe`);
  }
  return {
    id: idDaMontagem(m),
    segmento: m.segmento,
    nome: nomeDaMontagem(m),
    quotaGb: m.espacoGb,
    precoCentavos: e.precoCentavos,
  };
}

/** Todas as montagens possíveis — usado pelos testes de margem. */
export function todasAsMontagens(): Montagem[] {
  return SEGMENTOS.flatMap((s) => ESPACOS.map((e) => ({ segmento: s.id, espacoGb: e.gb })));
}

/**
 * ── IDS ANTIGOS ───────────────────────────────────────────────────────────
 * Gravados em `tenants.plano_id` (e no default da coluna). Duas gerações:
 * os seis nomeados, de antes do quebra-cabeça, e os montados de três peças
 * (`g:seg:galeria:cofre`), que existiram entre 24/08 e a unificação.
 *
 * Nos dois casos a regra é a mesma: a quota nova é a SOMA do que o cliente
 * tinha (galeria + cofre), e o preço fica congelado no que ele paga. Somar
 * nunca encolhe o espaço de ninguém — e reinterpretar um id antigo pela grade
 * nova encolheria, na próxima `sincronizar-quotas`, sem erro e sem aviso.
 * Congelar o preço garante que a unificação não vire aumento pelas costas.
 *
 * Ninguém novo recebe estes ids — eles só resolvem para trás.
 */
const LEGADOS: Record<string, Plano> = {
  "foto-100": { id: "foto-100", segmento: "foto", nome: "Foto 100 GB", quotaGb: 600, precoCentavos: 9900 },
  "foto-200": { id: "foto-200", segmento: "foto", nome: "Foto 200 GB", quotaGb: 1200, precoCentavos: 12900 },
  "foto-500": { id: "foto-500", segmento: "foto", nome: "Foto 500 GB", quotaGb: 2500, precoCentavos: 17900 },
  "filme-1000": { id: "filme-1000", segmento: "filme", nome: "Filme 1 TB", quotaGb: 4000, precoCentavos: 24900 },
  "filme-2000": { id: "filme-2000", segmento: "filme", nome: "Filme 2 TB", quotaGb: 7000, precoCentavos: 34900 },
  "filme-5000": { id: "filme-5000", segmento: "filme", nome: "Filme 5 TB", quotaGb: 15000, precoCentavos: 69900 },
};

/** As grades de quando o cofre era peça — para reconstruir o preço congelado. */
const GALERIAS_ANTIGAS: Record<number, number> = {
  100: 4900, 250: 7900, 500: 10900, 1000: 13900, 2000: 21900, 5000: 44900, 10000: 79900,
};
const COFRES_ANTIGOS: Record<number, number> = {
  500: 5900, 1000: 8900, 2000: 16900, 3000: 24900, 5000: 41900, 10000: 83900,
};

/**
 * Resolve qualquer id de plano — montagem nova, montagem de três peças, ou id
 * nomeado antigo.
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
  const [, segmento] = partes;
  if (!SEGMENTOS.some((s) => s.id === segmento)) return undefined;

  /* Montagem atual: g:segmento:espaço */
  if (partes.length === 3) {
    const espacoGb = Number(partes[2]);
    if (!Number.isInteger(espacoGb) || !faixa(espacoGb)) return undefined;
    return montar({ segmento: segmento as Segmento, espacoGb });
  }

  /*
   * Montagem de três peças (g:segmento:galeria:cofre), de 24/08. Vira espaço
   * somado, com o preço congelado nas grades daquela época. Não usa `montar`
   * porque a soma quase nunca cai numa faixa da grade nova — 250 + 1000 = 1250,
   * que não existe. Encaixar à força seria arredondar para baixo e encolher a
   * conta de quem já pagou.
   */
  if (partes.length === 4) {
    const galeriaGb = Number(partes[2]);
    const cofreGb = Number(partes[3]);
    if (!Number.isInteger(galeriaGb) || !Number.isInteger(cofreGb)) return undefined;
    const precoGaleria = GALERIAS_ANTIGAS[galeriaGb];
    if (precoGaleria === undefined) return undefined;
    if (cofreGb !== 0 && COFRES_ANTIGOS[cofreGb] === undefined) return undefined;
    const precoCentavos = precoGaleria + (cofreGb === 0 ? 0 : COFRES_ANTIGOS[cofreGb]);
    const quotaGb = galeriaGb + cofreGb;
    const tipo = SEGMENTOS.find((s) => s.id === segmento)?.nome ?? segmento;
    return {
      id,
      segmento: segmento as Segmento,
      nome: `${tipo} · ${formatarGb(quotaGb)}`,
      quotaGb,
      precoCentavos,
    };
  }

  return undefined;
}

/**
 * Combos prontos — atalhos para quem não quer escolher faixa nenhuma.
 *
 * Não são planos separados: cada um é uma montagem que a grade também produz.
 * Servem à home e a quem abre a tela de plano querendo só escolher e sair.
 */
export const planos: Plano[] = [
  { ...montar({ segmento: "foto", espacoGb: 250 }) },
  { ...montar({ segmento: "foto", espacoGb: 1000 }), destaque: true },
  { ...montar({ segmento: "foto", espacoGb: 2000 }) },
  { ...montar({ segmento: "filme", espacoGb: 3000 }) },
  { ...montar({ segmento: "filme", espacoGb: 5000 }) },
  { ...montar({ segmento: "filme", espacoGb: 10000 }) },
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
