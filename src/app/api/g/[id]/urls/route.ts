import { NextResponse, type NextRequest } from "next/server";
import { consultar, consultarUm } from "@/lib/db";
import { temAcessoLiberado } from "@/lib/galerias-publicas";
import { armazemDe, urlDaDerivada, urlDoOriginal } from "@/lib/armazem";

/**
 * URLs do lightbox e do download, assinadas SOB DEMANDA.
 *
 * Até 03/09/2026 a página da galeria assinava três URLs por foto e mandava as
 * três no HTML. Medido na galeria real de 111 fotos: 454 KB de página, 62 %
 * eram URL assinada, e preview + original — que a primeira pintura não usa —
 * eram 147 KB. Num casamento de 600 fotos, 800 KB a mais no 4G do salão.
 *
 * Agora o HTML leva só a miniatura. O preview é pedido aqui quando o lightbox
 * abre (a foto atual e as vizinhas), e o original quando alguém clica em
 * baixar. Uma ida e volta a mais nesses dois momentos, em troca de um terço da
 * página a menos para todo mundo — inclusive quem nunca amplia nada.
 *
 * ── A RÉGUA É A MESMA DA PÁGINA, E É AQUI QUE ELA MORA AGORA ───────────────
 *
 * Publicada, no ar, senha quando houver — e download SÓ quando o fotógrafo
 * permitiu. Essa última regra é a razão de a rota existir com cuidado: antes
 * o interruptor de download decidia se a URL do original ia no HTML; agora
 * decide se esta rota a entrega. "Esconder o botão não é proteger: o
 * interruptor precisa apagar o link" continua valendo, e o link agora nem
 * chega a nascer.
 */

const VALIDADE = 6 * 3600;
/** Teto de ids por pedido. "Baixar tudo" pede a galeria inteira de uma vez. */
const MAX_IDS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const galeria = await consultarUm<{
    senha_hash: string | null;
    estado: string;
    permite_download: boolean;
  }>("select senha_hash, estado, permite_download from galerias where id = $1 and publicada", [id]);
  if (!galeria) return NextResponse.json({ erro: "sem acesso" }, { status: 404 });
  if (galeria.estado !== "online") return NextResponse.json({ erro: "sem acesso" }, { status: 409 });
  if (galeria.senha_hash && !(await temAcessoLiberado(id, galeria.senha_hash))) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 401 });
  }

  let corpo: { ids?: unknown; tipo?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "requisição inválida" }, { status: 400 });
  }

  const { ids, tipo } = corpo;
  if (
    (tipo !== "preview" && tipo !== "download") ||
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_IDS ||
    !ids.every((i) => typeof i === "string" && UUID.test(i))
  ) {
    return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });
  }

  if (tipo === "download" && !galeria.permite_download) {
    return NextResponse.json({ erro: "download não permitido nesta galeria" }, { status: 403 });
  }

  /*
   * `galeria_id = $1` no where é o que impede pedir foto de outra galeria por
   * esta: id que não é desta simplesmente não volta.
   */
  const medias = await consultar<{
    id: string;
    chave: string;
    chave_preview: string | null;
    nome_original: string;
    armazem: string;
  }>(
    `select id, chave, chave_preview, nome_original, armazem
       from medias
      where galeria_id = $1 and pronto and id = any($2::uuid[])`,
    [id, ids],
  );

  const pares = await Promise.all(
    medias.map(async (m) => {
      const armazem = armazemDe(m.armazem);
      const url =
        tipo === "preview"
          ? await urlDaDerivada(m.chave_preview, m.chave, armazem, VALIDADE)
          : await urlDoOriginal(m.chave, armazem, VALIDADE, m.nome_original);
      return [m.id, url] as const;
    }),
  );

  return NextResponse.json({ urls: Object.fromEntries(pares) });
}
