import { NextResponse, type NextRequest } from "next/server";
import { NOME_COOKIE } from "@/lib/auth";

/**
 * A saída da armadilha: joga fora o cookie de sessão que não vale mais.
 *
 * ── POR QUE ESTA ROTA EXISTE ──────────────────────────────────────────────
 *
 * Duas checagens de sessão convivem, e é de propósito:
 *
 *   proxy   (borda, sem banco)  — OTIMISTA: o cookie existe? então está logado.
 *   layout  (Node, com banco)   — RIGOROSO: a assinatura vale e o estúdio existe?
 *
 * Enquanto concordam, o desenho é bom — a borda é barata, a conferência cara
 * roda uma vez. Quando discordam, vira armadilha fechada:
 *
 *   /painel → layout recusa → /entrar → proxy vê o cookie → /painel → …
 *
 * ERR_TOO_MANY_REDIRECTS, e a pessoa não chega nem na tela de entrar para
 * consertar. Aconteceu em produção em 27/08/2026, com a conta do próprio dono; a
 * única saída era limpar cookie no navegador, o que ninguém adivinha.
 *
 * O conserto NÃO é fazer o proxy conferir a assinatura: ele continuaria
 * discordando do banco no dia em que um estúdio deixasse de existir — e um
 * estúdio foi apagado neste mesmo dia. O conserto é jogar o cookie fora. Cookie
 * que o layout recusou não serve para nada, e enquanto existir o proxy vai
 * continuar acreditando nele.
 *
 * Mora numa ROTA porque componente de servidor não pode mexer em cookie: o
 * layout só sabe redirecionar, e é para cá que ele redireciona.
 *
 * `scripts/testar-sessao-podre.mjs` prende os dois lados: que não há loop, e que
 * o cookie some no caminho — sem a segunda parte, a armadilha reabre no clique
 * seguinte.
 */
export async function GET(request: NextRequest) {
  const proximo = request.nextUrl.searchParams.get("proximo");

  /* Só caminho interno. `proximo` vem da URL, e devolver a pessoa para
   * "https://sitequalquer.com" a partir de um endereço nosso é phishing com o
   * nosso domínio no meio. */
  const busca = new URLSearchParams({ sessao: "expirada" });
  if (proximo && proximo.startsWith("/") && !proximo.startsWith("//")) {
    busca.set("proximo", proximo);
  }

  /*
   * Caminho RELATIVO, e isto não é preferência de estilo.
   *
   * O app roda atrás do Caddy, escutando em localhost:3300 — então `request.url`
   * aqui dentro É "http://localhost:3300/…". `NextResponse.redirect(new
   * URL("/entrar", request.url))` monta a partir dele e devolve
   * `Location: https://localhost:3300/entrar`: um endereço que só existe dentro
   * do servidor, e que o navegador da pessoa não alcança.
   *
   * Publicado assim em 27/08/2026, e trocou o loop por um redirecionamento
   * morto. Em desenvolvimento nunca aparece: lá o app é o próprio endereço
   * público, e o absoluto acerta por coincidência. Relativo o navegador resolve
   * contra a origem de onde veio, seja ela qual for.
   */
  const r = new NextResponse(null, {
    status: 307,
    headers: { location: `/entrar?${busca}` },
  });
  r.cookies.delete(NOME_COOKIE);
  return r;
}
