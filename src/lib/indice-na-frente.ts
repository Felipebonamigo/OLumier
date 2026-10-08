/**
 * O ÍNDICE DO FILME VAI PARA A FRENTE DO ARQUIVO (08/10/2026).
 *
 * Um MP4/MOV tem duas partes que importam aqui: `mdat`, os quadros, e `moov`, o
 * índice — onde começa cada quadro, quanto dura, qual é chave. O player precisa
 * do índice ANTES de mostrar qualquer coisa. Câmera e celular gravam o índice
 * no FIM (só sabem o que escrever nele quando a gravação acaba), e aí o
 * navegador busca o começo, descobre que não é o índice, busca o fim, e só
 * então começa. Os 32 vídeos do Mirna e Diogo eram todos assim.
 *
 * A versão leve (`versao-leve.ts`) sai do conversor do mesmo jeito: com
 * `fastStart` em memória ele guardaria o filme inteiro na RAM antes de escrever
 * — impraticável numa cerimônia de uma hora. Então o conversor escreve com o
 * índice no fim, em disco, e este módulo o move.
 *
 * ── COMO, SEM COPIAR O FILME ───────────────────────────────────────────────
 *
 * O arquivo novo é um `Blob` montado por FATIAS do antigo: o que vinha antes dos
 * quadros, o índice reescrito, os quadros. `Blob.slice` não copia nada — é uma
 * referência —, então mover o índice de um filme de 4 GB custa ler e reescrever
 * o índice (alguns MB) e mais nada.
 *
 * Reescrever é necessário porque o índice guarda a posição ABSOLUTA de cada
 * pedaço de quadros (`stco`, 32 bits, ou `co64`, 64 bits). Com o índice na
 * frente, tudo o que vinha depois anda o tamanho dele. Se alguma posição passar
 * de 4 GB numa tabela de 32 bits, a tabela vira `co64` — e como isso muda o
 * tamanho do índice, que muda as posições, a conta é refeita com as tabelas já
 * convertidas (converter todas de uma vez fecha em duas voltas).
 *
 * É o que o `qt-faststart` do FFmpeg faz, no navegador. Funciona igual no Node
 * (o `Blob` é o mesmo), e é assim que o teste o confere.
 */

/** Erro deste módulo — a mensagem é para a tela, em português. */
export class ErroDoIndice extends Error {}

/** Teto do índice que aceitamos carregar na memória. Uma hora de filme dá ~5 MB. */
const INDICE_MAXIMO = 64 * 1024 * 1024;

/** As caixas que só contêm outras caixas no caminho até as tabelas de posição. */
const RECIPIENTES = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

interface Caixa {
  tipo: string;
  inicio: number;
  tamanho: number;
}

async function ler(arquivo: Blob, inicio: number, fim: number): Promise<Uint8Array> {
  return new Uint8Array(await arquivo.slice(inicio, fim).arrayBuffer());
}

function tipoEm(b: Uint8Array, i: number): string {
  return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
}

/** As caixas do primeiro nível, lendo só os cabeçalhos. */
export async function caixasDoTopo(arquivo: Blob): Promise<Caixa[]> {
  const caixas: Caixa[] = [];
  let pos = 0;
  while (pos + 8 <= arquivo.size) {
    const cab = await ler(arquivo, pos, Math.min(pos + 16, arquivo.size));
    const v = new DataView(cab.buffer, cab.byteOffset, cab.byteLength);
    let tamanho = v.getUint32(0);
    if (tamanho === 1) {
      if (cab.byteLength < 16) break;
      tamanho = Number(v.getBigUint64(8));
    } else if (tamanho === 0) {
      tamanho = arquivo.size - pos;
    }
    if (tamanho < 8 || pos + tamanho > arquivo.size) break;
    caixas.push({ tipo: tipoEm(cab, 4), inicio: pos, tamanho });
    pos += tamanho;
  }
  return caixas;
}

/** O índice já vem antes dos quadros? (O que o player quer.) */
export async function indiceJaNaFrente(arquivo: Blob): Promise<boolean | null> {
  const topo = await caixasDoTopo(arquivo);
  const moov = topo.find((c) => c.tipo === "moov");
  const mdat = topo.find((c) => c.tipo === "mdat");
  if (!moov || !mdat) return null;
  return moov.inicio < mdat.inicio;
}

/**
 * Reescreve uma caixa (e as de dentro), corrigindo as posições dos quadros.
 * `converter` transforma toda `stco` em `co64`.
 */
