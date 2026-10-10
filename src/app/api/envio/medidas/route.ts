import { NextResponse, type NextRequest } from "next/server";
import { tenantDaRequisicao } from "@/lib/auth-api";
import { consultar } from "@/lib/db";
import { lerLeva, lerMedidas, navegadorResumido } from "@/lib/velocidade-regras";

/**
 * As medidas do envio de fotos, em lote (migração 053).
 *
 * A fila do navegador junta o que terminou — subiu ou desistiu — e manda de
 * tempos em tempos, não uma requisição por foto. Falhar aqui não pode atrapalhar
 * o envio de ninguém: a fila manda e esquece.
 *
 * A galeria só entra se for DESTE estúdio; de outro, a medida fica sem galeria
 * (a velocidade continua valendo, o vínculo não).
 *
 * `leva` (migração 069) é a fila inteira, mandada uma vez quando ela seca.
 * Pode vir sozinha, sem medidas: a última foto já foi no lote anterior. O que
 * vier torto recusa o pedido inteiro, como sempre foi.
 */
export async function POST(request: NextRequest) {
  const tenantId = await tenantDaRequisicao(request, "envio");
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  let corpo: { medidas?: unknown; leva?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }
  const medidas = corpo.medidas === undefined ? [] : lerMedidas(corpo.medidas);
  const leva = corpo.leva === undefined ? null : lerLeva(corpo.leva);
  if (!medidas || (corpo.leva !== undefined && !leva) || (medidas.length === 0 && !leva)) {
    return NextResponse.json({ erro: "Medidas inválidas." }, { status: 400 });
  }
  const navegador = navegadorResumido(request.headers.get("user-agent"));

  if (leva) {
    await consultar(
      `insert into envios_levas (tenant_id, bytes, ms, arquivos, falhas, paralelos, navegador)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, leva.bytes, leva.ms, leva.arquivos, leva.falhas, leva.paralelos, navegador],
    );
  }
  if (medidas.length === 0) return NextResponse.json({ ok: true, gravadas: 0 });

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

  await consultar(
    `insert into envios_medidos (tenant_id, galeria_id, bytes, ms, ok, erro, recusa, navegador)
     select $1, g, b, m, o, e, r, $8
       from unnest($2::uuid[], $3::bigint[], $4::int[], $5::boolean[], $6::text[], $7::boolean[])
         as t(g, b, m, o, e, r)`,
    [
      tenantId,
      medidas.map((m) => (m.galeriaId && minhas.has(m.galeriaId) ? m.galeriaId : null)),
      medidas.map((m) => m.bytes),
      medidas.map((m) => m.ms),
      medidas.map((m) => m.ok),
      medidas.map((m) => m.erro),
      medidas.map((m) => m.recusa),
      navegador,
    ],
  );
  return NextResponse.json({ ok: true, gravadas: medidas.length });
}
