import { NextResponse, type NextRequest } from "next/server";
import { consultarUm } from "@/lib/db";
import { alternar, garantirVisitante, minhasFavoritas } from "@/lib/favoritas";
import { temAcessoLiberado } from "@/lib/galerias-publicas";

/**
 * Marcar e desmarcar favorita. Sem login: quem tem o link (e a senha, se
 * houver) pode marcar.
 *
 * A conferência de senha NÃO é opcional aqui. Sem ela, alguém que só descobriu
 * o id da galeria conseguiria marcar fotos de uma galeria trancada — sem nunca
 * ver as fotos, mas sujando a lista que o fotógrafo usa para montar o álbum.
 */
async function galeriaLiberada(id: string) {
  const galeria = await consultarUm<{ id: string; senha_hash: string | null; estado: string }>(
    "select id, senha_hash, estado from galerias where id = $1 and publicada",
    [id],
  );
  if (!galeria) return { ok: false as const, status: 404 };
  // No cofre a galeria não abre para ninguém; marcar também não faz sentido.
  if (galeria.estado !== "online") return { ok: false as const, status: 409 };
  if (galeria.senha_hash && !(await temAcessoLiberado(id, galeria.senha_hash))) {
    return { ok: false as const, status: 401 };
  }
  return { ok: true as const, galeria };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const permissao = await galeriaLiberada(id);
  if (!permissao.ok) return NextResponse.json({ erro: "sem acesso" }, { status: permissao.status });

  let corpo: { mediaId?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "requisição inválida" }, { status: 400 });
  }

  const mediaId = String(corpo.mediaId ?? "");
  if (!mediaId) return NextResponse.json({ erro: "foto não informada" }, { status: 400 });

  // O cookie do visitante nasce aqui, no primeiro clique — não na visita.
  const visitante = await garantirVisitante(id);
  const r = await alternar(id, mediaId, visitante);
  if (!r) return NextResponse.json({ erro: "foto não é desta galeria" }, { status: 404 });

  return NextResponse.json(r);
}

/** As favoritas deste visitante. Usada só para reconciliar depois de um erro. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const permissao = await galeriaLiberada(id);
  if (!permissao.ok) return NextResponse.json({ erro: "sem acesso" }, { status: permissao.status });
  return NextResponse.json({ favoritas: await minhasFavoritas(id) });
}
