import { NextResponse, type NextRequest } from "next/server";
import { sessaoAtual } from "@/lib/auth";
import { enderecosDasPrevias, LOTE_DE_PREVIAS } from "@/lib/previas-assinadas";

/**
 * OS ENDEREÇOS DA FOTO AMPLIADA (08/10/2026). O porquê está em
 * `lib/previas-assinadas.ts`.
 *
 * POST e sem cache, como a rota das miniaturas: são links assinados, com prazo.
 * Galeria de outro estúdio, ou foto que não é desta galeria, simplesmente não
 * volta na resposta.
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
    ids.length === 0 ||
    ids.length > LOTE_DE_PREVIAS ||
    !ids.every((i) => typeof i === "string" && UUID.test(i))
  ) {
    return NextResponse.json({ erro: "Lista de fotos inválida." }, { status: 400 });
  }

  const enderecos = await enderecosDasPrevias(id, tenantId, ids as string[]);
  return NextResponse.json({ enderecos }, { headers: { "Cache-Control": "private, no-store" } });
}
