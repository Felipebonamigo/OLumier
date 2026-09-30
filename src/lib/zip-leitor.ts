/**
 * LÊ UM ZIP NO NAVEGADOR — sem descompactar no disco e sem carregar o ZIP na
 * memória.
 *
 * ── PARA QUE EXISTE (30/09/2026) ──────────────────────────────────────────
 *
 * Felipe, sobre quem chega de outra plataforma com o acervo inteiro: "o usuário
 * que tem umas 80 galerias vai ter que baixar 80 zips e abrir 80 coisas
 * diferentes". O Pixieset (e quase toda plataforma) entrega a coleção em ZIP.
 * Pedir para descompactar cada um antes de arrastar é trabalho que a pessoa
 * não devia ter: o navegador lê o ZIP direto.
 *
 * ── POR QUE NÃO CARREGA O ZIP INTEIRO ─────────────────────────────────────
 *
 * Um ZIP de casamento tem 20 GB. `File` é uma referência ao disco, e
 * `Blob.slice` também: lemos só o índice do fim do arquivo (o "diretório
 * central", uns KB) e, na hora de enviar cada foto, a fatia dela. Foto guardada
 * sem compressão — o normal em ZIP de JPEG, que não comprime — nem passa pela
 * memória: a fatia vai direto para o envio. Comprimida (deflate), é
 * descompactada UMA de cada vez, na vez dela, pelo `DecompressionStream` que o
 * próprio navegador tem.
 *
 * ── POR QUE SEM BIBLIOTECA ────────────────────────────────────────────────
 *
 * O projeto já ESCREVE ZIP à mão (`zip-em-fluxo.ts`), e ler é a metade simples
 * do formato: o índice diz onde cada arquivo começa e quanto mede. O teste
 * (`scripts/testar-zip-leitor.mjs`) lê o que o nosso escritor produz — com e
 * sem ZIP64 — e um ZIP comprimido montado lá mesmo.
 *
 * Não lê: ZIP com senha (a entrada é recusada com o nome, não some calada),
 * e métodos de compressão além de guardar (0) e deflate (8) — os dois que
 * qualquer gerador de ZIP usa.
 */

export interface EntradaDoZip {
  /** Caminho dentro do ZIP, com "/" separando pastas: "Cerimônia/IMG_01.jpg". */
  caminho: string;
  /** Tamanho descompactado — o do arquivo que vai para a galeria. */
  tamanho: number;
  /** Traz o conteúdo. Só é chamado na vez do arquivo na fila de envio. */
  abrir: () => Promise<Blob>;
}

export interface ZipLido {
  entradas: EntradaDoZip[];
  /** Entradas que existem mas não dá para ler (senha, compressão exótica). */
  recusadas: { caminho: string; motivo: string }[];
}

/** O ZIP não é um ZIP, ou está cortado — o recado vai para a pessoa. */
export class ZipIlegivel extends Error {}

const ASSINATURA_FIM = 0x06054b50;
const ASSINATURA_LOCALIZADOR_64 = 0x07064b50;
const ASSINATURA_FIM_64 = 0x06064b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

const TETO_32 = 0xffffffff;
const TETO_16 = 0xffff;

async function ler(zip: Blob, inicio: number, fim: number): Promise<DataView> {
  return new DataView(await zip.slice(inicio, fim).arrayBuffer());
}

function u64(v: DataView, pos: number): number {
  const n = v.getBigUint64(pos, true);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipIlegivel("ZIP com tamanho impossível.");
  return Number(n);
}

/**
 * O nome dentro do ZIP. UTF-8 quando o gerador marca (bit 11) ou quando os
 * bytes são UTF-8 válido — o caso de todo gerador atual, marcado ou não. O
 * resto cai no latin-1, que ao menos não perde as letras sem acento: é o nome
 * de uma pasta, e o fotógrafo renomeia a galeria na tela antes de criar.
 */
