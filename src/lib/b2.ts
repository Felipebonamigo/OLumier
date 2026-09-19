import "server-only";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { dispositionSegura } from "./r2";

/**
 * ARMAZÉM DOS ARQUIVOS PESADOS — o primário no Backblaze B2.
 *
 * Guarda o original de galeria grande (acima de 500 GB contratados) e de tudo
 * que foi para o cofre. Custa R$ 0,046/GB/mês contra R$ 0,1155 do R2, e a grade
 * de preços foi calculada com esse número: enquanto o arquivo pesado não morar
 * aqui, boa parte da tabela vende abaixo do custo (ver docs/obra-rota-b2.md).
 *
 * ── ESTE É O CAMINHO DE SERVIR, E ELE LANÇA ALTO ──────────────────────────
 * Falha aqui é o cliente do fotógrafo olhando para uma foto que não abre, e
 * engolir isso em silêncio transformaria um defeito em mistério.
 *
 * Existia ao lado um `lib/espelho.ts`, com a regra OPOSTA: nunca lançar, porque
 * cópia de segurança atrasada é melhor que upload barrado. Ele foi removido em
 * 27/08/2026 com o resto do espelho — ver `scripts/testar-sem-espelho.mjs`. A
 * consequência para quem mexer aqui: o `olumier-arquivos` guarda a ÚNICA cópia
 * dos originais, e não há mais de onde restaurar um objeto perdido.
 *
 * O bucket dos originais não pode ser o mesmo onde o rclone guarda os backups
 * cifrados do banco (`olumier-espelho`, que manteve o nome antigo). Juntos,
 * uma chave com permissão de apagar levaria os arquivos e o backup na mesma
 * tacada — o desastre que o backup existe para cobrir.
 *
 * ── POR QUE ARQUIVOS_* E NÃO B2_* ─────────────────────────────────────────
 * O ambiente já tinha `B2_KEY_ID`, `B2_APPLICATION_KEY` e `B2_BUCKET` sobrando
 * de um experimento antigo, sem ninguém lendo. Batizar as variáveis novas de
 * `B2_*` faria este módulo herdar aquele bucket em silêncio — e o sintoma seria
 * arquivo gravado no lugar errado, que só aparece muito depois.
 */

const endpoint = process.env.ARQUIVOS_ENDPOINT;
const accessKeyId = process.env.ARQUIVOS_ACCESS_KEY_ID;
const secretAccessKey = process.env.ARQUIVOS_SECRET_ACCESS_KEY;
/* A região vem embutida no endpoint do B2 (s3.<regiao>.backblazeb2.com). */
const regiao = process.env.ARQUIVOS_REGIAO ?? "us-east-005";

export const ARQUIVOS_BUCKET = process.env.ARQUIVOS_BUCKET ?? "";

/**
 * Irmãs das de `r2.ts`, e pelo mesmo motivo: `testar-cors-arquivos` e
 * `configurar-cors` montavam cada um o seu cliente, e uma cópia esquecida é
 * uma cópia que fala com o armazém errado.
 *
 * `forcePathStyle`: servidor local não tem DNS curinga, e sem ele o cliente
 * procura `olumier-arquivos.127.0.0.1`. Em produção a variável não existe e o
 * B2 segue no estilo virtual.
 */
export const OPCOES_DO_CLIENTE_ARQUIVOS = {
  region: regiao,
  endpoint,
  forcePathStyle: process.env.ARMAZEM_CAMINHO_NO_ENDERECO === "1",
};

/**
 * true quando dá para servir do B2.
 *
 * Enquanto for false o sistema roda igual: nada foi movido para cá ainda, e
 * `medias.armazem` continua dizendo 'r2' para todo mundo. É o que permite esta
 * fase entrar em produção sem mudar nada.
 */
export const arquivosConfigurado = Boolean(
  endpoint && accessKeyId && secretAccessKey && ARQUIVOS_BUCKET,
);

let cliente: S3Client | null = null;

function s3(): S3Client {
  if (!arquivosConfigurado) {
    throw new Error(
      "Armazém dos arquivos não configurado: preencha ARQUIVOS_ENDPOINT, " +
        "ARQUIVOS_ACCESS_KEY_ID, ARQUIVOS_SECRET_ACCESS_KEY e ARQUIVOS_BUCKET " +
        "(ver docs/obra-rota-b2.md → fase 1)",
    );
  }
  cliente ??= new S3Client({
    ...OPCOES_DO_CLIENTE_ARQUIVOS,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
  });
  return cliente;
}

