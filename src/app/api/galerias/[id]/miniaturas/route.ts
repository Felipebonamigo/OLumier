import { NextResponse, type NextRequest } from "next/server";
import { sessaoAtual } from "@/lib/auth";
import { enderecosDasMiniaturas } from "@/lib/miniaturas-assinadas";
import { LOTE_DE_MINIATURAS } from "@/lib/miniaturas-do-painel";

/**
 * OS ENDEREÇOS DAS MINIATURAS DA ABA FOTOS, EM LOTE (01/10/2026).
 *
 * A grade pede quando o ladrilho chega perto da tela, em vez de a página
 * mandar os 4.577 endereços em toda volta do servidor. O porquê inteiro está
 * em `lib/miniaturas-do-painel.ts`.
 *
 * POST, e não GET: 200 ids não cabem com folga numa URL, e esta resposta não
 * deve ficar em cache nenhum — são links assinados, com prazo.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await sessaoAtual();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ erro: "Galeria inválida." }, { status: 400 });

  const corpo = await request.json().catch(() => null);
  const ids = (corpo as { ids?: unknown } | null)?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length > LOTE_DE_MINIATURAS ||
    !ids.every((i) => typeof i === "string" && UUID.test(i))
  ) {
    return NextResponse.json({ erro: "Lista de fotos inválida." }, { status: 400 });
  }

  /* Galeria de outro estúdio, ou id que não é desta galeria: simplesmente não
     volta — a consulta filtra pelos dois, e a resposta só tem o que é seu. */
  const enderecos = await enderecosDasMiniaturas(id, tenantId, ids as string[]);
  return NextResponse.json({ enderecos }, { headers: { "Cache-Control": "private, no-store" } });
}
