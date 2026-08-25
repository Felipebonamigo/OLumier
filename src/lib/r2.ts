import { randomUUID } from "node:crypto";
import {
  S3Client,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
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
  /*
   * A extensão entra na CHAVE do objeto, e o nome do arquivo vem do navegador —
   * ou seja, é texto escolhido por quem envia. Sem limpar, um nome como
   * `foto.jpg?x=/../../outro` levaria caracteres de caminho e de query para
   * dentro da chave; no mínimo geraria objeto com nome esquisito, e no pior
   * confundiria quem depois interpreta esse caminho.
   *
   * Só letras e números, no máximo 10 caracteres: nenhuma extensão real de foto
   * ou vídeo passa disso, e o que não couber vira "bin" — que funciona, porque
   * o tipo de verdade é o `Content-Type`, não o sufixo.
   */
  const bruta = nomeArquivo.includes(".") ? nomeArquivo.split(".").pop()!.toLowerCase() : "";
  const ext = /^[a-z0-9]{1,10}$/.test(bruta) ? bruta : "bin";
  const base = `${tenantId}/${galeriaId}/${randomUUID()}`;
  return {
    original: `${base}.${ext}`,
    thumb: `${base}_thumb.webp`,
    preview: `${base}_prev.webp`,
  };
}

/**
 * Caminho da logo do estúdio.
 *
 * Fica em `<tenant>/marca/`, fora de qualquer galeria: a logo é do estúdio e
 * sobrevive a galeria apagada. O uuid no nome existe para a troca de logo não
 * cair em cache do navegador com a imagem antiga — chave nova, link novo.
 *
 * ATENÇÃO: este objeto NÃO tem linha em `medias`. Quem varre o bucket
 * procurando arquivo órfão precisa saber disso, senão apaga a logo de todo
 * mundo — ver scripts/varrer-orfaos.mjs.
 */
export function chaveDaLogo(tenantId: string, extensao: string) {
  const ext = /^[a-z0-9]{1,10}$/.test(extensao) ? extensao : "bin";
  return `${tenantId}/marca/${randomUUID()}.${ext}`;
}

