/**
 * OS CUSTOS DA SOCIEDADE — as regras, sem banco.
 *
 * A lista mora na tabela `custos_da_sociedade` (migração 047) e é mantida
 * pelos sócios em /painel/admin/caixa. Aqui fica o que dá para testar sem
 * banco: ler o valor que alguém digitou, validar uma linha e somar a lista
 * sem contar duas vezes o que é dos dois produtos.
 */

export type SistemaDoCusto = "galeria" | "atomatiza" | "os-dois";

export const SISTEMAS_DO_CUSTO: { valor: SistemaDoCusto; nome: string }[] = [
  { valor: "galeria", nome: "Só da Galeria Átomo" },
  { valor: "atomatiza", nome: "Só do Atomatiza" },
  { valor: "os-dois", nome: "Dos dois" },
];

export function ehSistemaDoCusto(v: unknown): v is SistemaDoCusto {
  return v === "galeria" || v === "atomatiza" || v === "os-dois";
}

export interface CustoDaSociedade {
  id: string;
  nome: string;
  sistema: SistemaDoCusto;
  centavos_por_mes: number;
  confirmado: boolean;
  nota: string;
  atualizado_em: Date;
  atualizado_por_nome: string | null;
}

/** O teto de uma linha: R$ 100.000 por mês. Acima disso é engano de digitação. */
export const TETO_DO_CUSTO_CENTAVOS = 10_000_000;
export const LIMITE_DO_NOME = 80;
export const LIMITE_DA_NOTA = 300;

/**
 * "76", "76,00", "1.234,56", "R$ 76,5", "76.50" → centavos. Qualquer outra
 * coisa → null.
 *
 * O ponto é ambíguo em português: "1.234" é mil duzentos e trinta e quatro,
 * "76.50" é setenta e seis e cinquenta. A regra: com vírgula, ela é a decimal
 * e os pontos são milhar; sem vírgula, um ponto seguido de exatamente três
 * dígitos é milhar, e seguido de um ou dois é decimal.
 */
export function lerReais(texto: unknown): number | null {
  if (typeof texto !== "string") return null;
  let t = texto.replace(/^\s*R\$\s*/i, "").replace(/\s/g, "");
  if (!t) return null;

  if (t.includes(",")) {
    if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return null;
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  } else if (!/^\d+(\.\d{1,2})?$/.test(t)) {
    return null;
  }

  const centavos = Math.round(Number(t) * 100);
  if (!Number.isFinite(centavos) || centavos < 0 || centavos > TETO_DO_CUSTO_CENTAVOS) return null;
  return centavos;
}

export interface CustoLido {
  nome: string;
  sistema: SistemaDoCusto;
  centavosPorMes: number;
  confirmado: boolean;
  nota: string;
}

/** Os erros que a tela sabe dizer. Código, e não texto, porque viaja no endereço. */
export const ERROS_DO_CUSTO = {
  nome: `Dê um nome ao custo (até ${LIMITE_DO_NOME} letras).`,
  sistema: "Escolha de qual produto é o custo.",
  valor: "Valor por mês inválido. Use, por exemplo, 76,00.",
  nota: `A nota passa de ${LIMITE_DA_NOTA} letras.`,
  "nao-achou": "Esse custo não existe mais — alguém pode ter apagado.",
  banco: "Não consegui gravar agora. Tente de novo em instantes.",
} as const;
export type ErroDoCusto = keyof typeof ERROS_DO_CUSTO;

export function ehErroDoCusto(v: unknown): v is ErroDoCusto {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ERROS_DO_CUSTO, v);
}

/** Uma linha do formulário, validada. */
export function lerCusto(campos: {
  nome: unknown;
  sistema: unknown;
  valor: unknown;
  confirmado: unknown;
  nota: unknown;
}): { custo: CustoLido } | { erro: ErroDoCusto } {
  const nome = typeof campos.nome === "string" ? campos.nome.replace(/\s+/g, " ").trim() : "";
  if (!nome || nome.length > LIMITE_DO_NOME) return { erro: "nome" };
  if (!ehSistemaDoCusto(campos.sistema)) return { erro: "sistema" };
  const centavosPorMes = lerReais(campos.valor);
  if (centavosPorMes === null) return { erro: "valor" };
  const nota = typeof campos.nota === "string" ? campos.nota.trim() : "";
  if (nota.length > LIMITE_DA_NOTA) return { erro: "nota" };
  return {
    custo: {
      nome,
      sistema: campos.sistema,
      centavosPorMes,
      /* Caixa de marcar: vem "on" marcada e não vem desmarcada. */
      confirmado: campos.confirmado === "on" || campos.confirmado === "true",
      nota,
    },
  };
}

export interface SomaDosCustos {
  galeria: number;
  atomatiza: number;
  osDois: number;
  /** Cada custo uma vez só — o dos dois NÃO entra de novo em cada lado. */
  total: number;
  estimativas: number;
}

/**
 * Soma a lista. `armazenamentoDaGaleriaCentavos` é o custo variável que a
 * Galeria calcula do que está guardado (Backblaze + Cloudflare) e não é linha
 * da tabela: ninguém digita, ele sai do banco.
 */
export function somarCustos(
  custos: Pick<CustoDaSociedade, "sistema" | "centavos_por_mes" | "confirmado">[],
  armazenamentoDaGaleriaCentavos = 0,
): SomaDosCustos {
  const soma = { galeria: armazenamentoDaGaleriaCentavos, atomatiza: 0, osDois: 0, estimativas: 0 };
  for (const c of custos) {
    if (c.sistema === "galeria") soma.galeria += c.centavos_por_mes;
    else if (c.sistema === "atomatiza") soma.atomatiza += c.centavos_por_mes;
    else soma.osDois += c.centavos_por_mes;
    if (!c.confirmado && c.centavos_por_mes > 0) soma.estimativas += 1;
  }
  return { ...soma, total: soma.galeria + soma.atomatiza + soma.osDois };
}

/**
 * O custo fixo que o painel da Galeria mostra: o que é só dela mais o que é
 * dos dois, INTEIRO — o mesmo critério de `config/custos-fixos.ts` (se a
 * Galeria se paga carregando a conta toda, se paga em qualquer rateio).
 */
export function custoFixoDaGaleriaCentavos(
  custos: Pick<CustoDaSociedade, "sistema" | "centavos_por_mes">[],
): number {
  return custos
    .filter((c) => c.sistema === "galeria" || c.sistema === "os-dois")
    .reduce((s, c) => s + c.centavos_por_mes, 0);
}
