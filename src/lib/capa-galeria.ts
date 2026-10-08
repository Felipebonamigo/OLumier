import "server-only";
import { randomUUID } from "node:crypto";
import { consultar, consultarUm } from "./db";

/**
 * A capa enviada como arquivo próprio — ver a migração 029 para o porquê de ser
 * uma coluna e não uma linha em `medias`.
 *
 * Mesmo desenho da logo do estúdio: o arquivo vai direto do navegador para o
 * bucket com URL assinada, o banco guarda só a chave, e o link é assinado na
 * hora de desenhar a página.
 */

/** O que aceitamos como capa. SVG fica de fora pelo mesmo motivo da logo: é código. */
export const TIPOS_CAPA: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Teto de 8 MB — quatro vezes o da logo, e por uma razão.
 *
 * A logo é marca: 2 MB é generoso. A capa é FOTOGRAFIA, ocupa a tela inteira e
 * costuma sair da exportação do Lightroom em alta. Recusar a 2 MB mandaria o
 * fotógrafo reexportar a imagem mais importante da entrega.
 */
export const LIMITE_CAPA = 8 * 1024 * 1024;

/** Dentro da pasta da galeria, e numa subpasta própria: a limpeza distingue. */
export function chaveDaCapa(tenantId: string, galeriaId: string, extensao: string) {
  const ext = /^[a-z0-9]{1,10}$/.test(extensao) ? extensao : "bin";
  return `${tenantId}/${galeriaId}/capa/${randomUUID()}.${ext}`;
}

/**
 * A chave pertence à capa DESTA galeria deste estúdio?
 *
 * A chave chega do navegador na hora de confirmar. Sem esta conferência, um
 * pedido forjado apontaria a capa de uma galeria para um objeto de outra conta
 * — ou para qualquer chave do bucket, inclusive a foto de um cliente alheio.
 */
export function chaveDaGaleria(chave: string, tenantId: string, galeriaId: string) {
  return chave.startsWith(`${tenantId}/${galeriaId}/capa/`);
}

export function recusaDaCapa(mime: string, bytes: number): string | null {
  if (!TIPOS_CAPA[mime]) return "A capa precisa ser PNG, JPG ou WEBP.";
  if (!Number.isFinite(bytes) || bytes <= 0) return "Arquivo vazio ou inválido.";
  if (bytes > LIMITE_CAPA) return "A capa passa de 8 MB. Exporte um pouco menor.";
  return null;
}

/** A galeria, se for deste estúdio. O `tenant_id` no where É a autorização. */
export function galeriaParaCapa(galeriaId: string, tenantId: string) {
  return consultarUm<{ id: string; capa_chave: string | null }>(
    "select id, capa_chave from galerias where id = $1 and tenant_id = $2",
    [galeriaId, tenantId],
  );
}

/** Grava a capa nova e devolve a chave ANTERIOR, para quem chama poder apagá-la. */
export async function trocarCapaPropria(
  galeriaId: string,
  tenantId: string,
  chave: string | null,
): Promise<string | null> {
  /* Lê antes de trocar: depois do update não há mais como saber qual objeto
     ficou sem dono, e objeto sem dono é arquivo pago que ninguém acha. */
  const antes = await galeriaParaCapa(galeriaId, tenantId);
  if (!antes) return null;
  await consultarUm(
    "update galerias set capa_chave = $1, atualizado_em = now() where id = $2 and tenant_id = $3",
    [chave, galeriaId, tenantId],
  );
  return antes.capa_chave && antes.capa_chave !== chave ? antes.capa_chave : null;
}

/**
 * O PONTO FOCAL: onde a capa deve ser cortada.
 *
 * Juan, 08/09/2026: "queria que aparecesse mais o corpo do noivo, mas o
 * enquadramento foi automático". O automático é o `object-cover`, que corta
 * pelo centro — e o assunto da foto quase nunca está no meio.
 *
 * Dois inteiros de 0 a 100, conferidos aqui E no banco (migração 031). Não é
 * zelo repetido: o valor vira `object-position: X% Y%` dentro de um `style` na
 * galeria do CLIENTE, e a única defesa que não depende de ninguém lembrar é a
 * que está nos dois lugares. Fora da faixa, o CSS aceita e empurra a imagem
 * para fora da caixa — a capa fica vazia e ninguém sabe por quê.
 */
export const FOCO_CENTRAL = { x: 50, y: 50 } as const;

const pontoValido = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;

export async function definirFocoDaCapa(
  galeriaId: string,
  tenantId: string,
  x: unknown,
  y: unknown,
): Promise<boolean> {
  if (!pontoValido(x) || !pontoValido(y)) return false;
  const linhas = await consultar(
    `update galerias set capa_foco_x = $1, capa_foco_y = $2, atualizado_em = now()
      where id = $3 and tenant_id = $4 returning id`,
    [x, y, galeriaId, tenantId],
  );
  return linhas.length > 0;
}

