import { NextResponse, type NextRequest } from "next/server";
import { resolverEstudio } from "@/lib/endereco";
import { ehDominioPrincipal, estudioDoHost } from "@/config/dominios";
import { dominioLiberaCertificado } from "@/lib/dominio-proprio";

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
/*
 * ── LEIA ANTES DE COPIAR ISTO PARA OUTRA ROTA (26/08/2026) ────────────────
 * Em 26/08/2026 eu escrevi aqui que o Next cacheava a resposta desta rota por
 * URL, e que por isso um estúdio apagado continuaria liberando certificado.
 * **Estava errado, e a medição está abaixo.**
 *
 * GET de route handler é DINÂMICO por padrão desde a v15.0.0-RC (está no
 * changelog em `node_modules/next/dist/.../route.md`), e este projeto roda a
 * 16.3.1. Medido com esta linha removida: mesma URL, `dominio_verificado_em`
 * indo de null para agora entre as duas chamadas, resposta 403 → 200. Sem
 * cache nenhum.
 *
 * O que eu tinha visto era outra coisa: uma segunda sessão rodava a suíte a
 * cada dois minutos contra o mesmo banco, e o `finally` de um teste limpava
 * `dominio_proprio` segundos depois do meu probe gravá-lo. O 403 era a resposta
 * CERTA para um domínio que já não existia mais.
 *
 * ── ENTÃO POR QUE A LINHA FICA ───────────────────────────────────────────
 * Não por causa daquele defeito, que não existe. Fica porque este endereço é
 * uma decisão de AUTORIZAÇÃO — o Caddy pergunta se pode emitir certificado — e
 * o padrão que a torna dinâmica já mudou uma vez, na v15. Fixar custa uma linha
 * e tira essa rota da lista de coisas que um `revalidate` distraído poderia
 * quebrar em silêncio.
 *
 * NÃO é padrão da casa. Não copie para toda rota nova: em GET comum a linha é
 * cerimônia, e o resto do projeto vive bem sem ela.
 */
export const dynamic = "force-dynamic";

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
  if (slug) {
    /*
     * `resolverEstudio` e não um `select` cru: o endereço ANTIGO também precisa
     * de certificado. Um estúdio que trocou de endereço continua tendo links
     * entregues apontando para o subdomínio velho, e a página sabe redirecionar
     * — mas só se a conexão chegar a existir. Sem o certificado, o visitante
     * toma erro de TLS no navegador e nunca vê redirecionamento nenhum.
     *
     * A recusa continua fechada para quem não é de ninguém: subdomínio
     * inventado segue sem certificado, que é o motivo de esta rota existir.
     */
    const estudio = await resolverEstudio(slug);
    if (!estudio) return new NextResponse("estúdio não encontrado", { status: 403 });
    return new NextResponse("ok", { status: 200 });
  }

  /*
   * Domínio próprio do estúdio (migração 023).
   *
   * Vem por último de propósito: é o único caso que consulta o banco por um
   * host que pode ser QUALQUER coisa, e as duas checagens acima resolvem o
   * caminho comum sem chegar aqui.
   *
   * `dominioLiberaCertificado` só devolve true para domínio com a posse PROVADA
   * por DNS. Sem isso, um estúdio digitando `padelizou.com.br` faria o Caddy
   * tentar emitir certificado para domínio alheio — e a cota da Let's Encrypt é
   * por SERVIDOR, com quatro produtos neste. É a mesma razão pela qual este
   * porteiro existe, aplicada ao caso novo.
   */
  if (await dominioLiberaCertificado(dominio)) {
    return new NextResponse("ok", { status: 200 });
  }

  return new NextResponse("domínio de fora", { status: 403 });
}
