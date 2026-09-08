import { NextResponse, type NextRequest } from "next/server";
import { sessaoAtual } from "@/lib/auth";
import { galeriaDoPainel } from "@/lib/galeria-painel";
import { listarMedias } from "@/lib/medias";
import { armazemDe, urlDaDerivada } from "@/lib/armazem";

/** Uma hora: o pop-up é aberto, usado e fechado em minutos. */
const VALIDADE = 3600;

/**
 * As miniaturas da galeria, para o pop-up de escolher a capa.
 *
 * ── POR QUE UMA ROTA, E NÃO DADO DA PÁGINA ────────────────────────────────
 *
 * A aba Design não carrega mídia nenhuma, de propósito: a divisão em abas
 * existe porque a página antiga assinava uma URL por foto antes de desenhar
 * qualquer coisa — 600 assinaturas para quem entrou só para trocar a fonte.
 *
 * Buscar aqui move esse custo para QUEM USA. Quem abre o Design não paga nada;
 * quem abre o pop-up paga uma vez. É a mesma ideia das URLs sob demanda da
 * galeria pública.
 *
 * Só FOTO: vídeo não serve de capa (o `<img>` da capa não o desenharia), e
 * oferecê-lo seria oferecer uma escolha que não funciona.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await sessaoAtual();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const { id } = await params;
  /* 404 e não 403: galeria de outro estúdio não existe para esta sessão — a
     mesma resposta que o painel dá, e ela não confirma que o id existe. */
  const galeria = await galeriaDoPainel(id, tenantId);
  if (!galeria) return NextResponse.json({ erro: "Galeria não encontrada." }, { status: 404 });

  const medias = (await listarMedias(galeria.id)).filter((m) => m.tipo === "foto");
  const fotos = await Promise.all(
    medias.map(async (m) => ({
      id: m.id,
      nome: m.nome_original,
      url: await urlDaDerivada(m.chave_thumb, m.chave, armazemDe(m.armazem), VALIDADE),
    })),
  );

  return NextResponse.json({ fotos });
}
