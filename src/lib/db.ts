import { Pool } from "pg";

/**
 * Pool do Postgres. Em dev o Next recarrega módulos a cada edição, então o pool
 * fica pendurado no globalThis — sem isso, cada save abre um pool novo e o banco
 * chega no limite de conexões.
 */

declare global {
  var _pgPool: Pool | undefined;
}

export const bancoConfigurado = Boolean(process.env.DATABASE_URL);

export function pool(): Pool {
  if (!bancoConfigurado) {
    throw new Error("DATABASE_URL não configurada em .env.local");
  }
  globalThis._pgPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return globalThis._pgPool;
}

export async function consultar<T = Record<string, unknown>>(
  sql: string,
  valores: unknown[] = [],
): Promise<T[]> {
  const r = await pool().query(sql, valores);
  return r.rows as T[];
}

export async function consultarUm<T = Record<string, unknown>>(
  sql: string,
  valores: unknown[] = [],
): Promise<T | null> {
  const linhas = await consultar<T>(sql, valores);
  return linhas[0] ?? null;
}

/** Testa a conexão sem derrubar a página — as telas mostram o estado real da infra. */
export async function testarConexao(): Promise<{ ok: boolean; erro?: string }> {
  if (!bancoConfigurado) return { ok: false, erro: "DATABASE_URL não configurada" };
  try {
    await consultar("select 1");
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Roda as consultas de `corpo` numa transação de verdade.
 *
 * ── O DEFEITO QUE ISTO CORRIGE (05/09/2026) ───────────────────────────────
 *
 * `consultar` pede uma conexão ao POOL a cada chamada. Escrever
 *
 *     await consultar("begin");
 *     await consultar("update …");
 *     await consultar("commit");
 *
 * parece uma transação e não é: as três podem sair por conexões diferentes, e
 * aí o `begin` abre transação numa conexão que nunca recebe o `update`, o
 * `update` roda em auto-commit e o `commit` fecha nada. Enquanto o pool está
 * ocioso ele devolve sempre o mesmo cliente e o erro não aparece; ele aparece no
 * dia de movimento, que é o pior dia para aparecer.
 *
 * Aqui a conexão é retirada UMA vez e devolvida no fim, aconteça o que
 * acontecer. É a diferença entre "quase sempre atômico" e atômico.
 */
export async function emTransacao<T>(corpo: (q: Consulta) => Promise<T>): Promise<T> {
  const cliente = await pool().connect();
  try {
    await cliente.query("begin");
    const saida = await corpo(async <R = Record<string, unknown>>(sql: string, valores: unknown[] = []) => {
      const r = await cliente.query(sql, valores);
      return r.rows as R[];
    });
    await cliente.query("commit");
    return saida;
  } catch (e) {
    await cliente.query("rollback").catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

/** A mesma assinatura de `consultar`, mas presa à conexão da transação. */
export type Consulta = <T = Record<string, unknown>>(
  sql: string,
  valores?: unknown[],
) => Promise<T[]>;
