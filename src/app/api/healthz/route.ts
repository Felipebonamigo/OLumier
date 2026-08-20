import { NextResponse } from "next/server";
import { testarConexao } from "@/lib/db";
import { conferirAcesso } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Checagem de saúde, para o vigia do servidor.
 *
 * Responde 200 só quando o app REALMENTE consegue trabalhar. Uma rota que
 * devolve "ok" apenas por o processo estar de pé engana: o Next continua
 * respondendo com o banco fora do ar, e a gente descobriria pelo cliente.
 *
 * Por isso testa as duas dependências de verdade:
 *   - banco    → um select barato
 *   - R2       → um HEAD numa chave que não existe (só prova que a credencial
 *                é aceita e o bucket responde; não lista nem baixa nada)
 *
 * O detalhe do erro NÃO vai no corpo: esta rota é pública, e mensagem de falha
 * de banco costuma carregar host e usuário. Quem precisa do detalhe olha o log.
 */
export async function GET() {
  const [banco, armazenamento] = await Promise.all([testarConexao(), conferirAcesso()]);

  const ok = banco.ok && armazenamento.ok;

  if (!ok) {
    console.error(
      `[healthz] banco=${banco.ok ? "ok" : banco.erro} armazenamento=${
        armazenamento.ok ? "ok" : armazenamento.erro
      }`,
    );
  }

  return NextResponse.json(
    {
      ok,
      banco: banco.ok,
      armazenamento: armazenamento.ok,
    },
    {
      status: ok ? 200 : 503,
      // Resposta de saúde nunca pode ser servida de cache: um "ok" velho é pior
      // que nenhuma resposta.
      headers: { "cache-control": "no-store" },
    },
  );
}
