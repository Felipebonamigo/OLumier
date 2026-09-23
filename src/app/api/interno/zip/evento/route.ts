import { NextResponse, type NextRequest } from "next/server";
import { autorizacaoConfere, relatoValido, segredoDoZip } from "@/lib/zip-remoto";
import { lerPedidoDeZip, registrarEntregaDeZip } from "@/lib/pedidos-zip";

/**
 * O RELATO do servidor de ZIP: montou, serviu ou caiu — com os bytes.
 *
 *   POST /api/interno/zip/evento   { pedidoId, evento, bytes, doCache, duracaoMs }
 *   Authorization: Bearer <ZIP_SEGREDO>
 *
 * É o que alimenta a Atividade da galeria (o "baixou tudo" que o fotógrafo
 * vê) e o painel de administração (quanto está saindo, e de onde). O servidor
 * relata DEPOIS de entregar, então uma falha aqui nunca segura um download.
 */
export async function POST(request: NextRequest) {
  if (!autorizacaoConfere(request.headers.get("authorization"), segredoDoZip())) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 401 });
  }
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "requisição inválida" }, { status: 400 });
  }
  if (!relatoValido(corpo)) return NextResponse.json({ erro: "relato inválido" }, { status: 400 });

  const pedido = await lerPedidoDeZip(corpo.pedidoId);
  if (!pedido) return NextResponse.json({ erro: "pedido não encontrado" }, { status: 404 });

  await registrarEntregaDeZip(pedido, "servidor", corpo);
  return NextResponse.json({ ok: true });
}