function reescrever(
  b: Uint8Array,
  inicio: number,
  fim: number,
  novaPosicao: (antiga: number) => number,
  converter: boolean,
  estourou: { sim: boolean },
): Uint8Array[] {
  const saida: Uint8Array[] = [];
  let pos = inicio;
  while (pos + 8 <= fim) {
    const v = new DataView(b.buffer, b.byteOffset + pos);
    let tamanho = v.getUint32(0);
    let cab = 8;
    if (tamanho === 1) {
      tamanho = Number(v.getBigUint64(8));
      cab = 16;
    } else if (tamanho === 0) {
      tamanho = fim - pos;
    }
    if (tamanho < cab || pos + tamanho > fim) throw new ErroDoIndice("índice corrompido");
    const tipo = tipoEm(b, pos + 4);

    if (RECIPIENTES.has(tipo)) {
      const filhos = reescrever(b, pos + cab, pos + tamanho, novaPosicao, converter, estourou);
      const corpo = filhos.reduce((n, f) => n + f.byteLength, 0);
      const novo = new Uint8Array(8 + corpo);
      new DataView(novo.buffer).setUint32(0, 8 + corpo);
      novo.set(b.subarray(pos + 4, pos + 8), 4);
      let o = 8;
      for (const f of filhos) {
        novo.set(f, o);
        o += f.byteLength;
      }
      saida.push(novo);
    } else if (tipo === "stco" || tipo === "co64") {
      const larga = tipo === "co64";
      const n = v.getUint32(cab + 4);
      const paraLarga = larga || converter;
      const novo = new Uint8Array(8 + 8 + n * (paraLarga ? 8 : 4));
      const nv = new DataView(novo.buffer);
      nv.setUint32(0, novo.byteLength);
      novo.set(new TextEncoder().encode(paraLarga ? "co64" : "stco"), 4);
      nv.setUint32(8, v.getUint32(cab)); // versão e flags
      nv.setUint32(12, n);
      for (let i = 0; i < n; i++) {
        const antiga = larga ? Number(v.getBigUint64(cab + 8 + i * 8)) : v.getUint32(cab + 8 + i * 4);
        const nova = novaPosicao(antiga);
        if (paraLarga) nv.setBigUint64(16 + i * 8, BigInt(nova));
        else if (nova > 0xffffffff) estourou.sim = true;
        else nv.setUint32(16 + i * 4, nova);
      }
      saida.push(novo);
    } else {
      saida.push(b.subarray(pos, pos + tamanho));
    }
    pos += tamanho;
  }
  return saida;
}

function juntar(partes: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = partes.reduce((n, p) => n + p.byteLength, 0);
  const tudo = new Uint8Array(total);
  let o = 0;
  for (const p of partes) {
    tudo.set(p, o);
    o += p.byteLength;
  }
  return tudo;
}

/**
 * O mesmo arquivo, com o índice antes dos quadros. Devolve o próprio arquivo
 * quando não há o que mover (já está na frente, não é MP4/MOV, ou é
 * fragmentado — esse já toca enquanto chega).
 */
export async function indiceNaFrente(arquivo: Blob, tipo = arquivo.type || "video/mp4"): Promise<Blob> {
  const topo = await caixasDoTopo(arquivo);
  const moov = topo.find((c) => c.tipo === "moov");
  const primeiroMdat = topo.findIndex((c) => c.tipo === "mdat");
  if (!moov || primeiroMdat === -1 || topo.some((c) => c.tipo === "moof")) return arquivo;
  if (moov.inicio < topo[primeiroMdat].inicio) return arquivo;
  if (moov.tamanho > INDICE_MAXIMO) throw new ErroDoIndice("índice grande demais para mover");

  const antes = topo.slice(0, primeiroMdat).filter((c) => c.tipo !== "moov");
  const depois = topo.slice(primeiroMdat).filter((c) => c.tipo !== "moov");
  const tamanhoAntes = antes.reduce((n, c) => n + c.tamanho, 0);
  const bruto = await ler(arquivo, moov.inicio, moov.inicio + moov.tamanho);

  const montar = (tamanhoDoIndice: number, converter: boolean) => {
    /* Onde cada caixa de quadros vai morar no arquivo novo. */
    const mapa: { de: number; ate: number; para: number }[] = [];
    let para = tamanhoAntes + tamanhoDoIndice;
    for (const c of depois) {
      mapa.push({ de: c.inicio, ate: c.inicio + c.tamanho, para });
      para += c.tamanho;
    }
    const novaPosicao = (antiga: number) => {
      const m = mapa.find((x) => antiga >= x.de && antiga < x.ate);
      if (!m) throw new ErroDoIndice("posição de quadro fora das caixas de quadros");
      return antiga - m.de + m.para;
    };
    const estourou = { sim: false };
    const indice = juntar(reescrever(bruto, 0, bruto.byteLength, novaPosicao, converter, estourou));
    return { indice, estourou: estourou.sim };
  };

  /* A conta depende do tamanho do índice novo, que só se sabe depois de
     montá-lo. Sem conversão ele não muda e a primeira volta fecha; se estourou
     32 bits, converte e refaz até o tamanho parar de mudar. */
  let converter = false;
  let tamanhoDoIndice = moov.tamanho;
  let indice: Uint8Array<ArrayBuffer> | null = null;
  for (let volta = 0; volta < 4 && !indice; volta++) {
    const t = montar(tamanhoDoIndice, converter);
    if (t.estourou) converter = true;
    else if (t.indice.byteLength === tamanhoDoIndice) indice = t.indice;
    else tamanhoDoIndice = t.indice.byteLength;
  }
  if (!indice) throw new ErroDoIndice("não consegui reescrever o índice");

  return new Blob(
    [
      ...antes.map((c) => arquivo.slice(c.inicio, c.inicio + c.tamanho)),
      indice,
      ...depois.map((c) => arquivo.slice(c.inicio, c.inicio + c.tamanho)),
    ],
    { type: tipo },
  );
}
