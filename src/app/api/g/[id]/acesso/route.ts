import { NextResponse, type NextRequest } from "next/server";
import { registrarAcesso } from "@/lib/galerias-publicas";
import { consultarUm } from "@/lib/db";

const ACOES = new Set(["abriu", "baixou", "baixou_tudo", "assistiu"]);

/**
 * Registro de acesso do cliente final. Não exige autenticação — quem tem o link
 * pode abrir — mas confere se a galeria existe e está publicada, para o endpoint
 * não virar um jeito de encher a tabela com lixo.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const galeria = await consultarUm<{ id: string }>(
    "select id from galerias where id = $1 and publicada",
    [id],
  );
  if (!galeria) return NextResponse.json({ ok: false }, { status: 404 });

  let corpo: { acao?: string; mediaId?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const acao = String(corpo.acao ?? "");
  if (!ACOES.has(acao)) return NextResponse.json({ ok: false }, { status: 400 });

  await registrarAcesso({
    galeriaId: id,
    mediaId: corpo.mediaId,
    acao: acao as "abriu" | "baixou" | "baixou_tudo" | "assistiu",
    ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}
