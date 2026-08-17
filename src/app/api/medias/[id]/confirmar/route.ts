import { NextResponse, type NextRequest } from "next/server";
import { sessaoAtual } from "@/lib/auth";
import { buscarMedia, confirmarMedia, apagarMedia, anularDerivadas } from "@/lib/medias";
import { conferirObjeto, apagarObjeto, objetoExiste } from "@/lib/r2";

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

    // Derivada que não chegou vira null: a grade cai no original em vez de
    // mostrar imagem quebrada. Uma falha aqui NÃO invalida o upload.
    const [temThumb, temPreview] = await Promise.all([
      media.chave_thumb ? objetoExiste(media.chave_thumb) : Promise.resolve(true),
      media.chave_preview ? objetoExiste(media.chave_preview) : Promise.resolve(true),
    ]);
    if (!temThumb || !temPreview) {
      await anularDerivadas(mediaId, { thumb: !temThumb, preview: !temPreview });
    }

    const atualizada = await confirmarMedia(mediaId, tenantId, bytes);
    return NextResponse.json({
      ok: true,
      bytes: Number(atualizada!.bytes),
      derivadas: temThumb && temPreview,
    });
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
  // Apaga a família inteira (original + derivadas) para não deixar lixo pago.
  await Promise.all(
    [removida.chave, removida.chave_thumb, removida.chave_preview]
      .filter((c): c is string => Boolean(c))
      .map((c) => apagarObjeto(c).catch(() => {})),
  );

  return NextResponse.json({ ok: true });
}