function nomeDaEntrada(bytes: Uint8Array, utf8Marcado: boolean): string {
  if (utf8Marcado) return new TextDecoder("utf-8").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

/** Lixo que todo ZIP feito no Mac ou no Windows carrega junto. */
function ehLixo(caminho: string): boolean {
  const partes = caminho.split("/");
  if (partes[0] === "__MACOSX") return true;
  return partes.some((p) => p.startsWith("."));
}

/**
 * Onde começa e quanto mede o diretório central.
 *
 * O registro do fim fica nos últimos 22 bytes — mais o comentário do ZIP, que
 * pode ter até 64 KB. Por isso a busca é de trás para frente numa janela.
 */
async function localizarDiretorio(
  zip: Blob,
): Promise<{ inicio: number; tamanho: number; total: number }> {
  const janela = Math.min(zip.size, 22 + TETO_16 + 20);
  const baseJanela = zip.size - janela;
  const v = await ler(zip, baseJanela, zip.size);

  let fim = -1;
  for (let i = janela - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === ASSINATURA_FIM) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new ZipIlegivel("Não parece um ZIP — ou o download não terminou.");

  let total = v.getUint16(fim + 10, true);
  let tamanho = v.getUint32(fim + 12, true);
  let inicio = v.getUint32(fim + 16, true);

  /* ZIP64: o localizador fica colado ANTES do registro do fim. Os geradores
     que o usam nem sempre marcam 0xFFFF nos campos de 32 bits — então se ele
     existir, vale ele. */
  if (fim >= 20 && v.getUint32(fim - 20, true) === ASSINATURA_LOCALIZADOR_64) {
    const onde = u64(v, fim - 20 + 8);
    const f64 = await ler(zip, onde, onde + 56);
    if (f64.getUint32(0, true) !== ASSINATURA_FIM_64) {
      throw new ZipIlegivel("O índice do ZIP está corrompido.");
    }
    total = u64(f64, 32);
    tamanho = u64(f64, 40);
    inicio = u64(f64, 48);
  } else if (total === TETO_16 || tamanho === TETO_32 || inicio === TETO_32) {
    throw new ZipIlegivel("O índice do ZIP está corrompido.");
  }

  if (inicio + tamanho > zip.size) {
    throw new ZipIlegivel("O ZIP está cortado — o download provavelmente não terminou.");
  }
  return { inicio, tamanho, total };
}

/**
 * Lê o índice do ZIP. Nada do conteúdo é lido aqui — cada entrada traz um
 * `abrir()` para a hora dela.
 */
export async function lerZip(zip: Blob): Promise<ZipLido> {
  if (zip.size < 22) throw new ZipIlegivel("Não parece um ZIP — o arquivo é pequeno demais.");

  const dir = await localizarDiretorio(zip);
  const v = await ler(zip, dir.inicio, dir.inicio + dir.tamanho);
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

  const entradas: EntradaDoZip[] = [];
  const recusadas: ZipLido["recusadas"] = [];

  let p = 0;
  for (let n = 0; n < dir.total; n++) {
    if (p + 46 > v.byteLength || v.getUint32(p, true) !== ASSINATURA_CENTRAL) {
      throw new ZipIlegivel("O índice do ZIP está corrompido.");
    }
    const flags = v.getUint16(p + 8, true);
    const metodo = v.getUint16(p + 10, true);
    let comprimido = v.getUint32(p + 20, true);
    let tamanho = v.getUint32(p + 24, true);
    const tamNome = v.getUint16(p + 28, true);
    const tamExtra = v.getUint16(p + 30, true);
    const tamComentario = v.getUint16(p + 32, true);
    let local = v.getUint32(p + 42, true);

    const caminho = nomeDaEntrada(bytes.subarray(p + 46, p + 46 + tamNome), (flags & 0x0800) !== 0);

    /* O campo extra ZIP64 (id 0x0001) traz, NESTA ordem, só os valores que
       estouraram 32 bits: tamanho, comprimido, deslocamento. */
    let e = p + 46 + tamNome;
    const fimExtra = e + tamExtra;
    while (e + 4 <= fimExtra) {
      const id = v.getUint16(e, true);
      const tam = v.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (tamanho === TETO_32) {
          tamanho = u64(v, q);
          q += 8;
        }
        if (comprimido === TETO_32) {
          comprimido = u64(v, q);
          q += 8;
        }
        if (local === TETO_32) local = u64(v, q);
      }
      e += 4 + tam;
    }
    p = fimExtra + tamComentario;

    if (caminho.endsWith("/") || ehLixo(caminho)) continue; // pasta, ou lixo do sistema

    if (flags & 0x0001) {
      recusadas.push({ caminho, motivo: "protegido por senha" });
      continue;
    }
    if (metodo !== 0 && metodo !== 8) {
      recusadas.push({ caminho, motivo: "compressão que o navegador não abre" });
      continue;
    }

    entradas.push({
      caminho,
      tamanho,
      abrir: () => abrirEntrada(zip, local, comprimido, tamanho, metodo, caminho),
    });
  }

  return { entradas, recusadas };
}

async function abrirEntrada(
  zip: Blob,
  local: number,
  comprimido: number,
  tamanho: number,
  metodo: number,
  caminho: string,
): Promise<Blob> {
  /* O cabeçalho LOCAL repete o nome e tem o próprio campo extra, que pode ter
     tamanho diferente do que está no índice — o começo dos dados só se sabe
     lendo este. */
  const cab = await ler(zip, local, local + 30);
  if (cab.getUint32(0, true) !== ASSINATURA_LOCAL) {
    throw new ZipIlegivel(`“${caminho}”: o ZIP está corrompido neste arquivo.`);
  }
  const inicio = local + 30 + cab.getUint16(26, true) + cab.getUint16(28, true);
  const dados = zip.slice(inicio, inicio + comprimido);
  if (dados.size !== comprimido) {
    throw new ZipIlegivel(`“${caminho}”: o ZIP está cortado neste arquivo.`);
  }
  if (metodo === 0) return dados;

  const aberto = await new Response(
    dados.stream().pipeThrough(new DecompressionStream("deflate-raw")),
  ).blob();
  if (aberto.size !== tamanho) {
    throw new ZipIlegivel(`“${caminho}”: o arquivo saiu do ZIP com tamanho errado.`);
  }
  return aberto;
}

/** "fotos.zip" é ZIP; o navegador às vezes não sabe o mime, a extensão sabe. */
export function ehZip(f: { name: string; type: string }): boolean {
  return /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";
}
