import { randomUUID } from "node:crypto";
import { S3Client, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

/**
 * Camada de armazenamento — falada em API S3 de propósito.
 *
 * Hoje aponta para o Cloudflare R2 (download ilimitado grátis). Quando o volume
 * agregado passar de ~1 TB, a mesma interface passa a apontar para Backblaze B2
 * atrás da Cloudflare: custo cai ~60% e nada aqui muda além das variáveis de
 * ambiente. É por isso que nenhum nome de fornecedor vaza para o resto do app.
 */

const conta = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

export const BUCKET = process.env.R2_BUCKET ?? "galerias";

/** true quando as credenciais estão configuradas — telas mostram aviso amigável se não. */
export const armazenamentoConfigurado = Boolean(conta && accessKeyId && secretAccessKey);

let cliente: S3Client | null = null;

function s3(): S3Client {
  if (!armazenamentoConfigurado) {
    throw new Error(
      "Armazenamento não configurado: preencha R2_ACCOUNT_ID, R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY em .env.local",
    );
  }
  cliente ??= new S3Client({
    region: "auto",
    endpoint: `https://${conta}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
  });
  return cliente;
}

/**
 * Caminhos dos objetos: separados por tenant para o isolamento ser visível no
 * bucket. Original e derivadas compartilham o mesmo uuid — dá para achar a
 * família de um arquivo olhando o prefixo.
 */
export function montarChaves(tenantId: string, galeriaId: string, nomeArquivo: string) {
  const ext = nomeArquivo.includes(".") ? nomeArquivo.split(".").pop()!.toLowerCase() : "bin";
  const base = `${tenantId}/${galeriaId}/${randomUUID()}`;
  return {
    original: `${base}.${ext}`,
    thumb: `${base}_thumb.webp`,
    preview: `${base}_prev.webp`,
  };
}

/**
 * URL para o navegador enviar o arquivo DIRETO ao bucket.
 * O arquivo nunca passa pelo nosso servidor — é o que permite receber um filme
 * de 30 GB sem o VPS ser gargalo nem pagar banda.
 */
export function urlDeUpload(chave: string, mime: string, expiraSeg = 3600) {
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: BUCKET, Key: chave, ContentType: mime }), {
    expiresIn: expiraSeg,
  });
}

/**
 * URL temporária de leitura. Galeria privada nunca expõe o objeto direto:
 * o link é assinado, curto e só vale para quem já passou pela senha.
 */
export function urlDeLeitura(chave: string, expiraSeg = 3600, baixarComoNome?: string) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: chave,
      ...(baixarComoNome
        ? { ResponseContentDisposition: `attachment; filename="${baixarComoNome.replace(/"/g, "")}"` }
        : {}),
    }),
    { expiresIn: expiraSeg },
  );
}

/** Confirma que o upload chegou e devolve o tamanho real — nunca confie no tamanho que o cliente informou. */
export async function conferirObjeto(chave: string) {
  const r = await s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: chave }));
  return { bytes: Number(r.ContentLength ?? 0), mime: r.ContentType ?? "application/octet-stream" };
}

export async function apagarObjeto(chave: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: chave }));
}

/** true se o objeto existe no bucket. */
export async function objetoExiste(chave: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: chave }));
    return true;
  } catch {
    return false;
  }
}
