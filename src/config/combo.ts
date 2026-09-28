import { espacoValido, precoDoCicloCentavos, type Ciclo, type Plano } from "./planos";

/**
 * O COMBO GALERIA ÁTOMO + ATOMATIZA — as regras, sem banco e sem rede.
 *
 * ── O QUE FOI DECIDIDO (28/09/2026) ───────────────────────────────────────
 *
 * Felipe, sobre a proposta de preço dos dois juntos: "divide o valor 50% para
 * cada plataforma, e cada plataforma já tem a sua divisão em % diferentes com
 * os sócios", e "caso a pessoa já tenha um e queira o outro, o desconto será
 * igual".
 *
 *   · O desconto do combo é dividido MEIO A MEIO entre as duas plataformas, em
 *     reais. Quando não divide exato, a Atomatiza cede o centavo a mais — os
 *     preços fecham redondos dos dois lados (a Galeria em ,00; a Atomatiza em
 *     ,90).
 *   · Cada plataforma cobra a SUA parte na SUA assinatura, e divide com os
 *     sócios pela própria regra. Aqui nada muda no split: ele já é calculado
 *     sobre o preço que a assinatura cobra (`montarFatias`).
 *   · Quem já tem uma e assina a outra paga o mesmo combo: a que já existia
 *     baixa de preço. Cancelou uma, a outra volta ao cheio no ciclo seguinte.
 *
 * ── A TABELA É UM CONTRATO ENTRE DOIS REPOSITÓRIOS ────────────────────────
 *
 * A mesma tabela mora no Atomatiza (`src/lib/combo.ts` de lá), e as duas têm
 * de ser iguais: se divergirem, a soma das partes deixa de ser o preço que foi
 * prometido ao cliente. `scripts/testar-combo.mjs` prende os números daqui; o
 * teste de lá prende os de lá. Mudou aqui, mude lá.
 *
 * O desconto depende do PAR: do tamanho da galeria e da faixa do Atomatiza.
 * Por isso cada lado precisa saber o plano do outro — e ele lê isso na
 * descrição da assinatura do outro, no Asaas (a conta é a mesma). As duas
 * descrições também são contrato; ver `faixaDaDescricaoAtomatiza` e
 * `gbDaDescricaoGaleria`.
 */

/** As faixas do Atomatiza — quantas pessoas usam. Os ids são os de lá. */
export type FaixaAtomatiza = "solo" | "equipe" | "estudio";

/** Em que linha da tabela cai um espaço da Galeria. */
export type LinhaDaGaleria = "250" | "500" | "1000";

/**
 * Até 499 GB conta como a linha de 250, até 999 como a de 500, e de 1 TB para
 * cima como a de 1 TB. Acima de 1 TB a tabela não cresce: cada TB a mais custa
 * R$ 80 dos dois jeitos, e o desconto do combo é o da linha de 1 TB.
 */
export function linhaDaGaleria(gb: number): LinhaDaGaleria {
  if (gb >= 1000) return "1000";
  if (gb >= 500) return "500";
  return "250";
}

/**
 * Quanto cada plataforma cede por MÊS, em centavos, em cada par.
 *
 * Escrito por extenso, e não calculado, pelo motivo de sempre com dinheiro: um
 * reajuste tem de aparecer no diff, par por par. Os totais são os da proposta
 * aprovada — 250 GB + Solo sai por R$ 89,90 (R$ 40,00 + R$ 49,90), 500 GB +
 * Equipe por R$ 139,90, 1 TB + Estúdio por R$ 269,90.
 */
export const DESCONTOS_DO_COMBO: Record<
  LinhaDaGaleria,
  Record<FaixaAtomatiza, { galeria: number; atomatiza: number }>
> = {
  "250": {
    solo: { galeria: 999, atomatiza: 1000 },
    equipe: { galeria: 999, atomatiza: 1000 },
    estudio: { galeria: 1999, atomatiza: 2000 },
  },
  "500": {
    solo: { galeria: 999, atomatiza: 1000 },
    equipe: { galeria: 1499, atomatiza: 1500 },
    estudio: { galeria: 2499, atomatiza: 2500 },
  },
  "1000": {
    solo: { galeria: 1499, atomatiza: 1500 },
    equipe: { galeria: 1499, atomatiza: 1500 },
    estudio: { galeria: 2499, atomatiza: 2500 },
  },
};

