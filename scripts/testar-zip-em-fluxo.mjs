#!/usr/bin/env node
/**
 * O ZIP que a galeria entrega, montado em fluxo. Uso:
 *   node --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-zip-em-fluxo.mjs
 *
 * ── O PEDIDO ──────────────────────────────────────────────────────────────
 *
 * Felipe, 15/09/2026: "o download de baixar várias fotos ainda está difícil" —
 * e, perguntado, "se for pelo computador, uma pasta zipada". Hoje o computador
 * baixa um arquivo por vez com 700 ms entre eles: a galeria de 2108 fotos da
 * Ana & Kaio são 25 minutos de navegador disparando download.
 *
 * ── POR QUE O ZIP É ESCRITO À MÃO, E EM FLUXO ─────────────────────────────
 *
 * Nenhuma dependência instalada escreve ZIP, e o formato sem compressão é
 * pequeno: cabeçalho, bytes, descritor, diretório. Foto já é JPEG — comprimir
 * de novo gasta CPU do VPS para ganhar quase nada —, então o método é
 * "armazenado" e o custo é só a banda.
 *
 * Em FLUXO porque um capítulo passa de 2 GB: montar o arquivo na memória antes
 * de mandar derrubaria o servidor que serve as outras galerias. Cada foto é
 * lida, repassada e esquecida; o CRC é somado durante a passagem
 * (`zlib.crc32(pedaço, anterior)`) e vai num descritor DEPOIS dos dados.
 *
 * ── POR QUE O JUIZ É O WINDOWS ────────────────────────────────────────────
 *
 * Um ZIP que só o meu próprio leitor abre não prova nada — eu erraria o
 * formato nas duas pontas do mesmo jeito. Quem descompacta aqui é o
 * `Expand-Archive` do PowerShell, que é o que a Carol usa, e o conteúdo de cada
 * arquivo extraído é comparado byte a byte com o que entrou.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { zipEmFluxo } from "../src/lib/zip-em-fluxo.ts";

let falhou = false;
const ok = (m, extra) => console.log(`  ✓ ${m}${extra ? ` — ${extra}` : ""}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

/** Junta o fluxo inteiro num Buffer — só para o teste; o produto nunca faz isso. */
async function juntar(fluxo) {
  const pedacos = [];
  for await (const p of fluxo) pedacos.push(Buffer.from(p));
  return Buffer.concat(pedacos);
}

/** Um "arquivo" que só existe quando é aberto, como a foto buscada no balde. */
const entrada = (nome, bytes, partes = 3) => ({
  nome,
  tamanho: bytes.length,
  /* Entregue em pedaços desiguais de propósito: o CRC somado por partes tem de
     dar o mesmo que o CRC do arquivo inteiro, e é aqui que isso seria pego. */
  abrir: async function* () {
    const passo = Math.ceil(bytes.length / partes);
    for (let i = 0; i < bytes.length; i += passo) yield bytes.subarray(i, i + passo);
  },
});

/*
 * ── O WINDOWS NÃO CONFERE CRC ─────────────────────────────────────────────
 *
 * Descoberto corrompendo o CRC de propósito, em 16/09/2026: o `Expand-Archive`
 * aceitou e extraiu tudo. O `System.IO.Compression` do .NET não valida CRC em
 * entrada armazenada. O Archive Utility do Mac, o 7-Zip e o `unzip` validam —
 * então um CRC errado passaria neste teste e quebraria no computador do cliente.
 *
 * Por isso o CRC é conferido aqui, À PARTE, lendo o diretório central e
 * comparando com `zlib.crc32` dos bytes originais. É independente do escritor:
 * se o escritor errasse a soma, os dois números divergiriam.
 */
function crcsDoDiretorio(zip) {
  const fim = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let inicio = zip.readUInt32LE(fim + 16);
  let quantos = zip.readUInt16LE(fim + 10);
  /* Campos cheios de 1 querem dizer ZIP64: o número de verdade mora no
     registro de fim de 64 bits, apontado pelo localizador logo antes. */
  if (inicio === 0xffffffff || quantos === 0xffff) {
    const loc = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
    const fim64 = Number(zip.readBigUInt64LE(loc + 8));
    quantos = Number(zip.readBigUInt64LE(fim64 + 32));
    inicio = Number(zip.readBigUInt64LE(fim64 + 48));
  }
  const crcs = new Map();
  let p = inicio;
  for (let i = 0; i < quantos; i++) {
    const crc = zip.readUInt32LE(p + 16);
    const tamNome = zip.readUInt16LE(p + 28);
    const tamExtra = zip.readUInt16LE(p + 30);
    const tamComent = zip.readUInt16LE(p + 32);
    const nome = zip.subarray(p + 46, p + 46 + tamNome).toString("utf8");
    crcs.set(nome, crc);
    p += 46 + tamNome + tamExtra + tamComent;
  }
  return crcs;
}

/** Descompacta com o Windows e devolve o diretório. */
function descompactarComWindows(zip) {
  const dir = mkdtempSync(path.join(tmpdir(), "zip-teste-"));
  const arquivo = path.join(dir, "galeria.zip");
  writeFileSync(arquivo, zip);
  const destino = path.join(dir, "saida");
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${arquivo}' -DestinationPath '${destino}' -Force`,
    ],
    { encoding: "utf8" },
  );
  return { dir, destino, codigo: r.status, erro: (r.stderr || "").trim() };
}

const casos = [
  ["ZIP comum", {}],
  /* O caminho de ZIP64 só é tomado acima de 4 GB, e não dá para gerar 4 GB num
     teste. O limite é rebaixado para 1 byte: o arquivo sai com as estruturas de
     ZIP64 do mesmo jeito que sairia com um capítulo de verdade, e o Windows
     tem de conseguir abrir. */
  ["ZIP64 (limite rebaixado para forçar o caminho)", { limiteZip64: 1 }],
];