/**
 * URL temporária de leitura — a mesma ideia do R2, no outro fornecedor.
 *
 * A chave é IDÊNTICA à do R2 de propósito: quem decide de onde ler é a coluna
 * `medias.armazem`, e não um segundo caminho guardado em algum lugar. Chave
 * derivada não se perde no dia do desastre; correspondência guardada à parte,
 * sim.
 *
 * Não é `async` porque `s3()` precisa estourar na hora, e não virar promessa
 * rejeitada que alguém esquece de esperar.
 */
export function urlDeLeituraArquivo(chave: string, expiraSeg = 3600, baixarComoNome?: string) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: ARQUIVOS_BUCKET,
      Key: chave,
      /* Reusa a montagem do r2.ts: duas formas de `filename`, sem quebra de
       * linha. Refazer aqui à mão faria a correção de cabeçalho injetado
       * regredir justamente no download que o casal abre. */
      ...(baixarComoNome ? { ResponseContentDisposition: dispositionSegura(baixarComoNome) } : {}),
    }),
    { expiresIn: expiraSeg },
  );
}

/**
 * URL para gravar direto no bucket.
 *
 * Hoje só o movedor noturno usa — o upload do fotógrafo continua nascendo no R2
 * e é movido depois. Bifurcar o caminho de upload por tamanho de plano seria
 * mexer na parte mais crítica do sistema para economizar uma cópia noturna.
 */
export function urlDeUploadArquivo(chave: string, mime: string, expiraSeg = 3600) {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: ARQUIVOS_BUCKET, Key: chave, ContentType: mime }),
    { expiresIn: expiraSeg },
  );
}

/** Confirma que o objeto chegou e devolve o tamanho real gravado. */
export async function conferirArquivo(chave: string) {
  const r = await s3().send(new HeadObjectCommand({ Bucket: ARQUIVOS_BUCKET, Key: chave }));
  return { bytes: Number(r.ContentLength ?? 0), mime: r.ContentType ?? "application/octet-stream" };
}

export async function apagarArquivo(chave: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: ARQUIVOS_BUCKET, Key: chave }));
}

/**
 * Apaga muitos originais de uma vez — o gêmeo de `apagarObjetos` do R2.
 *
 * Mesma razão de lá: `DeleteObjects` leva até 1000 chaves por chamada. Uma
 * galeria de 286 fotos são 286 requisições separadas contra uma — e a diferença
 * apareceu como "Não foi possível apagar agora" na tela da Ana Carolina, em
 * 18/09/2026.
 *
 * Não lança por objeto que já não existe: apagar o que já não está lá é o
 * resultado desejado.
 */
