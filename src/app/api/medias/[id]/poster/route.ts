import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { sessaoAtual } from "@/lib/auth";
import { buscarMedia, definirMiniatura } from "@/lib/medias";
import {
  urlDeUpload,
  conferirObjeto,
  apagarObjeto,
  mimeDaDerivada,
  chaveDerivadaDoOriginal,
  armazenamentoConfigurado,
} from "@/lib/r2";

/**
 * A CAPA DE UM VÍDEO, ESCOLHIDA À MÃO.
 *
 * Juan, 29/09/2026: "essa configuração de vídeo permite escolher uma capa
 * thumbnail para o vídeo ali".
 *
 * Duas chamadas, no mesmo molde da capa da galeria:
 *   POST → devolve a URL de envio. Não toca na linha.
 *   PUT  → confere o que REALMENTE chegou e grava.
 *
 * ── A CHAVE É CALCULADA AQUI, NÃO RECEBIDA ──────────────────────────────
 *
 * `chaveDerivadaDoOriginal` a deduz da chave do original, que já está na linha
 * da mídia. O navegador nunca manda chave nenhuma, então não há o que forjar —
 * é uma conferência a menos para esquecer do que validar uma chave vinda de
 * fora, como a capa da galeria precisa fazer.
 *
 * ── POR QUE `sessaoAtual`, E NÃO `tenantQuePodeEnviar` ──────────────────
 *
 * Porque 50 KB de miniatura não é envio de acervo, e quem está com o teste
 * vencido consertando a capa de uma galeria JÁ ENTREGUE não deveria esbarrar
 * numa trava de cobrança. É escolha, e o teto está nomeado: esta rota grava
 * uma derivada de imagem e nada mais.
 *
 * ── POR QUE SÓ VÍDEO ────────────────────────────────────────────────────
 *
 * A capa de uma foto é a própria foto. Deixar passar abriria caminho para a
 * miniatura de uma foto ser outra imagem — o casal veria uma coisa na grade e
 * outra ao abrir.
 */

async function videoDoEstudio(mediaId: string) {
  const tenantId = await sessaoAtual();
  if (!tenantId) {
    return { erro: NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 }) };
  }
  const media = await buscarMedia(mediaId, tenantId);
  /* 404 e não 403: mídia de outro estúdio não existe para esta sessão, e
     confirmar que o id existe já seria contar demais. */
  if (!media) {
    return { erro: NextResponse.json({ erro: "Arquivo não encontrado." }, { status: 404 }) };
  }
  if (media.tipo !== "video") {
    return {
      erro: NextResponse.json({ erro: "Só vídeo tem capa própria." }, { status: 400 }),
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

  const chave = chaveDerivadaDoOriginal(quem.media!.chave);
  return NextResponse.json({
    chave,
    url: await urlDeUpload(chave, mimeDaDerivada(chave)),
    mime: mimeDaDerivada(chave),
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quem = await videoDoEstudio(id);
  if (quem.erro) return quem.erro;

  let corpo: { largura?: number; altura?: number } = {};
  try {
    corpo = await request.json();
  } catch {
    /* Corpo vazio é aceitável: largura e altura são um detalhe da grade, e a
       capa vale sem eles. O que NÃO é opcional é o objeto existir. */
  }

  const chave = chaveDerivadaDoOriginal(quem.media!.chave);

  /*
   * A ORDEM É A DEFESA. Gravar a coluna antes de o objeto existir faria
   * `urlDaDerivada` assinar uma URL para o nada, e a galeria do casal mostraria
   * imagem quebrada — pior do que o ladrilho sem capa, que ao menos desenha o
   * filme.
   */
  let real: { bytes: number; mime: string };
  try {
    real = await conferirObjeto(chave);
  } catch {
    return NextResponse.json({ erro: "O arquivo não chegou. Tente de novo." }, { status: 409 });
  }

  if (!real.mime.startsWith("image/") || real.bytes === 0) {
    /* Recusado: não deixa para trás um objeto pago que ninguém vai usar. */
    await apagarObjeto(chave).catch(() => {});
    return NextResponse.json({ erro: "A capa precisa ser uma imagem." }, { status: 400 });
  }

  await definirMiniatura(id, quem.tenantId!, chave, corpo.largura, corpo.altura);
  revalidatePath(`/painel/galerias/${quem.media!.galeria_id}`);
  return NextResponse.json({ ok: true });
}
