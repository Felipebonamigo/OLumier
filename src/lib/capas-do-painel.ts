import "server-only";
import { consultar } from "./db";
import { armazemDe, urlDaDerivada } from "./armazem";
import { urlDeLeitura } from "./r2";

/**
 * A CAPA DE CADA GALERIA, PARA A LISTA DO PAINEL (30/09/2026).
 *
 * Felipe, com a foto do painel cheio de cartões parecidos: "está se
 * confundindo para visualizar as galerias". Uma das formas de ver pedidas é
 * "miniaturas com a capa" — e a capa é o que o fotógrafo reconhece de relance,
 * muito antes do nome do casal.
 *
 * A capa segue a MESMA ordem da galeria do cliente: a capa enviada como
 * arquivo (`capa_chave`, migração 029), senão a foto marcada como capa
 * (`capa_media_id`), senão a primeira foto. A mídia é escolhida inteira, não
 * coluna a coluna — ver o comentário igual em `e/[estudio]/page.tsx`.
 *
 * Uma consulta para a tela toda (24 galerias), e a assinatura das URLs é conta
 * local, sem ida ao armazém. Por isso as capas vêm sempre, e trocar a forma de
 * ver na tela não precisa voltar ao servidor.
 */
export interface CapaDoPainel {
  url: string;
  /** Onde cortar, em % — o mesmo foco que a capa do cliente usa. */
  focoX: number;
  focoY: number;
}

export async function capasDoPainel(tenantId: string, ids: string[]): Promise<Map<string, CapaDoPainel>> {
  const capas = new Map<string, CapaDoPainel>();
  if (ids.length === 0) return capas;
  const linhas = await consultar<{
    id: string;
    capa_chave: string | null;
    thumb: string | null;
    original: string | null;
    armazem: string | null;
    capa_foco_x: number | null;
    capa_foco_y: number | null;
  }>(
    `select g.id, g.capa_chave, g.capa_foco_x, g.capa_foco_y,
            case when cm.chave is not null then cm.chave_thumb else pm.chave_thumb end as thumb,
            case when cm.chave is not null then cm.chave       else pm.chave       end as original,
            case when cm.chave is not null then cm.armazem     else pm.armazem     end as armazem
       from galerias g
       left join medias cm on cm.id = g.capa_media_id and cm.pronto
       left join lateral (
         select chave, chave_thumb, armazem from medias
          where galeria_id = g.id and pronto and tipo = 'foto'
          order by ordem limit 1
       ) pm on true
      where g.tenant_id = $1 and g.id = any($2::uuid[])`,
    [tenantId, ids],
  );
  await Promise.all(
    linhas.map(async (l) => {
      const url = l.capa_chave
        ? await urlDeLeitura(l.capa_chave, 6 * 3600)
        : l.original
          ? await urlDaDerivada(l.thumb, l.original, armazemDe(l.armazem), 6 * 3600)
          : null;
      if (url) capas.set(l.id, { url, focoX: l.capa_foco_x ?? 50, focoY: l.capa_foco_y ?? 50 });
    }),
  );
  return capas;
}
