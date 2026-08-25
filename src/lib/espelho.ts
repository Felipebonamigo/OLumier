import "server-only";
import { Readable } from "node:stream";
import { S3Client, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { BUCKET, urlDeLeitura } from "./r2";

/**
 * ESPELHO — a segunda cópia dos arquivos, num fornecedor diferente.
 *
 * O banco tinha backup desde sempre; os arquivos não. Foto e vídeo viviam só no
 * R2: uma cópia, um fornecedor, uma conta. Disco não é o risco — a Cloudflare
 * declara durabilidade de onze noves. O risco é a CONTA: suspensão, cartão
 * recusado, chave vazada com permissão de apagar, engano humano. Qualquer um
 * leva as entregas de TODOS os clientes de uma vez, e o backup do banco
 * restaurado passa a apontar para arquivos que não existem mais.
 *
 * Por isso o espelho fica em outro fornecedor (Backblaze B2), com credencial
 * PRÓPRIA. Espelho na mesma conta protegeria contra apagar sem querer e contra
 * mais nada — que é justamente o cenário menos provável dos quatro.
 *
 * ── O QUE ESTE MÓDULO NÃO É ───────────────────────────────────────────────
 * Não é o "cofre" (`lib/cofre.ts`), que tira a galeria do ar depois do prazo e
 * é recurso vendido ao fotógrafo. O espelho é invisível, cobre 100% do acervo
 * desde o primeiro upload, e existe para o dia em que tudo der errado.
 *
 * ── FALHA AQUI NUNCA DERRUBA NADA ─────────────────────────────────────────
 * Todas as funções devolvem `{ok:false, erro}` em vez de lançar. Espelhar é
 * cópia de segurança: se o B2 estiver fora, o upload do fotógrafo tem de
 * continuar funcionando e o arquivo fica na fila para a próxima passada. Uma
 * entrega barrada hoje por causa de um backup é um problema pior que o backup
 * atrasado.
 */

const endpoint = process.env.ESPELHO_ENDPOINT;
const accessKeyId = process.env.ESPELHO_ACCESS_KEY_ID;
const secretAccessKey = process.env.ESPELHO_SECRET_ACCESS_KEY;
const regiao = process.env.ESPELHO_REGIAO ?? "us-east-005";

export const ESPELHO_BUCKET = process.env.ESPELHO_BUCKET ?? "";

/** true quando dá para espelhar. Sem isso o sistema roda igual, só sem segunda cópia. */
export const espelhoConfigurado = Boolean(
  endpoint && accessKeyId && secretAccessKey && ESPELHO_BUCKET,
);

let cliente: S3Client | null = null;

function s3(): S3Client {
  if (!espelhoConfigurado) {
    throw new Error(
      "Espelho não configurado: preencha ESPELHO_ENDPOINT, ESPELHO_ACCESS_KEY_ID, " +
        "ESPELHO_SECRET_ACCESS_KEY e ESPELHO_BUCKET",
    );
  }
  cliente ??= new S3Client({
    region: regiao,
    endpoint,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
  });
  return cliente;
}

/**
 * Quais objetos entram no espelho.
 *
 * Só o ORIGINAL. Miniatura e preview são geradas no navegador durante o upload
 * e, se sumirem, a galeria cai para o original sozinha — as colunas
 * `chave_thumb`/`chave_preview` são anuláveis exatamente por isso. Espelhar o
 * que se recupera sozinho seria pagar duas vezes pela mesma coisa.
 */
export function DEVE_ESPELHAR(chave: string): boolean {
  return !chave.includes(".thumb.") && !chave.includes(".preview.");
}

/**
 * Onde o objeto mora no espelho.
 *
 * Derivada da chave de origem, nunca sorteada: no dia de restaurar, o banco tem
 * em mãos só a chave original. Uma correspondência que dependa de índice à parte
 * é uma correspondência que pode se perder justamente no desastre que o espelho
 * existe para cobrir.
 */
export function chaveDoEspelho(chaveOrigem: string): string {
  return `espelho/${chaveOrigem}`;
}

async function corpoParaBuffer(corpo: unknown): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const p of corpo as AsyncIterable<Uint8Array>) partes.push(Buffer.from(p));
  return Buffer.concat(partes);
}

export interface ResultadoEspelho {
  ok: boolean;
  erro?: string;
  bytes?: number;
  /** Baixa de volta o que foi gravado — usado pelos testes para conferir byte a byte. */
  conferirConteudo: () => Promise<Buffer>;
}

