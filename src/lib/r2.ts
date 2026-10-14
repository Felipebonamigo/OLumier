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
import { getSignedUrl, S3RequestPresigner } from "@aws-sdk/s3-request-presigner";
import { dispositionSegura } from "./disposition";
import { inicioDaJanela } from "./janela-de-assinatura";
import { copiarNoBalde } from "./copia-no-balde";
import { PutObjectCommand } from "@aws-sdk/client-s3";

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

/*
 * ── APONTAR O ARMAZÉM PARA OUTRO LUGAR (16/09/2026) ───────────────────────
 *
 * O comentário lá em cima promete que trocar de fornecedor "não muda nada aqui
 * além das variáveis de ambiente". Não era verdade: o endereço era montado a
 * partir da conta do R2 e não havia como apontar para outro lugar.
 *
 * Quem cobrou a promessa foi o CI. A suíte publica galeria, assina upload e
 * confere que o objeto saiu do bucket — um dublê provaria que o dublê funciona,
 * então o portão precisa de um armazém DE VERDADE. Com credencial de produção
 * no runner, qualquer workflow do repositório passaria a alcançar as fotos dos
 * clientes; com esta variável, ele sobe um MinIO ao lado e fala com ele.
 *
 * Em produção `R2_ENDPOINT` não existe, e tudo continua exatamente como estava.
 *
 * `forcePathStyle` acompanha porque servidor local não tem DNS curinga: sem
 * ele o cliente procura `galerias.127.0.0.1` e não acha ninguém. Fica atrás de
 * uma chave própria em vez de ligar sozinho junto com o endereço, para um
 * fornecedor futuro poder usar endereço próprio e continuar no estilo virtual.
 *
 * As duas variáveis são lidas em `OPCOES_DO_CLIENTE`, logo abaixo.
 */

export const BUCKET = process.env.R2_BUCKET ?? "galerias";

/**
 * O endereço do armazém, e as opções do cliente S3 — exportados porque havia
 * CINCO cópias desta mesma conta espalhadas pelos scripts.
 *
 * `testar-r2`, `testar-limpeza`, `testar-cors` e `configurar-cors` montavam
 * cada um o seu `new S3Client({ endpoint: `https://${conta}.r2...` })`. Quando
 * o CI apontou o armazém para outro lugar, o app obedeceu e os scripts não:
 * eles abriram TLS contra um servidor HTTP e devolveram
 * `ssl3_read_bytes:ssl/tls alert handshake failure`, que não diz nada sobre
 * endereço nenhum.
 *
 * Uma cópia só, e quem falar com o armazém por fora do app usa esta.
 */
export const ENDERECO_DO_ARMAZEM =
  process.env.R2_ENDPOINT ?? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

export const OPCOES_DO_CLIENTE = {
  region: process.env.R2_ENDPOINT ? (process.env.R2_REGIAO ?? "us-east-1") : "auto",
  endpoint: ENDERECO_DO_ARMAZEM,
  forcePathStyle: process.env.ARMAZEM_CAMINHO_NO_ENDERECO === "1",
};

/** true quando as credenciais estão configuradas — telas mostram aviso amigável se não.
 *
 *  `R2_ENDPOINT` conta como conta configurada, e não é detalhe: quando o armazém
 *  é imposto por endereço — o MinIO do CI —, NÃO existe `R2_ACCOUNT_ID`, porque
 *  não há conta da Cloudflare envolvida. Exigindo só `conta`, o `healthz`
 *  reprovaria por falta de armazém e o corredor pularia as 32 suítes de HTTP,
 *  inclusive as treze que passam por rota de arquivo. Metade do portão viraria
 *  enfeite, em silêncio — que é o pior jeito de um CI falhar. */
export const armazenamentoConfigurado = Boolean(
  (conta || process.env.R2_ENDPOINT) && accessKeyId && secretAccessKey,
);

let cliente: S3Client | null = null;

