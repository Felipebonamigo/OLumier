import { NextResponse, type NextRequest } from "next/server";
import { autorizacaoConfere, segredoDoZip } from "@/lib/zip-remoto";
import { lerPedidoDeZip, manifestoDoPedido } from "@/lib/pedidos-zip";

/**
 * O MANIFESTO de um pedido de ZIP — só para o servidor de ZIP.
 *
 *   GET /api/interno/zip/manifesto/<pedidoId>[?comUrls=1]
 *   Authorization: Bearer <ZIP_SEGREDO>
 *
 * Não há sessão nem cookie aqui: quem autentica é o segredo compartilhado, e
 * quem já decidiu o que entra no ZIP foi `prepararEntrega`, no clique. Esta
 * rota não reavalia trava nenhuma de propósito — o pedido expira em 12 horas,
 * e um pedido é a foto de uma permissão que existiu.
 *
 * `comUrls=1` assina a URL de cada original. O servidor só pede isso quando
 * vai MONTAR; para servir do arquivo guardado, o manifesto sem URLs basta.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ pedido: string }> }) {
  if (!autorizacaoConfere(request.headers.get("authorization"), segredoDoZip())) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 401 });
  }
  const { pedido: id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });

  const pedido = await lerPedidoDeZip(id);
  if (!pedido) return NextResponse.json({ erro: "pedido não encontrado" }, { status: 404 });
  if (new Date(pedido.expira_em) < new Date()) {
    return NextResponse.json({ erro: "pedido vencido" }, { status: 410 });
  }

  const manifesto = await manifestoDoPedido(pedido, request.nextUrl.searchParams.get("comUrls") === "1");
  return NextResponse.json(manifesto, { headers: { "Cache-Control": "private, no-store" } });
}
