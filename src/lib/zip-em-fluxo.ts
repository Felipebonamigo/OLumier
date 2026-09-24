import { crc32 } from "node:zlib";

/**
 * ZIP montado em FLUXO — cada arquivo é lido, repassado e esquecido.
 *
 * ── POR QUE EXISTE (16/09/2026) ───────────────────────────────────────────
 *
 * Felipe: "o download de baixar várias fotos ainda está difícil", e, no
 * computador, "uma pasta zipada". Até aqui o computador baixava um arquivo por
 * vez com 700 ms de pausa — 2108 fotos eram 25 minutos de navegador disparando
 * download e perguntando se podia continuar.
 *
 * ── AS TRÊS ESCOLHAS DO FORMATO ───────────────────────────────────────────
 *
 * 1. MÉTODO "ARMAZENADO", sem compressão. Foto já é JPEG; comprimir de novo
 *    gasta CPU do mesmo VPS que serve as galerias para ganhar quase nada. O
 *    custo que sobra é a banda, e esse é inevitável.
 *
 * 2. DESCRITOR DE DADOS (bit 3). O cabeçalho de cada arquivo vai ANTES dos
 *    bytes, e o CRC só se conhece DEPOIS de lê-los. O bit 3 diz ao leitor que o
 *    CRC vem num descritor logo após os dados, e é isso que dispensa guardar a
 *    foto inteira na memória para calcular antes. O CRC é somado durante a
 *    passagem — `crc32(pedaço, anterior)` dá o mesmo que o do arquivo inteiro.
 *
 * 3. ZIP64 SÓ QUANDO PRECISA. Acima de 4 GB os campos de 32 bits estouram, e um
 *    capítulo de casamento chega perto disso. Mas descompactadores antigos
 *    tropeçam em ZIP64 sem necessidade, então a decisão é tomada UMA vez, antes
 *    de começar, a partir dos tamanhos que o banco já conhece — e vale para o
 *    arquivo inteiro, que é mais simples de acertar do que misturar os dois.
 *
 * `scripts/testar-zip-em-fluxo.mjs` descompacta o resultado com o
 * `Expand-Archive` do Windows e compara byte a byte. Um ZIP que só o meu próprio
 * leitor abre não provaria nada.
 */

export interface ArquivoDoZip {
  /** Caminho dentro do zip. Barra vira pasta: "Festa/brinde.jpg". */
  nome: string;
  /** O tamanho que o banco conhece. Tem de bater com o que chegar. */
  tamanho: number;
  /** Abre o arquivo só na vez dele — nada é buscado antes da hora. */
  abrir: () => AsyncIterable<Uint8Array>;
}

export interface OpcoesDoZip {
  /**
   * A partir de quantos bytes o arquivo usa ZIP64. O padrão é o teto real do
   * formato; o teste rebaixa para forçar o caminho sem gerar 4 GB.
   */
  limiteZip64?: number;
  /**
   * A data gravada em cada entrada. Sem ela, é a hora da montagem — e dois
   * ZIPs do mesmo conteúdo saem com bytes diferentes. O servidor de ZIP passa
   * uma data FIXA por conteúdo, para que um ZIP apagado do cache e montado de
   * novo seja idêntico byte a byte ao anterior: é o que deixa o "Retomar" do
   * navegador continuar de onde parou sem emendar dois arquivos diferentes.
   */
  data?: Date;
}

const TETO_32 = 0xffffffff;
const TETO_16 = 0xffff;

/* Bit 3: CRC e tamanhos no descritor, depois dos dados. Bit 11: nomes em UTF-8
   — sem ele o Windows descompacta "Cerimônia" como "CerimÃ´nia". */
const FLAGS = 0x0008 | 0x0800;

/** Data e hora no formato do DOS, que é o que o ZIP guarda. */
function dataDos(agora: Date): { hora: number; data: number } {
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | Math.floor(agora.getSeconds() / 2);
  const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  return { hora, data };
}

