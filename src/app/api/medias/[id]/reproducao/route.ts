import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { sessaoAtual } from "@/lib/auth";
import { buscarMedia, definirVersaoLeve } from "@/lib/medias";
import {
  urlDeUpload,
  conferirObjeto,
  apagarObjeto,
  chaveDaVersaoLeve,
  MIME_DA_VERSAO_LEVE,
  armazenamentoConfigurado,
} from "@/lib/r2";

/**
 * A VERSÃO LEVE DE UM VÍDEO — a cópia que o cliente assiste (08/10/2026).
 *
 * Quem converte é o navegador do fotógrafo (`lib/versao-leve.ts`); esta rota só
 * dá o endereço e confere o que chegou. Duas chamadas, no molde da capa do
 * vídeo (`../poster`):
 *   POST → devolve a URL de envio. Não toca na linha.
 *   PUT  → confere o objeto e grava `chave_reproducao`.
 *
 * A chave é deduzida do original (`chaveDaVersaoLeve`), nunca recebida: não há
 * o que forjar. `sessaoAtual`, e não a trava de envio de acervo, pela mesma
 * razão da capa: preparar os vídeos de uma galeria JÁ ENTREGUE é conserto, não
 * acervo novo, e a cópia não entra na cota — é derivada nossa.
 *
 * O TETO é o próprio original: a cópia só é aceita se for MENOR que ele. Sem
 * isso, a rota seria um jeito de guardar no R2, de graça e fora da cota, um
 * arquivo do tamanho que quisesse.
 */

async function videoDoEstudio(mediaId: string) {
  const tenantId = await sessaoAtual();
  if (!tenantId) {
    return { erro: NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 }) };
  }
  const media = await buscarMedia(mediaId, tenantId);
  if (!media) {
    return { erro: NextResponse.json({ erro: "Arquivo não encontrado." }, { status: 404 }) };
  }
  if (media.tipo !== "video") {
    return { erro: NextResponse.json({ erro: "Só vídeo tem versão leve." }, { status: 400 }) };
  }
  if (!media.pronto) {
    return {
      erro: NextResponse.json({ erro: "O vídeo ainda não terminou de subir." }, { status: 409 }),
    };
  }
  return { tenantId, media };
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quem = await videoDoEstudio(id);
  if (quem.erro) return quem.erro;
  if (!armazenamentoConfigurado) {
    return NextResponse.json({ erro: "Armazenamento não configurado." }, { status: 503 });
  }
  const chave = chaveDaVersaoLeve(quem.media!.chave);
  return NextResponse.json({ url: await urlDeUpload(chave, MIME_DA_VERSAO_LEVE) });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quem = await videoDoEstudio(id);
  if (quem.erro) return quem.erro;
  const media = quem.media!;

  let corpo: { largura?: number; altura?: number; duracao?: number } = {};
  try {
    corpo = await request.json();
  } catch {
    /* As medidas são detalhe; o que não é opcional é o objeto existir. */
  }

  const chave = chaveDaVersaoLeve(media.chave);
  /* A ORDEM É A DEFESA, como na capa: gravar a coluna antes de o objeto existir
     faria o player buscar o nada — pior que tocar o original pesado. */
  let real: { bytes: number; mime: string };
  try {
    real = await conferirObjeto(chave);
  } catch {
    return NextResponse.json({ erro: "A versão leve não chegou. Tente de novo." }, { status: 409 });
  }
  if (real.mime !== MIME_DA_VERSAO_LEVE || real.bytes === 0 || real.bytes >= Number(media.bytes)) {
    await apagarObjeto(chave).catch(() => {});
    return NextResponse.json(
      { erro: "A versão leve precisa ser um MP4 menor que o original." },
      { status: 400 },
    );
  }

  const inteiro = (n: unknown, teto: number) => {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? Math.min(teto, Math.round(v)) : null;
  };
  await definirVersaoLeve(id, quem.tenantId!, chave, {
    largura: inteiro(corpo.largura, 20000),
    altura: inteiro(corpo.altura, 20000),
    duracaoSeg: inteiro(corpo.duracao, 86400),
  });
  revalidatePath(`/painel/galerias/${media.galeria_id}`);
  return NextResponse.json({ ok: true, bytes: real.bytes });
}
