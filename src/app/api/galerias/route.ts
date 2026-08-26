import { NextResponse, type NextRequest } from "next/server";
import { tenantDaRequisicao, tenantQuePodeEnviar } from "@/lib/auth-api";
import { consultar } from "@/lib/db";
import { criarGaleria } from "@/lib/tenants";

/**
 * Listar e criar galeria — as duas coisas que faltavam para um programa
 * conseguir publicar.
 *
 * Criar galeria vivia SÓ como server action (`criarGaleriaAction`), que usa
 * `redirect()` e `revalidatePath`: útil para o formulário do painel e
 * inalcançável de fora do React. Sem esta rota, a chave de API autorizaria um
 * plugin do Lightroom que não teria onde publicar. Ver docs/chave-de-api.md.
 *
 * O painel continua usando a server action — ela não sai daqui. Esta rota é a
 * porta de fora, e as duas chamam a mesma `criarGaleria` do `lib/tenants`.
 */

/** As galerias do estúdio, para o plugin mostrar a lista de destinos. */
export async function GET(request: NextRequest) {
  const tenantId = await tenantDaRequisicao(request, "leitura");
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  /*
   * A lixeira fica de fora: para quem publica, galeria apagada não existe, e
   * oferecê-la como destino faria o plugin ressuscitar entrega que o fotógrafo
   * mandou apagar. O cofre entra, com o estado à mostra — dá para ver que está
   * arquivada e reativar no painel.
   */
  const galerias = await consultar(
    `select id, slug, titulo, subtitulo, data_evento, publicada, estado,
            bytes_total::text as bytes
       from galerias
      where tenant_id = $1 and estado <> 'lixeira'
      order by criado_em desc`,
    [tenantId],
  );

  return NextResponse.json({ galerias });
}

/** Cria a galeria. A coleção publicada do Lightroom vira uma destas. */
export async function POST(request: NextRequest) {
  // Autoriza E confere o portão de cobrança — ver tenantQuePodeEnviar.
  const quem = await tenantQuePodeEnviar(request);
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });

  let corpo: { titulo?: string; subtitulo?: string; dataEvento?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const titulo = String(corpo.titulo ?? "").trim();
  if (!titulo) return NextResponse.json({ erro: "Dê um nome para a galeria." }, { status: 400 });

  /* `criarGaleria` resolve a colisão de slug sozinha (ana-pedro, ana-pedro-2…):
   * o plugin pode publicar duas coleções de mesmo nome sem escolher endereço. */
  const galeria = await criarGaleria({
    tenantId: quem.tenantId,
    titulo,
    subtitulo: String(corpo.subtitulo ?? "").trim() || undefined,
    dataEvento: String(corpo.dataEvento ?? "").trim() || undefined,
  });

  return NextResponse.json(
    { id: galeria!.id, slug: galeria!.slug, titulo: galeria!.titulo },
    { status: 201 },
  );
}
