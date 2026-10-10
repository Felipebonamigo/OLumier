import { after, NextResponse, type NextRequest } from "next/server";
import { marca } from "@/config/marca";
import { alvoDaBio } from "@/config/bio";
import {
  EVENTO_SELO,
  NOME_DO_COOKIE_DA_BIO,
  VALIDADE_DA_ORIGEM_DIAS,
  ehAdiantamento,
  montarCookieDaBio,
  origemDoSelo,
} from "@/lib/bio-regras";
import { quemPede, registrarEventoDaBio } from "@/lib/bio";
import { ipDaRequisicao } from "@/lib/origem";

/**
 * O CLIQUE NO SELO DA GALERIA — conta, lembra de onde a pessoa veio, e leva à casa.
 *
 * `/selo/<estudio>?no=galeria` e `?no=vitrine`. É o irmão de `/bio/ir/[destino]`
 * e segue as mesmas regras, pelas mesmas razões (ver lá): o destino é fixo (a
 * home) e NUNCA vem do pedido; robô, adiantamento e `HEAD` redirecionam sem
 * contar; 302 para o clique seguinte também passar por aqui.
 *
 * O estúdio vai como CAMPANHA, peneirado por `rotulo` — não se confere no banco
 * se ele existe. Um nome inventado só rotula o clique de quem o inventou, e o
 * redirecionamento não espera por consulta nenhuma.
 *
 * O cookie é o mesmo da ponte (`origem_bio`): o cadastro já o lê, e a conta
 * nasce com `origem = "selo/galeria/galeria"` e o estúdio em `origem_campanha`.
 */

const PRODUTO = "galeria";

function raizDoSite(request: NextRequest): string {
  return process.env.NODE_ENV === "production" ? `https://${marca.dominio}` : request.nextUrl.origin;
}

async function resolver(request: NextRequest, estudio: string, contar: boolean) {
  const alvo = alvoDaBio(PRODUTO);
  const resposta = NextResponse.redirect(new URL(alvo?.destino ?? "/", raizDoSite(request)), 302);
  resposta.headers.set("Cache-Control", "no-store");

  if (!contar || ehAdiantamento(request.headers)) return resposta;
  const quem = quemPede(await ipDaRequisicao(), request.headers.get("user-agent"));
  if (!quem.gente) return resposta;

  const origem = origemDoSelo(estudio, request.nextUrl.searchParams.get("no"));
  resposta.cookies.set(NOME_DO_COOKIE_DA_BIO, montarCookieDaBio({ ...origem, produto: PRODUTO }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VALIDADE_DA_ORIGEM_DIAS * 24 * 60 * 60,
  });
  after(() =>
    registrarEventoDaBio({
      evento: EVENTO_SELO,
      fonte: origem.fonte,
      meio: origem.meio,
      campanha: origem.campanha,
      visitante: quem.visitante,
      janelaSeg: 3,
    }),
  );
  return resposta;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ estudio: string }> }) {
  return resolver(request, (await params).estudio, true);
}

export async function HEAD(request: NextRequest, { params }: { params: Promise<{ estudio: string }> }) {
  return resolver(request, (await params).estudio, false);
}
