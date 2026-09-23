import "server-only";
import { consultar, consultarUm } from "./db";
import {
  MAX_ROSTOS_POR_FOTO,
  PISO_ROSTO_PX,
  casar,
  vetorValido,
  type FotoEncontrada,
} from "@/config/rostos";

/**
 * Busca por rosto — o lado do banco.
 *
 * Tudo o que entra aqui é dado biométrico (LGPD art. 11). Duas regras não
 * negociáveis, e as duas moram nesta camada, não na tela:
 *
 *   1. Nada é gravado numa galeria com `rostos_ativos = false`. O
 *      consentimento do fotógrafo é a chave da porta.
 *   2. Desligar apaga tudo. Consentimento retirado não deixa resto.
 */

export interface RostoRecebido {
  caixa: { x: number; y: number; w: number; h: number };
  px: number;
  vetor: number[];
}

/** O que o navegador manda, já validado campo a campo. Recusa em vez de corrigir. */
export function lerRostos(bruto: unknown): { rostos: RostoRecebido[]; descartados: number } | null {
  if (!Array.isArray(bruto)) return null;
  const rostos: RostoRecebido[] = [];
  let descartados = 0;

  for (const item of bruto) {
    if (!item || typeof item !== "object") return null;
    const { caixa, px, vetor } = item as Record<string, unknown>;
    if (!vetorValido(vetor)) return null;
    if (typeof px !== "number" || !Number.isFinite(px) || px <= 0) return null;
    if (!caixa || typeof caixa !== "object") return null;
    const c = caixa as Record<string, unknown>;
    const fracao = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
    if (!fracao(c.x) || !fracao(c.y) || !fracao(c.w) || !fracao(c.h)) return null;

    /*
     * O piso é reaplicado AQUI, mesmo que o navegador já o tenha aplicado: o
     * navegador é do usuário, e um plugin pode mandar o que quiser. Vetor de
     * rosto pequeno não é só inútil — é o que casa estranhos.
     */
    if (px < PISO_ROSTO_PX) {
      descartados++;
      continue;
    }
    rostos.push({
      caixa: { x: c.x as number, y: c.y as number, w: c.w as number, h: c.h as number },
      px: Math.round(px),
      vetor,
    });
  }

  // Os maiores ficam: são os mais confiáveis, e o teto existe para foto de plenária.
  rostos.sort((a, b) => b.px - a.px);
  if (rostos.length > MAX_ROSTOS_POR_FOTO) {
    descartados += rostos.length - MAX_ROSTOS_POR_FOTO;
    rostos.length = MAX_ROSTOS_POR_FOTO;
  }

  return { rostos, descartados };
}

/**
 * Substitui os rostos de uma foto. Substitui, não acumula: reindexar a mesma
 * foto duas vezes não pode dobrar as linhas.
 *
 * Devolve null quando a galeria não aceita: foto de outro estúdio, ou busca
 * desligada. Os dois casos são "não" — quem chama decide a mensagem.
 */
export async function guardarRostos(
  mediaId: string,
  tenantId: string,
  rostos: RostoRecebido[],
): Promise<{ salvos: number } | null> {
  const dona = await consultarUm<{ galeria_id: string; rostos_ativos: boolean }>(
    `select m.galeria_id, g.rostos_ativos
       from medias m join galerias g on g.id = m.galeria_id
      where m.id = $1 and m.tenant_id = $2`,
    [mediaId, tenantId],
  );
  if (!dona || !dona.rostos_ativos) return null;

  await consultar("delete from rostos where media_id = $1", [mediaId]);
  if (rostos.length === 0) return { salvos: 0 };

  /*
   * Um INSERT só: trinta rostos numa foto seriam trinta idas ao banco por
   * foto, seiscentas fotos por casamento. Os rostos viajam como UM json e
   * viram linhas com `jsonb_array_elements`.
   *
   * Não é `unnest` de `real[][]` de propósito: o `unnest` de array
   * bidimensional achata TUDO em escalares — 30 rostos virariam 3.840 linhas
   * de um número cada, e o CHECK de 128 posições recusaria em silêncio.
   */
  await consultar(
    `insert into rostos (media_id, galeria_id, tenant_id, caixa, px, vetor)
     select $1, $2, $3,
            r->'caixa',
            (r->>'px')::int,
            (select array_agg(x::real) from jsonb_array_elements_text(r->'vetor') x)
       from jsonb_array_elements($4::jsonb) r`,
    [mediaId, dona.galeria_id, tenantId, JSON.stringify(rostos)],
  );
  return { salvos: rostos.length };
}

