import { NextResponse, type NextRequest } from "next/server";
import { autorizacaoConfere, segredoDaPonte } from "@/lib/ponte-atomatiza";
import { lerPedido, prepararPacote } from "@/lib/pacote";

/**
 * O ATOMATIZA VAI CRIAR A FATURA ÚNICA DO PACOTE: prepara a conta daqui.
 *
 * Acha ou cria a conta (as regras de `/api/ponte/assinar`), põe no plano pedido
 * e responde quanto a Galeria cobra no pacote e como a parte dela se divide
 * entre os sócios — sem criar assinatura. Ver `docs/pacote.md`, "Fatura única".
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
  const pedido = lerPedido({ ...(corpo as object), pacote: true });
  if (typeof pedido === "string") return NextResponse.json({ erro: pedido }, { status: 400 });
  try {
    const r = await prepararPacote(pedido);
    if (r.ok) return NextResponse.json(r);
    return NextResponse.json({ erro: r.erro, ...(r.codigo ? { codigo: r.codigo } : {}) }, { status: r.status });
  } catch (e) {
    console.error("[pacote] preparar falhou:", e);
    return NextResponse.json({ erro: "A Galeria Átomo não conseguiu preparar o pacote agora." }, { status: 502 });
  }
}
