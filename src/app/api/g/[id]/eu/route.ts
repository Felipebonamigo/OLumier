import { NextResponse, type NextRequest } from "next/server";
import { consultarUm } from "@/lib/db";
import {
  esquecerPessoa,
  favoritasDaPessoa,
  lembrarPessoa,
  pessoaPorEmail,
} from "@/lib/favoritas";
import { temAcessoLiberado } from "@/lib/galerias-publicas";

/**
 * "Quem é você nesta galeria" — o e-mail que separa uma lista de favoritas da
 * outra.
 *
 * ── POR QUE ISTO NÃO É LOGIN ──────────────────────────────────────────────
 *
 * Não há senha, não há confirmação, não há conta. O e-mail é digitado e aceito
 * — decisão do Felipe em 15/09/2026, e a razão é o problema que ele resolve: o
 * convidado que desmarcava a escolha da noiva SEM QUERER. Contra o engano, o
 * nome basta; contra quem queira mexer de propósito sabendo o e-mail dela, não
 * protege, e esta rota não finge o contrário.
 *
 * A porta de entrada continua sendo a mesma da galeria: publicada, fora do
 * cofre, e a senha quando houver. Identificar-se não abre nada que o link já
 * não abrisse — só diz de quem é a lista.
 */
async function galeriaLiberada(id: string) {
  const galeria = await consultarUm<{ id: string; senha_hash: string | null; estado: string }>(
    "select id, senha_hash, estado from galerias where id = $1 and publicada",
    [id],
  );
  if (!galeria) return { ok: false as const, status: 404 };
  if (galeria.estado !== "online") return { ok: false as const, status: 409 };
  if (galeria.senha_hash && !(await temAcessoLiberado(id, galeria.senha_hash))) {
    return { ok: false as const, status: 401 };
  }
  return { ok: true as const };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const permissao = await galeriaLiberada(id);
  if (!permissao.ok) return NextResponse.json({ erro: "sem acesso" }, { status: permissao.status });

  let corpo: { email?: string; nome?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "requisição inválida" }, { status: 400 });
  }

  const pessoa = await pessoaPorEmail(id, String(corpo.email ?? ""), corpo.nome ?? null);
  if (!pessoa) {
    /* A recusa é do FORMATO, e a mensagem diz isso: "e-mail inválido" faria a
       pessoa achar que o endereço dela não é aceito, quando o que faltou foi um
       arroba. */
    return NextResponse.json(
      { erro: "Confira o e-mail — está faltando o arroba ou o ponto." },
      { status: 400 },
    );
  }

  await lembrarPessoa(id, pessoa.id);

  /* Devolve a lista junto: a pessoa que se identifica no segundo aparelho
     espera reencontrar o que já escolheu, e sem isto a tela apareceria vazia
     até o próximo carregamento. */
  return NextResponse.json({
    pessoa: { email: pessoa.email, nome: pessoa.nome },
    favoritas: await favoritasDaPessoa(id, pessoa.id),
  });
}

/** "Não sou eu" — troca de pessoa no mesmo navegador, que é o notebook da casa. */
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await esquecerPessoa(id);
  return NextResponse.json({ ok: true });
}
