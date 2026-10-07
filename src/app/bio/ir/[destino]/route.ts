import { after, NextResponse, type NextRequest } from "next/server";
import { marca } from "@/config/marca";
import { alvoDaBio } from "@/config/bio";
import {
  NOME_DO_COOKIE_DA_BIO,
  VALIDADE_DA_ORIGEM_DIAS,
  ehAdiantamento,
  montarCookieDaBio,
  origemDaConsulta,
  urlComOrigem,
} from "@/lib/bio-regras";
import { quemPede, registrarEventoDaBio } from "@/lib/bio";
import { ipDaRequisicao } from "@/lib/origem";

/**
 * O CLIQUE NA PÁGINA-PONTE — conta, lembra de onde a pessoa veio, e redireciona.
 *
 * `/bio/ir/galeria`, `/bio/ir/atomatiza`, `/bio/ir/entrar-galeria`… Os destinos
 * vêm de `config/bio.ts` pelo nome; o endereço de saída NUNCA vem do pedido
 * (um `?para=` aqui seria um redirecionador aberto, o favorito de quem monta
 * golpe com o nosso domínio). Caminho desconhecido volta para a página.
 *
 * ── O QUE ACONTECE NO CLIQUE ──────────────────────────────────────────────
 *
 *   1. conta o clique, DEPOIS de responder (`after`): medir não pode atrasar a
 *      pessoa, e se o banco engasgar o redirecionamento sai do mesmo jeito;
 *   2. nos botões de PRODUTO, grava o cookie de origem (httpOnly, 30 dias) —
 *      é ele que o cadastro lê para dizer "esta conta veio do Instagram";
 *   3. se o produto mora em outro domínio, a origem vai na URL (UTM): cookie
 *      não atravessa domínio. O produto do nosso site vai com a URL limpa.
 *
 * ── O QUE NÃO CONTA ───────────────────────────────────────────────────────
 *
 * Robô (a prévia do link no WhatsApp), navegador adiantando a página sem
 * toque, e `HEAD`. O redirecionamento acontece igual — só não vira número.
 * Quem usa `<Link>` do Next para chegar aqui o pré-carregaria: por isso a
 * página usa `<a>` comum.
 *
 * 302, e não 301: um 301 seria guardado pelo navegador, e o clique seguinte
 * nem chegaria aqui — nem para contar, nem para reorganizar o destino.
 */

/** O endereço do nosso site: o canônico em produção, o da própria requisição em desenvolvimento. */
function raizDoSite(request: NextRequest): string {
  return process.env.NODE_ENV === "production" ? `https://${marca.dominio}` : request.nextUrl.origin;
}

async function resolver(request: NextRequest, caminho: string, contar: boolean) {
  const raiz = raizDoSite(request);
  const alvo = alvoDaBio(caminho);
  if (!alvo) return NextResponse.redirect(new URL("/bio", raiz), 302);

  const origem = origemDaConsulta(request.nextUrl.searchParams);
  const destino = new URL(alvo.destino, raiz).toString();
  const resposta = NextResponse.redirect(alvo.origemNaUrl ? urlComOrigem(destino, origem) : destino, 302);
  resposta.headers.set("Cache-Control", "no-store");

  if (!contar || ehAdiantamento(request.headers)) return resposta;
  const quem = quemPede(await ipDaRequisicao(), request.headers.get("user-agent"));
  if (!quem.gente) return resposta;

  if (alvo.tipo === "produto") {
    resposta.cookies.set(NOME_DO_COOKIE_DA_BIO, montarCookieDaBio({ ...origem, produto: alvo.produto.id }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: VALIDADE_DA_ORIGEM_DIAS * 24 * 60 * 60,
    });
  }
  after(() =>
    registrarEventoDaBio({
      evento: alvo.evento,
      fonte: origem.fonte,
      meio: origem.meio,
      campanha: origem.campanha,
      visitante: quem.visitante,
      /* O polegar que aperta duas vezes. */
      janelaSeg: 3,
    }),
  );
  return resposta;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ destino: string }> }) {
  return resolver(request, (await params).destino, true);
}

/** `HEAD` responde igual e não conta: é o que verificadores de link fazem. */
export async function HEAD(request: NextRequest, { params }: { params: Promise<{ destino: string }> }) {
  return resolver(request, (await params).destino, false);
}
