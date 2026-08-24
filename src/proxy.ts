import { NextResponse, type NextRequest } from "next/server";
import { SUBDOMINIOS_RESERVADOS } from "@/config/subdominios";

/**
 * No Next 16 o antigo `middleware.ts` passou a se chamar `proxy.ts`.
 *
 * Faz duas coisas:
 *
 * 1. Checagem otimista de sessão — só olha se o cookie existe, como a
 *    documentação recomenda. A validação de verdade (assinatura HMAC + validade
 *    + estúdio existe) fica no layout do painel, que roda em Node e tem banco.
 *    Cookie falsificado passa por aqui e morre lá, antes de tocar em dado.
 *
 * 2. Subdomínio por estúdio — `siriusfotografia.olumier.com.br/lu-marino` é
 *    reescrito para a rota interna `/g/siriusfotografia/lu-marino`. É reescrita,
 *    não redirecionamento: o visitante continua vendo o endereço bonito.
 */

const NOME_COOKIE = "olumier_sessao";
const DOMINIO_BASE = "olumier.com.br";

// A lista mora em config/subdominios.ts para o CADASTRO usar a mesma: antes ela
// só existia aqui, e nada impedia um estúdio nascer com o slug "www".

/** Devolve o slug do estúdio quando o endereço é um subdomínio dele. */
function estudioDoEndereco(host: string | null): string | null {
  if (!host) return null;
  const nome = host.split(":")[0].toLowerCase();

  const sufixo = `.${DOMINIO_BASE}`;
  if (!nome.endsWith(sufixo)) return null;

  const slug = nome.slice(0, -sufixo.length);
  // Sub-subdomínio (a.b.olumier.com.br) não é o nosso formato.
  if (!slug || slug.includes(".") || SUBDOMINIOS_RESERVADOS.has(slug)) return null;
  return slug;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // --- subdomínio do estúdio ------------------------------------------------
  const estudio = estudioDoEndereco(request.headers.get("host"));
  if (estudio) {
    // Rotas internas seguem intactas — reescrever /api ou /_next quebraria tudo.
    const interna =
      pathname.startsWith("/api") ||
      pathname.startsWith("/_next") ||
      pathname === "/favicon.ico";

    if (!interna) {
      // O painel mora só no domínio principal: quem tenta entrar por um
      // subdomínio de estúdio é mandado para lá, senão haveria dois endereços
      // para a mesma tela e o cookie de sessão não valeria nos dois.
      if (pathname.startsWith("/painel") || pathname === "/entrar" || pathname === "/cadastrar") {
        return NextResponse.redirect(new URL(pathname + search, `https://${DOMINIO_BASE}`));
      }

      // `/g/` e `/e/` são a forma interna das páginas públicas, e estavam na
      // lista acima: passavam intactas. Com isso
      // `siriusfotografia.olumier.com.br/g/outroestudio/casamento` servia a
      // entrega de um estúdio dentro do endereço de outro — a marca própria,
      // que é o que se vende aqui, quebrada numa linha. Agora a casa só
      // responde pelo que é dela, e pelo endereço curto.
      if (pathname.startsWith("/g/") || pathname.startsWith("/e/")) {
        const [, tipo, dono, ...resto] = pathname.split("/");
        if (dono !== estudio) {
          // Não é 404: a galeria existe, só não mora nesta casa. O visitante
          // com o link torto chega no endereço certo em vez de numa parede.
          return NextResponse.redirect(new URL(pathname + search, `https://${DOMINIO_BASE}`));
        }
        const curto = tipo === "g" && resto.length ? `/${resto.join("/")}` : "/";
        return NextResponse.redirect(new URL(curto + search, `https://${estudio}.${DOMINIO_BASE}`));
      }

      const galeria = pathname.replace(/^\/+|\/+$/g, "");
      const destino = galeria ? `/g/${estudio}/${galeria}` : `/e/${estudio}`;
      return NextResponse.rewrite(new URL(destino + search, request.url));
    }
  }

  // --- sessão ---------------------------------------------------------------
  const temCookie = Boolean(request.cookies.get(NOME_COOKIE)?.value);

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
  // Precisa ver todas as rotas para reconhecer o subdomínio; as exceções ficam
  // de fora aqui mesmo, para não pagar o custo em arquivo estático.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
