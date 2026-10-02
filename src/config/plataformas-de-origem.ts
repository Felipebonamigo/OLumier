/**
 * De onde o fotógrafo pode vir com o acervo — e quem pode ver o "Entrar com a
 * conta de lá" LIGADO.
 *
 * Felipe, 30/09/2026: "deixa desabilitado o botão de logar no pixieset por
 * enquanto, para todos, só vamos habilitar para os usuários que eu apontar";
 * depois, "crie essa opção, para liberar, lá no admin"; e por fim, "crie a
 * opção Login com a conta do Pixellu, igual foi feito para o pixieset, só eu
 * posso habilitar pelo menu admin".
 *
 * Uma lista, e não um arquivo por plataforma: a regra é a mesma para todas, e
 * a terceira plataforma é uma linha aqui mais uma coluna no banco.
 *
 * Duas travas por plataforma, e as duas precisam abrir:
 *
 *   1. a CONTA foi liberada — o botão "Permitir <plataforma>" na ficha do
 *      estúdio, no admin, que grava a coluna da plataforma em `tenants`
 *      (migrações 051 e 053);
 *
 *   2. o CONECTOR existe. Hoje nenhum existe (ver docs/importacao.md): liberar
 *      uma conta só troca o recado da tela, e o formulário continua desligado.
 *      Botão aceso sem nada atrás seria o "botão que não faz nada" que o
 *      PRODUCT.md proíbe.
 *
 * Nulo (o padrão) = não liberado.
 */

export type Plataforma = "pixieset" | "pixellu";

/** A coluna de `tenants` que guarda desde quando a conta está liberada. */
export type ColunaDeLiberacao = "pixieset_liberado_em" | "pixellu_liberado_em";

export interface PlataformaDeOrigem {
  id: Plataforma;
  nome: string;
  coluna: ColunaDeLiberacao;
  /** Vira `true` no mesmo commit em que o conector dessa plataforma chegar. */
  conectorPronto: boolean;
}

export const PLATAFORMAS: readonly PlataformaDeOrigem[] = [
  { id: "pixieset", nome: "Pixieset", coluna: "pixieset_liberado_em", conectorPronto: false },
  { id: "pixellu", nome: "Pixellu", coluna: "pixellu_liberado_em", conectorPronto: false },
];

/** A plataforma pelo id que veio de fora (formulário, URL) — ou nada. */
export function plataformaPorId(id: unknown): PlataformaDeOrigem | undefined {
  return PLATAFORMAS.find((p) => p.id === id);
}

/** A conta foi liberada no admin para usar o login desta plataforma. */
export function loginLiberado(
  conta: Partial<Record<ColunaDeLiberacao, Date | null>>,
  plataforma: Plataforma,
): boolean {
  const p = plataformaPorId(plataforma);
  return Boolean(p && conta[p.coluna]);
}
