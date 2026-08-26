import { NextResponse, type NextRequest } from "next/server";
import { consultarUm } from "@/lib/db";
import { ehDominioPrincipal, estudioDoHost } from "@/config/dominios";

/**
 * Porteiro do certificado sob demanda.
 *
 * Cada estúdio ganha seu subdomínio (siriusfotografia.olumier.com.br), e o Caddy
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

  /*
   * A pergunta aqui é "esta instalação atende este host?", e não "este é o
   * domínio canônico?". Durante uma troca de marca as duas respostas divergem:
   * atendemos dois domínios e o canônico é um só. Ler `marca.dominio` fazia o
   * porteiro recusar o domínio novo — e sem o "ok" daqui o Caddy nunca emite o
   * certificado, então o site novo não sobe nem com o DNS perfeito.
   *
   * `config/dominios.ts` é a fonte, a mesma que o `proxy.ts` usa. Duas cópias
   * desta regra já significaram um aceitar o que o outro recusa.
   */
  if (ehDominioPrincipal(dominio)) {
    return new NextResponse("ok", { status: 200 });
  }

  const slug = estudioDoHost(dominio);
  /* `estudioDoHost` devolve null para host de fora, para sub-subdomínio e para
   * o parecido (`olumier.com.br.golpe.net`) — a comparação lá é por sufixo com
   * ponto, nunca `includes`. Emitir certificado para domínio alheio nos
   * transformaria em emissor de graça para um golpista. */
  if (!slug) {
    return new NextResponse("domínio de fora", { status: 403 });
  }

  const estudio = await consultarUm<{ id: string }>("select id from tenants where slug = $1", [
    slug,
  ]);
  if (!estudio) return new NextResponse("estúdio não encontrado", { status: 403 });

  return new NextResponse("ok", { status: 200 });
}
