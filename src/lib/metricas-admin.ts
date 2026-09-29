/**
 * AS CONTAS DO PAINEL DE ADMINISTRAÇÃO.
 *
 * Funções PURAS: recebem as linhas já lidas do banco e devolvem números. Nada
 * aqui abre conexão, e é de propósito — o caso que quebra a conta quase nunca
 * existe no banco de desenvolvimento (o inadimplente, o cancelado que deixou
 * 2 TB parados, o trial que escolheu 10 TB no cadastro). Com as funções puras,
 * `scripts/testar-metricas-admin.mjs` monta esses casos à mão em uma linha.
 *
 * Também não é `server-only`: a página é de servidor, mas prender o módulo ao
 * servidor só impediria o teste de importá-lo. Não há segredo aqui — quem
 * chama já passou pelo portão.
 *
 * ── A DECISÃO QUE GOVERNA O ARQUIVO INTEIRO ───────────────────────────────
 * Estes números são lidos para DECIDIR: subir preço, procurar cliente, cortar
 * custo. Então cada um responde ao que o dinheiro faz de verdade, não ao que
 * seria agradável mostrar:
 *
 *   · receita conta só quem está `ativo`. O inadimplente tem plano e assinatura
 *     e não pagou; somá-lo transforma o painel numa promessa;
 *   · custo conta TODO MUNDO que ocupa disco, inclusive quem cancelou. O
 *     Backblaze cobra por byte guardado, não por status;
 *   · a quota do trial é o teto de `config/trial.ts`, não a do plano escolhido.
 *
 * Cada uma dessas três tem etapa própria no teste, porque as três são fáceis
 * de "consertar" na direção errada por alguém que ache o número feio.
 */

import {
  GB,
  MESES_PAGOS_NO_ANO,
  cicloDe,
  custoArmazenamentoCentavos,
  planoPorId,
} from "@/config/planos";
import { espacoSemLimite, quotaEfetivaBytes } from "@/config/trial";
import { custoFixoMensalCentavos } from "@/config/custos-fixos";

/**
 * O mínimo que uma linha precisa ter para entrar nas contas.
 *
 * Frouxo de propósito: `LinhaAdmin` (em `lib/admin.ts`) tem duas dezenas de
 * campos, e amarrar as contas ao formato completo obrigaria o teste a montar
 * duas dezenas de campos para conferir uma soma.
 */
export interface EstudioParaMetrica {
  status: string;
  plano_id: string;
  ciclo_cobranca: string | null;
  quota_bytes: string;
  bytes_no_ar: string;
  bytes_no_cofre: string;
  criado_em: Date | string;
  trial_ate: Date | string | null;
}

const ZERO = BigInt(0);
const comoData = (d: Date | string | null): Date | null => (d ? new Date(d) : null);

/**
 * As situações do `check` da coluna, na ordem em que interessam.
 *
 * `cortesia` entrou em 09/09/2026 (migração 032) e fica ao lado de `ativo`
 * porque é o que ela é do ponto de vista do ACESSO. Do ponto de vista do
 * dinheiro é o oposto, e é `receitaMensalCentavos` quem diz isso — ela soma só
 * `ativo`, então uma conta de cortesia nunca vira receita.
 */
export const SITUACOES = ["trial", "ativo", "cortesia", "inadimplente", "cancelado"] as const;
export type Situacao = (typeof SITUACOES)[number];

/**
 * Quanto uma assinatura vale POR MÊS, qualquer que seja o ciclo.
 *
 * O anual cobra dez meses e entrega doze (ver `MESES_PAGOS_NO_ANO`). Somar o
 * preço cheio ao total mensal contaria como receita de um mês o dinheiro de
 * doze — e o painel anunciaria um salto de faturamento no dia em que alguém
 * assinasse anual, que é exatamente o dia em que a leitura errada é mais cara.
 *
 * Ciclo desconhecido cai em mensal, pela mesma razão de `cicloDe`: mensal é o
 * que toda assinatura era antes da migração 018, e é o palpite conservador.
 */
export function mensalEquivalenteCentavos(
  precoMensalCentavos: number,
  ciclo: string | null | undefined,
): number {
  if (cicloDe(ciclo) === "anual") {
    return Math.round((precoMensalCentavos * MESES_PAGOS_NO_ANO) / 12);
  }
  return precoMensalCentavos;
}

/** O preço mensal da faixa contratada. Plano que não resolve vale zero. */
export function precoMensalDoEstudio(e: EstudioParaMetrica): number {
  return planoPorId(e.plano_id)?.precoCentavos ?? 0;
}