/** Número de 64 bits em little-endian, a partir de um `number` seguro. */
function u64(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

/** A mesma decisão de ZIP64 que o escritor toma — um lugar só, senão divergem. */
function usaZip64(arquivos: ArquivoDoZip[], limite: number): boolean {
  const total = arquivos.reduce((s, a) => s + a.tamanho, 0);
  /*
   * A decisão é tomada ANTES do primeiro byte, com os tamanhos do banco. O
   * total inclui cabeçalhos por estimativa generosa: um capítulo de 3,99 GB de
   * foto mais os cabeçalhos passaria de 4 GB, e descobrir isso no meio do fluxo
   * seria tarde demais — os cabeçalhos já enviados diriam "32 bits".
   */
  const folgaDeCabecalhos = arquivos.length * 256;
  return (
    total + folgaDeCabecalhos >= limite ||
    arquivos.length >= TETO_16 ||
    arquivos.some((a) => a.tamanho >= limite)
  );
}

/**
 * O tamanho EXATO do zip, antes de começar.
 *
 * Existe para o `Content-Length`: sem ele, um capítulo de 2 GB é uma barra de
 * "baixando…" sem fim por meia hora, e o casal não sabe se travou. Com ele o
 * navegador mostra quanto falta.
 *
 * Tem de ser exato, não aproximado — um byte a mais e o navegador espera para
 * sempre por um fim que não vem; um a menos e corta o último arquivo. Por isso
 * espelha o escritor campo a campo, e `testar-zip-em-fluxo.mjs` compara os dois.
 */
export function tamanhoDoZip(arquivos: ArquivoDoZip[], opcoes: OpcoesDoZip = {}): number {
  const zip64 = usaZip64(arquivos, opcoes.limiteZip64 ?? TETO_32);
  let total = 0;
  let central = 0;
  for (const a of arquivos) {
    const nome = Buffer.byteLength(a.nome, "utf8");
    total += 30 + nome + (zip64 ? 20 : 0); // cabeçalho local + extensão ZIP64
    total += a.tamanho;
    total += zip64 ? 24 : 16; // descritor
    central += 46 + nome + (zip64 ? 28 : 0); // entrada do diretório + extensão ZIP64
  }
  total += central;
  if (zip64) total += 56 + 20; // fim de 64 bits + localizador
  total += 22; // fim
  return total;
}

export async function* zipEmFluxo(
  arquivos: ArquivoDoZip[],
  opcoes: OpcoesDoZip = {},
): AsyncGenerator<Uint8Array> {
  const zip64 = usaZip64(arquivos, opcoes.limiteZip64 ?? TETO_32);

  const { hora, data } = dataDos(opcoes.data ?? new Date());
  const central: Buffer[] = [];
  let posicao = 0;

  for (const arquivo of arquivos) {
    const nome = Buffer.from(arquivo.nome, "utf8");
    const inicio = posicao;

    /* ── cabeçalho local ──────────────────────────────────────────────── */
    /* No ZIP64 com descritor, os tamanhos do cabeçalho vão como 0xFFFFFFFF e a
       extensão ZIP64 leva zeros: o valor real chega no descritor. */
    const extraLocal = zip64
      ? Buffer.concat([Buffer.from([0x01, 0x00, 16, 0x00]), u64(0), u64(0)])
      : Buffer.alloc(0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(zip64 ? 45 : 20, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(0, 8); // armazenado
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(0, 14); // CRC vem no descritor
    local.writeUInt32LE(zip64 ? TETO_32 : 0, 18);
    local.writeUInt32LE(zip64 ? TETO_32 : 0, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(extraLocal.length, 28);

    const cabecalho = Buffer.concat([local, nome, extraLocal]);
    yield cabecalho;
    posicao += cabecalho.length;

    /* ── os bytes da foto, com o CRC somado na passagem ───────────────── */
    let crc = 0;
    let lidos = 0;
    for await (const pedaco of arquivo.abrir()) {
      crc = crc32(pedaco, crc);
      lidos += pedaco.length;
      yield pedaco;
    }
    posicao += lidos;

    /*
     * O tamanho que CHEGOU tem de ser o que o banco disse. Um descritor com o
     * número errado faz alguns descompactadores recusarem o arquivo inteiro —
     * e o Windows, pior, às vezes aceita e entrega a foto cortada. Melhor o
     * fluxo parar aqui, alto, do que o casal receber um zip que abre quase
     * inteiro.
     */
    if (lidos !== arquivo.tamanho) {
      throw new Error(
        `"${arquivo.nome}" chegou com ${lidos} bytes, e o banco diz ${arquivo.tamanho}`,
      );
    }

    /* ── descritor de dados ───────────────────────────────────────────── */
    const descritor = zip64
      ? Buffer.concat([
          (() => {
            const b = Buffer.alloc(8);
            b.writeUInt32LE(0x08074b50, 0);
            b.writeUInt32LE(crc >>> 0, 4);
            return b;
          })(),
          u64(lidos),
          u64(lidos),
        ])
      : (() => {
          const b = Buffer.alloc(16);
          b.writeUInt32LE(0x08074b50, 0);
          b.writeUInt32LE(crc >>> 0, 4);
          b.writeUInt32LE(lidos, 8);
          b.writeUInt32LE(lidos, 12);
          return b;
        })();
    yield descritor;
    posicao += descritor.length;

    /* ── a entrada dele no diretório central, guardada para o fim ─────── */
    const extraCentral = zip64
      ? Buffer.concat([Buffer.from([0x01, 0x00, 24, 0x00]), u64(lidos), u64(lidos), u64(inicio)])
      : Buffer.alloc(0);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(zip64 ? 45 : 20, 4); // feito por
    cdh.writeUInt16LE(zip64 ? 45 : 20, 6); // necessário para extrair
    cdh.writeUInt16LE(FLAGS, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(hora, 12);
    cdh.writeUInt16LE(data, 14);
    cdh.writeUInt32LE(crc >>> 0, 16);
    cdh.writeUInt32LE(zip64 ? TETO_32 : lidos, 20);
    cdh.writeUInt32LE(zip64 ? TETO_32 : lidos, 24);
    cdh.writeUInt16LE(nome.length, 28);
    cdh.writeUInt16LE(extraCentral.length, 30);
    cdh.writeUInt16LE(0, 32); // comentário
    cdh.writeUInt16LE(0, 34); // disco
    cdh.writeUInt16LE(0, 36); // atributos internos
    cdh.writeUInt32LE(0, 38); // atributos externos
    cdh.writeUInt32LE(zip64 ? TETO_32 : inicio, 42);
    central.push(Buffer.concat([cdh, nome, extraCentral]));
  }

  /* ── o diretório central e o fim ────────────────────────────────────── */
  const inicioCentral = posicao;
  const diretorio = Buffer.concat(central);
  yield diretorio;
  posicao += diretorio.length;

  if (zip64) {
    const inicioFim64 = posicao;

    const fim64 = Buffer.alloc(56);
    fim64.writeUInt32LE(0x06064b50, 0);
    fim64.writeBigUInt64LE(BigInt(44), 4); // tamanho do registro, sem os 12 primeiros bytes
    fim64.writeUInt16LE(45, 12);
    fim64.writeUInt16LE(45, 14);
    fim64.writeUInt32LE(0, 16);
    fim64.writeUInt32LE(0, 20);
    fim64.writeBigUInt64LE(BigInt(arquivos.length), 24);
    fim64.writeBigUInt64LE(BigInt(arquivos.length), 32);
    fim64.writeBigUInt64LE(BigInt(diretorio.length), 40);
    fim64.writeBigUInt64LE(BigInt(inicioCentral), 48);
    yield fim64;

    const localizador = Buffer.alloc(20);
    localizador.writeUInt32LE(0x07064b50, 0);
    localizador.writeUInt32LE(0, 4);
    localizador.writeBigUInt64LE(BigInt(inicioFim64), 8);
    localizador.writeUInt32LE(1, 16);
    yield localizador;
  }

  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(0, 4);
  fim.writeUInt16LE(0, 6);
  fim.writeUInt16LE(zip64 ? TETO_16 : arquivos.length, 8);
  fim.writeUInt16LE(zip64 ? TETO_16 : arquivos.length, 10);
  fim.writeUInt32LE(zip64 ? TETO_32 : diretorio.length, 12);
  fim.writeUInt32LE(zip64 ? TETO_32 : inicioCentral, 16);
  fim.writeUInt16LE(0, 20);
  yield fim;
}
