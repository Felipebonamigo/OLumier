/**
 * Quem pode ver o "Entrar com a conta do Pixieset" LIGADO.
 *
 * Felipe, 30/09/2026: "deixa desabilitado o botão de logar no pixieset por
 * enquanto, para todos, só vamos habilitar para os usuários que eu apontar".
 *
 * Duas travas, e as duas precisam abrir:
 *
 *   1. a CONTA está na lista — variável de ambiente, pelo mesmo motivo dos
 *      admins (`config/admin.ts`): uma coluna no banco poderia ser ligada por
 *      um `update` errado; a variável só muda com acesso ao servidor;
 *
 *   2. o CONECTOR existe. Hoje não existe (ver docs/importacao.md): liberar
 *      uma conta agora só troca o recado da tela, e o formulário continua
 *      desligado. Botão aceso sem nada atrás seria o "botão que não faz nada"
 *      que o PRODUCT.md proíbe.
 *
 * Vazia (o padrão) = ninguém.
 *
 *   PIXIESET_LOGIN_LIBERADO=felipe@exemplo.com,carol@exemplo.com
 */

/** Vira `true` no mesmo commit em que o conector que entra no Pixieset chegar. */
export const CONECTOR_PIXIESET_PRONTO = false;

export function contasLiberadasNoPixieset(): string[] {
  return (process.env.PIXIESET_LOGIN_LIBERADO ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** A conta deste e-mail foi apontada para usar o login do Pixieset. */
export function loginDoPixiesetLiberado(email: string | null | undefined): boolean {
  if (!email) return false;
  return contasLiberadasNoPixieset().includes(email.trim().toLowerCase());
}