/**
 * A receita recorrente da plataforma, por mês, em centavos.
 *
 * Só `ativo`. Um plano de R$ 139,99 num estúdio inadimplente é R$ 0,00 de
 * receita — é uma dívida com nome bonito.
 */
export function receitaMensalCentavos(estudios: EstudioParaMetrica[]): number {
  return estudios
    .filter((e) => e.status === "ativo")
    .reduce((s, e) => s + mensalEquivalenteCentavos(precoMensalDoEstudio(e), e.ciclo_cobranca), 0);
}

/** Tudo que ocupa disco: no ar mais cofre, de todos os estúdios. */
export function bytesGuardados(estudios: EstudioParaMetrica[]): bigint {
  return estudios.reduce((s, e) => s + BigInt(e.bytes_no_ar) + BigInt(e.bytes_no_cofre), ZERO);
}

export function bytesNoAr(estudios: EstudioParaMetrica[]): bigint {
  return estudios.reduce((s, e) => s + BigInt(e.bytes_no_ar), ZERO);
}

export function bytesNoCofre(estudios: EstudioParaMetrica[]): bigint {
  return estudios.reduce((s, e) => s + BigInt(e.bytes_no_cofre), ZERO);
}

/**
 * A quota que de fato foi entregue — a EFETIVA, com o teto do trial aplicado.
 *
 * Sem o teto, um trial que escolheu 10 TB no cadastro contaria como 10 TB de
 * espaço vendido, e a ocupação da plataforma despencaria por causa de uma conta
 * que não pagou nada.
 */
export function quotaVendidaBytes(estudios: EstudioParaMetrica[]): bigint {
  /* Cortesia não tem limite (16/09/2026): somar o "sem limite" faria o pior
     caso do painel virar bilhões. O teto honesto dela é o que já guarda. */
  return estudios.reduce(
    (s, e) =>
      s + (espacoSemLimite(e) ? BigInt(e.bytes_no_ar) + BigInt(e.bytes_no_cofre) : quotaEfetivaBytes(e)),
    ZERO,
  );
}

const centavosDoEspaco = (bytes: bigint): number =>
  custoArmazenamentoCentavos({ segmento: "foto", espacoGb: Number(bytes) / GB });

/**
 * O que os fornecedores cobram pelo que está guardado HOJE.
 *
 * É a despesa real do mês, e o único número do painel que sobe sozinho: byte
 * enviado não some quando o estúdio cancela.
 */
export function custoDoGuardadoCentavos(estudios: EstudioParaMetrica[]): number {
  return Math.round(centavosDoEspaco(bytesGuardados(estudios)));
}

/** O que custaria se cada estúdio enchesse a quota que tem. O pior caso. */
export function custoDoTetoCentavos(estudios: EstudioParaMetrica[]): number {
  return Math.round(centavosDoEspaco(quotaVendidaBytes(estudios)));
}

/** Quantos estúdios em cada situação. As quatro sempre presentes, mesmo zeradas. */
export function contagemPorStatus(estudios: EstudioParaMetrica[]): Record<Situacao, number> {
  const c = Object.fromEntries(SITUACOES.map((s) => [s, 0])) as Record<Situacao, number>;
  for (const e of estudios) {
    if ((SITUACOES as readonly string[]).includes(e.status)) c[e.status as Situacao] += 1;
  }
  return c;
}

/**
 * Trials que vencem dentro de N dias — e ainda NÃO venceram.
 *
 * Quem já passou da data não está "vencendo": está vencido, e é outra lista,
 * com outra ação. Misturar as duas faria a fila de quem ainda dá para salvar
 * crescer com nomes que já foram embora.
 */
export function trialsVencendo<T extends EstudioParaMetrica>(
  estudios: T[],
  dias: number,
  agora: Date = new Date(),
): T[] {
  const limite = agora.getTime() + dias * 86_400_000;
  return estudios.filter((e) => {
    if (e.status !== "trial") return false;
    const fim = comoData(e.trial_ate);
    if (!fim) return false;
    return fim.getTime() >= agora.getTime() && fim.getTime() <= limite;
  });
}

/** Trials cuja data já passou. Continuam `trial` no banco: nada os muda sozinho. */
export function trialsVencidos<T extends EstudioParaMetrica>(
  estudios: T[],
  agora: Date = new Date(),
): T[] {
  return estudios.filter((e) => {
    if (e.status !== "trial") return false;
    const fim = comoData(e.trial_ate);
    return fim !== null && fim.getTime() < agora.getTime();
  });
}