/**
 * A busca do convidado. Lê todos os rostos da galeria e compara em memória —
 * ver a migração 028 para a conta que justifica não usar índice vetorial.
 */
export async function procurarRostos(
  galeriaId: string,
  vetores: number[][],
): Promise<FotoEncontrada[]> {
  const rostos = await consultar<{ media_id: string; vetor: number[] }>(
    `select r.media_id, r.vetor
       from rostos r join medias m on m.id = r.media_id
      where r.galeria_id = $1 and m.pronto`,
    [galeriaId],
  );
  return casar(
    vetores,
    rostos.map((r) => ({ mediaId: r.media_id, vetor: r.vetor })),
  );
}

/** Quantos rostos a galeria tem no índice, e em quantas fotos. */
export async function resumoDeRostos(galeriaId: string) {
  const r = await consultarUm<{ rostos: number; fotos: number }>(
    `select count(*)::int as rostos, count(distinct media_id)::int as fotos
       from rostos where galeria_id = $1`,
    [galeriaId],
  );
  return r ?? { rostos: 0, fotos: 0 };
}

export async function contarRostos(galeriaId: string): Promise<number> {
  return (await resumoDeRostos(galeriaId)).rostos;
}

/**
 * Fotos da galeria que ainda não passaram pela medição — é o que o botão
 * "medir as fotos já enviadas" percorre. Só foto (vídeo não tem rosto a medir)
 * e só as prontas.
 */
export async function fotosSemRosto(galeriaId: string, tenantId: string) {
  return consultar<{ id: string; chave: string; chave_preview: string | null; armazem: string }>(
    `select m.id, m.chave, m.chave_preview, m.armazem
       from medias m
      where m.galeria_id = $1 and m.tenant_id = $2 and m.pronto and m.tipo = 'foto'
        and not exists (select 1 from rostos r where r.media_id = m.id)
      order by m.ordem, m.criado_em`,
    [galeriaId, tenantId],
  );
}

/**
 * Liga a busca. O `rostos_ligados_em` é a prova do consentimento: quando o
 * fotógrafo leu o texto e aceitou. Não é atualizado se já estava ligada.
 */
export async function ligarRostos(galeriaId: string, tenantId: string): Promise<boolean> {
  const r = await consultar(
    `update galerias
        set rostos_ativos = true,
            rostos_ligados_em = coalesce(rostos_ligados_em, now()),
            atualizado_em = now()
      where id = $1 and tenant_id = $2
      returning id`,
    [galeriaId, tenantId],
  );
  return r.length > 0;
}

/**
 * Desliga E apaga. As duas coisas juntas, na mesma função, de propósito: não
 * existe estado "desligada mas com os vetores guardados" — seria guardar dado
 * biométrico sem base.
 */
export async function desligarRostos(galeriaId: string, tenantId: string): Promise<number> {
  const apagados = await apagarRostosDaGaleria(galeriaId, tenantId);
  await consultar(
    `update galerias
        set rostos_ativos = false, rostos_ligados_em = null, atualizado_em = now()
      where id = $1 and tenant_id = $2`,
    [galeriaId, tenantId],
  );
  return apagados;
}

export async function apagarRostosDaGaleria(galeriaId: string, tenantId: string): Promise<number> {
  const r = await consultar(
    "delete from rostos where galeria_id = $1 and tenant_id = $2 returning id",
    [galeriaId, tenantId],
  );
  return r.length;
}
