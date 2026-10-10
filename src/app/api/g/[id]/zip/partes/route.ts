import { NextResponse, type NextRequest } from "next/server";
import { prepararEntrega } from "@/lib/entrega-da-galeria";
import { entradasDoZip } from "@/lib/entradas-do-zip";
import { dividirEmPartes } from "@/lib/partes-do-zip";

/**
 * As partes da galeria grande, para o menu de baixar (10/10/2026).
 *
 * A divisão mora no servidor (`lib/partes-do-zip.ts`) e é a mesma que
 * `/api/g/<id>/zip?parte=` recalcula no clique: o menu não adivinha quantas
 * partes há nem quanto pesa cada uma. As travas são as do próprio ZIP — senha,
 * prazo, download liberado — porque a lista diz o tamanho da entrega.
 *
 * Só a galeria inteira: com capítulo, favoritas ou recorte no endereço, a
 * resposta é uma parte só, e o menu não oferece divisão nenhuma.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entrega = await prepararEntrega(id, request.nextUrl.searchParams);
  if (entrega instanceof NextResponse) return entrega;

  const { arquivos } = entradasDoZip(entrega);
  const partes = entrega.tipo === "tudo" ? dividirEmPartes(arquivos) : [arquivos];
  return NextResponse.json(
    {
      partes: partes.map((p, i) => ({
        numero: i + 1,
        arquivos: p.length,
        bytes: p.reduce((soma, a) => soma + a.tamanho, 0),
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
