import "server-only";
import { consultar, consultarUm } from "./db";

export interface Media {
  id: string;
  galeria_id: string;
  tenant_id: string;
  chave: string;
  chave_thumb: string | null;
  chave_preview: string | null;
  nome_original: string;
  tipo: "foto" | "video";
  mime: string;
  bytes: string;
  largura: number | null;
  altura: number | null;
  ordem: number;
  pronto: boolean;
  criado_em: Date;
}

/** O que aceitamos subir. Fora desta lista, recusamos antes de gerar a URL. */
export const TIPOS_ACEITOS: Record<string, "foto" | "video"> = {
  "image/jpeg": "foto",
  "image/png": "foto",
  "image/webp": "foto",
  "image/avif": "foto",
  "image/heic": "foto",
  "image/heif": "foto",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
};

/**
 * Limite por arquivo. O R2 aceita até 5 GiB num único PUT; acima disso exige
 * envio em partes (multipart), que ainda não implementamos. Filme de casamento
 * costuma passar disso — é o primeiro item a evoluir aqui.
 */
export const LIMITE_POR_ARQUIVO = 5 * 1024 ** 3;

export async function listarMedias(galeriaId: string) {
  return consultar<Media>(
    "select * from medias where galeria_id = $1 and pronto order by ordem, criado_em",
    [galeriaId],
  );
}

/**
 * Espaço já comprometido pelo tenant: conta também o que está subindo agora
 * (pronto = false). Sem isso, vários envios em paralelo furariam a quota juntos.
 */
export async function bytesComprometidos(tenantId: string): Promise<bigint> {
  const r = await consultarUm<{ total: string }>(
    "select coalesce(sum(bytes),0)::text as total from medias where tenant_id = $1",
    [tenantId],
  );
  return BigInt(r?.total ?? "0");
}

export async function criarMediaPendente(dados: {
  galeriaId: string;
  tenantId: string;
  chave: string;
  chaveThumb?: string | null;
  chavePreview?: string | null;
  nomeOriginal: string;
  tipo: "foto" | "video";
  mime: string;
  bytes: number;
  largura?: number | null;
  altura?: number | null;
}) {
  const proxima = await consultarUm<{ n: number }>(
    "select coalesce(max(ordem), -1) + 1 as n from medias where galeria_id = $1",
    [dados.galeriaId],
  );

  return consultarUm<Media>(
    `insert into medias (galeria_id, tenant_id, chave, chave_thumb, chave_preview,
                         nome_original, tipo, mime, bytes, largura, altura, ordem, pronto)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false)
     returning *`,
    [
      dados.galeriaId,
      dados.tenantId,
      dados.chave,
      dados.chaveThumb ?? null,
      dados.chavePreview ?? null,
      dados.nomeOriginal,
      dados.tipo,
      dados.mime,
      dados.bytes,
      dados.largura ?? null,
      dados.altura ?? null,
      proxima?.n ?? 0,
    ],
  );
}

/** Anula as chaves de derivadas que não chegaram ao bucket — a grade cai no original. */
export async function anularDerivadas(mediaId: string, quais: { thumb?: boolean; preview?: boolean }) {
  const partes: string[] = [];
  if (quais.thumb) partes.push("chave_thumb = null");
  if (quais.preview) partes.push("chave_preview = null");
  if (partes.length === 0) return;
  await consultarUm(`update medias set ${partes.join(", ")} where id = $1`, [mediaId]);
}

/** Marca como pronta usando o tamanho REAL vindo do bucket — nunca o que o navegador declarou. */
export async function confirmarMedia(mediaId: string, tenantId: string, bytesReais: number) {
  return consultarUm<Media>(
    `update medias set bytes = $1, pronto = true
      where id = $2 and tenant_id = $3
      returning *`,
    [bytesReais, mediaId, tenantId],
  );
}

export async function buscarMedia(mediaId: string, tenantId: string) {
  return consultarUm<Media>("select * from medias where id = $1 and tenant_id = $2", [
    mediaId,
    tenantId,
  ]);
}

export async function apagarMedia(mediaId: string, tenantId: string) {
  return consultarUm<Media>("delete from medias where id = $1 and tenant_id = $2 returning *", [
    mediaId,
    tenantId,
  ]);
}
