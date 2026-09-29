import { espacoValido, precoDoCicloCentavos, precoDoEspacoCentavos, type Ciclo, type Plano } from "./planos";

/**
 * O COMBO GALERIA ÁTOMO + ATOMATIZA — as regras, sem banco e sem rede.
 *
 * ── O QUE FOI DECIDIDO ─────────────────────────────────────────────────────
 *
 * 28/09/2026 — Felipe, sobre a proposta de preço dos dois juntos: "caso a
 * pessoa já tenha um e queira o outro, o desconto será igual". Cada
 * plataforma cobra a SUA parte na SUA assinatura, e divide com os sócios pela
 * própria regra (aqui o split já sai do preço que a assinatura cobra). Quem já
 * tem uma e assina a outra paga o mesmo combo: a que já existia baixa de
 * preço. Cancelou uma, a outra volta ao cheio no ciclo seguinte.
 *
 * 29/09/2026 — a divisão do desconto deixou de ser meio a meio em reais.
 * Felipe: "a receita é dividida [pela] porcentagem respectiva do pacote de
 * cada sistema, porque um pode ser bem mais caro que o outro, por exemplo se
 * a galeria for de 5 TB e o atomatiza o pacote solo". Meio a meio, o Solo
 * cedia R$ 15 de R$ 59,90 (25% do preço) enquanto os 5 TB cediam R$ 14,99 de
 * R$ 439,99 (3%). Agora cada lado cede a MESMA porcentagem do seu preço de
 * tabela — a receita do combo fica dividida na proporção dos dois pacotes, e
 * o total que o cliente paga continua o aprovado. Ver `divisaoDoDesconto`.
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
 * Quanto o PACOTE custa a menos por MÊS, em centavos, em cada par — o total
 * que as duas plataformas cedem juntas.
 *
 * Escrito por extenso, e não calculado, pelo motivo de sempre com dinheiro: um
 * reajuste tem de aparecer no diff, par por par. São os totais da proposta
 * aprovada — 250 GB + Solo por R$ 89,90, 500 GB + Equipe por R$ 139,90, 1 TB +
 * Estúdio por R$ 269,90.
 */
export const DESCONTO_DO_PACOTE: Record<LinhaDaGaleria, Record<FaixaAtomatiza, number>> = {
  "250": { solo: 1999, equipe: 1999, estudio: 3999 },
  "500": { solo: 1999, equipe: 2999, estudio: 4999 },
  "1000": { solo: 2999, equipe: 2999, estudio: 4999 },
};

/**
 * O preço MENSAL de tabela do Atomatiza, por faixa — a régua da proporção.
 *
 * É contrato, e não o preço vivo de lá (que vem do ambiente): as duas
 * plataformas têm de chegar à MESMA divisão sem se consultar, e a única
 * maneira é as duas usarem os mesmos números. O Atomatiza guarda uma cópia do
 * preço da Galeria pelo mesmo motivo.
 */
export const PRECO_DE_TABELA_ATOMATIZA: Record<FaixaAtomatiza, number> = {
  solo: 5990,
  equipe: 8990,
  estudio: 19990,
};

/**
 * Quanto cada plataforma cede por mês, em centavos, neste par.
 *
 * O desconto do pacote é dividido na proporção dos preços de tabela: a Galeria
 * cede `desconto × galeria ÷ (galeria + atomatiza)`, e o Atomatiza o resto — o
 * centavo do arredondamento fica com ele, para a soma fechar exata. Assim os
 * dois cedem a mesma porcentagem do próprio preço, e a receita do combo fica
 * na proporção dos dois pacotes.
 *
 * Com 5 TB (R$ 439,99) + Solo (R$ 59,90), o pacote cede R$ 29,99: R$ 26,40 da
 * Galeria e R$ 3,59 do Atomatiza, 6% de cada lado.
 */
export function divisaoDoDesconto(
  gb: number,
  faixa: FaixaAtomatiza,
): { galeria: number; atomatiza: number; pacote: number } {
  const pacote = DESCONTO_DO_PACOTE[linhaDaGaleria(gb)][faixa];
  const g = espacoValido(gb) ? precoDoEspacoCentavos(gb) : 0;
  const a = PRECO_DE_TABELA_ATOMATIZA[faixa];
  const galeria = g + a > 0 ? Math.round((pacote * g) / (g + a)) : 0;
  return { galeria, atomatiza: pacote - galeria, pacote };
}

/**
 * A divisão MEIO A MEIO de 28/09/2026, que ficou no ar um dia.
 *
 * Só serve à conferência automática (`recalcularCombo`): uma assinatura criada
 * nesse dia cobra um desses valores, e a conferência precisa reconhecê-lo como
 * "nosso" para trazê-lo à divisão nova — senão o tomaria por valor mudado à
 * mão e o deixaria como está.
 */
export const DESCONTOS_MEIO_A_MEIO_28_09: Record<LinhaDaGaleria, Record<FaixaAtomatiza, number>> = {
  "250": { solo: 999, equipe: 999, estudio: 1999 },
  "500": { solo: 999, equipe: 1499, estudio: 2499 },
  "1000": { solo: 1499, equipe: 1499, estudio: 2499 },
};

/** O que o Atomatiza grava no `externalReference` da assinatura dele. */
export const PREFIXO_ATOMATIZA = "atz:sub:";

/**
 * E na cobrança da DIFERENÇA de uma troca de faixa lá. Ela também dispara a
 * conferência do combo aqui: trocar de faixa muda o desconto dos dois lados, e
 * é por esse aviso que ficamos sabendo da troca na hora — a assinatura de lá
 * só volta a avisar no próximo pagamento.
 */
export const PREFIXO_DIFERENCA_ATOMATIZA = "atz:dif:";

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
  return divisaoDoDesconto(plano.quotaGb, faixa).galeria;
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
