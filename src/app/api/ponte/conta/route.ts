import { NextResponse, type NextRequest } from "next/server";
import { autorizacaoConfere, marcarContaDoAtomatiza, segredoDaPonte } from "@/lib/ponte-atomatiza";

/**
 * O ATOMATIZA PERGUNTA: esta pessoa tem conta na Galeria Átomo?
 *
 * Chamada de servidor para servidor, a cada abertura do painel de lá (com
 * cache do lado de lá). Responde `{ conta: true | false }` e, no sim, marca o
 * estúdio — é essa marca que liga o seletor de plataforma no nosso painel.
 * Ver `src/lib/ponte-atomatiza.ts`.
 *
 * Sem `PONTE_ATOMO_SEGREDO` configurado, a porta fica fechada (503), como no
 * webhook do Asaas: aberta, esta rota diria a qualquer um se um e-mail é
 * nosso cliente.
 */
export async function POST(request: NextRequest) {
  const segredo = segredoDaPonte();
  if (!segredo) {
    return NextResponse.json({ erro: "ponte sem segredo configurado" }, { status: 503 });
  }
  if (!autorizacaoConfere(request.headers.get("authorization"), segredo)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  let corpo: { email?: unknown; documento?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "corpo inválido" }, { status: 400 });
  }

  const conta = await marcarContaDoAtomatiza({
    email: typeof corpo.email === "string" ? corpo.email : null,
    documento: typeof corpo.documento === "string" ? corpo.documento : null,
  });
  return NextResponse.json({ conta });
}
