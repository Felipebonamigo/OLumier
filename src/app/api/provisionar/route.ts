import { NextResponse, type NextRequest } from "next/server";
import {
  provisionamentoConfigurado,
  segredoConfere,
  provisionarEstudio,
} from "@/lib/provisionamento";
import { marca } from "@/config/marca";

/**
 * POST /api/provisionar — o outro produto da casa cria a conta pelo fotógrafo.
 *
 * O porquê inteiro está em `lib/provisionamento.ts`. Aqui fica só a porta: o
 * segredo, a validação do que chega, e a forma da resposta.
 *
 * ── ESTA ROTA NÃO USA CHAVE `ga_…`, E NÃO PODERIA ─────────────────────────
 *
 * Toda a outra API daqui se autentica com a chave do estúdio, que é a prova de
 * quem ele é. Esta cria o estúdio — não há chave ainda, e não há como haver. O
 * que autoriza é um segredo de PLATAFORMA, combinado entre os dois produtos e
 * guardado no ambiente dos dois. Por isso ele autoriza só uma coisa: criar
 * conta em teste. Não lê nada, não toca em conta existente, não publica nada.
 *
 * Sem o segredo configurado a porta responde 503 e fica fechada — nunca
 * "aberta porque ninguém configurou", que é como porta de serviço vira porta.
 */
export async function POST(request: NextRequest) {
  if (!provisionamentoConfigurado()) {
    return NextResponse.json(
      { erro: "Criação de conta por integração não está ligada neste servidor." },
      { status: 503 },
    );
  }

  if (!segredoConfere(request.headers.get("x-provisionamento-segredo"))) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Corpo inválido." }, { status: 400 });
  }

  const c = corpo as Record<string, unknown>;
  const nomeEstudio = typeof c?.nomeEstudio === "string" ? c.nomeEstudio.trim() : "";
  const email = typeof c?.email === "string" ? c.email.trim() : "";
  const referencia = typeof c?.referenciaExterna === "string" ? c.referenciaExterna.trim() : "";

  if (!nomeEstudio) return NextResponse.json({ erro: "nomeEstudio é obrigatório." }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ erro: "E-mail inválido." }, { status: 400 });
  }
  /* A referência é o que torna o retry seguro (migração 047). Sem ela, uma
   * resposta perdida no caminho viraria conta órfã na segunda tentativa. */
  if (!referencia) {
    return NextResponse.json({ erro: "referenciaExterna é obrigatória." }, { status: 400 });
  }

  const r = await provisionarEstudio({ nomeEstudio, email, origem: "atomatiza", referencia });

  if (!r.ok) {
    /*
     * 409, e a mensagem diz o que fazer.
     *
     * Contar que o e-mail já tem conta aqui não abre nada que o cadastro
     * público já não abra — ele responde "Já existe uma conta com esse e-mail"
     * para qualquer um, sem segredo nenhum. E quem chega aqui teve de
     * apresentar o segredo de plataforma. O que se ganha é o outro lado poder
     * mostrar a instrução certa ("você já tem conta: cole a chave") em vez de
     * um erro cego.
     */
    return NextResponse.json(
      {
        erro: "ja_tem_conta",
        recado:
          `Já existe uma conta no ${marca.nome} com esse e-mail. ` +
          `Entre lá, gere uma chave de API e cole aqui para ligar as duas.`,
      },
      { status: 409 },
    );
  }

  /*
   * A chave sai UMA VEZ, aqui, e nunca mais — igual à criação pelo painel: o
   * banco guarda só o hash. Quem chamou grava cifrado do lado dele.
   *
   * `jaExistia` distingue "criei agora" de "era retry": o outro lado usa isso
   * para não mandar de novo a mensagem de boas-vindas ao fotógrafo.
   */
  return NextResponse.json(
    {
      tenantId: r.conta.id,
      slug: r.conta.slug,
      nomeEstudio: r.conta.nomeEstudio,
      dominio: marca.dominio,
      escopo: "envio",
      chave: r.chave,
      jaExistia: r.jaExistia,
    },
    { status: r.jaExistia ? 200 : 201 },
  );
}
