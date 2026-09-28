import { NextResponse, type NextRequest } from "next/server";
import { registrarAcesso } from "@/lib/galerias-publicas";
import { consultarUm } from "@/lib/db";
import { pessoaAtual } from "@/lib/favoritas";

const ACOES = new Set(["abriu", "baixou", "baixou_tudo", "assistiu"]);

/**
 * Registro de acesso do cliente final. Não exige autenticação — quem tem o link
 * pode abrir — mas confere se a galeria existe e está publicada, para o endpoint
 * não virar um jeito de encher a tabela com lixo.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const galeria = await consultarUm<{ id: string }>(
    "select id from galerias where id = $1 and publicada",
    [id],
  );
  if (!galeria) return NextResponse.json({ ok: false }, { status: 404 });

  let corpo: { acao?: string; mediaId?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const acao = String(corpo.acao ?? "");
  if (!ACOES.has(acao)) return NextResponse.json({ ok: false }, { status: 400 });

  /*
   * QUEM está baixando, quando a pessoa já se identificou.
   *
   * `pessoaAtual` e NÃO `visitanteAtual`: os dois leem cookie assinado por
   * galeria e parecem intercambiáveis, mas o segundo devolve o id ANÔNIMO do
   * navegador — o modelo de favoritas anterior à migração 033 —, e esse id não
   * existe em `pessoas_da_galeria`. Escrito errado, a chave estrangeira recusa
   * em silêncio (o `try` de `registrarAcesso` engole) e TODO download fica
   * anônimo. Foi o que aconteceu na primeira versão disto, pego no navegador:
   * a porta pedia o nome, o nome era gravado, e a tela do fotógrafo continuava
   * dizendo "não identificado".
   *
   * Sem cookie o download entra anônimo mesmo, que é a verdade.
   */
  const pessoaId = await pessoaAtual(id);

  await registrarAcesso({
    galeriaId: id,
    mediaId: corpo.mediaId,
    pessoaId,
    acao: acao as "abriu" | "baixou" | "baixou_tudo" | "assistiu",
    ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}
