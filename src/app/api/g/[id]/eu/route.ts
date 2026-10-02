import { NextResponse, type NextRequest } from "next/server";
import {
  esquecerPessoa,
  favoritasDaPessoa,
  lembrarPessoa,
  pessoaPorEmail,
  pessoaPorNomeOuEmail,
} from "@/lib/favoritas";
import { galeriaLiberada } from "@/lib/acesso-galeria-publica";

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
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const permissao = await galeriaLiberada(id);
  if (!permissao.ok) return NextResponse.json({ erro: "sem acesso" }, { status: permissao.status });

  let corpo: { email?: string; nome?: string; motivo?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "requisição inválida" }, { status: 400 });
  }

  /*
   * ── BAIXAR ACEITA NOME; FAVORITAR EXIGE E-MAIL ──────────────────────────
   *
   * Felipe, 23/09/2026: "quando for baixar pedir nome e email opcional, pelo
   * menos um dos dois para baixar a primeira vez".
   *
   * A regra é diferente porque o trabalho é diferente. A lista de favoritas
   * precisa atravessar aparelhos — a noiva escolhe no celular e revê no
   * notebook —, e só o e-mail atravessa; um nome digitado em dois lugares são
   * duas linhas. Saber quem baixou não precisa disso: "Tia Marta" na planilha
   * do fotógrafo já responde a pergunta, e exigir e-mail de cada convidado que
   * quer salvar uma foto é atrito em cima de quem não decide nada.
   *
   * O `motivo` vem da tela que pediu. Ausente, vale a regra estrita — quem não
   * disse por que está identificando cai no caso que preserva a lista.
   */
  const pessoa =
    corpo.motivo === "baixar"
      ? await pessoaPorNomeOuEmail(id, { email: corpo.email, nome: corpo.nome })
      : await pessoaPorEmail(id, String(corpo.email ?? ""), corpo.nome ?? null);

  if (!pessoa) {
    /* A recusa é do FORMATO, e a mensagem diz isso: "e-mail inválido" faria a
       pessoa achar que o endereço dela não é aceito, quando o que faltou foi um
       arroba. */
    return NextResponse.json(
      {
        erro:
          corpo.motivo === "baixar"
            ? "Escreva o seu nome ou o seu e-mail."
            : "Confira o e-mail — está faltando o arroba ou o ponto.",
      },
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