function s3(): S3Client {
  if (!armazenamentoConfigurado) {
    throw new Error(
      "Armazenamento não configurado: preencha R2_ACCOUNT_ID, R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY em .env.local",
    );
  }
  cliente ??= new S3Client({
    ...OPCOES_DO_CLIENTE,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
  });
  return cliente;
}

/**
 * Caminhos dos objetos: separados por tenant para o isolamento ser visível no
 * bucket. Original e derivadas compartilham o mesmo uuid — dá para achar a
 * família de um arquivo olhando o prefixo.
 */
export function montarChaves(
  tenantId: string,
  galeriaId: string,
  nomeArquivo: string,
  formatoDerivadas: FormatoDerivada = "webp",
) {
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
  const d = FORMATOS_DERIVADA[formatoDerivadas];
  return {
    original: `${base}.${ext}`,
    thumb: `${base}_thumb.${d.ext}`,
    preview: `${base}_prev.${d.ext}`,
  };
}

/**
 * O formato das derivadas deixou de ser WEBP cravado (26/08/2026).
 *
 * Enquanto só o navegador enviasse, WEBP fixo servia: é o que o `canvas` gera.
 * Mas o Lightroom Classic exporta JPEG, JPEG XL, AVIF, PNG, TIFF, PSD e DNG — e
 * NÃO exporta WEBP. Um cliente que mandasse AVIF gravaria bytes AVIF numa chave
 * `.webp` assinada como `image/webp`, e a galeria do casal serviria o
 * Content-Type errado.
 *
 * A extensão entra na CHAVE e o mime entra na ASSINATURA, então os dois têm de
 * sair da mesma tabela — separá-los é como as duas dessincronizam.
 */
export const FORMATOS_DERIVADA = {
  webp: { ext: "webp", mime: "image/webp" },
  avif: { ext: "avif", mime: "image/avif" },
  jpeg: { ext: "jpg", mime: "image/jpeg" },
} as const;

export type FormatoDerivada = keyof typeof FORMATOS_DERIVADA;

export function formatoDerivadaValido(v: unknown): v is FormatoDerivada {
  return typeof v === "string" && v in FORMATOS_DERIVADA;
}

/**
 * O mime de uma derivada a partir da CHAVE já gravada.
 *
 * Na republicação o formato não é escolhido de novo: ele foi decidido quando a
 * mídia nasceu e está na extensão da chave. Perguntar ao cliente outra vez
 * deixaria ele assinar `.webp` como AVIF.
 */
