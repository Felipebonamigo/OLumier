import { NextResponse, type NextRequest } from "next/server";
import { consultarUm } from "@/lib/db";
import { marca } from "@/config/marca";

/**
 * Porteiro do certificado sob demanda.
 *
 * Cada estúdio ganha seu subdomínio (siriusfotografia.fotonio.com.br), e o Caddy
 * emite um certificado para cada um na primeira visita — em vez de um curinga,
 * que exigiria trocar o binário do Caddy num servidor com quatro sites em
 * produção.
 *
 * O preço disso é que o Caddy, sozinho, tentaria emitir certificado para
 * QUALQUER domínio apontado ao nosso IP. Alguém apontando mil subdomínios nos
 * levaria ao limite de emissão da Let's Encrypt e derrubaria a emissão de todos
 * os sites do servidor. Por isso o Caddy pergunta aqui antes, e só respondemos
 * "pode" para subdomínio de estúdio que existe de verdade.
 */
export async function GET(request: NextRequest) {
  const dominio = request.nextUrl.searchParams.get("domain")?.toLowerCase().trim();
  if (!dominio) return new NextResponse("sem domínio", { status: 400 });

  const base = marca.dominio.toLowerCase();

  // O domínio principal e o www já têm certificado fixo no Caddy.
  if (dominio === base || dominio === `www.${base}`) {
    return new NextResponse("ok", { status: 200 });
  }

  const sufixo = `.${base}`;
  if (!dominio.endsWith(sufixo)) {
    return new NextResponse("domínio de fora", { status: 403 });
  }

  const slug = dominio.slice(0, -sufixo.length);
  // Um ponto no meio significa sub-subdomínio (a.b.fotonio.com.br) — não é nosso formato.
  if (!slug || slug.includes(".")) {
    return new NextResponse("formato inválido", { status: 403 });
  }

  const estudio = await consultarUm<{ id: string }>("select id from tenants where slug = $1", [
    slug,
  ]);
  if (!estudio) return new NextResponse("estúdio não encontrado", { status: 403 });

  return new NextResponse("ok", { status: 200 });
}
