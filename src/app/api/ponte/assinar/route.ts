import { NextResponse, type NextRequest } from "next/server";
import { autorizacaoConfere, segredoDaPonte } from "@/lib/ponte-atomatiza";
import { lerPedido, receberAssinatura } from "@/lib/pacote";

/**
 * O ATOMATIZA PEDE: cria a assinatura da Galeria para quem montou o pacote lá.
 *
 * Cria a conta se o CPF/CNPJ não tiver uma (com o e-mail de "crie a sua
 * senha"), e a assinatura com o combo desde já quando é pacote. As regras e os
 * códigos de recusa estão em `docs/pacote.md`; a lógica, em `lib/pacote.ts`.
 */
export async function POST(request: NextRequest) {
  const segredo = segredoDaPonte();
  if (!segredo) return NextResponse.json({ erro: "ponte sem segredo configurado" }, { status: 503 });
  if (!autorizacaoConfere(request.headers.get("authorization"), segredo)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "corpo inválido" }, { status: 400 });
  }

  const pedido = lerPedido(corpo);
  if (typeof pedido === "string") return NextResponse.json({ erro: pedido }, { status: 400 });

  try {
    const r = await receberAssinatura(pedido);
    if (r.ok) {
      return NextResponse.json({ ok: true, contaNova: r.contaNova, valorCentavos: r.valorCentavos, faturaUrl: r.faturaUrl });
    }
    return NextResponse.json({ erro: r.erro, ...(r.codigo ? { codigo: r.codigo } : {}) }, { status: r.status });
  } catch (e) {
    /* O detalhe fica no log daqui: a frase volta para a tela de lá, e erro
     * interno (SQL, Asaas) não é coisa para mostrar a cliente. */
    console.error("[pacote] o pedido do Atomatiza falhou:", e);
    return NextResponse.json(
      { erro: "A Galeria Átomo não conseguiu criar a assinatura agora. Tente de novo em instantes." },
      { status: 502 },
    );
  }
}
