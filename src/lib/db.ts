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
