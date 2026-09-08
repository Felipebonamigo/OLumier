import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { sessaoAtual } from "@/lib/auth";
import {
  TIPOS_CAPA,
  chaveDaCapa,
  chaveDaGaleria,
  galeriaParaCapa,
  recusaDaCapa,
  trocarCapaPropria,
  definirFocoDaCapa,
  definirCapaPorMedia,
  FOCO_CENTRAL,
} from "@/lib/capa-galeria";
import { urlDeUpload, conferirObjeto, apagarObjeto, armazenamentoConfigurado } from "@/lib/r2";

/**
 * A capa da galeria enviada como ARQUIVO — no mesmo modelo da logo do estúdio:
 * o navegador manda direto para o bucket com URL assinada, e o servidor só
 * confirma o que realmente chegou.
 *
 *   POST   → devolve a URL de envio
 *   PUT    → confirma (confere o objeto de verdade) e grava
 *   DELETE → tira a capa e apaga o arquivo
 *
 * Ver a migração 029 para por que a capa é uma coluna e não uma linha em
 * `medias` — resumo: uma mídia "só capa" exigiria um filtro novo em todo lugar
 * que lista foto, e esquecer um deles entrega ao casal uma foto que nunca foi
 * dele.
 */

async function dona(request: NextRequest, galeriaId: string) {
  const tenantId = await sessaoAtual();
  if (!tenantId) return { erro: NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 }) };
  const galeria = await galeriaParaCapa(galeriaId, tenantId);
  /* 404 e não 403: galeria de outro estúdio não existe para esta sessão — é a
     mesma resposta que o painel dá, e não confirma que o id existe. */
  if (!galeria) return { erro: NextResponse.json({ erro: "Galeria não encontrada." }, { status: 404 }) };
  return { tenantId, galeria };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dono = await dona(request, id);
  if (dono.erro) return dono.erro;
  if (!armazenamentoConfigurado) {
    return NextResponse.json({ erro: "Armazenamento não configurado." }, { status: 503 });
  }

  let corpo: { mime?: string; bytes?: number };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const mime = String(corpo.mime ?? "");
  const bytes = Number(corpo.bytes ?? 0);
  const recusa = recusaDaCapa(mime, bytes);
  if (recusa) return NextResponse.json({ erro: recusa }, { status: 415 });

  const chave = chaveDaCapa(dono.tenantId!, id, TIPOS_CAPA[mime]);
  const url = await urlDeUpload(chave, mime, 600);
  return NextResponse.json({ url, chave });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dono = await dona(request, id);
  if (dono.erro) return dono.erro;

  let corpo: { chave?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const chave = String(corpo.chave ?? "");
  /* A chave vem do navegador. Sem esta conferência, um pedido forjado apontaria
     a capa desta galeria para um objeto de outra conta. */
  if (!chave || !chaveDaGaleria(chave, dono.tenantId!, id)) {
    return NextResponse.json({ erro: "Envio inválido." }, { status: 400 });
  }

  /* Confere o que REALMENTE chegou, não o que o navegador prometeu no POST. */
  let real: { bytes: number; mime: string };
  try {
    real = await conferirObjeto(chave);
  } catch {
    return NextResponse.json({ erro: "O arquivo não chegou. Tente de novo." }, { status: 409 });
  }

  const recusa = recusaDaCapa(real.mime, real.bytes);
  if (recusa) {
    // Recusado: não deixa o arquivo para trás sendo cobrado.
    await apagarObjeto(chave).catch(() => {});
    return NextResponse.json({ erro: recusa }, { status: 415 });
  }

  const anterior = await trocarCapaPropria(id, dono.tenantId!, chave);
  if (anterior) await apagarObjeto(anterior).catch(() => {});

  revalidatePath(`/painel/galerias/${id}/design`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dono = await dona(request, id);
  if (dono.erro) return dono.erro;

  const anterior = await trocarCapaPropria(id, dono.tenantId!, null);
  if (anterior) await apagarObjeto(anterior).catch(() => {});

  revalidatePath(`/painel/galerias/${id}/design`);
  return NextResponse.json({ ok: true });
}

/**
 * PATCH — o enquadramento, e a troca da foto de capa.
 *
 * ── POR QUE AS DUAS COISAS NA MESMA ROTA ──────────────────────────────────
 *
 * Porque elas são a mesma decisão vista de perto: "qual foto, e mostrando o
 * quê". E porque trocar a foto TEM de zerar o foco — um ponto calibrado para a
 * foto A não quer dizer nada na foto B. Em rotas separadas, o dia em que
 * alguém acrescentar um terceiro jeito de trocar a capa vai esquecer de zerar,
 * e o fotógrafo recebe um enquadramento torto que não escolheu.
 *
 * `{ focoX, focoY }` move o ponto; `{ mediaId }` troca a foto e centraliza.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dono = await dona(request, id);
  if (dono.erro) return dono.erro;

  const corpo = await request.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }

  if ("mediaId" in corpo) {
    const trocou = await definirCapaPorMedia(id, dono.tenantId!, String(corpo.mediaId ?? ""));
    if (!trocou) {
      return NextResponse.json({ erro: "Foto não encontrada nesta galeria." }, { status: 404 });
    }
    revalidatePath(`/painel/galerias/${id}/design`);
    return NextResponse.json({ ok: true, foco: FOCO_CENTRAL });
  }

  const definiu = await definirFocoDaCapa(id, dono.tenantId!, corpo.focoX, corpo.focoY);
  if (!definiu) {
    /* 422 e não 400: o pedido está bem formado, o VALOR é que não serve. A
       diferença importa para quem lê o log tentando entender se o cliente
       mandou lixo ou se a galeria sumiu. */
    return NextResponse.json(
      { erro: "O ponto precisa ser dois inteiros de 0 a 100." },
      { status: 422 },
    );
  }

  revalidatePath(`/painel/galerias/${id}/design`);
  return NextResponse.json({ ok: true });
}