export function mimeDaDerivada(chave: string): string {
  const ext = chave.split(".").pop()?.toLowerCase() ?? "";
  for (const f of Object.values(FORMATOS_DERIVADA)) {
    if (f.ext === ext) return f.mime;
  }
  return FORMATOS_DERIVADA.webp.mime;
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

/*
 * `dispositionSegura` mora em `lib/disposition.ts` desde 23/09/2026: o servidor
 * de ZIP, que é Node puro fora do Next, precisa do mesmo cabeçalho e não pode
 * importar este módulo (SDK do S3, `server-only`). Reexportada aqui para os
 * chamadores de sempre.
 */
export { dispositionSegura };

/**
 * URL temporária de leitura. Galeria privada nunca expõe o objeto direto:
 * o link é assinado, curto e só vale para quem já passou pela senha.
 *
 * Assinada no começo de uma janela, e não agora: dentro dela o endereço não
 * muda, e o navegador reaproveita a miniatura que já baixou. A validade nunca
 * passa de `expiraSeg`. Ver `lib/janela-de-assinatura.ts`.
 */
export function urlDeLeitura(chave: string, expiraSeg = 3600, baixarComoNome?: string) {
  return urlDeLeituraAssinadaEm(inicioDaJanela(expiraSeg), chave, expiraSeg, baixarComoNome);
}

/*
 * ── ASSINAR SEM ATRAVESSAR O SDK INTEIRO A CADA FOTO (26/09/2026) ─────────
 *
 * "A galeria parece lenta para abrir." Metade do tempo do servidor numa
 * galeria de 600 fotos era ESTA função: 600 chamadas a `getSignedUrl` levavam
 * ~200 ms de CPU, contra ~150 ms de todo o resto da página.
 *
 * `getSignedUrl` refaz, a cada foto, o que é igual para todas: resolve o
 * endereço pelas regras de endpoint do S3, clona a pilha de middlewares,
 * serializa o comando e cria um assinador novo — que por ser novo recalcula a
 * chave de assinatura do dia (quatro HMACs) em vez de guardá-la. A conta que
 * de fato muda por foto é um HMAC.
 *
 * Aqui o assinador é o MESMO do SDK (`S3RequestPresigner`, a classe que o
 * próprio `getSignedUrl` usa por dentro), criado uma vez só; o que se monta à
 * mão é o pedido que ele assina — endereço, caminho e parâmetros —, que é
 * fixo para um GET. A criptografia não é nossa.
 *
 * ── A PROVA DE QUE NADA MUDOU ─────────────────────────────────────────────
 *
 * `scripts/testar-assinatura-de-leitura.mjs` assina as mesmas chaves pelos dois
 * caminhos, no mesmo instante, e exige a URL IDÊNTICA, byte a byte — nos dois
 * jeitos de endereço (o do R2 em produção e o do MinIO do CI) e com o nome de
 * download. Se uma atualização do SDK mudar o formato, é ali que aparece, e
 * não numa galeria sem miniatura.
 *
 * A data de assinatura continua sendo a do pedido: a republicação sobrescreve
 * a miniatura na MESMA chave e conta com a URL nova a cada visita para o
 * navegador não servir a versão antiga (ver `api/medias/[id]/arquivo`).
 */
const ENDERECO = new URL(ENDERECO_DO_ARMAZEM);

let assinador: S3RequestPresigner | null = null;

function assinadorDeLeitura(): S3RequestPresigner {
  /* O que `getSignedUrl` passa ao montar o dele: a configuração do cliente,
     com o nome do serviço e a região fixados. A região aqui é a mesma que as
     regras de endpoint devolvem para este endereço ("auto" no R2). */
  assinador ??= new S3RequestPresigner({
    ...s3().config,
    signingName: "s3",
    region: async () => OPCOES_DO_CLIENTE.region,
  });
  return assinador;
}

/** A codificação de URI do S3: a de `encodeURIComponent`, mais `!'()*`. */
function escaparParaUri(texto: string): string {
  return encodeURIComponent(texto).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * `urlDeLeitura` com a data de assinatura escolhida por quem chama.
 *
 * Existe para o teste comparar com o `getSignedUrl` no mesmo instante; o app
 * chama `urlDeLeitura`, que assina com a data de agora.
 */
export async function urlDeLeituraAssinadaEm(
  quando: Date,
  chave: string,
  expiraSeg = 3600,
  baixarComoNome?: string,
): Promise<string> {
  const presigner = assinadorDeLeitura();

  /*
   * O endereço que as regras de endpoint do SDK montam para este bucket: o
   * nome do bucket no HOST (`galerias.<conta>.r2.cloudflarestorage.com/chave`)
   * ou, com `forcePathStyle`, no CAMINHO (`127.0.0.1:9000/galerias/chave`).
   */
  const noCaminho = OPCOES_DO_CLIENTE.forcePathStyle;
  const hostname = noCaminho ? ENDERECO.hostname : `${BUCKET}.${ENDERECO.hostname}`;
  const porta = ENDERECO.port ? Number(ENDERECO.port) : undefined;
  const chaveNoCaminho = chave.split("/").map(escaparParaUri).join("/");
  const path = noCaminho ? `/${BUCKET}/${chaveNoCaminho}` : `/${chaveNoCaminho}`;

  /*
   * Os parâmetros que o `GetObjectCommand` põe na URL. `x-id` é a marca do
   * comando e `x-amz-checksum-mode` é o pedido de checksum que o SDK faz por
   * padrão em todo GetObject; nenhum dos dois muda o que o armazém devolve,
   * e estão aqui para a URL ser a mesma de antes, e não "uma equivalente".
   */
  const query: Record<string, string> = { "x-id": "GetObject" };
  if (baixarComoNome) query["response-content-disposition"] = dispositionSegura(baixarComoNome);

  const assinado = await presigner.presign(
    {
      method: "GET",
      protocol: ENDERECO.protocol,
      hostname,
      port: porta,
      path,
      query,
      headers: { "x-amz-checksum-mode": "ENABLED" },
    },
    { expiresIn: expiraSeg, signingDate: quando },
  );

  /* Montada como o SDK monta (`formatUrl`): parâmetros em ordem alfabética,
     cada nome e valor escapado. Todos os valores aqui são texto — os nossos e
     os `X-Amz-*` que o assinador acrescenta. */
  const parametros = assinado.query ?? {};
  const busca = Object.keys(parametros)
    .sort()
    .map((nome) => `${escaparParaUri(nome)}=${escaparParaUri(String(parametros[nome]))}`)
    .join("&");
  return `${ENDERECO.protocol}//${hostname}${porta ? `:${porta}` : ""}${path}?${busca}`;
}

/** Confirma que o upload chegou e devolve o tamanho real — nunca confie no tamanho que o cliente informou. */
export async function conferirObjeto(chave: string) {
  const r = await s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: chave }));
  return { bytes: Number(r.ContentLength ?? 0), mime: r.ContentType ?? "application/octet-stream" };
}

