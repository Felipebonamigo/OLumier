import { NextResponse, type NextRequest } from "next/server";
import { SUBDOMINIOS_RESERVADOS } from "@/config/subdominios";
import { ehDominioPrincipal, estudioDoHost } from "@/config/dominios";
import { estudioDoDominioProprio } from "@/lib/dominio-proprio";
import { marca } from "@/config/marca";
import { COOKIE_PREVIA, VALIDADE_PREVIA_S, baseDaGaleria } from "@/config/previa";

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
 *
 * 3. Prévia do dono — o `?previa=1` vira cookie e sai da barra, para o link
 *    que o fotógrafo copia dali ser o do cliente. Ver `config/previa.ts`.
 */

const NOME_COOKIE = "olumier_sessao";

/** Um arquivo pedido na raiz do endereço do estúdio — ver "ARQUIVO NÃO É GALERIA". */
const ARQUIVO_NA_RAIZ =
  /^\/[^/]*\.(txt|xml|json|webmanifest|ico|png|jpe?g|gif|webp|avif|svg|php|env|js|css|map|html?)$/i;

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

/**
 * Devolve o slug do estúdio deste endereço — subdomínio nosso ou domínio próprio.
 *
 * A ordem é de custo crescente, e isso importa: o proxy roda em quase toda
 * requisição do site.
 *
 *   1. `estudioDoHost` — string pura, resolve todo subdomínio nosso;
 *   2. domínio principal — sai aqui, e é o caminho MAIS comum de todos;
 *   3. só então o banco, para o host que não é nem um nem outro.
 *
 * Sem o degrau 2, cada visita a olumier.com.br viraria uma busca por domínio
 * próprio. O cache absorveria, mas o certo é não perguntar.
 */
