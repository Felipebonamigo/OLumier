import { NextResponse, type NextRequest } from "next/server";
import { consultarUm } from "@/lib/db";
import { temAcessoLiberado } from "@/lib/galerias-publicas";
import { procurarRostos } from "@/lib/rostos";
import { MAX_VETORES_NA_BUSCA, vetorValido } from "@/config/rostos";

/**
 * A busca do CONVIDADO: "em quais fotos eu apareço?"
 *
 * O que chega aqui são números — 128 por vetor, no máximo dois vetores (a
 * selfie e o espelho dela). A imagem nunca chega: a medição acontece no
 * aparelho do convidado, e é isso que sustenta o texto que ele leu antes de
 * tirar a foto ("a sua selfie não sai daqui").
 *
 * Mesma régua de acesso das favoritas: link, e senha quando houver. Sem a
 * senha, alguém com o id da galeria poderia varrer os rostos de uma galeria
 * trancada — sem ver foto nenhuma, mas descobrindo quem está nela.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const galeria = await consultarUm<{ senha_hash: string | null; estado: string; rostos_ativos: boolean }>(
    "select senha_hash, estado, rostos_ativos from galerias where id = $1 and publicada",
    [id],
  );
  /*
   * Busca desligada é 404, não 403: para o convidado o recurso NÃO EXISTE
   * nesta galeria. Um 403 diria "existe, mas não para você" — e convidaria a
   * insistir.
   */
  if (!galeria || !galeria.rostos_ativos) {
    return NextResponse.json({ erro: "busca por rosto indisponível" }, { status: 404 });
  }
  if (galeria.estado !== "online") return NextResponse.json({ erro: "sem acesso" }, { status: 409 });
  if (galeria.senha_hash && !(await temAcessoLiberado(id, galeria.senha_hash))) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 401 });
  }

  let corpo: { vetores?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "requisição inválida" }, { status: 400 });
  }

  const vetores = corpo.vetores;
  if (
    !Array.isArray(vetores) ||
    vetores.length === 0 ||
    vetores.length > MAX_VETORES_NA_BUSCA ||
    !vetores.every(vetorValido)
  ) {
    return NextResponse.json({ erro: "vetor inválido" }, { status: 400 });
  }

  const fotos = await procurarRostos(id, vetores);
  return NextResponse.json({ fotos });
}
