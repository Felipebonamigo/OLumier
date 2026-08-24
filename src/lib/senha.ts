import "server-only";
import { consultar, consultarUm } from "./db";
import { conferirSenha, gerarHashSenha } from "./auth";

/**
 * Troca de senha do fotógrafo — a regra, separada da tela.
 *
 * Mora aqui e não dentro do server action porque action não se chama de fora:
 * para exercitar isto num teste seria preciso o id interno que o Next gera. Uma
 * regra de autenticação que não dá para testar acaba não sendo testada.
 */

/** Mínimo da senha. Vale para cadastro, recuperação e troca — um número só. */
export const MINIMO_SENHA = 8;

export type FalhaTroca = "curta" | "diferentes" | "igual-a-atual" | "atual-errada" | "sem-conta";

/**
 * Troca a senha conferindo a atual.
 *
 * Devolve o motivo da recusa em vez de lançar: quem chama precisa transformar
 * cada caso numa frase para a pessoa, e exceção obrigaria a inspecionar mensagem
 * de texto para decidir.
 */
export async function trocarSenha(
  tenantId: string,
  atual: string,
  nova: string,
  repetida: string,
): Promise<{ ok: true } | { ok: false; motivo: FalhaTroca }> {
  if (nova.length < MINIMO_SENHA) return { ok: false, motivo: "curta" };
  if (nova !== repetida) return { ok: false, motivo: "diferentes" };
  if (nova === atual) return { ok: false, motivo: "igual-a-atual" };

  const t = await consultarUm<{ senha_hash: string }>(
    "select senha_hash from tenants where id = $1",
    [tenantId],
  );
  if (!t) return { ok: false, motivo: "sem-conta" };
  if (!(await conferirSenha(atual, t.senha_hash))) return { ok: false, motivo: "atual-errada" };

  /*
   * `senha_alterada_em` derruba toda sessão emitida antes desta hora — ver
   * src/lib/auth.ts. Quem está trocando recebe um cookie novo em seguida (isso
   * é responsabilidade de quem chama, porque depende do contexto de requisição).
   */
  await consultar("update tenants set senha_hash = $1, senha_alterada_em = now() where id = $2", [
    await gerarHashSenha(nova),
    tenantId,
  ]);

  /*
   * Um pedido de recuperação em aberto morre aqui.
   *
   * Cenário real: a pessoa desconfia de invasão, pede o link por e-mail, se
   * lembra da senha e troca por aqui. O link continuaria valendo por uma hora —
   * na caixa de entrada de quem ela estava tentando expulsar.
   */
  await consultar(
    "update recuperacoes set usado_em = now() where tenant_id = $1 and usado_em is null",
    [tenantId],
  );

  return { ok: true };
}