/** O que o Atomatiza grava no `externalReference` da assinatura dele. */
export const PREFIXO_ATOMATIZA = "atz:sub:";

/**
 * A faixa do Atomatiza, lida na descrição da assinatura dele.
 *
 * Lá a descrição nasce como `Atomatiza — plano equipe` (`assinar`, em
 * `mutacoes-assinatura.ts`). As assinaturas mais antigas, de antes das faixas,
 * dizem "plano mensal" ou "plano anual" — e essas são o Solo de hoje.
 *
 * Descrição que não se lê devolve null, e null é "sem combo": o lado seguro é
 * cobrar o preço cheio, nunca dar um desconto que ninguém pode conferir.
 */
export function faixaDaDescricaoAtomatiza(descricao: string | null | undefined): FaixaAtomatiza | null {
  const m = /\bplano\s+(solo|equipe|est[uú]dio|mensal|anual)\b/i.exec(descricao ?? "");
  if (!m) return null;
  const palavra = m[1].toLowerCase();
  if (palavra === "equipe") return "equipe";
  if (palavra.startsWith("est")) return "estudio";
  return "solo";
}

/**
 * O tamanho da Galeria, lido na descrição da NOSSA assinatura.
 *
 * Quem usa isto é o Atomatiza — ele tem a mesma função. Mora aqui para o nosso
 * teste provar que a descrição que escrevemos continua legível do lado de lá:
 * é o contrato, e quem quebra é quem escreve.
 */
export function gbDaDescricaoGaleria(descricao: string | null | undefined): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(TB|GB)\b/i.exec(descricao ?? "");
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(m[2].toUpperCase() === "TB" ? n * 1000 : n);
}

/**
 * O plano entra no combo? Só os da grade atual (`g:<tipo>:<GB>`).
 *
 * Os ids antigos (os seis nomeados e os de três peças) têm preço congelado
 * de outra época, fora da tabela; tirar dez reais de um preço que já não é o
 * da vitrine faria um valor que ninguém prometeu. Eles continuam pagando o
 * que pagam, e o Atomatiza dá a metade dele normalmente.
 */
export function planoEntraNoCombo(plano: Plano): boolean {
  const partes = plano.id.split(":");
  return partes.length === 3 && partes[0] === "g" && espacoValido(Number(partes[2]));
}

/** Quanto a Galeria cede por mês, em centavos, neste par. Zero sem combo. */
export function descontoDaGaleriaCentavos(plano: Plano, faixa: FaixaAtomatiza | null): number {
  if (!faixa || !planoEntraNoCombo(plano)) return 0;
  return DESCONTOS_DO_COMBO[linhaDaGaleria(plano.quotaGb)][faixa].galeria;
}

/** O preço da Galeria no ciclo, já com o desconto do combo quando há. */
export function precoDoCicloComComboCentavos(
  plano: Plano,
  ciclo: Ciclo,
  faixa: FaixaAtomatiza | null,
): number {
  return precoDoCicloCentavos(plano.precoCentavos - descontoDaGaleriaCentavos(plano, faixa), ciclo);
}

/**
 * A descrição da assinatura da Galeria no Asaas.
 *
 * O tamanho tem de continuar legível por `gbDaDescricaoGaleria` — é o que o
 * Atomatiza lê para saber em que linha da tabela estamos.
 */
export function descricaoDaAssinatura(
  marca: string,
  plano: Plano,
  ciclo: Ciclo,
  faixa: FaixaAtomatiza | null,
): string {
  const combo = descontoDaGaleriaCentavos(plano, faixa) > 0 ? " · combo com o Atomatiza" : "";
  return `${marca} — ${plano.nome}${ciclo === "anual" ? " (anual)" : ""}${combo}`;
}

/** O nome da faixa para a tela. */
export const NOME_DA_FAIXA: Record<FaixaAtomatiza, string> = {
  solo: "Solo",
  equipe: "Equipe",
  estudio: "Estúdio",
};

export function ehFaixaAtomatiza(v: unknown): v is FaixaAtomatiza {
  return v === "solo" || v === "equipe" || v === "estudio";
}
