import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { sessaoAtual } from "@/lib/auth";
import { chaveDaGaleria, chavesDoClipe, galeriaParaClipe, trocarClipeDaCapa } from "@/lib/capa-galeria";
import {
  TIPO_DO_CLIPE,
  TIPO_DO_POSTER_DO_CLIPE,
  recusaDoClipe,
  recusaDoPosterDoClipe,
} from "@/lib/clipe-da-capa-regras";
import { urlDeUpload, conferirObjeto, apagarObjetos, armazenamentoConfigurado } from "@/lib/r2";

/**
 * A capa da galeria em VÍDEO — o clipe do formato Stream (migração 066).
 *
 * No mesmo molde da capa em imagem (`../capa/route.ts`): o navegador manda
 * direto para o bucket com URL assinada e o servidor só confirma o que de fato
 * chegou. O clipe é preparado no navegador do fotógrafo (curto, mudo, 720p) —
 * o servidor nunca toca no vídeo.
 *
 *   POST   → duas URLs de envio: o clipe e o primeiro quadro
 *   PUT    → confere os dois objetos de verdade e grava
 *   DELETE → tira o clipe e apaga os arquivos
 */

/* O clipe é bem maior que uma capa em imagem, e a conexão de quem envia é a
   de casa: 10 minutos (o prazo da imagem) cortaria o envio de um fotógrafo com
   internet lenta no meio. */
const VALIDADE_DO_ENVIO = 30 * 60;

async function dona(galeriaId: string) {
  const tenantId = await sessaoAtual();
  if (!tenantId) return { erro: NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 }) };
  const galeria = await galeriaParaClipe(galeriaId, tenantId);
  /* 404 e não 403: galeria de outro estúdio não existe para esta sessão. */
  if (!galeria) return { erro: NextResponse.json({ erro: "Galeria não encontrada." }, { status: 404 }) };
  return { tenantId };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dono = await dona(id);
  if (dono.erro) return dono.erro;
  if (!armazenamentoConfigurado) {
    return NextResponse.json({ erro: "Armazenamento não configurado." }, { status: 503 });
  }

  let corpo: { bytes?: number; posterBytes?: number };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }
  const recusa =
    recusaDoClipe(TIPO_DO_CLIPE, Number(corpo.bytes ?? 0)) ??
    recusaDoPosterDoClipe(TIPO_DO_POSTER_DO_CLIPE, Number(corpo.posterBytes ?? 0));
  if (recusa) return NextResponse.json({ erro: recusa }, { status: 415 });

  const chaves = chavesDoClipe(dono.tenantId!, id);
  const [url, posterUrl] = await Promise.all([
    urlDeUpload(chaves.clipe, TIPO_DO_CLIPE, VALIDADE_DO_ENVIO),
    urlDeUpload(chaves.poster, TIPO_DO_POSTER_DO_CLIPE, VALIDADE_DO_ENVIO),
  ]);
  return NextResponse.json({ url, chave: chaves.clipe, posterUrl, posterChave: chaves.poster });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dono = await dona(id);
  if (dono.erro) return dono.erro;

  let corpo: { chave?: string; posterChave?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }
  const chave = String(corpo.chave ?? "");
  const posterChave = String(corpo.posterChave ?? "");
  /* As chaves vêm do navegador. Sem esta conferência, um pedido forjado
     apontaria a capa desta galeria para um objeto de outra conta. */
  if (
    !chave ||
    !posterChave ||
    chave === posterChave ||
    !chaveDaGaleria(chave, dono.tenantId!, id) ||
    !chaveDaGaleria(posterChave, dono.tenantId!, id)
  ) {
    return NextResponse.json({ erro: "Envio inválido." }, { status: 400 });
  }

  /* Confere o que REALMENTE chegou, não o que o navegador prometeu no POST. */
  let clipe: { bytes: number; mime: string };
  let quadro: { bytes: number; mime: string };
  try {
    [clipe, quadro] = await Promise.all([conferirObjeto(chave), conferirObjeto(posterChave)]);
  } catch {
    await apagarObjetos([chave, posterChave]).catch(() => {});
    return NextResponse.json({ erro: "O arquivo não chegou. Tente de novo." }, { status: 409 });
  }

  const recusa = recusaDoClipe(clipe.mime, clipe.bytes) ?? recusaDoPosterDoClipe(quadro.mime, quadro.bytes);
  if (recusa) {
    // Recusado: não deixa o arquivo para trás sendo cobrado.
    await apagarObjetos([chave, posterChave]).catch(() => {});
    return NextResponse.json({ erro: recusa }, { status: 415 });
  }

  const antigas = await trocarClipeDaCapa(id, dono.tenantId!, { clipe: chave, poster: posterChave });
  if (antigas === null) {
    await apagarObjetos([chave, posterChave]).catch(() => {});
    return NextResponse.json({ erro: "Galeria não encontrada." }, { status: 404 });
  }
  if (antigas.length > 0) await apagarObjetos(antigas).catch(() => {});

  revalidatePath(`/painel/galerias/${id}/design`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dono = await dona(id);
  if (dono.erro) return dono.erro;

  const antigas = await trocarClipeDaCapa(id, dono.tenantId!, null);
  if (antigas && antigas.length > 0) await apagarObjetos(antigas).catch(() => {});

  revalidatePath(`/painel/galerias/${id}/design`);
  return NextResponse.json({ ok: true });
}