/** true quando a chave é de marca (logo), não de mídia de galeria. */
export function ehChaveDeMarca(chave: string) {
  return /^[^/]+\/marca\//.test(chave);
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
 * Monta o `Content-Disposition` do download sem deixar o nome do arquivo virar
 * cabeçalho injetado.
 *
 * O nome vem do navegador de quem enviou. Tirar só as aspas não bastava: quebra
 * de linha no meio do nome permitiria emendar OUTRO cabeçalho na resposta, e
 * acento simplesmente não é válido num header — "Ana & Pedro — Cerimônia.jpg"
 * chegaria corrompido ou faria a requisição falhar.
 *
 * Por isso duas formas, como o padrão prevê: `filename` só com ASCII seguro,
 * para navegador antigo, e `filename*` em UTF-8, que os atuais preferem — e que
 * preserva o acento e o nome real que o casal espera ver.
 */
export function dispositionSegura(nome: string): string {
  const limpo = nome.replace(/[\r\n"\\]/g, "").slice(0, 200) || "arquivo";
  const soAscii = limpo.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${soAscii}"; filename*=UTF-8''${encodeURIComponent(limpo)}`;
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
        ? { ResponseContentDisposition: dispositionSegura(baixarComoNome) }
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

/**
 * Apaga muitos objetos de uma vez (galeria inteira).
 *
 * Usa DeleteObjects, que aceita até 1000 chaves por chamada: uma galeria de 600
 * fotos com derivadas passa de 1800 objetos, e 1800 requisições separadas
 * levariam minutos e custariam à toa.
 *
 * Não lança por objeto que já não existe — apagar o que já não está lá é
 * exatamente o resultado desejado.
 */
export async function apagarObjetos(chaves: string[]) {
  const unicas = [...new Set(chaves)].filter(Boolean);
  for (let i = 0; i < unicas.length; i += 1000) {
    const lote = unicas.slice(i, i + 1000);
    const r = await s3().send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: lote.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    // Com Quiet: true só voltam os que FALHARAM. Silêncio aqui esconderia
    // arquivo pago ficando para trás.
    if (r.Errors?.length) {
      throw new Error(
        `${r.Errors.length} objeto(s) não foram apagados (ex.: ${r.Errors[0].Key} — ${r.Errors[0].Message})`,
      );
    }
  }
}

/**
 * Lista todas as chaves do bucket (páginas de 1000, seguindo o cursor).
 *
 * Existe para a varredura de órfãos: comparar o que está no bucket com o que o
 * banco conhece é a única forma de achar arquivo pago que ninguém mais
 * referencia. Não é usado no caminho normal do app.
 */
export async function listarChaves(prefixo?: string): Promise<string[]> {
  return (await listarObjetos(prefixo)).map((o) => o.chave);
}

/**
 * Como `listarChaves`, mas devolve também QUANDO cada objeto foi gravado.
 *
 * A data não é enfeite: a varredura de órfãos precisa poupar o arquivo que
 * acabou de subir. Entre o PUT no bucket e a confirmação no banco existe uma
 * janela em que o objeto é, tecnicamente, órfão — e apagar aí significa apagar
 * a foto de quem está enviando NESTE momento.
 */
export async function listarObjetos(
  prefixo?: string,
): Promise<Array<{ chave: string; modificadoEm: Date | null }>> {
  const objetos: Array<{ chave: string; modificadoEm: Date | null }> = [];
  let cursor: string | undefined;
  do {
    const r = await s3().send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefixo,
        ContinuationToken: cursor,
      }),
    );
    for (const o of r.Contents ?? []) {
      if (o.Key) objetos.push({ chave: o.Key, modificadoEm: o.LastModified ?? null });
    }
    cursor = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (cursor);
  return objetos;
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

/**
 * O bucket responde e aceita nossa credencial?
 *
 * NÃO dá para usar `objetoExiste` para isso: ela engole qualquer erro e devolve
 * false, então credencial revogada ficaria indistinguível de "arquivo não
 * existe" — e a checagem de saúde diria que está tudo bem com o armazenamento
 * inteiro fora do ar.
 *
 * Aqui um 404 é justamente o resultado ESPERADO: prova que a requisição chegou,
 * foi autenticada e o bucket respondeu. Qualquer outro erro é problema de
 * verdade.
 */
export async function conferirAcesso(): Promise<{ ok: boolean; erro?: string }> {
  if (!armazenamentoConfigurado) return { ok: false, erro: "credenciais ausentes" };
  try {
    await s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: "_healthz/nao-existe" }));
    return { ok: true }; // improvável, mas seria uma resposta boa também
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = err.$metadata?.httpStatusCode;
    if (status === 404 || err.name === "NotFound") return { ok: true };
    return { ok: false, erro: err.name ? `${err.name} (${status ?? "sem status"})` : "falha no bucket" };
  }
}

// --- envio em partes (multipart) --------------------------------------------

/**
 * Arquivo acima de 5 GB não cabe num PUT único — o protocolo S3 exige quebrar
 * em partes. É o que destrava filme de casamento em 4K, que passa fácil disso.
 *
 * O fluxo tem três etapas: abrir o envio, mandar cada parte com sua própria URL
 * assinada, e fechar informando a lista de partes na ordem. Se o processo for
 * interrompido no meio, as partes ficam ocupando espaço até serem abortadas —
 * por isso existe `abortarEnvioEmPartes`, e o bucket tem regra que limpa
 * envios inacabados depois de 7 dias.
 */

export async function abrirEnvioEmPartes(chave: string, mime: string): Promise<string> {
  const r = await s3().send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: chave, ContentType: mime }),
  );
  if (!r.UploadId) throw new Error("o armazenamento não devolveu o identificador do envio");
  return r.UploadId;
}

export function urlDaParte(chave: string, uploadId: string, numero: number, expiraSeg = 6 * 3600) {
  return getSignedUrl(
    s3(),
    new UploadPartCommand({ Bucket: BUCKET, Key: chave, UploadId: uploadId, PartNumber: numero }),
    { expiresIn: expiraSeg },
  );
}

export async function fecharEnvioEmPartes(
  chave: string,
  uploadId: string,
  partes: { numero: number; etag: string }[],
) {
  await s3().send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: chave,
      UploadId: uploadId,
      MultipartUpload: {
        // A ordem importa: o S3 remonta o arquivo pela sequência dos números.
        Parts: partes
          .slice()
          .sort((a, b) => a.numero - b.numero)
          .map((p) => ({ PartNumber: p.numero, ETag: p.etag })),
      },
    }),
  );
}

export async function abortarEnvioEmPartes(chave: string, uploadId: string) {
  await s3().send(
    new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: chave, UploadId: uploadId }),
  );
}