/**
 * Copia um objeto do armazenamento principal para o espelho.
 *
 * A cópia passa pelo servidor (o B2 não sabe puxar do R2 sozinho), mas em
 * STREAM: um vídeo de 30 GB não pode virar 30 GB de memória. O `Upload` do SDK
 * quebra em partes sozinho, que é o mesmo caminho que os vídeos grandes já usam
 * na subida.
 *
 * Sai do R2 pela URL assinada em vez do cliente S3 porque o egress do R2 é
 * grátis por essa porta e o código de leitura já está provado ali.
 */
export async function espelharObjeto(chaveOrigem: string): Promise<ResultadoEspelho> {
  const conferirConteudo = async () => baixarDoEspelho(chaveOrigem);

  if (!espelhoConfigurado) {
    return { ok: false, erro: "espelho não configurado", conferirConteudo };
  }

  try {
    const url = await urlDeLeitura(chaveOrigem, 3600);
    const resposta = await fetch(url);
    if (!resposta.ok || !resposta.body) {
      return {
        ok: false,
        erro: `origem não pôde ser lida: HTTP ${resposta.status}`,
        conferirConteudo,
      };
    }

    const envio = new Upload({
      client: s3(),
      params: {
        Bucket: ESPELHO_BUCKET,
        Key: chaveDoEspelho(chaveOrigem),
        /* `fetch` devolve stream do padrão web; o SDK só aceita stream do Node.
         * `fromWeb` faz a ponte sem materializar o arquivo em memória — que é o
         * ponto inteiro de usar stream num vídeo de dezenas de gigabytes. */
        Body: Readable.fromWeb(resposta.body as Parameters<typeof Readable.fromWeb>[0]),
        ContentType: resposta.headers.get("content-type") ?? "application/octet-stream",
      },
      queueSize: 2, // a banda do VPS é o gargalo; mais paralelismo só enfileira
      partSize: 16 * 1024 * 1024,
    });
    await envio.done();

    const tamanho = Number(resposta.headers.get("content-length") ?? 0);
    return { ok: true, bytes: tamanho, conferirConteudo };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e), conferirConteudo };
  }
}

/** O objeto já está no espelho? Usado para não pagar a mesma cópia duas vezes. */
export async function objetoEspelhadoExiste(chaveOrigem: string): Promise<boolean> {
  if (!espelhoConfigurado) return false;
  try {
    await s3().send(
      new HeadObjectCommand({ Bucket: ESPELHO_BUCKET, Key: chaveDoEspelho(chaveOrigem) }),
    );
    return true;
  } catch {
    return false;
  }
}

async function baixarDoEspelho(chaveOrigem: string): Promise<Buffer> {
  const r = await s3().send(
    new GetObjectCommand({ Bucket: ESPELHO_BUCKET, Key: chaveDoEspelho(chaveOrigem) }),
  );
  return corpoParaBuffer(r.Body);
}

/**
 * Tira um objeto do espelho.
 *
 * Só a limpeza de teste e a varredura de órfãos chamam isto. O caminho normal
 * NÃO apaga do espelho quando o fotógrafo apaga uma foto — apagar dos dois
 * lugares ao mesmo tempo transforma um clique errado em perda definitiva, que é
 * exatamente o que o espelho deveria impedir.
 */
export async function apagarDoEspelho(chaveOrigem: string): Promise<void> {
  if (!espelhoConfigurado) return;
  await s3().send(
    new DeleteObjectCommand({ Bucket: ESPELHO_BUCKET, Key: chaveDoEspelho(chaveOrigem) }),
  );
}

/** Diz se as credenciais do espelho funcionam — usado pelo teste e pela saúde. */
export async function conferirEspelho(): Promise<{ ok: boolean; erro?: string }> {
  if (!espelhoConfigurado) return { ok: false, erro: "espelho não configurado" };
  try {
    /* HEAD numa chave que não existe: prova credencial e bucket sem gravar nada.
     * "não encontrado" é resposta de sucesso aqui; o que interessa é não tomar
     * 403 nem erro de rede. */
    await s3().send(new HeadObjectCommand({ Bucket: ESPELHO_BUCKET, Key: "espelho/.sonda" }));
    return { ok: true };
  } catch (e) {
    const nome = e instanceof Error ? e.name : "";
    if (nome === "NotFound" || nome === "NoSuchKey") return { ok: true };
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/** O bucket de origem, reexportado para os scripts não precisarem dos dois módulos. */
export { BUCKET as BUCKET_ORIGEM };
