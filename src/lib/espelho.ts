import "server-only";
import { Readable } from "node:stream";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
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
 * A fila do espelho: todo ORIGINAL que ainda está com uma cópia só.
 *
 * Mora aqui, e não solta dentro do `espelhar.mjs`, porque a pergunta que esta
 * consulta responde é a promessa da página /seguranca em forma de SQL — "o que
 * ainda não está em duas empresas?". Deixá-la no script fez com que ela ficasse
 * incompleta por dois meses sem ninguém notar.
 *
 * ── POR QUE A LOGO ENTRA AQUI ─────────────────────────────────────────────
 * Até 25/08/2026 a varredura lia só a tabela `medias`. A logo do estúdio é
 * arquivo que o fotógrafo ENVIOU — não é derivada, não se regenera de nada — e
 * mora em `tenants.logo_chave`. Ficava com cópia única, e era a única perda
 * DEFINITIVA de arquivo de cliente no desenho inteiro: sumindo o R2, só pedindo
 * o arquivo de novo, para cada estúdio.
 *
 * Passou despercebido porque "cada arquivo em duas empresas" é fácil de escrever
 * e ninguém tinha conferido o "cada". `scripts/testar-espelho.mjs` agora prende
 * esta consulta — voltar a olhar só para `medias` deixa a suíte vermelha.
 *
 * A logo não tem coluna de controle própria (não existe `logo_espelhada_em`): a
 * cópia é idempotente e o script pula o que já está lá conferindo o destino, que
 * é barato para UM objeto por estúdio. Uma coluna a mais seria mais migração e
 * mais estado para manter sincronizado, sem ganho nenhum nessa escala.
 */
export const ORIGINAIS_SEM_COPIA = `
  select id, chave, bytes::text as bytes, 'media' as origem
    from medias
   where pronto and espelhado_em is null and armazem = 'r2'
  union all
  select null as id, logo_chave as chave, null as bytes, 'logo' as origem
    from tenants
   where logo_chave is not null
  order by origem, chave
`;

/**
 * Quantos ORIGINAIS estão hoje com uma cópia só.
 *
 * Existe por causa de uma decisão consciente, tomada em 25/08/2026: o primário
 * saiu do R2 e foi para o B2 para baixar o custo, e o segundo fornecedor
 * (Hetzner) ficou para depois. Nesse arranjo o espelho não tem para onde
 * copiar — arquivo que nasce no B2 não pode ser "espelhado" no próprio B2 — e
 * a promessa de duas empresas fica suspensa até a Hetzner entrar.
 *
 * A decisão é legítima e é do dono do negócio. O que o código não pode fazer é
 * deixá-la INVISÍVEL: cópia única não dói no dia em que se escolhe, dói meses
 * depois, quando ninguém lembra que escolheu. Este contador é o que mantém o
 * número na cara de quem opera — e é o que vai a zero no dia em que o espelho
 * frio existir.
 */