for (const [rotulo, opcoes] of casos) {
  console.log(`\n${rotulo}\n`);

  const arquivos = [
    ["Making of - DSC_0001.jpg", randomBytes(70_001)],
    /* Acento no nome: sem a flag de UTF-8 do ZIP, o Windows descompacta como
       "CerimÃ´nia", e o casal recebe a pasta com o nome quebrado. */
    ["Cerimônia - beijo no altar (1).jpg", randomBytes(123_457)],
    /* Barra no nome vira PASTA dentro do zip — é assim que capítulos viram
       pastas quando a galeria inteira for baixada de uma vez. */
    ["Festa/brinde.jpg", randomBytes(9_999)],
    /* Arquivo vazio é borda clássica de ZIP: CRC zero, tamanho zero. */
    ["vazio.txt", Buffer.alloc(0)],
  ];

  let zip;
  try {
    zip = await juntar(zipEmFluxo(arquivos.map(([n, b]) => entrada(n, b)), opcoes));
    ok("o fluxo termina e produz um arquivo", `${zip.length} bytes`);
  } catch (e) {
    erro(`o fluxo estourou: ${e.message}`);
    continue;
  }

  /* O CRC primeiro, e sem o Windows no meio — ver `crcsDoDiretorio`. */
  const { crc32 } = await import("node:zlib");
  const crcs = crcsDoDiretorio(zip);
  const crcErrado = arquivos.find(([nome, bytes]) => crcs.get(nome) !== crc32(bytes));
  if (crcErrado) {
    erro(`o CRC de "${crcErrado[0]}" está errado — o Mac e o 7-Zip recusariam este arquivo`);
  } else {
    ok("o CRC de cada arquivo confere com o conteúdo", "o que o Windows não verifica");
  }

  const { dir, destino, codigo, erro: msg } = descompactarComWindows(zip);
  try {
    if (codigo !== 0) {
      erro(`o Windows recusou o arquivo: ${msg.split("\n")[0]}`);
      continue;
    }
    ok("o Windows descompacta sem reclamar");

    for (const [nome, bytes] of arquivos) {
      const extraido = path.join(destino, ...nome.split("/"));
      if (!existsSync(extraido)) {
        erro(`"${nome}" não saiu do zip com esse nome`);
        continue;
      }
      if (!readFileSync(extraido).equals(bytes)) {
        erro(`"${nome}" saiu com conteúdo diferente do que entrou`);
        continue;
      }
      ok(`"${nome}" idêntico ao original`, `${bytes.length} bytes`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/*
 * ── O TAMANHO ANTES DO PRIMEIRO BYTE ──────────────────────────────────────
 *
 * Um capítulo de 2 GB sem `Content-Length` é uma barra de "baixando…" sem fim
 * por meia hora — o casal não sabe se travou. Como o banco já conhece o tamanho
 * de cada foto, o do zip inteiro é calculável antes de começar. Mas só serve se
 * for EXATO: um byte a mais e o navegador espera para sempre por um fim que não
 * vem; um a menos e corta o último arquivo.
 */
console.log("\nO tamanho anunciado é o tamanho entregue\n");
{
  const { tamanhoDoZip } = await import("../src/lib/zip-em-fluxo.ts");
  for (const [rotulo, opcoes] of casos) {
    const arquivos = [
      ["a.jpg", randomBytes(1234)],
      ["Cerimônia/beijo (1).jpg", randomBytes(5678)],
      ["vazio.txt", Buffer.alloc(0)],
    ];
    const entradas = arquivos.map(([n, b]) => entrada(n, b));
    const anunciado = tamanhoDoZip(entradas, opcoes);
    const entregue = (await juntar(zipEmFluxo(entradas, opcoes))).length;
    if (anunciado === entregue) ok(`${rotulo}: anuncia exatamente o que entrega`, `${entregue} bytes`);
    else erro(`${rotulo}: anuncia ${anunciado} e entrega ${entregue} — o navegador travaria ou cortaria`);
  }
}

console.log("\nQuando a foto não chega\n");

/* Uma foto que some do balde no meio do capítulo não pode travar o fluxo nem
   corromper o zip em silêncio. O certo é a falha aparecer — um zip truncado
   que abre "quase inteiro" faria o casal achar que recebeu tudo. */
{
  const quebrada = {
    nome: "quebrada.jpg",
    tamanho: 10,
    abrir: async function* () {
      yield Buffer.from("123");
      throw new Error("o balde fechou a conexão");
    },
  };
  try {
    await juntar(zipEmFluxo([entrada("ok.jpg", randomBytes(50)), quebrada]));
    erro("a falha no meio da foto foi engolida — o zip sairia truncado sem aviso");
  } catch (e) {
    ok("a falha no meio de uma foto interrompe o fluxo, não vira zip truncado", e.message);
  }
}

/* O tamanho declarado é o do banco; se o balde entregar outro, o zip mentiria
   no diretório e alguns descompactadores recusam. Melhor falhar alto. */
{
  const mentirosa = {
    nome: "mentirosa.jpg",
    tamanho: 999,
    abrir: async function* () {
      yield Buffer.from("só isto");
    },
  };
  try {
    await juntar(zipEmFluxo([mentirosa]));
    erro("tamanho diferente do declarado passou sem erro");
  } catch (e) {
    ok("foto que chega com tamanho diferente do banco é recusada", e.message);
  }
}

if (falhou) {
  console.error("\n✗ o zip em fluxo tem problema");
  process.exit(1);
}
console.log("\n✓ o zip em fluxo abre no Windows, com acento, pasta e ZIP64");
