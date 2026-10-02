import "server-only";
import { consultar } from "./db";
import { armazemDe, urlDaDerivada, urlDoOriginal } from "./armazem";
import type { EnderecoDaMiniatura } from "./miniaturas-do-painel";

/**
 * O endereço de um ladrilho da aba Fotos — a miniatura e, em vídeo, o filme.
 *
 * Um lugar só para as duas portas que assinam: a página, que manda a primeira
 * tela junto com o HTML, e `/api/galerias/[id]/miniaturas`, que manda o resto
 * conforme a grade rola. Se as duas assinassem diferente (validade, armazém),
 * a mesma foto teria dois endereços — e a imagem baixaria duas vezes. Ver
 * `lib/miniaturas-do-painel.ts`.
 */
export async function enderecoDaMiniatura(m: {
  tipo: string;
  chave: string;
  chave_thumb: string | null;
  armazem: string | null;
}): Promise<EnderecoDaMiniatura> {
  const armazem = armazemDe(m.armazem);
  return {
    url: await urlDaDerivada(m.chave_thumb, m.chave, armazem, 3600),
    urlFilme: m.tipo === "video" ? await urlDoOriginal(m.chave, armazem, 3600) : undefined,
  };
}

/** Os endereços de um lote, só das mídias desta galeria e deste estúdio. */
export async function enderecosDasMiniaturas(
  galeriaId: string,
  tenantId: string,
  ids: string[],
): Promise<Record<string, EnderecoDaMiniatura>> {
  if (ids.length === 0) return {};
  const linhas = await consultar<{
    id: string;
    tipo: string;
    chave: string;
    chave_thumb: string | null;
    armazem: string | null;
  }>(
    `select id, tipo, chave, chave_thumb, armazem from medias
      where galeria_id = $1 and tenant_id = $2 and id = any($3::uuid[]) and pronto`,
    [galeriaId, tenantId, ids],
  );
  const pares = await Promise.all(linhas.map(async (l) => [l.id, await enderecoDaMiniatura(l)] as const));
  return Object.fromEntries(pares);
}
