import "server-only";
import { randomUUID } from "node:crypto";
import { consultarUm } from "./db";

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
