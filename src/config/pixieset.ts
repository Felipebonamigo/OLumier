/**
 * Quem pode ver o "Entrar com a conta do Pixieset" LIGADO.
 *
 * Felipe, 30/09/2026: "deixa desabilitado o botão de logar no pixieset por
 * enquanto, para todos, só vamos habilitar para os usuários que eu apontar" —
 * e depois: "crie essa opção, para liberar, lá no admin".
 *
 * Duas travas, e as duas precisam abrir:
 *
 *   1. a CONTA foi liberada — o botão "Permitir Pixieset" na ficha do estúdio,
 *      no admin, que grava `tenants.pixieset_liberado_em` (migração 052);
 *
 *   2. o CONECTOR existe. Hoje não existe (ver docs/importacao.md): liberar
 *      uma conta agora só troca o recado da tela, e o formulário continua
 *      desligado. Botão aceso sem nada atrás seria o "botão que não faz nada"
 *      que o PRODUCT.md proíbe.
 *
 * Nulo (o padrão) = não liberado.
 */

/** Vira `true` no mesmo commit em que o conector que entra no Pixieset chegar. */
export const CONECTOR_PIXIESET_PRONTO = false;

/** A conta foi liberada no admin para usar o login do Pixieset. */
export function loginDoPixiesetLiberado(conta: { pixieset_liberado_em?: Date | null }): boolean {
  return Boolean(conta.pixieset_liberado_em);
}
