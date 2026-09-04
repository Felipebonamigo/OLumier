import { NextResponse, type NextRequest } from "next/server";
import { tenantDaRequisicao } from "@/lib/auth-api";
import { guardarRostos, lerRostos } from "@/lib/rostos";

/**
 * O FOTÓGRAFO guarda os rostos de uma foto.
 *
 * O navegador dele mediu os rostos durante o envio (ou depois, no botão de
 * reindexar) e manda só o resultado: caixa, tamanho e os 128 números. Este
 * servidor nunca vê a foto — continua valendo a regra de que arquivo não
 * passa por aqui.
 *
 * Chave de API com escopo `envio` também serve: um plugin do Lightroom que
 * já sobe a foto pode subir os rostos junto.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantDaRequisicao(request, "envio");
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const { id: mediaId } = await params;

  let corpo: { rostos?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const lidos = lerRostos(corpo.rostos);
  if (!lidos) return NextResponse.json({ erro: "Rostos em formato inválido." }, { status: 400 });

  const r = await guardarRostos(mediaId, tenantId, lidos.rostos);
  /*
   * 409 e não 404: a foto pode existir e ser sua — o que falta é o
   * consentimento. Guardar vetor numa galeria com a busca desligada seria
   * guardar dado biométrico sem base legal, e a porta fecha AQUI, não na tela.
   */
  if (!r) {
    return NextResponse.json(
      { erro: "A busca por rosto está desligada nesta galeria." },
      { status: 409 },
    );
  }

  return NextResponse.json({ salvos: r.salvos, descartados: lidos.descartados });
}
