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
 * Custo: R$ 0,0459/GB/mês (B2 a R$ 0,0382 mais a derivada que fica no R2),
 * igual em toda faixa — o arquivo pesado inteiro vai para o B2.
 *
 * O R$/GB cai a cada degrau de propósito (0,490 → 0,080): é o que faz valer a
 * pena subir de faixa em vez de apagar entrega quando o espaço aperta. O teste
 * prende essa monotonicidade — uma inversão aqui é erro de digitação em
 * dinheiro, e passaria despercebida numa tabela.
 */
/*
 * ── A GRADE DE 04/09/2026 ─────────────────────────────────────────────────
 *
 * O sócio pediu três planos na vitrine — 250 GB, 500 GB, 1 TB — e "TERA
 * ADICIONAL" vendido à parte. A vitrine mudou; a GRADE não encolheu.
 *
 * SAIU A FAIXA DE 100 GB. Era a mais exposta da tabela: o GoFotógrafo entrega
 * 300 GB mais um CRM inteiro por R$ 49,90 (medido em 26/08/2026), e 100 GB
 * pelo mesmo dinheiro perdia em qualquer comparação lado a lado. A entrada
 * passa a ser 250 GB pelos mesmos R$ 49,99 — dois e meio pelo preço de um.
 *
 * Fica registrado o que eu disse ao propor e ele decidiu contra: 250 continua
 * abaixo dos 300 GB do concorrente, e a linha de 300 GB é onde os dois mercados
 * se separam. Ele preferiu 250, e é decisão dele — o número está aqui, num
 * lugar só, e mudar é trocar uma linha.
 *
 * FICARAM 2 A 10 TB, e isso é o oposto de teimosia: acima de 300 GB nenhum
 * concorrente existe, por nenhum preço. Tirá-las para caber numa página de
 * vendas mais curta seria abandonar o único mercado sem briga. Elas saem da
 * VITRINE (ver `planos`), não da tabela — quem precisa acha no montador.
 *
 * O "TB ADICIONAL" não é produto novo nem coluna nova: é a diferença entre
 * degraus vizinhos acima de 1 TB, mantida CONSTANTE em R$ 80,00. É o que
 * permite dizer "cada TB a mais custa R$ 80" sem mentir, e sem inventar uma
 * segunda estrutura de cobrança (quota = plano + N × TB) que exigiria mexer em
 * schema e no Asaas para não entregar nada de novo.
 * `scripts/testar-planos.mjs` prende essa constância e o piso de custo: um TB
 * cheio custa R$ 59,63 com a folga cambial, então abaixo disso o adicional
 * venderia prejuízo que cresce com o uso.
 */
