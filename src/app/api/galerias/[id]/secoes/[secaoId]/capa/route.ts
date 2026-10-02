import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { sessaoAtual } from "@/lib/auth";
import {
  TIPOS_CAPA,
  chaveDaCapaDaPasta,
  chaveDoCapitulo,
  capituloParaCapa,
  recusaDaCapa,
  trocarCapaDaPasta,
} from "@/lib/capa-da-pasta";
import { urlDeUpload, conferirObjeto, apagarObjeto, armazenamentoConfigurado } from "@/lib/r2";

/**
 * A CAPA DE UM CAPÍTULO enviada como ARQUIVO (migração 057).
 *
 *   POST   → devolve a URL de envio
 *   PUT    → confirma (confere o objeto de verdade) e grava
 *   DELETE → tira a capa e apaga o arquivo
 *
 * É a irmã de `/api/galerias/[id]/capa`, e a repetição é deliberada: são duas
 * portas, cada uma com a sua conferência de chave. Fundi-las numa rota só com
 * um "se vier secaoId" faria a conferência mais frouxa (a da galeria) virar o
 * caminho padrão no dia em que alguém esquecesse o parâmetro.
 *
 * Escolher uma foto DO capítulo continua em `definirCapaDaPastaAction`; esta
 * rota é só para imagem que não é da entrega.
 */

async function dono(galeriaId: string, secaoId: string) {
  const tenantId = await sessaoAtual();
  if (!tenantId) {
    return { erro: NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 }) };
  }
  const capitulo = await capituloParaCapa(secaoId, galeriaId, tenantId);
  /* 404 e não 403: capítulo de outra galeria ou de outro estúdio não existe
     para esta sessão, e a resposta não confirma que o id existe. */
  if (!capitulo) return { erro: NextResponse.json({ erro: "Capítulo não encontrado." }, { status: 404 }) };
  return { tenantId, capitulo };
}

type Rota = { params: Promise<{ id: string; secaoId: string }> };

export async function POST(request: NextRequest, { params }: Rota) {
  const { id, secaoId } = await params;
  const d = await dono(id, secaoId);
  if (d.erro) return d.erro;
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
  const recusa = recusaDaCapa(mime, Number(corpo.bytes ?? 0));
  if (recusa) return NextResponse.json({ erro: recusa }, { status: 415 });

  const chave = chaveDaCapaDaPasta(d.tenantId!, id, secaoId, TIPOS_CAPA[mime]);
  const url = await urlDeUpload(chave, mime, 600);
  return NextResponse.json({ url, chave });
}

export async function PUT(request: NextRequest, { params }: Rota) {
  const { id, secaoId } = await params;
  const d = await dono(id, secaoId);
  if (d.erro) return d.erro;

  let corpo: { chave?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const chave = String(corpo.chave ?? "");
  /* A chave vem do navegador. Sem esta conferência, um pedido forjado apontaria
     a capa deste capítulo para um objeto de outra conta. */
  if (!chave || !chaveDoCapitulo(chave, d.tenantId!, id, secaoId)) {
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

  const anterior = await trocarCapaDaPasta(secaoId, id, d.tenantId!, chave);
  if (anterior) await apagarObjeto(anterior).catch(() => {});

  revalidatePath(`/painel/galerias/${id}/design`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: Rota) {
  const { id, secaoId } = await params;
  const d = await dono(id, secaoId);
  if (d.erro) return d.erro;

  const anterior = await trocarCapaDaPasta(secaoId, id, d.tenantId!, null);
  if (anterior) await apagarObjeto(anterior).catch(() => {});

  revalidatePath(`/painel/galerias/${id}/design`);
  return NextResponse.json({ ok: true });
}
