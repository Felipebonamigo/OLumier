import { NextResponse, type NextRequest } from "next/server";
import { consultarUm } from "@/lib/db";
import {
  estadoSelecao,
  fecharSelecao,
  garantirVisitante,
  favoritasDaPessoa,
  pessoaAtual,
  alternarDaPessoa,
} from "@/lib/favoritas";
import { temAcessoLiberado } from "@/lib/galerias-publicas";

/**
 * Marcar e desmarcar favorita. Sem login: quem tem o link (e a senha, se
 * houver) pode marcar.
 *
 * A conferência de senha NÃO é opcional aqui. Sem ela, alguém que só descobriu
 * o id da galeria conseguiria marcar fotos de uma galeria trancada — sem nunca
 * ver as fotos, mas sujando a lista que o fotógrafo usa para montar o álbum.
 */
async function galeriaLiberada(id: string) {
  const galeria = await consultarUm<{ id: string; senha_hash: string | null; estado: string }>(
    "select id, senha_hash, estado from galerias where id = $1 and publicada",
    [id],
  );
  if (!galeria) return { ok: false as const, status: 404 };
  // No cofre a galeria não abre para ninguém; marcar também não faz sentido.
  if (galeria.estado !== "online") return { ok: false as const, status: 409 };
  if (galeria.senha_hash && !(await temAcessoLiberado(id, galeria.senha_hash))) {
    return { ok: false as const, status: 401 };
  }
  return { ok: true as const, galeria };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const permissao = await galeriaLiberada(id);
  if (!permissao.ok) return NextResponse.json({ erro: "sem acesso" }, { status: permissao.status });

  let corpo: { mediaId?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "requisição inválida" }, { status: 400 });
  }

  const mediaId = String(corpo.mediaId ?? "");
  if (!mediaId) return NextResponse.json({ erro: "foto não informada" }, { status: 400 });

  /*
   * ── SEM PESSOA, NÃO HÁ LISTA (15/09/2026) ────────────────────────────────
   *
   * Desde a migração 033 a favorita tem dona. Marcar sem dizer quem se é não
   * tem onde cair: cairia na lista antiga, compartilhada, que é exatamente o
   * que o Felipe pediu para acabar.
   *
   * 428 e não 401: não é falta de permissão — quem tem o link pode escolher —,
   * é falta de um passo anterior. A tela lê este código e abre o campo do
   * e-mail, em vez de dizer "sem acesso" para quem tem acesso.
   */
  const pessoa = await pessoaAtual(id);
  if (!pessoa) {
    return NextResponse.json({ erro: "identifique-se", precisaEmail: true }, { status: 428 });
  }

  // O cookie do visitante segue nascendo aqui: ele diz de ONDE veio a marcação.
  await garantirVisitante(id);
  const r = await alternarDaPessoa(id, mediaId, pessoa);
  if (!r) return NextResponse.json({ erro: "foto não é desta galeria" }, { status: 404 });

  /*
   * Recusa da seleção não é erro de servidor nem de permissão: é uma regra que o
   * fotógrafo definiu. 409 (conflito com o estado atual) diz isso, e o `motivo`
   * é o que a tela usa para explicar em português em vez de um "não deu".
   */
  if ("erro" in r) {
    const estado = await estadoSelecao(id, pessoa);
    return NextResponse.json(
      { erro: r.erro, total: estado.total, limite: estado.limite },
      { status: 409 },
    );
  }

  const estado = await estadoSelecao(id, pessoa);
  return NextResponse.json({ ...r, limite: estado.limite, cheia: estado.cheia });
}

/** A lista da galeria e o estado da seleção. Reconcilia a tela depois de um erro. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const permissao = await galeriaLiberada(id);
  if (!permissao.ok) return NextResponse.json({ erro: "sem acesso" }, { status: permissao.status });
  /* "Minhas" passou a querer dizer minhas de verdade (migração 033). Sem
     identificação a lista é vazia — e não a da galeria inteira, que era o
     defeito. */
  const pessoa = await pessoaAtual(id);
  const estado = await estadoSelecao(id, pessoa);
  return NextResponse.json({
    favoritas: await favoritasDaPessoa(id, pessoa),
    total: estado.total,
    limite: estado.limite,
    cheia: estado.cheia,
    aberta: estado.aberta,
    motivo: estado.motivo,
  });
}

/**
 * "Terminei minha escolha".
 *
 * Fica junto das favoritas de propósito: é a mesma régua de acesso (link, e
 * senha quando houver) e o mesmo recurso — a seleção. Uma rota separada
 * duplicaria `galeriaLiberada`, que é onde mora a autorização.
 */
export async function PUT(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const permissao = await galeriaLiberada(id);
  if (!permissao.ok) return NextResponse.json({ erro: "sem acesso" }, { status: permissao.status });

  const antes = await estadoSelecao(id);
  /* Sem escolha combinada não há o que encerrar: as favoritas são livres. O
     botão nem aparece; isto é para quem chama a rota por fora. */
  if (!antes.combinada) {
    return NextResponse.json({ erro: "sem escolha combinada" }, { status: 409 });
  }
  if (!antes.aberta) {
    // Já estava fechada: para quem clicou, o resultado é o mesmo que ele queria.
    return NextResponse.json({ fechada: true, total: antes.total, motivo: antes.motivo });
  }

  await fecharSelecao(id);
  const depois = await estadoSelecao(id);
  return NextResponse.json({ fechada: true, total: depois.total, motivo: depois.motivo });
}