export async function apagarArquivos(chaves: string[]) {
  const unicas = [...new Set(chaves)].filter(Boolean);
  for (let i = 0; i < unicas.length; i += 1000) {
    const lote = unicas.slice(i, i + 1000);
    const r = await s3().send(
      new DeleteObjectsCommand({
        Bucket: ARQUIVOS_BUCKET,
        Delete: { Objects: lote.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    /* Com `Quiet: true` só voltam os que FALHARAM. Silêncio aqui esconderia
       arquivo pago ficando para trás. */
    if (r.Errors?.length) {
      throw new Error(
        `${r.Errors.length} arquivo(s) não foram apagados (ex.: ${r.Errors[0].Key} — ${r.Errors[0].Message})`,
      );
    }
  }
}

/** true se o objeto já está aqui — usado pelo movedor para não copiar duas vezes. */
export async function arquivoExiste(chave: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: ARQUIVOS_BUCKET, Key: chave }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lista o bucket inteiro, em páginas de 1000, com a data de gravação.
 *
 * Existe para a varredura de órfãos, e não para o caminho normal do app —
 * gêmea de `listarObjetos` em `r2.ts`, de propósito e com a mesma forma de
 * retorno, para o comparador tratar os dois armazéns sem saber qual é qual.
 *
 * Até 26/08/2026 ela não existia, e a consequência era invisível: o
 * `varrer-orfaos.mjs` listava só o R2, então arquivo pago sem dono no B2 não
 * aparecia em ferramenta nenhuma. O caçador de órfãos tinha o mesmo ponto cego
 * do `limpar-pendentes.mjs`, que procurava no R2 o arquivo de mídia do B2.
 *
 * A DATA não é enfeite, e a razão é a mesma do R2: entre o envio e a
 * confirmação no banco existe uma janela em que o objeto é, tecnicamente,
 * órfão. Sem a data, a varredura apagaria o arquivo de quem está enviando
 * NESTE momento — e aqui isso dói mais, porque o que mora no B2 é o original
 * grande, o vídeo de casamento que ninguém quer subir duas vezes.
 */
export async function listarArquivos(
  prefixo?: string,
): Promise<Array<{ chave: string; modificadoEm: Date | null }>> {
  const objetos: Array<{ chave: string; modificadoEm: Date | null }> = [];
  let cursor: string | undefined;
  do {
    const r = await s3().send(
      new ListObjectsV2Command({
        Bucket: ARQUIVOS_BUCKET,
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

/**
 * ── ENVIO EM PARTES ───────────────────────────────────────────────────────
 *
 * O caminho do vídeo 4K: acima de 5 GB o PUT único não serve, e o arquivo sobe
 * em pedaços com uma URL assinada por parte. É o arquivo que o fotógrafo menos
 * quer subir duas vezes, então este é o trecho onde uma falha custa mais caro.
 *
 * Espelho fiel do que o `r2.ts` faz — mesma sequência (abrir, assinar cada
 * parte, fechar na ordem), mesmos nomes, mesma validade de 6 horas. A cópia é
 * deliberada: um envio precisa acontecer inteiro no MESMO fornecedor, e uma
 * abstração comum sobre os dois convidaria a abrir num e fechar no outro, o
 * que deixa partes órfãs ocupando espaço e cobrando sem nunca virar arquivo.
 * `scripts/testar-armazem.mjs` prende as quatro operações no mesmo armazém.
 */
export async function abrirEnvioEmPartesArquivo(chave: string, mime: string): Promise<string> {
  const r = await s3().send(
    new CreateMultipartUploadCommand({ Bucket: ARQUIVOS_BUCKET, Key: chave, ContentType: mime }),
  );
  if (!r.UploadId) throw new Error("o armazenamento não devolveu o identificador do envio");
  return r.UploadId;
}

export function urlDaParteArquivo(
  chave: string,
  uploadId: string,
  numero: number,
  expiraSeg = 6 * 3600,
) {
  return getSignedUrl(
    s3(),
    new UploadPartCommand({
      Bucket: ARQUIVOS_BUCKET,
      Key: chave,
      UploadId: uploadId,
      PartNumber: numero,
    }),
    { expiresIn: expiraSeg },
  );
}

export async function fecharEnvioEmPartesArquivo(
  chave: string,
  uploadId: string,
  partes: { numero: number; etag: string }[],
) {
  await s3().send(
    new CompleteMultipartUploadCommand({
      Bucket: ARQUIVOS_BUCKET,
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

export async function abortarEnvioEmPartesArquivo(chave: string, uploadId: string) {
  await s3().send(
    new AbortMultipartUploadCommand({ Bucket: ARQUIVOS_BUCKET, Key: chave, UploadId: uploadId }),
  );
}

/**
 * O bucket responde e aceita nossa credencial?
 *
 * Mesmo raciocínio do `conferirAcesso` do R2: `arquivoExiste` engole qualquer
 * erro, então credencial revogada ficaria indistinguível de "arquivo não
 * existe". Aqui o 404 é o resultado ESPERADO — prova que a requisição chegou,
 * foi autenticada e o bucket respondeu.
 */
export async function conferirArmazemArquivos(): Promise<{ ok: boolean; erro?: string }> {
  if (!arquivosConfigurado) return { ok: false, erro: "ARQUIVOS_* não configurado" };
  try {
    await s3().send(new HeadObjectCommand({ Bucket: ARQUIVOS_BUCKET, Key: "_healthz/nao-existe" }));
    return { ok: true };
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = err.$metadata?.httpStatusCode;
    if (status === 404 || err.name === "NotFound" || err.name === "NoSuchKey") return { ok: true };
    return {
      ok: false,
      erro: err.name ? `${err.name} (${status ?? "sem status"})` : "falha no bucket",
    };
  }
}