export async function contarCopiaUnica(): Promise<{ arquivos: number; bytes: bigint }> {
  const { consultarUm } = await import("./db");
  const r = await consultarUm<{ arquivos: string; bytes: string }>(
    `select count(*)::text as arquivos, coalesce(sum(bytes), 0)::text as bytes
       from medias
      where pronto and armazem = 'b2' and espelho_frio_em is null`,
  );
  return { arquivos: Number(r?.arquivos ?? 0), bytes: BigInt(r?.bytes ?? "0") };
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

export interface OpcoesPurga {
  /** Limita a um estúdio. Sem isto, varre o espelho inteiro. */
  tenantId?: string;
  /** Limita a uma galeria. Só faz sentido com `exclusaoSolicitada`. */
  galeriaId?: string;
  /**
   * Pedido de exclusão da LGPD: alcança TAMBÉM o que ainda tem linha no banco.
   *
   * Separado e explícito de propósito. A varredura normal só remove o que já
   * não existe mais — este modo remove o que existe, a pedido do titular, e é
   * a única operação do sistema capaz de destruir a segunda cópia de um arquivo
   * vivo. Padrão nenhum deveria fazer isso sozinho.
   */
  exclusaoSolicitada?: boolean;
  /** Sem isto, só relata. */
  aplicar?: boolean;
}

export interface ResultadoPurga {
  /** Chaves no espelho que não têm mais linha correspondente no banco. */
  orfas: string[];
  apagadas: number;
  erros: string[];
}

/**
 * Limpa o espelho.
 *
 * Resolve dois problemas que o espelho cria ao guardar cópia de tudo: a cópia
 * de uma galeria já destruída continua sendo paga todo mês, e um pedido de
 * exclusão da LGPD não é atendido de verdade enquanto ela existir.
 *
 * ── A REGRA QUE NÃO PODE CAIR ─────────────────────────────────────────────
 * Só é órfã a chave que NÃO tem linha em `medias`. Apagar do espelho a cópia de
 * um arquivo que ainda existe destrói exatamente a proteção que justifica o
 * espelho — e destrói em silêncio, porque o arquivo principal continua no lugar
 * e a ausência só aparece no dia do desastre. A comparação é contra TODAS as
 * linhas, inclusive as com `pronto = false`: arquivo no meio do upload tem
 * linha e não tem objeto ainda, e tratá-lo como órfão seria apagar o que está
 * chegando.
 */
/**
 * Fração do espelho que uma varredura automática pode apagar numa passada.
 *
 * Acima disto ela recusa e pede olho humano. Não é palpite de tamanho: é a
 * diferença entre "faxina" e "acidente". Órfã aparece quando alguém apaga uma
 * foto e o objeto fica para trás — é um punhado por noite, nunca um terço do
 * acervo.
 */
export const LIMITE_PURGA = 0.25;

/** Abaixo disto não há amostra que sustente a proporção; a trava não se aplica. */
const MINIMO_PARA_PROPORCAO = 20;

/**
 * A trava de volume — o `--max-delete` desta casa.
 *
 * A purga decide o que é órfão comparando o bucket contra a tabela `medias`.
 * Toda a segurança dela depende dessa comparação estar certa, e ela pode estar
 * errada de um jeito silencioso: banco restaurado pela metade, migração no meio
 * do caminho, consulta que devolveu vazio. Nesses casos TODO o espelho vira
 * órfão, e a varredura automática das 05:20 apaga a segunda cópia de todos os
 * clientes numa noite — sem erro nenhum aparecer, porque do ponto de vista do
 * código está tudo funcionando.
 *
 * A trava não tenta descobrir se a comparação está certa. Ela só se recusa a
 * executar um apagamento grande demais para ser plausível, e devolve a decisão
 * para uma pessoa. Custa uma noite de faxina adiada; evita perder o espelho.
 */
export function purgaExcedeLimite(alvos: number, totalNoEspelho: number): boolean {
  if (totalNoEspelho < MINIMO_PARA_PROPORCAO) return false;
  return alvos / totalNoEspelho > LIMITE_PURGA;
}

export async function purgarEspelho(opcoes: OpcoesPurga = {}): Promise<ResultadoPurga> {
  const { consultar } = await import("./db");
  const vazio: ResultadoPurga = { orfas: [], apagadas: 0, erros: [] };
  if (!espelhoConfigurado) return { ...vazio, erros: ["espelho não configurado"] };

  /*
   * O prefixo do espelho é `espelho/<chave original>`, e a chave original
   * começa pelo id do estúdio — então filtrar por estúdio é um prefixo, não uma
   * varredura do bucket inteiro. É o que torna a operação viável quando houver
   * muitos estúdios.
   */
  const prefixo = opcoes.tenantId
    ? `espelho/${opcoes.tenantId}/${opcoes.galeriaId ? `${opcoes.galeriaId}/` : ""}`
    : "espelho/";

  const noEspelho: string[] = [];
  let continuacao: string | undefined;
  do {
    const r = await s3().send(
      new ListObjectsV2Command({
        Bucket: ESPELHO_BUCKET,
        Prefix: prefixo,
        ContinuationToken: continuacao,
      }),
    );
    for (const o of r.Contents ?? []) if (o.Key) noEspelho.push(o.Key);
    continuacao = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (continuacao);

  // De volta para a chave original: é ela que existe (ou não) no banco.
  const origens = noEspelho.map((k) => k.replace(/^espelho\//, ""));
  if (origens.length === 0) return vazio;

  const linhas = await consultar<{ chave: string }>(
    "select chave from medias where chave = any($1::text[])",
    [origens],
  );
  const vivas = new Set(linhas.map((l) => l.chave));

  const orfas = origens.filter((c) => !vivas.has(c));
  // Exclusão solicitada alcança tudo; a varredura normal, só as órfãs.
  const alvos = opcoes.exclusaoSolicitada ? origens : orfas;

  const resultado: ResultadoPurga = { orfas, apagadas: 0, erros: [] };
  if (!opcoes.aplicar || alvos.length === 0) return resultado;

  /*
   * Exclusão a pedido do titular passa por fora da trava: ali apagar tudo do
   * estúdio é literalmente o pedido, e o alvo é um tenant só. A trava existe
   * para a varredura AUTOMÁTICA, que roda sozinha de madrugada e não tem
   * ninguém olhando.
   */
  if (!opcoes.exclusaoSolicitada && purgaExcedeLimite(alvos.length, origens.length)) {
    const pct = ((alvos.length / origens.length) * 100).toFixed(0);
    resultado.erros.push(
      `RECUSADO: ${alvos.length} de ${origens.length} objetos (${pct}%) seriam apagados, ` +
        `acima do limite de ${(LIMITE_PURGA * 100).toFixed(0)}%. Uma purga desse tamanho quase ` +
        `sempre é a comparação com o banco que está errada, não o espelho. Confira o banco ` +
        `antes; para apagar assim mesmo, é caso a caso com exclusaoSolicitada.`,
    );
    return resultado;
  }

  for (const chave of alvos) {
    try {
      await apagarDoEspelho(chave);
      resultado.apagadas++;
    } catch (e) {
      // Object Lock pode recusar objeto ainda dentro da retenção. Não é falha
      // do código: é a trava funcionando, e quem pediu precisa saber disso.
      resultado.erros.push(`${chave}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (resultado.apagadas > 0 || resultado.erros.length > 0) {
    const { registrarEvento, ACOES } = await import("./eventos");
    await registrarEvento({
      tenantId: opcoes.tenantId ?? null,
      ator: "sistema",
      acao: ACOES.ESPELHO_PURGADO,
      alvoTipo: opcoes.galeriaId ? "galeria" : "conta",
      alvoId: opcoes.galeriaId ?? opcoes.tenantId ?? null,
      detalhe: {
        apagadas: resultado.apagadas,
        orfas: orfas.length,
        exclusaoSolicitada: Boolean(opcoes.exclusaoSolicitada),
        erros: resultado.erros.length,
      },
    });
  }

  return resultado;
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
