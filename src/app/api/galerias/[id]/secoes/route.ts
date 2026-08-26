import { NextResponse, type NextRequest } from "next/server";
import { tenantDaRequisicao, tenantQuePodeEnviar } from "@/lib/auth-api";
import { consultarUm } from "@/lib/db";
import { criarSecao, listarSecoes } from "@/lib/secoes";

/**
 * Capítulos da galeria pela API — a subcoleção do Lightroom vira um destes.
 *
 * Como `criarGaleria`, `criarSecao` só existia atrás de uma server action. E o
 * plugin precisa dos dois: sem capítulo, uma coleção com subcoleções publica
 * tudo achatado num monte só. Ver docs/chave-de-api.md.
 */

/** Confere que a galeria é deste estúdio. Galeria de outro não existe aqui. */
function daGaleria(galeriaId: string, tenantId: string) {
  return consultarUm<{ id: string; estado: string }>(
    "select id, estado from galerias where id = $1 and tenant_id = $2",
    [galeriaId, tenantId],
  );
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantDaRequisicao(request, "leitura");
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const { id } = await params;
  if (!(await daGaleria(id, tenantId))) {
    return NextResponse.json({ erro: "Galeria não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ secoes: await listarSecoes(id) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quem = await tenantQuePodeEnviar(request);
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });

  const { id } = await params;
  const galeria = await daGaleria(id, quem.tenantId);
  if (!galeria) return NextResponse.json({ erro: "Galeria não encontrada." }, { status: 404 });
  if (galeria.estado !== "online") {
    return NextResponse.json(
      { erro: "Esta galeria está no cofre. Reative antes de mexer nos capítulos." },
      { status: 409 },
    );
  }

  let corpo: { nome?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const nome = String(corpo.nome ?? "").trim();
  if (!nome) return NextResponse.json({ erro: "Dê um nome ao capítulo." }, { status: 400 });

  /*
   * `criarSecao` devolve null por DOIS motivos: nome vazio ou capítulo repetido
   * (ignorando maiúsculas — "Making Of" e "making of" são o mesmo para quem lê).
   * O nome vazio já foi barrado acima, então o null que chega aqui é repetição,
   * e 409 é a resposta honesta: o plugin republicando a mesma subcoleção precisa
   * distinguir "já existe" de "deu errado" para seguir em vez de abortar.
   */
  const secao = await criarSecao(id, quem.tenantId, nome);
  if (!secao) {
    return NextResponse.json({ erro: "Já existe um capítulo com esse nome." }, { status: 409 });
  }

  return NextResponse.json({ id: secao.id, nome: secao.nome }, { status: 201 });
}
