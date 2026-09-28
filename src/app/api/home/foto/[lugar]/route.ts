import { NextResponse, type NextRequest } from "next/server";
import { consultarUm } from "@/lib/db";
import { urlDeLeitura } from "@/lib/r2";
import { FOTOS_PADRAO, ehLugarDaHome } from "@/config/home-demonstracao";
import { ehChaveDaFotoDaHome } from "@/lib/fotos-da-home-regras";

/**
 * O endereço FIXO de uma foto da página inicial trocada pelo admin.
 *
 * O bucket é privado e todo link de leitura é assinado e expira. A home fica
 * em cache — regenerada quando uma foto muda, e não a cada visita —, então um
 * link assinado escrito no HTML morreria antes do cache e a página seguiria no
 * ar com a foto quebrada. Esta rota é o que vai no HTML: ela assina na hora e
 * redireciona.
 *
 * Lugar sem troca, ou com a troca desfeita entre a página ser gerada e a foto
 * ser pedida, cai na foto padrão do repositório — nunca num 404 no meio da
 * vitrine.
 *
 * `max-age=300` no redirecionamento: o navegador reaproveita por cinco
 * minutos, bem dentro da hora de validade do link assinado. O `?v=` que a
 * página põe no endereço muda a cada troca, então a foto nova não espera
 * esse prazo.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ lugar: string }> }) {
  const { lugar } = await params;
  if (!ehLugarDaHome(lugar)) return new NextResponse(null, { status: 404 });

  const miniatura = request.nextUrl.searchParams.get("t") === "miniatura";
  let destino = FOTOS_PADRAO[lugar].src;

  try {
    const linha = await consultarUm<{ chave: string; chave_miniatura: string | null }>(
      "select chave, chave_miniatura from fotos_da_home where lugar = $1",
      [lugar],
    );
    if (linha) {
      const chave =
        miniatura && ehChaveDaFotoDaHome(linha.chave_miniatura, lugar, "miniatura")
          ? linha.chave_miniatura
          : linha.chave;
      destino = await urlDeLeitura(chave, 3600);
    }
  } catch (e) {
    /* Banco ou bucket fora: a foto padrão ainda é uma foto. */
    console.error("[home] foto do admin indisponível, servindo a padrão:", e);
  }

  return new NextResponse(null, {
    status: 302,
    headers: { Location: destino, "Cache-Control": "public, max-age=300" },
  });
}
