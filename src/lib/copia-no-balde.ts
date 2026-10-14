import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  UploadPartCopyCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

/**
 * COPIAR UM OBJETO DENTRO DO MESMO BALDE — sem o arquivo passar por aqui.
 *
 * É o que deixa "copiar fotos para outra galeria" custar segundos em vez de
 * horas: quem copia é o armazém (CopyObject), não o VPS nem o navegador. Serve
 * aos dois fornecedores (R2 e B2 falam S3), por isso recebe o cliente e o balde
 * em vez de importar um deles.
 *
 * ── O LIMITE DE 5 GB ──────────────────────────────────────────────────────
 *
 * CopyObject copia até 5 GB de uma vez. Um filme 4K passa disso fácil, e aí a
 * cópia vira multipart (UploadPartCopy), parte a parte, também feita no
 * armazém. As partes são de 512 MB: com o teto de 10.000 partes, cobre 5 TB,
 * muito além dos 100 GB por arquivo que o produto aceita.
 *
 * Devolve `false` quando a ORIGEM não existe — quem chama decide se isso é erro
 * (o original) ou só uma derivada que nunca foi gerada. Qualquer outra falha
 * lança, e a cópia incompleta é abortada para não ficar parte paga sem arquivo.
 */

const LIMITE_DA_COPIA_SIMPLES = 5 * 1024 ** 3 - 1;
export const TAMANHO_DA_PARTE_NA_COPIA = 512 * 1024 ** 2;

const naoExiste = (e: unknown) => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return x?.name === "NoSuchKey" || x?.name === "NotFound" || x?.$metadata?.httpStatusCode === 404;
};

/** O `CopySource` vai como caminho de URL: cada pedaço codificado, as barras não. */
export function origemDaCopia(balde: string, chave: string): string {
  return `${balde}/${chave.split("/").map(encodeURIComponent).join("/")}`;
}

export async function copiarNoBalde(
  s3: S3Client,
  balde: string,
  de: string,
  para: string,
): Promise<boolean> {
  let tamanho: number;
  let tipo: string | undefined;
  try {
    const h = await s3.send(new HeadObjectCommand({ Bucket: balde, Key: de }));
    tamanho = Number(h.ContentLength ?? 0);
    tipo = h.ContentType;
  } catch (e) {
    if (naoExiste(e)) return false;
    throw e;
  }

  const origem = origemDaCopia(balde, de);
  if (tamanho <= LIMITE_DA_COPIA_SIMPLES) {
    try {
      await s3.send(new CopyObjectCommand({ Bucket: balde, Key: para, CopySource: origem }));
      return true;
    } catch (e) {
      if (naoExiste(e)) return false;
      throw e;
    }
  }

  const { UploadId } = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: balde, Key: para, ContentType: tipo }),
  );
  try {
    const partes: { ETag: string; PartNumber: number }[] = [];
    for (let inicio = 0, n = 1; inicio < tamanho; inicio += TAMANHO_DA_PARTE_NA_COPIA, n++) {
      const fim = Math.min(inicio + TAMANHO_DA_PARTE_NA_COPIA, tamanho) - 1;
      const r = await s3.send(
        new UploadPartCopyCommand({
          Bucket: balde,
          Key: para,
          UploadId,
          PartNumber: n,
          CopySource: origem,
          CopySourceRange: `bytes=${inicio}-${fim}`,
        }),
      );
      const etag = r.CopyPartResult?.ETag;
      if (!etag) throw new Error(`o armazém não devolveu o ETag da parte ${n}`);
      partes.push({ ETag: etag, PartNumber: n });
    }
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: balde,
        Key: para,
        UploadId,
        MultipartUpload: { Parts: partes },
      }),
    );
    return true;
  } catch (e) {
    await s3
      .send(new AbortMultipartUploadCommand({ Bucket: balde, Key: para, UploadId }))
      .catch(() => {});
    throw e;
  }
}
