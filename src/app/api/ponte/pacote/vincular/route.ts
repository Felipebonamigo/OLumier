import { NextResponse, type NextRequest } from "next/server";
import { autorizacaoConfere, segredoDaPonte } from "@/lib/ponte-atomatiza";
import { vincularPacote } from "@/lib/pacote";

/**
 * A FATURA ÚNICA NASCEU NO ATOMATIZA: grava aqui que a assinatura desta conta
 * é a do pacote. A assinatura é lida no Asaas e a referência dela conferida —
 * ver `vincularPacote` e `docs/pacote.md`.
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
  try {
    const r = await vincularPacote(corpo);
    if (r.ok) return NextResponse.json({ ok: true });
    return NextResponse.json({ erro: r.erro, ...(r.codigo ? { codigo: r.codigo } : {}) }, { status: r.status });
  } catch (e) {
    console.error("[pacote] vincular falhou:", e);
    return NextResponse.json({ erro: "A Galeria Átomo não conseguiu gravar o pacote agora." }, { status: 502 });
  }
}
