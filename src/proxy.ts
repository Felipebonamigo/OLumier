import { NextResponse, type NextRequest } from "next/server";

/**
 * No Next 16 o antigo `middleware.ts` passou a se chamar `proxy.ts`.
 *
 * Aqui fazemos APENAS a checagem otimista que a documentação recomenda: existe
 * um cookie de sessão? Isso evita renderizar o painel para quem claramente não
 * entrou, e é barato porque roda em toda requisição.
 *
 * A validação de verdade (assinatura HMAC + validade + tenant existe) fica no
 * layout do painel, que roda em Node e tem acesso ao banco. Ou seja: um cookie
 * falsificado passa por aqui e é barrado lá — nunca chega em dado nenhum.
 */

const NOME_COOKIE = "fotonio_sessao";

export function proxy(request: NextRequest) {
  const temCookie = Boolean(request.cookies.get(NOME_COOKIE)?.value);
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/painel") && !temCookie) {
    const url = new URL("/entrar", request.url);
    // Guarda o destino para devolver a pessoa onde ela queria chegar.
    url.searchParams.set("proximo", pathname + search);
    return NextResponse.redirect(url);
  }

  if ((pathname === "/entrar" || pathname === "/cadastrar") && temCookie) {
    return NextResponse.redirect(new URL("/painel", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/painel/:path*", "/entrar", "/cadastrar"],
};