/** Copia um objeto para outra chave do mesmo balde, dentro do armazém. `false`: a origem não existe. */
export function copiarObjeto(de: string, para: string): Promise<boolean> {
  return copiarNoBalde(s3(), BUCKET, de, para);
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

/**
 * A CHAVE DA MINIATURA, DEDUZIDA DA CHAVE DO ORIGINAL.
 *
 * `montarChaves` cria as três juntas no momento do envio, e é ela quem manda.
 * Esta existe para o caso em que a miniatura nasce DEPOIS: a capa de um vídeo
 * escolhida à mão na aba Vídeo, meses depois de o filme ter subido.
 *
 * ── POR QUE DEDUZIR, E NÃO DEIXAR O NAVEGADOR MANDAR A CHAVE ─────────────
 *
 * Porque uma chave vinda do cliente é texto escolhido por quem envia, e teria
 * de ser validada contra o estúdio e a galeria — é o que `chaveDaGaleria` faz
 * na capa da galeria, e é uma conferência a mais para esquecer. Deduzindo do
 * ORIGINAL, que já está na linha da mídia, não há nada a forjar: o servidor
 * calcula, o navegador só recebe a URL assinada.
 *
 * O formato é sempre `webp` porque quem gera é o `canvas` do navegador. Se um
 * dia a miniatura puder chegar em AVIF ou JPEG, esta função passa a receber o
 * formato, como `montarChaves` já recebe — e as duas continuam lendo de
 * `FORMATOS_DERIVADA`, que é o que impede a extensão e o mime de divergirem.
 */
export function chaveDerivadaDoOriginal(chaveOriginal: string, sufixo = "_thumb"): string {
  const semExtensao = chaveOriginal.replace(/\.[a-z0-9]{1,10}$/i, "");
  return `${semExtensao}${sufixo}.${FORMATOS_DERIVADA.webp.ext}`;
}

/**
 * Onde mora a VERSÃO LEVE de um vídeo — a cópia H.264 que o cliente assiste
 * (`lib/versao-leve.ts`, migração 065).
 *
 * Mesma regra da capa: deduzida do original, nunca recebida do navegador. A
 * extensão e o tipo são fixos porque quem gera é sempre o conversor do painel,
 * e ele só escreve MP4.
 */
export const MIME_DA_VERSAO_LEVE = "video/mp4";
export function chaveDaVersaoLeve(chaveOriginal: string): string {
  const semExtensao = chaveOriginal.replace(/\.[a-z0-9]{1,10}$/i, "");
  return `${semExtensao}_leve.mp4`;
}
