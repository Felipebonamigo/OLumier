import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { sessaoAtual } from "@/lib/auth";
import { capituloParaCapa } from "@/lib/capa-da-pasta";
import { definirFocoDaPasta } from "@/lib/secoes";

/**
 * O ENQUADRAMENTO DA CAPA DE UM CAPÍTULO.
 *
 * Juan, 09/10/2026: "adicionar opção de escolher o ponto focal da imagem, para
 * poder deixar a capa da pasta também centralizada da forma que eu quiser".
 *
 * É a irmã de `/api/galerias/[id]/capa` (PATCH), que faz o mesmo para a capa da
 * galeria desde a migração 031. Mesma forma, mesmos códigos de resposta — duas
 * portas que fazem a mesma pergunta não podem responder de jeitos diferentes.
 *
 * Rota própria, e não uma server action, pelo mesmo motivo da capa: o valor
 * chega de um clique numa imagem, e o retorno precisa dizer se gravou para a
 * bolinha não ficar onde a pessoa clicou enquanto o banco tem outro ponto.
 */

async function dono(galeriaId: string, secaoId: string) {
  const tenantId = await sessaoAtual();
  if (!tenantId) {
    return { erro: NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 }) };
  }
  /* 404 e não 403: capítulo de outra galeria ou de outro estúdio não existe
     para esta sessão, e a resposta não confirma que o id existe. É a mesma
     régua da rota da capa, ao lado. */
  const capitulo = await capituloParaCapa(secaoId, galeriaId, tenantId);
  if (!capitulo) return { erro: NextResponse.json({ erro: "Capítulo não encontrado." }, { status: 404 }) };
  return { tenantId };
}

type Rota = { params: Promise<{ id: string; secaoId: string }> };

export async function PATCH(request: NextRequest, { params }: Rota) {
  const { id, secaoId } = await params;
  const quem = await dono(id, secaoId);
  if (quem.erro) return quem.erro;

  const corpo = await request.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }

  const definiu = await definirFocoDaPasta(secaoId, id, quem.tenantId!, corpo.focoX, corpo.focoY);
  if (!definiu) {
    /* 422 e não 400: o pedido está bem formado, o VALOR é que não serve. A
       distinção é a mesma da rota da capa da galeria, e serve a quem lê o log
       tentando saber se quem chamou mandou lixo ou mandou um número fora da
       faixa. */
    return NextResponse.json({ erro: "Ponto fora da imagem." }, { status: 422 });
  }

  revalidatePath(`/painel/galerias/${id}/design`);
  return NextResponse.json({ ok: true, foco: { x: corpo.focoX, y: corpo.focoY } });
}