export const ESPACOS: Faixa[] = [
  { gb: 250, precoCentavos: 4999 },
  { gb: 500, precoCentavos: 7999 },
  /* A faixa que briga com o Pixieset Pro (1 TB por ~R$ 135 no cartão do
   * brasileiro). Empate no preço, e lá o vídeo é 1 hora em HD.
   *
   * FOLGA DE UM CENTAVO, e ela é decisão, não acaso. `testar-planos` reprova
   * esta faixa acima de R$ 140,00, e a regra dos ,99 obriga o degrau seguinte a
   * ser R$ 149,99 — não existe reajuste pequeno aqui, o próximo passo estoura o
   * teto junto. Se um dia o teste ficar vermelho neste ponto, não é defeito: é
   * a grade encostando no limite de propósito. A saída é reler o preço do Pro
   * (o número e a data da conferência estão no teste) e mover o teto por
   * decisão — nunca afrouxar o teto para caber um preço já escolhido. */
  { gb: 1000, precoCentavos: 11999 },
  /*
   * ── DE 2 A 10 TB, DE UM EM UM (05/09/2026) ──────────────────────────────
   *
   * A escada era 2, 3, 5 e 10 TB. Os preços destes quatro degraus NÃO mudaram:
   * eles já eram exatamente 1 TB + N × R$ 80, e é dessa igualdade que
   * `TB_ADICIONAL_CENTAVOS` nasce. O que faltava eram 4, 6, 7, 8 e 9 TB.
   *
   * O buraco não incomodava enquanto o seletor da home desenhava um botão por
   * faixa: quem precisava de 4 TB clicava em 5 e pagava por 5. Ele passou a
   * incomodar quando o Felipe pediu "apenas 3 planos e depois plano adicional
   * por 1 TB" — porque um passo de "+1 TB" que sai de 3 e chega em 5 mente
   * para quem apertou o botão uma vez.
   *
   * Escrito por extenso, e não gerado por laço, pelo mesmo motivo de sempre
   * nesta tabela: é dinheiro. Uma linha de código que produz nove preços
   * esconde o preço — e o dia em que alguém trocar o passo de 8000 para 8500,
   * a diferença tem de aparecer no diff, degrau por degrau.
   */
  { gb: 2000, precoCentavos: 19999 },
  /* Degrau herdado do cofre: existia lá e faltava aqui. É o passo que evita o
   * salto de R$ 219 para R$ 449 bater de frente com quem só precisava de 3 TB. */
  { gb: 3000, precoCentavos: 27999 },
  { gb: 4000, precoCentavos: 35999 },
  { gb: 5000, precoCentavos: 43999 },
  { gb: 6000, precoCentavos: 51999 },
  { gb: 7000, precoCentavos: 59999 },
  { gb: 8000, precoCentavos: 67999 },
  { gb: 9000, precoCentavos: 75999 },
  /* O topo, para quem filma casamento em 4K o ano inteiro. Acima do Pixieset
   * Ultimate, que nem aceita vídeo 4K — aqui não existe concorrente. */
  { gb: 10000, precoCentavos: 83999 },
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
 * Quanto de derivada cada GB de original arrasta para o R2.
 *
 * Miniatura de 640 px mais preview de 2048 px, WebP q82, dão ~280 KB por foto.
 * Sobre um original de 10 MB (casamento) são 2,7%; sobre um de 3 MB (fotos
 * leves) são 9,3%. Vídeo não gera derivada e fica em ~0%.
 *
 * Fica o PIOR perfil, e não o típico, porque este número alimenta uma RESERVA —
 * e reserva é proteção, que se calcula pelo caso ruim. A diferença é pequena
 * (R$ 0,0459/GB contra R$ 0,0404) e some dentro da folga cambial.
 *
 * A quota do cliente conta só o original (`medias.bytes`, via trigger): a
 * derivada é byte que pagamos e não cobramos. Por isso ela entra aqui como
 * acréscimo ao GB vendido, e não como fatia dele.
 */
const FRACAO_DERIVADA_NO_R2 = 0.093;

/**
 * ── POR QUE NÃO EXISTE MAIS "ROTA" (26/08/2026) ───────────────────────────
 *
 * Até aqui o custo era calculado por uma de duas rotas: `atual` (tudo no R2
 * mais um espelho cheio no B2, R$ 0,1207/GB) e `alvo` (tudo no B2 com espelho
 * frio em Hetzner, R$ 0,0512/GB). A escolha existia para o código contar o que
 * a fatura cobrava enquanto a obra da rota B2 não terminava — e cumpriu o
 * papel: em faixa grande a reserva passava do preço, `lucroCentavos` travava o
 * lucro em zero e o split retinha 100%, em vez de pagar sócio com dinheiro da
 * fatura da Cloudflare.
 *
 * A obra terminou e o espelho foi cancelado, e aí as duas rotas viraram
 * descrições de mundos que não existem: `atual` cobrava por um espelho que não
 * há e por um primário que mudou de casa; `alvo` cobrava por uma caixa da
 * Hetzner que não foi comprada. Ficou a pior combinação possível — o código
 * contando R$ 0,1207/GB contra R$ 0,0459 reais, e nenhuma faixa de 1 TB para
 * cima repassando um centavo aos sócios, sem que nada na tela dissesse por quê.
 *
 * Agora há um custo só, e ele descreve a arquitetura que está no ar: o
 * ORIGINAL no Backblaze B2, a DERIVADA na Cloudflare (o navegador nunca toca o
 * B2 — grade de 16 miniaturas em 1,14 s contra 2,32 s, medido em 25/08/2026), e
 * nenhum espelho. Ver `lib/armazem.ts` e `docs/obra-rota-b2.md`.
 *
 * A proteção não se perdeu com a rota: ela nunca morou aqui. Quem trava o lucro
 * em zero quando o custo engole o preço é `lucroCentavos`, em `socios.ts`, e
 * continua igual. Se um dia entrar espelho frio, é somar uma constante a
 * `custoArmazenamentoCentavos` — não ressuscitar o seletor.
 */

/**
 * COMO A ASSINATURA É COBRADA.
 *
 * O mensal continua sendo o preço de referência da grade — `ESPACOS` guarda
 * mensal, e o anual é DERIVADO dele. Nunca uma segunda tabela: duas tabelas de
 * preço dessincronizam, e a que dessincroniza é sempre a que ninguém olha.
 */
export type Ciclo = "mensal" | "anual";

/**
 * Doze meses de espaço por dez meses de preço.
 *
 * "2 meses grátis" é o desconto anual mais comum do mercado e o mais fácil de
 * explicar numa frase — e a frase importa, porque desconto que precisa de conta
 * para ser entendido não converte.
 *
 * O que este número NÃO pode virar: um desconto que sai da reserva. O estúdio
 * paga dez meses e ocupa o disco por doze, então quem segura o custo dos dois
 * meses restantes é o LUCRO, nunca o dinheiro reservado para o fornecedor. Ver
 * `lucroCentavos` em `socios.ts`, e as etapas do anual em `testar-planos.mjs`.
 */
export const MESES_PAGOS_NO_ANO = 10;

/**
 * Normaliza o que veio do banco OU do formulário.
 *
 * Qualquer coisa que não seja exatamente "anual" vira "mensal" — que é o que
 * TODA assinatura era até a migração 018, e o padrão seguro: mensal reserva um
 * mês de custo, e reservar de MENOS é o erro caro. O `check` da migração já
 * impede lixo de entrar na coluna; isto protege o caminho de leitura.
 *
 * Aceita `unknown` de propósito, e não `string | null`: desde 05/09/2026 o
 * ciclo também chega da tela, atravessando uma server action — e ali o tipo é
 * promessa do cliente, não garantia. Tipar como `Ciclo` o que veio do navegador
 * seria uma mentira que o TypeScript não tem como cobrar. Mesma razão de
 * `formaDaAssinatura` em `config/forma-assinatura.ts`.
 */
export function cicloDe(valor: unknown): Ciclo {
  return valor === "anual" ? "anual" : "mensal";
}

/** O que a fatura cobra naquele ciclo, a partir do preço mensal da faixa. */
export function precoDoCicloCentavos(precoMensalCentavos: number, ciclo: Ciclo): number {
  return ciclo === "anual" ? precoMensalCentavos * MESES_PAGOS_NO_ANO : precoMensalCentavos;
}

/** Quanto o estúdio economiza no ano ao pagar de uma vez — para a tela, não para a conta. */
export function economiaAnualCentavos(precoMensalCentavos: number): number {
  return precoMensalCentavos * (12 - MESES_PAGOS_NO_ANO);
}

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
 * Quanto custa cada TB acima de 1 TB — o "TERA ADICIONAL" da vitrine.
 *
 * Derivado da grade, e não escrito à mão: é a diferença entre dois degraus
 * vizinhos. Um número solto aqui viraria propaganda que a tabela desmente no
 * dia em que alguém reajustar uma faixa e esquecer da outra.
 * `testar-planos.mjs` exige que essa diferença seja a MESMA em todos os
 * degraus acima de 1 TB — sem isso a frase "cada TB a mais custa X" seria falsa
 * em algum ponto da tabela.
 */
export const TB_ADICIONAL_CENTAVOS = (() => {
  const acima = ESPACOS.filter((e) => e.gb >= 1000).sort((a, b) => a.gb - b.gb);
  return (acima[1].precoCentavos - acima[0].precoCentavos) / ((acima[1].gb - acima[0].gb) / 1000);
})();

/*
 * ── A ESCADA NÃO PARA ONDE A TABELA PARA (06/09/2026) ─────────────────────
 *
 * O Felipe: "remova essa coisa do 10TB". Até aqui o último degrau escrito era
 * também o teto do produto: o "+1 TB" desabilitava ali e a home anunciava o
 * número como limite. Mas acima de 1 TB a tabela sempre foi uma RETA — cada
 * degrau é o anterior mais R$ 80 —, e a reta não tem por que terminar onde
 * alguém cansou de digitar linhas.
 *
 * A TABELA CONTINUA ESCRITA À MÃO, e isso não é contradição com o que está
 * escrito lá em cima: é dinheiro, e o diff tem de mostrar preço por preço nas
 * faixas que quase todo mundo compra. A fórmula só assume ACIMA do topo, onde
 * não há o que escrever à mão — e `testar-planos.mjs` exige que ela reproduza
 * EXATAMENTE cada degrau já escrito. Se um reajuste quebrar a reta, é lá que
 * aparece, antes de virar preço na tela.
 *
 * O PASSO É DE 1 TB, sempre. Acima do topo só existe múltiplo exato de 1.000 GB
 * — 10.500 GB não é um espaço mais barato, é um id que nenhum botão produz.
 */
const TOPO_ESCRITO = ESPACOS.at(-1)!;

/**
 * O limite de sanidade — NÃO é teto de venda, e não aparece em tela nenhuma.
 *
 * Ele existe porque `plano_id` atravessa uma server action: sem limite,
 * `g:foto:999999999` viraria plano válido de milhões de reais, e o único
 * lugar que notaria seria a fatura. 100 TB é folgado o bastante para nenhum
 * cliente real encostar (o maior degrau que já vendemos é 10 TB) e apertado o
 * bastante para que um número absurdo seja recusado na fronteira.
 */
export const ESPACO_MAXIMO_GB = 100_000;

/** Um espaço é vendável se está na tabela, ou se é tera inteiro acima do topo. */
export function espacoValido(gb: number): boolean {
  if (!Number.isInteger(gb) || gb <= 0) return false;
  if (faixa(gb)) return true;
  if (gb <= TOPO_ESCRITO.gb || gb > ESPACO_MAXIMO_GB) return false;
  return (gb - TOPO_ESCRITO.gb) % 1000 === 0;
}

/**
 * O preço mensal de qualquer espaço vendável, em centavos.
 *
 * Dentro da tabela, lê a tabela — o preço continua vindo do que está escrito,
 * nunca de conta feita na hora. Acima do topo, continua a reta.
 */
export function precoDoEspacoCentavos(gb: number): number {
  const e = faixa(gb);
  if (e) return e.precoCentavos;
  if (!espacoValido(gb)) throw new Error(`espaço de ${gb} GB não existe`);
  return TOPO_ESCRITO.precoCentavos + ((gb - TOPO_ESCRITO.gb) / 1000) * TB_ADICIONAL_CENTAVOS;
}

/**
 * Custo de ARMAZENAMENTO da montagem, com o espaço 100% ocupado, em centavos.
 *
 * ── O QUE ESTE NÚMERO É, E O QUE ELE NÃO É ────────────────────────────────
 * O nome ficou longo de propósito. Enquanto ele se chamava só `custoEspaco` e
 * `custoTeto`, era natural ler "custo" como "o custo de ter um cliente" — e não
 * é. Este número tem exatamente dois itens dentro:
 *
 *   ENTRA:  o original no B2, e a derivada que fica no R2.
 *
 *   NÃO ENTRA, e escala com o uso:
 *     · IOF e spread do cartão sobre a parte em dólar — cobertos pela FOLGA de
 *       30% em `socios.ts`, não somados aqui (medido: com IOF 3,5% e spread 3%
 *       a reserva ainda aguenta o dólar a R$ 6,71);
 *     · download acima da franquia do B2 (grátis até 3× do guardado por mês,
 *       depois US$ 0,01/GB) — não modelado, e o único variável que pode morder
 *       de verdade. Só dá para calibrar com galeria real em uso;
 *     · requisições no R2 (uma por miniatura) — centavos.
 *
 *   NÃO ENTRA, e NÃO escala com GB:
 *     · DAS-MEI, VPS, domínio, contabilidade. Esses não pertencem a este
 *       cálculo: somá-los ao plano de 100 GB o faria parecer prejuízo, e
 *       diluí-los entre clientes mudaria o custo de todo mundo a cada cliente
 *       novo. O lugar deles é o PONTO DE EQUILÍBRIO — quantos clientes pagam a
 *       operação —, em `src/config/custos-fixos.ts`.
 *
 * É TETO porque os fornecedores cobram o que está guardado de verdade: conta
 * nova começa vazia e custa quase nada. Usar o teto é o que garante que nenhuma
 * faixa sangre no pior caso.
 */
export function custoArmazenamentoCentavos(m: Montagem): number {
  if (!Number.isFinite(m.espacoGb)) {
    /*
     * Falhar alto em vez de devolver NaN.
     *
     * Isto não é zelo: `testar-cobranca.mjs` passou semanas chamando com a
     * forma antiga da montagem (`galeriaGb`/`cofreGb`, de quando o cofre era
     * peça). `m.espacoGb` vinha `undefined`, o custo virava NaN, e a
     * comparação `reserva < NaN` é sempre falsa — o teste que existe para
     * provar que a reserva cobre o custo nunca teve como ficar vermelho.
     * Um teste que não pode falhar é pior que teste nenhum, porque ocupa a
     * vaga de um que poderia.
     */
    throw new Error(`montagem sem espacoGb: ${JSON.stringify(m)}`);
  }
  const porGb = CUSTO_B2_CENTAVOS_GB + FRACAO_DERIVADA_NO_R2 * CUSTO_R2_CENTAVOS_GB;
  return m.espacoGb * porGb;
}

/** O mesmo custo de armazenamento, arredondado — o que o resto do sistema consome. */
export function custoArmazenamentoTetoCentavos(m: Montagem): number {
  return Math.round(custoArmazenamentoCentavos(m));
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
  if (!SEGMENTOS.some((s) => s.id === m.segmento)) {
    throw new Error(`tipo de trabalho "${m.segmento}" não existe`);
  }
  /* `precoDoEspacoCentavos` lança no espaço inválido — a mesma recusa de antes,
     agora num lugar só, e valendo também acima do topo escrito. */
  const precoCentavos = precoDoEspacoCentavos(m.espacoGb);
  return {
    id: idDaMontagem(m),
    segmento: m.segmento,
    nome: nomeDaMontagem(m),
    quotaGb: m.espacoGb,
    precoCentavos,
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

  /* Montagem atual: g:segmento:espaço.
   *
   * `espacoValido` no lugar de `faixa` desde 06/09/2026: acima do topo escrito
   * a escada continua, e um id de 20 TB tem de resolver aqui. É esta linha que
   * liga a RESERVA CERTA — `reservaDoPlano`, em socios.ts, pergunta o plano a
   * esta função, e o id que ela não reconhece cai num chute de 35% do preço.
   * Num plano grande, esse chute manda para as carteiras dos sócios o dinheiro
   * da fatura da Backblaze, sem erro e sem nada em tela. Ver a etapa "acima do
   * topo a reserva é a real" em `testar-planos.mjs`. */
  if (partes.length === 3) {
    const espacoGb = Number(partes[2]);
    if (!espacoValido(espacoGb)) return undefined;
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
/*
 * TRÊS, e não seis — pedido do sócio em 04/09/2026.
 *
 * Seis cartões na vitrine não são seis opções: são seis contas para fazer antes
 * de escolher. Ele resumiu o papel de cada um: "250 GB pra conseguir competir,
 * 500 GB para a maioria pegar, 1 TB o maior plano" — e é por isso que o
 * destaque é o do meio, e não o mais caro.
 *
 * Quem precisa de mais que 1 TB não perdeu nada: a grade inteira continua no
 * montador, e o TB adicional (R$ 80) descreve exatamente o que ela cobra acima
 * de 1 TB. Ver o comentário de `ESPACOS`.
 *
 * Os combos são de `foto` porque o segmento não muda preço nenhum — é só qual
 * recurso liga. Escolher filme na vitrine daria a impressão de que filme custa
 * diferente, que é justamente a mentira que a home promete não contar.
 */
export const planos: Plano[] = [
  { ...montar({ segmento: "foto", espacoGb: 250 }) },
  { ...montar({ segmento: "foto", espacoGb: 500 }), destaque: true },
  { ...montar({ segmento: "foto", espacoGb: 1000 }) },
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