/** Quantas contas nasceram nos últimos N dias. */
export function novosDesde(
  estudios: EstudioParaMetrica[],
  dias: number,
  agora: Date = new Date(),
): number {
  const corte = agora.getTime() - dias * 86_400_000;
  return estudios.filter((e) => new Date(e.criado_em).getTime() >= corte).length;
}

export interface ResumoDaPlataforma {
  estudios: number;
  porStatus: Record<Situacao, number>;
  novos7: number;
  novos30: number;
  trialsVencendo7: number;
  trialsJaVencidos: number;
  /** Ativos sobre o total. Zero com a base vazia — nunca NaN. */
  conversao: number;
  receitaMensalCentavos: number;
  /** Receita dividida pelos pagantes. Zero se não houver pagante. */
  receitaPorPaganteCentavos: number;
  custoMensalCentavos: number;
  custoTetoCentavos: number;
  custoFixoCentavos: number;
  /** Receita menos o custo do que está guardado. Pode ser negativa. */
  margemMensalCentavos: number;
  /** Margem menos os custos fixos: o que sobra de verdade no mês. */
  resultadoMensalCentavos: number;
  bytesNoAr: bigint;
  bytesNoCofre: bigint;
  bytesGuardados: bigint;
  quotaVendidaBytes: bigint;
  /** Guardado sobre quota vendida, de 0 a 1. Zero se nada foi vendido. */
  ocupacao: number;
}

/**
 * Tudo de uma vez, para a página não repetir cinco varreduras na mesma lista.
 *
 * `agora` entra por parâmetro porque metade destes números depende de "hoje", e
 * um teste que não controla o relógio só consegue afirmar coisas frouxas.
 */
export function resumoDaPlataforma(
  estudios: EstudioParaMetrica[],
  agora: Date = new Date(),
): ResumoDaPlataforma {
  const porStatus = contagemPorStatus(estudios);
  const receita = receitaMensalCentavos(estudios);
  const custo = custoDoGuardadoCentavos(estudios);
  const custoFixo = custoFixoMensalCentavos();
  const guardado = bytesGuardados(estudios);
  const quota = quotaVendidaBytes(estudios);

  return {
    estudios: estudios.length,
    porStatus,
    novos7: novosDesde(estudios, 7, agora),
    novos30: novosDesde(estudios, 30, agora),
    trialsVencendo7: trialsVencendo(estudios, 7, agora).length,
    trialsJaVencidos: trialsVencidos(estudios, agora).length,
    conversao: estudios.length === 0 ? 0 : porStatus.ativo / estudios.length,
    receitaMensalCentavos: receita,
    receitaPorPaganteCentavos: porStatus.ativo === 0 ? 0 : Math.round(receita / porStatus.ativo),
    custoMensalCentavos: custo,
    custoTetoCentavos: custoDoTetoCentavos(estudios),
    custoFixoCentavos: custoFixo,
    margemMensalCentavos: receita - custo,
    resultadoMensalCentavos: receita - custo - custoFixo,
    bytesNoAr: bytesNoAr(estudios),
    bytesNoCofre: bytesNoCofre(estudios),
    bytesGuardados: guardado,
    quotaVendidaBytes: quota,
    ocupacao: quota === ZERO ? 0 : Number(guardado) / Number(quota),
  };
}

/**
 * O custo de UMA conta: o que os fornecedores cobram pelo que ela guarda, no
 * ar e no cofre. Pedido do Felipe em 16/09/2026 — "o custo de cada login, para
 * que eu possa cobrá-los separado". Não inclui o custo fixo (VPS, DAS,
 * domínio), que os sócios rateiam por fora, nem tráfego, que não é medido por
 * conta.
 */
export function custoMensalDoEstudioCentavos(e: EstudioParaMetrica): number {
  return custoDoGuardadoCentavos([e]);
}

/** Quanto as contas de cortesia custam por mês — o que cobrar dos sócios por fora. */
export function custoDasCortesiasCentavos(estudios: EstudioParaMetrica[]): number {
  return estudios
    .filter((e) => e.status === "cortesia")
    .reduce((s, e) => s + custoMensalDoEstudioCentavos(e), 0);
}

// ---------------------------------------------------------------------------
// A LINHA DE TOTAL DA TABELA DE ESTÚDIOS
// ---------------------------------------------------------------------------

/**
 * Os campos da tabela que a linha de total soma, além dos de `EstudioParaMetrica`.
 *
 * Interface própria, e não `LinhaAdmin` de `lib/admin.ts`: aquela traz trinta
 * campos que vêm de uma consulta com banco, e esta função é pura de propósito
 * — é assim que `testar-totais-do-admin.mjs` consegue montar o estúdio sem
 * limite, o cancelado com disco cheio e o que nunca foi aberto, todos na mesma
 * tabela, que é o caso que o banco de desenvolvimento nunca tem junto.
 */