async function estudioDoEndereco(host: string | null): Promise<string | null> {
  const slug = estudioDoHost(host);
  if (slug) return SUBDOMINIOS_RESERVADOS.has(slug) ? null : slug;

  if (ehDominioPrincipal(host)) return null;

  return estudioDoDominioProprio(host);
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // --- www do domínio canônico ---------------------------------------------
  /*
   * `www.galeriaatomo.com.br` e `galeriaatomo.com.br` serviam a mesma página,
   * as duas com 200 — o bloco do Caddy entrega os dois nomes ao app sem
   * redirecionar (ops/caddy-galeriaatomo.md). Para o buscador são dois sites
   * com o conteúdo copiado, e a relevância da home se dividia entre eles.
   * Permanente (308), para ele juntar as duas numa só (26/09/2026).
   *
   * Só o `www` do CANÔNICO. O domínio antigo não passa por aqui: a rota interna
   * `olumier.com.br/g/...` continua servindo de propósito, porque é link de
   * galeria já entregue (ver `testar-subdominio.mjs`, etapas LEGADO).
   *
   * A `/api` fica de fora: webhook e porteiro do certificado não seguem
   * redirecionamento, e quem os chama pelo `www` precisa ser atendido ali.
   */
  const hostPedido = request.headers.get("host")?.split(":")[0].toLowerCase();
  if (hostPedido === `www.${marca.dominio}` && !pathname.startsWith("/api")) {
    return NextResponse.redirect(new URL(pathname + search, `https://${marca.dominio}`), 308);
  }

  // --- subdomínio do estúdio ------------------------------------------------
  const estudio = await estudioDoEndereco(request.headers.get("host"));
  if (estudio) {
    // Rotas internas seguem intactas — reescrever /api ou /_next quebraria tudo.
    // O `/icon.svg` entrou em 26/09/2026: sem ele, cada página aberta no
    // endereço do estúdio pedia o ícone, e o pedido virava a renderização de
    // uma galeria chamada "icon.svg" — consulta ao banco para devolver 404.
    const interna =
      pathname.startsWith("/api") ||
      pathname.startsWith("/_next") ||
      pathname === "/favicon.ico" ||
      pathname === "/icon.svg";

    /*
     * `robots.txt` e `sitemap.xml` do ESTÚDIO, e não os da casa: os da casa
     * apontam para `galeriaatomo.com.br` e fecham o `/painel`, que aqui nem
     * existe. Pela mesma leitura de endereço curto que vale para galeria,
     * estes dois caíam na rota de galeria e devolviam 404 — o site que o
     * estúdio divulga ficava sem mapa para o buscador (26/09/2026).
     *
     * As rotas de destino têm nome NEUTRO, e não `robots.txt`/`sitemap.xml`:
     * o Next trata todo caminho que termina em `/sitemap.xml` como rota
     * especial de metadados, com regras próprias de nome e de cache. Aqui
     * elas são rotas comuns, e o endereço público continua o que o robô pede.
     */
    if (pathname === "/robots.txt") {
      return NextResponse.rewrite(new URL(`/e/${estudio}/regras-para-robos`, request.url));
    }
    if (pathname === "/sitemap.xml") {
      return NextResponse.rewrite(new URL(`/e/${estudio}/mapa-do-site`, request.url));
    }

    /*
     * ARQUIVO NÃO É GALERIA (30/09/2026).
     *
     * Robô pede arquivo o tempo todo — `/llms.txt`, `/apple-touch-icon.png`,
     * `/ads.txt`, e as sondagens de sempre (`/wp-login.php`, `/.env`). Cada um
     * era lido como o endereço curto de uma galeria e pagava uma renderização
     * inteira da rota, com consulta ao banco, para devolver 404.
     *
     * Endereço de galeria nunca tem extensão: todo slug sai de `gerarSlug`, que
     * só deixa letra, número e hífen. A lista de extensões é fechada, e não
     * "qualquer ponto", para uma galeria antiga de antes dessa regra continuar
     * abrindo — só o que é inequivocamente arquivo para aqui.
     */
    if (!interna && ARQUIVO_NA_RAIZ.test(pathname)) {
      return new NextResponse("Não encontrado\n", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

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
        /*
         * O HOST QUE CHEGOU É O HOST QUE VOLTA.
         *
         * Isto era `https://${estudio}.${marca.dominio}` — montado a partir do
         * nosso domínio, o que estava certo enquanto o subdomínio fosse o único
         * endereço possível. Com domínio próprio (migração 023) essa linha joga
         * o visitante de carolinetedesco.com.br de volta para o olumier.com.br
         * no meio da navegação: o estúdio paga por um endereço e o nome dele
         * some na primeira normalização de link.
         *
         * O defeito seria silencioso — a página abre, só que no lugar errado.
         *
         * O host vem do cabeçalho da requisição, e não de `nextUrl`: em
         * desenvolvimento os dois divergem (o `nextUrl` traz localhost, o
         * cabeçalho traz o subdomínio simulado), e é o cabeçalho que diz por
         * qual endereço a pessoa chegou.
         */
        const host = request.headers.get("host") ?? `${estudio}.${marca.dominio}`;
        const protocolo = request.nextUrl.protocol === "http:" ? "http" : "https";
        return NextResponse.redirect(new URL(curto + search, `${protocolo}://${host}`));
      }

      const galeria = pathname.replace(/^\/+|\/+$/g, "");
      const destino = galeria ? `/g/${estudio}/${galeria}` : `/e/${estudio}`;
      /*
       * ── O ENDEREÇO QUE A PESSOA VÊ, PARA QUEM PRECISA MONTAR LINK ────────
       *
       * Aqui dentro a galeria mora em `/g/<estudio>/<galeria>`; no domínio
       * próprio o visitante vê `/<galeria>`, e a forma interna é justamente o
       * que o bloco lá em cima recusa servir nesse host. Quem montar o link de
       * um capítulo a partir de `/g/...` quebra exatamente nos estúdios que
       * pagam pelo endereço deles.
       *
       * Só o primeiro pedaço: dentro de um capítulo o caminho já vem
       * `/<galeria>/<capitulo>`, e a base continua sendo a galeria.
       */
      const cabecalhos = new Headers(request.headers);
      if (galeria) cabecalhos.set(CAMINHO_PUBLICO, `/${galeria.split("/")[0]}`);
      return NextResponse.rewrite(new URL(destino + search, request.url), {
        request: { headers: cabecalhos },
      });
    }
  }

  // --- prévia do dono: o pedido vira cookie, e a barra fica limpa ------------
  // Ver `config/previa.ts`. Só no domínio principal, que é onde mora a sessão:
  // no endereço do estúdio o `?previa=1` não tem quem atender.
  if (
    pathname.startsWith("/g/") &&
    request.nextUrl.searchParams.has("previa") &&
    request.headers.get("sec-fetch-dest") === "document"
  ) {
    const base = baseDaGaleria(pathname);
    if (base) {
      const busca = new URLSearchParams(search);
      busca.delete("previa");
      const consulta = busca.toString();
      const resposta = NextResponse.redirect(
        new URL(pathname + (consulta ? `?${consulta}` : ""), request.url),
      );
      resposta.cookies.set(COOKIE_PREVIA, "1", {
        path: base,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: VALIDADE_PREVIA_S,
      });
      return resposta;
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

/**
 * O cabeçalho em que o proxy guarda o endereço público da galeria.
 *
 * Existe porque a reescrita esconde da página por qual endereço a pessoa
 * chegou — e é esse endereço que os links de capítulo precisam ter como base.
 */
export const CAMINHO_PUBLICO = "x-caminho-publico";

export const config = {
  // Precisa ver todas as rotas para reconhecer o subdomínio; as exceções ficam
  // de fora aqui mesmo, para não pagar o custo em arquivo estático.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
