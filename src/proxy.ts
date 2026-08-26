import { NextResponse, type NextRequest } from "next/server";
import { SUBDOMINIOS_RESERVADOS } from "@/config/subdominios";
import { estudioDoHost } from "@/config/dominios";
import { marca } from "@/config/marca";

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

/*
 * O domínio base era escrito aqui à mão, e este arquivo era o único lugar que o
 * sabia — o porteiro do certificado tinha a própria cópia, tirada de
 * `marca.dominio`. Duas fontes para a mesma pergunta significam que uma delas
 * pode aceitar um domínio que a outra recusa: o certificado sai e o endereço
 * abre a home em vez da galeria do estúdio, ou o contrário.
 *
 * Agora os dois leem `config/dominios.ts`, que atende mais de um domínio ao
 * mesmo tempo — é o que permite uma troca de marca sem derrubar link entregue.
 */

// A lista de reservados mora em config/subdominios.ts para o CADASTRO usar a
// mesma: antes ela só existia aqui, e nada impedia um estúdio nascer com o
// slug "www".

/** Devolve o slug do estúdio quando o endereço é um subdomínio de algum domínio atendido. */
function estudioDoEndereco(host: string | null): string | null {
  const slug = estudioDoHost(host);
  if (!slug || SUBDOMINIOS_RESERVADOS.has(slug)) return null;
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
        return NextResponse.redirect(new URL(pathname + search, `https://${marca.dominio}`));
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
          return NextResponse.redirect(new URL(pathname + search, `https://${marca.dominio}`));
        }
        const curto = tipo === "g" && resto.length ? `/${resto.join("/")}` : "/";
        return NextResponse.redirect(new URL(curto + search, `https://${estudio}.${marca.dominio}`));
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