export interface EstudioParaTotal extends EstudioParaMetrica {
  galerias: number;
  publicadas: number;
  fotos: number;
  videos: number;
  acessos_30d: number;
  ultimo_acesso: Date | string | null;
  ultima_alteracao: Date | string | null;
  ultimo_acesso_estudio: Date | string | null;
}

export interface TotaisDosEstudios {
  estudios: number;
  porStatus: Record<Situacao, number>;
  /** O que a plataforma recebe por mês — só de quem está `ativo`. */
  pagaCentavos: number;
  /** O que os fornecedores cobram — de TODO MUNDO que ocupa disco. */
  custaCentavos: number;
  usadoBytes: bigint;
  /** A quota vendida, SEM os sem-limite: ver o comentário abaixo. */
  quotaBytes: bigint;
  semLimite: number;
  galerias: number;
  publicadas: number;
  fotos: number;
  videos: number;
  acessos30d: number;
  /** O MAIS RECENTE, não a soma — e nulo quando ninguém nunca abriu. */
  ultimoAcesso: Date | null;
  ultimaAlteracao: Date | null;
  /** A última vez que ALGUM fotógrafo entrou — ver a migração 047. */
  ultimoAcessoEstudio: Date | null;
}

/**
 * Soma a tabela de estúdios, coluna por coluna.
 *
 * Felipe, 29/09/2026: "tenha uma linha com o 'total' de cada coluna, último
 * acesso, última alteração também".
 *
 * ── TRÊS COLUNAS NÃO SOMAM DO JEITO ÓBVIO, E É POR ISSO QUE ISTO É UMA
 *    FUNÇÃO E NÃO UM `reduce` DENTRO DO JSX ────────────────────────────────
 *
 * 1. **Paga** conta só quem está `ativo`, e **Custa** conta todo mundo — é a
 *    mesma assimetria que a explicação do bloco "Dinheiro" já enuncia: o
 *    Backblaze cobra por byte guardado, não por situação. Somar as duas colunas
 *    do mesmo jeito faria a linha de total contradizer o topo da própria
 *    página.
 *
 * 2. **Espaço** não pode somar a quota de quem é sem limite. Cortesia de sócio
 *    tem `quota_bytes` = 2^62; jogada no total, ela daria um "vendido" de
 *    exabytes e zeraria a barra de ocupação. Eles são contados à parte, em
 *    `semLimite`.
 *
 * 3. **As datas** são o MAIS RECENTE das linhas, não uma soma. E nulo continua
 *    nulo: `Math.max` sobre nada devolve `-Infinity`, e sobre nulos devolve 0,
 *    que vira 01/01/1970 — a data errada mais fácil de deixar passar, porque a
 *    tela desenha uma data de verdade e ninguém desconfia.
 */
export function totaisDosEstudios(estudios: EstudioParaTotal[]): TotaisDosEstudios {
  const maisRecente = (pegar: (e: EstudioParaTotal) => Date | string | null): Date | null => {
    let melhor: Date | null = null;
    for (const e of estudios) {
      const d = comoData(pegar(e));
      if (d && (!melhor || d > melhor)) melhor = d;
    }
    return melhor;
  };

  let usadoBytes = ZERO;
  let quotaBytes = ZERO;
  let semLimite = 0;
  for (const e of estudios) {
    usadoBytes += BigInt(e.bytes_no_ar) + BigInt(e.bytes_no_cofre);
    if (espacoSemLimite(e)) semLimite += 1;
    else quotaBytes += quotaEfetivaBytes(e);
  }

  const soma = (pegar: (e: EstudioParaTotal) => number) =>
    estudios.reduce((s, e) => s + pegar(e), 0);

  return {
    estudios: estudios.length,
    porStatus: contagemPorStatus(estudios),
    pagaCentavos: receitaMensalCentavos(estudios),
    custaCentavos: soma(custoMensalDoEstudioCentavos),
    usadoBytes,
    quotaBytes,
    semLimite,
    galerias: soma((e) => e.galerias),
    publicadas: soma((e) => e.publicadas),
    fotos: soma((e) => e.fotos),
    videos: soma((e) => e.videos),
    acessos30d: soma((e) => e.acessos_30d),
    ultimoAcesso: maisRecente((e) => e.ultimo_acesso),
    ultimaAlteracao: maisRecente((e) => e.ultima_alteracao),
    ultimoAcessoEstudio: maisRecente((e) => e.ultimo_acesso_estudio),
  };
}
