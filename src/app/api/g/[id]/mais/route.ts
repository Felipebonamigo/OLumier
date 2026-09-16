import { NextResponse, type NextRequest } from "next/server";
import { consultarUm } from "@/lib/db";
import { listarMediasPublicas, temAcessoLiberado } from "@/lib/galerias-publicas";
import { secaoPeloApelido } from "@/lib/secoes";
import { galeriasNoAr } from "@/lib/assinatura";
import { armazemDe, urlDaDerivada } from "@/lib/armazem";

/**
 * O PRÓXIMO PEDAÇO DA GALERIA — o que faz a rolagem não ter fim.
 *
 * ── DE ONDE VEIO (16/09/2026) ─────────────────────────────────────────────
 *
 * Felipe: "remover paginação dentro do mesmo capítulo, tem apenas que rolar
 * até o final".
 *
 * A paginação nasceu de um defeito real, em 11/09: a galeria da Ana & Kaio,
 * com 2108 fotos, dava 6,35 MB de DOCUMENTO — o suficiente para o Safari do
 * iPhone estourar e desistir de recarregar. O corte em `FOTOS_POR_TELA`
 * resolveu aquilo e trouxe "parte 3 de 4", que é o que ele viu.
 *
 * ── POR QUE A ROLAGEM INFINITA NÃO TRAZ O DEFEITO DE VOLTA ────────────────
 *
 * Porque o que estourava era o DOCUMENTO, não a quantidade de fotos. Cada foto
 * custava ~3,2 KB de HTML porque a URL assinada dela vinha escrita ali dentro —
 * e o Safari engasgava no texto, não nos `<img>`. O que esta rota entrega é
 * JSON, lido e descartado: a página continua nascendo com uma tela de fotos, e
 * as seguintes viram nós do DOM sem passar pelo documento.
 *
 * ── A RÉGUA É A DA PÁGINA, MENOS UMA ──────────────────────────────────────
 *
 * Publicada, estúdio no ar, galeria no ar, dentro do prazo e senha quando
 * houver — as mesmas de `/urls` e de `prepararEntrega`. A que NÃO entra é a do
 * download: esta rota devolve MINIATURA, que é o que a galeria já mostra a
 * quem abriu o link. Exigir permissão de download para ver a segunda tela de
 * fotos seria esconder a galeria de quem tem o link para vê-la.
 */

/** Seis horas, como as outras miniaturas da página. */
const VALIDADE = 6 * 3600;
/**
 * Quantas fotos por pedido.
 *
 * Bem menor que as 600 da primeira tela, e de propósito: aqui a espera é
 * percebida (a pessoa chegou ao fim e está esperando), enquanto a primeira tela
 * chega junto com a página. Cento e vinte enchem umas três dobras de tela num
 * computador — tempo de sobra para o pedido seguinte sair antes de a rolagem
 * alcançar o fim de novo.
 */
const POR_PEDIDO = 120;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const galeria = await consultarUm<{
    senha_hash: string | null;
    estado: string;
    expira_em: string | null;
    estudio_status: string;
    estudio_trial_ate: string | null;
  }>(
    `select g.senha_hash, g.estado, g.expira_em,
            t.status as estudio_status, t.trial_ate as estudio_trial_ate
       from galerias g join tenants t on t.id = g.tenant_id
      where g.id = $1 and g.publicada`,
    [id],
  );
  if (!galeria) return NextResponse.json({ erro: "sem acesso" }, { status: 404 });
  if (!galeriasNoAr({ status: galeria.estudio_status, trial_ate: galeria.estudio_trial_ate })) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 409 });
  }
  if (galeria.estado !== "online") return NextResponse.json({ erro: "sem acesso" }, { status: 409 });
  if (galeria.expira_em && new Date(galeria.expira_em) < new Date()) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 409 });
  }
  if (galeria.senha_hash && !(await temAcessoLiberado(id, galeria.senha_hash))) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 401 });
  }

  const busca = request.nextUrl.searchParams;
  const cap = busca.get("cap");
  const desde = Math.max(0, Math.floor(Number(busca.get("desde")) || 0));

  /*
   * O MESMO RECORTE DA PÁGINA, e é isto que faz a continuação continuar de
   * verdade: se a página cortou pelo capítulo aberto, a rolagem tem de seguir
   * dentro dele. Um recorte diferente aqui faria a segunda tela trazer fotos de
   * outro capítulo, no meio do que a pessoa está lendo.
   */
  const todas = await listarMediasPublicas(id);
  const secaoId = cap ? await secaoPeloApelido(id, cap) : null;
  const doEscopo = !cap
    ? todas
    : cap === "sem-capitulo"
      ? todas.filter((m) => !m.secao_id)
      : todas.filter((m) => m.secao_id === secaoId);

  const pedaco = doEscopo.slice(desde, desde + POR_PEDIDO);
  const fotos = await Promise.all(
    pedaco.map(async (m) => ({
      id: m.id,
      nome: m.nome_original,
      tipo: m.tipo,
      bytes: Number(m.bytes),
      largura: m.largura,
      altura: m.altura,
      secaoId: m.secao_id,
      temPoster: Boolean(m.chave_thumb),
      url: await urlDaDerivada(m.chave_thumb, m.chave, armazemDe(m.armazem), VALIDADE),
    })),
  );

  return NextResponse.json(
    { fotos, restantes: Math.max(0, doEscopo.length - (desde + pedaco.length)) },
    /* Pessoal (galeria com senha) e cheio de URL assinada que vence: proxy
       nenhum guarda, e o navegador tampouco. */
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
