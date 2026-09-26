import "server-only";
import { consultar, consultarUm } from "./db";
import { marca } from "@/config/marca";
import type { Site } from "./site-estudio";

/**
 * O QUE A VITRINE DO ESTÚDIO LÊ DO BANCO — num lugar só.
 *
 * Até 26/09/2026 as duas consultas moravam dentro de `app/e/[estudio]/page.tsx`.
 * Saíram daqui para fora porque a vitrine passou a ter TRÊS leitores: a página,
 * o cartão de link (`opengraph-image.tsx` ao lado dela) e o `sitemap.xml` do
 * subdomínio. O cartão é o que mais importa manter junto: ele mostra a foto do
 * topo, e a regra de QUAIS galerias podem aparecer (publicada, no ar, sem senha,
 * no prazo) é a regra que protege a entrega de um casal. Duas cópias dela
 * divergiriam, e a cópia esquecida seria a do cartão — que é público e fica
 * guardado nos servidores do WhatsApp.
 */

export async function buscarEstudio(slug: string) {
  return consultarUm<{
    id: string;
    slug: string;
    nome_estudio: string;
    cor_destaque: string;
    logo_chave: string | null;
    site: unknown;
    dominio_proprio: string | null;
    dominio_verificado_em: Date | null;
  }>(
    `select id, slug, nome_estudio, cor_destaque, logo_chave, site,
            dominio_proprio, dominio_verificado_em
       from tenants where slug = $1`,
    [slug],
  );
}

export type GaleriaDaVitrine = {
  slug: string;
  titulo: string;
  subtitulo: string | null;
  data_evento: Date | null;
  capa_thumb: string | null;
  capa_preview: string | null;
  capa_original: string | null;
  capa_armazem: string | null;
};

/**
 * As galerias que a vitrine pode mostrar: PÚBLICAS e sem senha.
 *
 * Galeria protegida não aparece: listá-la entregaria a existência da entrega de
 * um casal para qualquer visitante, e a senha existe justamente para isso não
 * acontecer.
 */
export async function galeriasDaVitrine(tenantId: string) {
  return consultar<GaleriaDaVitrine>(
    /*
     * A capa vem em VÁRIAS colunas, não num `coalesce` só.
     *
     * Antes era `coalesce(cm.chave_thumb, cm.chave, pm.chave_thumb, pm.chave)`,
     * que devolve a chave e esconde QUAL das quatro venceu. Desde que o original
     * pode morar no B2 (obra da rota B2), essa informação passou a importar: se
     * o vencedor foi uma miniatura, lê-se do R2; se foi o original, lê-se de
     * onde ele estiver. Com a chave já achatada não dá para saber, e a capa
     * abriria quebrada exatamente nas galerias sem miniatura.
     *
     * A escolha é da MÍDIA inteira, não coluna a coluna: `cm` (a capa que o
     * fotógrafo marcou) se ela existir, senão `pm` (a primeira foto). Um
     * `coalesce` por coluna pegaria a miniatura de uma foto com o original de
     * outra no caso em que a capa marcada não tem miniatura — as colunas têm de
     * vir sempre da mesma linha.
     *
     * `chave_preview` entrou junto com a vitrine: a mesma foto que vira cartão
     * de 300px na grade vira fundo de tela cheia na capa, e a miniatura esticada
     * a 1600px fica visivelmente mole.
     */
    `select g.slug, g.titulo, g.subtitulo, g.data_evento,
            case when cm.chave is not null then cm.chave_thumb   else pm.chave_thumb   end as capa_thumb,
            case when cm.chave is not null then cm.chave_preview else pm.chave_preview end as capa_preview,
            case when cm.chave is not null then cm.chave         else pm.chave         end as capa_original,
            case when cm.chave is not null then cm.armazem       else pm.armazem       end as capa_armazem
       from galerias g
       left join medias cm on cm.id = g.capa_media_id and cm.pronto
       left join lateral (
         select chave, chave_thumb, chave_preview, armazem from medias
          where galeria_id = g.id and pronto and tipo = 'foto'
          order by ordem limit 1
       ) pm on true
      where g.tenant_id = $1
        and g.publicada
        and g.estado = 'online'
        and g.senha_hash is null
        and (g.expira_em is null or g.expira_em > now())
      order by coalesce(g.data_evento, g.criado_em::date) desc
      limit 60`,
    [tenantId],
  );
}

/**
 * A galeria cuja capa vira a foto do topo.
 *
 * A foto do topo sai de uma galeria já publicada, escolhida no painel — não de
 * um upload à parte. É o degrau mais barato que resolve: sem campo novo, sem
 * arquivo novo, sem mais um objeto pago no bucket, e sem a foto da capa
 * envelhecendo parada enquanto o trabalho do fotógrafo avança. Trocar a capa do
 * site é trocar a capa de uma galeria, que ele já sabe fazer.
 */
export function galeriaDoTopo(galerias: GaleriaDaVitrine[], site: Site) {
  return (
    galerias.find((g) => g.slug === site.capaGaleria && g.capa_original) ??
    galerias.find((g) => g.capa_original) ??
    null
  );
}

/**
 * O endereço CANÔNICO da vitrine — o único que o buscador deve indexar.
 *
 * A mesma vitrine abre por até quatro endereços: o domínio próprio, o
 * subdomínio no domínio canônico, o subdomínio no domínio antigo (que fica de
 * pé por causa de link entregue — ver `config/dominios.ts`) e a rota interna
 * `/e/<estudio>` no domínio principal. Sem o canônico, o Google trata as quatro
 * como páginas concorrentes e divide entre elas a relevância que é do estúdio.
 *
 * O domínio próprio vence quando a posse está PROVADA — a mesma régua do proxy
 * e do porteiro do certificado. Domínio pedido e não verificado não responde, e
 * apontar o canônico para ele mandaria o buscador para um endereço que não abre.
 */
export function enderecoDaVitrine(t: {
  slug: string;
  dominio_proprio: string | null;
  dominio_verificado_em: Date | null;
}): string {
  if (t.dominio_proprio && t.dominio_verificado_em) return `https://${t.dominio_proprio}`;
  return `https://${t.slug}.${marca.dominio}`;
}
