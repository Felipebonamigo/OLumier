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

export type FalhaSenhaNova = "curta" | "diferentes";
export type FalhaTroca = FalhaSenhaNova | "igual-a-atual" | "atual-errada" | "sem-conta";

/**
 * A senha nova serve? Vale para as TRÊS telas que definem senha: cadastro,
 * recuperação e troca.
 *
 * Existia só aqui dentro, embutida em `trocarSenha`. O cadastro tinha um `8`
 * cravado à mão e nenhuma confirmação; a recuperação tinha o mínimo e nenhuma
 * confirmação. Ou seja: digitar errado no cadastro custava a conta recém criada,
 * e a pessoa descobria na hora de entrar — quando ainda não sabe que existe
 * "esqueci minha senha", acabou de conhecer o produto, e conclui que quebrou.
 *
 * A ordem das conferências é regra, não detalhe: o tamanho vem antes da
 * diferença. Duas senhas curtas e diferentes têm dois problemas, e dizer "não
 * conferem" primeiro faria a pessoa corrigir a digitação para tomar outro erro
 * logo em seguida.
 *
 * Nada é aparado. Espaço é caractere válido de senha, e aparar mudaria a senha
 * que a pessoa escolheu — se ela pôs espaço num campo e não no outro, são
 * senhas diferentes de verdade, e é melhor descobrir agora que amanhã.
 */
export function conferirSenhaNova(nova: string, repetida: string): FalhaSenhaNova | null {
  if (nova.length < MINIMO_SENHA) return "curta";
  if (nova !== repetida) return "diferentes";
  return null;
}

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
  const problema = conferirSenhaNova(nova, repetida);
  if (problema) return { ok: false, motivo: problema };
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
