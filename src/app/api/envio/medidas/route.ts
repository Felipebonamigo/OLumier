import { NextResponse, type NextRequest } from "next/server";
import { tenantDaRequisicao } from "@/lib/auth-api";
import { consultar } from "@/lib/db";
import { lerMedidas, navegadorResumido } from "@/lib/velocidade-regras";

/**
 * As medidas do envio de fotos, em lote (migração 053).
 *
 * A fila do navegador junta o que terminou — subiu ou desistiu — e manda de
 * tempos em tempos, não uma requisição por foto. Falhar aqui não pode atrapalhar
 * o envio de ninguém: a fila manda e esquece.
 *
 * A galeria só entra se for DESTE estúdio; de outro, a medida fica sem galeria
 * (a velocidade continua valendo, o vínculo não).
 */
export async function POST(request: NextRequest) {
  const tenantId = await tenantDaRequisicao(request, "envio");
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  let corpo: { medidas?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }
  const medidas = lerMedidas(corpo.medidas);
  if (!medidas) return NextResponse.json({ erro: "Medidas inválidas." }, { status: 400 });

  const ids = [...new Set(medidas.map((m) => m.galeriaId).filter(Boolean))] as string[];
  const minhas = ids.length
    ? new Set(
        (
          await consultar<{ id: string }>(
            "select id from galerias where tenant_id = $1 and id = any($2::uuid[])",
            [tenantId, ids],
          )
        ).map((g) => g.id),
      )
    : new Set<string>();

  const navegador = navegadorResumido(request.headers.get("user-agent"));
  await consultar(
    `insert into envios_medidos (tenant_id, galeria_id, bytes, ms, ok, erro, navegador)
     select $1, g, b, m, o, e, $7
       from unnest($2::uuid[], $3::bigint[], $4::int[], $5::boolean[], $6::text[]) as t(g, b, m, o, e)`,
    [
      tenantId,
      medidas.map((m) => (m.galeriaId && minhas.has(m.galeriaId) ? m.galeriaId : null)),
      medidas.map((m) => m.bytes),
      medidas.map((m) => m.ms),
      medidas.map((m) => m.ok),
      medidas.map((m) => m.erro),
      navegador,
    ],
  );
  return NextResponse.json({ ok: true, gravadas: medidas.length });
}
