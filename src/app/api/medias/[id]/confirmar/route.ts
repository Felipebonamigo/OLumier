import { NextResponse, type NextRequest } from "next/server";
import { sessaoAtual } from "@/lib/auth";
import { buscarMedia, confirmarMedia, apagarMedia } from "@/lib/medias";
import { conferirObjeto, apagarObjeto } from "@/lib/r2";

/**
 * Confirma que o arquivo chegou ao bucket.
 *
 * Aqui perguntamos ao próprio bucket qual é o tamanho real do objeto. Isso não é
 * capricho: o número que o navegador declarou no preparo é um palpite do cliente,
 * e quota (que é o nosso custo) não pode ser sustentada por um dado que o usuário
 * escolhe. Se o objeto não estiver lá, a linha pendente é removida.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await sessaoAtual();
  if (!tenantId) {
    return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  }

  const { id: mediaId } = await params;
  const media = await buscarMedia(mediaId, tenantId);
  if (!media) return NextResponse.json({ erro: "Arquivo não encontrado." }, { status: 404 });
  if (media.pronto) return NextResponse.json({ ok: true, bytes: Number(media.bytes) });

  try {
    const { bytes } = await conferirObjeto(media.chave);
    const atualizada = await confirmarMedia(mediaId, tenantId, bytes);
    return NextResponse.json({ ok: true, bytes: Number(atualizada!.bytes) });
  } catch {
    // Não chegou ao bucket: some com a reserva para não travar a quota do cliente.
    await apagarMedia(mediaId, tenantId);
    return NextResponse.json({ erro: "O arquivo não chegou ao armazenamento." }, { status: 502 });
  }
}

/** Remove um arquivo: sai do bucket e do banco (o trigger devolve o espaço). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = await sessaoAtual();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const { id: mediaId } = await params;
  const removida = await apagarMedia(mediaId, tenantId);
  if (!removida) return NextResponse.json({ erro: "Arquivo não encontrado." }, { status: 404 });

  // O banco é a fonte da verdade: se o objeto já não existir no bucket, tudo bem.
  try {
    await apagarObjeto(removida.chave);
  } catch {
    /* objeto já não estava lá */
  }

  return NextResponse.json({ ok: true });
}