/**
 * Devolve o foco ao centro.
 *
 * Chamado sempre que a FOTO da capa muda — enviada, removida, ou trocada por
 * outra da galeria. Um foco calibrado para a foto A não quer dizer nada na foto
 * B, e herdá-lo entrega um enquadramento torto que ninguém escolheu, sem pista
 * de onde veio.
 */
export async function centralizarFocoDaCapa(galeriaId: string, tenantId: string) {
  await consultar(
    `update galerias set capa_foco_x = $1, capa_foco_y = $2 where id = $3 and tenant_id = $4`,
    [FOCO_CENTRAL.x, FOCO_CENTRAL.y, galeriaId, tenantId],
  );
}

/**
 * Escolhe uma foto DA GALERIA como capa, e centraliza o enquadramento.
 *
 * A checagem de que a mídia é desta galeria está no próprio `update`, e não
 * numa consulta antes: entre conferir e gravar cabe a foto mudar de galeria, e
 * o banco não deixa essa fresta. Devolve `false` quando não achou — quem chama
 * traduz em 404.
 */
export async function definirCapaPorMedia(
  galeriaId: string,
  tenantId: string,
  mediaId: string,
): Promise<boolean> {
  if (!mediaId) return false;
  const linhas = await consultar(
    `update galerias g
        set capa_media_id = $1,
            capa_foco_x = ${FOCO_CENTRAL.x},
            capa_foco_y = ${FOCO_CENTRAL.y},
            atualizado_em = now()
      where g.id = $2 and g.tenant_id = $3
        and exists (
          /*
           * FOTO, ou FILME COM PÔSTER (02/10/2026).
           *
           * Juan pediu capa de vídeo; Felipe cortou para "só a capa principal".
           * O "chave_thumb is not null" não é detalhe: vídeo sem pôster não tem
           * imagem nenhuma, e deixá-lo passar faria a capa apontar para o .mp4.
           * Ver lib/capa-publica.ts, que desenha a mesma regra do outro lado.
           */
          select 1 from medias m
           where m.id = $1 and m.galeria_id = g.id
             and (m.tipo = 'foto' or (m.tipo = 'video' and m.chave_thumb is not null))
        )
      returning g.id`,
    [mediaId, galeriaId, tenantId],
  );
  return linhas.length > 0;
}

/* ── A CAPA EM VÍDEO (migração 066) ────────────────────────────────────────
 *
 * Um clipe curto e mudo, mais o primeiro quadro em imagem, que fica no lugar
 * enquanto o clipe carrega (e para quem pediu menos movimento). Duas colunas de
 * chave em `galerias`, no mesmo molde da `capa_chave`. As medidas e as recusas
 * moram em `clipe-da-capa-regras.ts`, que o navegador também lê. */

/** Dentro de `capa/`, como a capa: `chaveDaGaleria` já a reconhece, e a limpeza distingue. */
export function chavesDoClipe(tenantId: string, galeriaId: string) {
  const id = randomUUID();
  return {
    clipe: `${tenantId}/${galeriaId}/capa/clipe-${id}.mp4`,
    poster: `${tenantId}/${galeriaId}/capa/clipe-${id}-quadro.jpg`,
  };
}

/** A galeria, se for deste estúdio — com o clipe que ela tem hoje. */
export function galeriaParaClipe(galeriaId: string, tenantId: string) {
  return consultarUm<{ id: string; capa_video_chave: string | null; capa_video_poster_chave: string | null }>(
    "select id, capa_video_chave, capa_video_poster_chave from galerias where id = $1 and tenant_id = $2",
    [galeriaId, tenantId],
  );
}

/**
 * Grava (ou tira, com `null`) o clipe da capa e devolve as chaves ANTERIORES,
 * para quem chama apagá-las do bucket.
 *
 * Lê e troca num comando só: `for update` segura a linha entre ler o que havia
 * e gravar o novo, e dois envios seguidos não deixam um arquivo sem dono.
 */
export async function trocarClipeDaCapa(
  galeriaId: string,
  tenantId: string,
  novo: { clipe: string; poster: string } | null,
): Promise<string[] | null> {
  const linhas = await consultar<{ clipe_antigo: string | null; poster_antigo: string | null }>(
    `with antes as (
       select id, capa_video_chave, capa_video_poster_chave
         from galerias where id = $3 and tenant_id = $4 for update
     )
     update galerias g
        set capa_video_chave = $1, capa_video_poster_chave = $2, atualizado_em = now()
       from antes
      where g.id = antes.id
      returning antes.capa_video_chave as clipe_antigo, antes.capa_video_poster_chave as poster_antigo`,
    [novo?.clipe ?? null, novo?.poster ?? null, galeriaId, tenantId],
  );
  if (linhas.length === 0) return null;
  const { clipe_antigo, poster_antigo } = linhas[0];
  return [clipe_antigo, poster_antigo].filter(
    (c): c is string => Boolean(c) && c !== novo?.clipe && c !== novo?.poster,
  );
}
