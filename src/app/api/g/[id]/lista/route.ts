import { NextResponse, type NextRequest } from "next/server";
import { nomeNaEntrega, prepararEntrega } from "@/lib/entrega-da-galeria";

/**
 * A lista do que o celular vai salvar: id, nome do arquivo e tamanho.
 *
 * Mesmo pedido do zip (`?cap=`, `?favoritas=1`, ou nada para a galeria
 * inteira), mesmas travas — ver `lib/entrega-da-galeria.ts`. Sem link nenhum:
 * o original é assinado lote a lote pela rota `urls`, na hora de buscar. Uma
 * entrega de 2108 fotos pelo iPhone leva horas, e um link assinado no começo
 * venceria no caminho.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entrega = await prepararEntrega(id, request.nextUrl.searchParams);
  if (entrega instanceof NextResponse) return entrega;

  return NextResponse.json(
    {
      fotos: entrega.fotos.map((m) => ({
        id: m.id,
        nome: nomeNaEntrega(m, entrega),
        bytes: Number(m.bytes),
      })),
    },
    /* Pessoal (favoritas de quem pediu, galeria com senha): proxy nenhum guarda. */
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
