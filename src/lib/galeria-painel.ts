import "server-only";
import { consultarUm } from "./db";
import type { Galeria } from "./tenants";

/**
 * A galeria como o PAINEL a vê — e a autorização que vem junto.
 *
 * ── POR QUE ISTO EXISTE (04/09/2026) ───────────────────────────────────────
 *
 * A tela da galeria virou quatro rotas (fotos, design, entrega, atividade).
 * Quatro rotas são quatro portas para a mesma galeria, e basta UMA sem tranca:
 * a cláusula `and g.tenant_id = $2` é a autorização inteira deste produto, e
 * copiá-la à mão em quatro arquivos é convidar a quinta cópia a esquecê-la.
 *
 * Ela mora aqui, numa função só, e cada página chama. O layout compartilhado
 * NÃO é a defesa — ele desenha o cabeçalho, e um dia alguém pode montar uma
 * rota fora dele. `scripts/testar-painel-abas.mjs` pergunta a cada aba se a
 * galeria do vizinho abre.
 */
export interface GaleriaDoPainel extends Galeria {
  estudio_slug: string;
  estudio_fonte: string | null;
}

/** A galeria DESTE estúdio, ou null. Id de outro estúdio simplesmente não existe. */
export function galeriaDoPainel(id: string, tenantId: string) {
  return consultarUm<GaleriaDoPainel>(
    `select g.*, t.slug as estudio_slug, t.fonte_chave as estudio_fonte
       from galerias g join tenants t on t.id = g.tenant_id
      where g.id = $1 and g.tenant_id = $2`,
    [id, tenantId],
  );
}

/**
 * Quantos arquivos prontos a galeria tem.
 *
 * Existe para a aba Entrega, que só precisa saber se há alguma foto (para
 * avisar antes de publicar galeria vazia). Carregar `listarMedias` ali traria
 * a linha inteira de cada mídia para responder um sim ou não — e era
 * exatamente esse tipo de carga desnecessária que a divisão em abas veio
 * cortar.
 */
export async function contarMediasProntas(galeriaId: string): Promise<number> {
  const r = await consultarUm<{ n: number }>(
    "select count(*)::int as n from medias where galeria_id = $1 and pronto",
    [galeriaId],
  );
  return r?.n ?? 0;
}
