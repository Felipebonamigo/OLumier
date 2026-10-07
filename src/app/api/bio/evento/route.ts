import { NextResponse, type NextRequest } from "next/server";
import { EVENTO_VISITA, rotulo } from "@/lib/bio-regras";
import { dentroDoLimite, quemPede, registrarEventoDaBio } from "@/lib/bio";
import { ipDaRequisicao } from "@/lib/origem";

/**
 * A VISITA À PÁGINA-PONTE — o único evento que o navegador avisa.
 *
 * Os cliques são contados no servidor, no redirecionador (`bio/ir/[destino]`).
 * A visita é diferente: só um navegador de verdade, que rodou o JavaScript da
 * página, chega aqui — e é isso que a separa do robô e da pré-visualização do
 * link, que baixam o HTML e nunca executam nada.
 *
 * Aceita UM nome de evento (`page_view`) e três rótulos de origem. O resto do
 * corpo é ignorado: esta rota é pública e escreve no banco, então o que ela
 * não precisa ler, ela não lê.
 *
 * Responde 204 em tudo o que não for pedido malformado — inclusive robô e
 * limite estourado. Dizer "você foi descartado" a quem está tentando inflar o
 * número só ensina a contornar.
 */
export async function POST(request: NextRequest) {
  /* Navegadores dizem de onde o pedido saiu. De outro site, não é a nossa página. */
  const de = request.headers.get("sec-fetch-site");
  if (de && de !== "same-origin") return new NextResponse(null, { status: 204 });

  let corpo: Record<string, unknown>;
  try {
    const lido = await request.json();
    if (!lido || typeof lido !== "object") throw new Error("corpo");
    corpo = lido as Record<string, unknown>;
  } catch {
    return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });
  }
  if (corpo.evento !== EVENTO_VISITA) return NextResponse.json({ erro: "evento desconhecido" }, { status: 400 });

  const quem = quemPede(await ipDaRequisicao(), request.headers.get("user-agent"));
  if (!quem.gente) return new NextResponse(null, { status: 204 });
  if (!dentroDoLimite(quem.visitante ?? "sem-ip")) return new NextResponse(null, { status: 204 });

  await registrarEventoDaBio({
    evento: EVENTO_VISITA,
    fonte: rotulo(corpo.fonte) ?? "direto",
    meio: rotulo(corpo.meio) ?? "nenhum",
    campanha: rotulo(corpo.campanha),
    visitante: quem.visitante,
  });
  return new NextResponse(null, { status: 204 });
}
