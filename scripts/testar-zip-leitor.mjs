#!/usr/bin/env node
/**
 * O leitor de ZIP do navegador (`lib/zip-leitor.ts`). Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-zip-leitor.mjs
 *
 * ── POR QUE OS ZIPS VÊM DE FORA ───────────────────────────────────────────
 *
 * O mesmo aviso do `testar-zip-em-fluxo.mjs`, do outro lado: um leitor que só
 * lê o ZIP do nosso próprio escritor não prova nada — eu erraria o formato nas
 * duas pontas do mesmo jeito. Os ZIPs daqui saem do `zip` (Info-ZIP, o que o
 * Linux e muito servidor usam) e do `zipfile` do Python, que escrevem
 * compressão, ZIP64 e nome UTF-8 cada um do seu jeito. O nosso escritor entra
 * também, porque é o único que usa descritor de dados depois dos bytes.
 *
 * O juiz é o conteúdo: cada arquivo que sai do ZIP é comparado byte a byte com
 * o que entrou.
 *
 * O arquivo é lido com `openAsBlob`, que é um Blob apoiado no disco — o mesmo
 * que o navegador entrega num `File`. Nada do ZIP é carregado inteiro.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, openAsBlob, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import { lerZip, ZipIlegivel, ehZip } from "../src/lib/zip-leitor.ts";
import { zipEmFluxo } from "../src/lib/zip-em-fluxo.ts";

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

const pasta = mkdtempSync(path.join(tmpdir(), "zip-leitor-"));
const origem = path.join(pasta, "origem");

/* O conteúdo: uma "foto" que não comprime (bytes aleatórios, como JPEG) e um
   arquivo que comprime muito — senão o deflate nem é exercitado. */
const ARQUIVOS = {
  "Ana e Pedro/01 Making Of/IMG_0001.jpg": randomBytes(300_000),
  "Ana e Pedro/02 Cerimônia/IMG_0002.jpg": randomBytes(120_000),
  "Ana e Pedro/02 Cerimônia/leia.txt": Buffer.from("cerimônia ".repeat(20_000)),
  "Ana e Pedro/solta.jpg": randomBytes(1_000),
};
for (const [caminho, bytes] of Object.entries(ARQUIVOS)) {
  mkdirSync(path.join(origem, path.dirname(caminho)), { recursive: true });
  writeFileSync(path.join(origem, caminho), bytes);
}
/* O lixo que o Mac põe em todo ZIP — tem de ficar de fora. */
writeFileSync(path.join(origem, "Ana e Pedro", ".DS_Store"), "lixo");

function rodar(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} falhou: ${r.stderr || r.stdout}`);
}

/** Lê o ZIP e confere que TODO arquivo esperado saiu idêntico, e nada a mais. */
async function conferir(arquivoZip, esperado = ARQUIVOS) {
  const { entradas, recusadas } = await lerZip(await openAsBlob(arquivoZip));
  if (recusadas.length) throw new Error(`recusou: ${recusadas.map((r) => r.caminho).join(", ")}`);

  const nomes = entradas.map((e) => e.caminho).sort();
  const quer = Object.keys(esperado).sort();
  if (JSON.stringify(nomes) !== JSON.stringify(quer)) {
    throw new Error(`entradas: esperado ${JSON.stringify(quer)}, veio ${JSON.stringify(nomes)}`);
  }
  for (const e of entradas) {
    const bytes = Buffer.from(await (await e.abrir()).arrayBuffer());
    if (e.tamanho !== esperado[e.caminho].length) throw new Error(`${e.caminho}: tamanho no índice errado`);
    if (!bytes.equals(esperado[e.caminho])) throw new Error(`${e.caminho}: conteúdo diferente`);
  }
  return `${entradas.length} arquivos idênticos`;
}

console.log("Leitor de ZIP:\n");

await etapa("zip do Info-ZIP, comprimido (deflate)", async () => {
  const z = path.join(pasta, "infozip-deflate.zip");
  rodar("zip", ["-r", "-q", "-9", z, "Ana e Pedro"], origem);
  return conferir(z);
});

await etapa("zip do Info-ZIP, guardado sem compressão", async () => {
  const z = path.join(pasta, "infozip-guardado.zip");
  rodar("zip", ["-r", "-q", "-0", z, "Ana e Pedro"], origem);
  return conferir(z);
});

/* O Python escreve o ZIP64 do jeito dele: campo extra só com o que precisa, e
   os registros de fim de 64 bits. `force_zip64` faz isso sem gerar 4 GB. */
const PY = `
import zipfile, sys, os
destino, raiz, metodo = sys.argv[1], sys.argv[2], sys.argv[3]
comp = zipfile.ZIP_DEFLATED if metodo == "deflate" else zipfile.ZIP_STORED
with zipfile.ZipFile(destino, "w", compression=comp, allowZip64=True) as z:
    for pasta, _, arquivos in os.walk(raiz):
        for a in sorted(arquivos):
            if a.startswith("."):
                continue
            completo = os.path.join(pasta, a)
            nome = os.path.relpath(completo, raiz).replace(os.sep, "/")
            with open(completo, "rb") as f, z.open(nome, "w", force_zip64=True) as d:
                d.write(f.read())
`;

await etapa("zip do Python com ZIP64 e nome em UTF-8, comprimido", async () => {
  const z = path.join(pasta, "python-zip64.zip");
  rodar("python3", ["-c", PY, z, origem, "deflate"]);
  return conferir(z);
});

await etapa("zip do Python com ZIP64, guardado", async () => {
  const z = path.join(pasta, "python-zip64-guardado.zip");
  rodar("python3", ["-c", PY, z, origem, "guardado"]);
  return conferir(z);
});

async function doNossoEscritor(destino, opcoes) {
  const lista = Object.entries(ARQUIVOS).map(([nome, bytes]) => ({
    nome,
    tamanho: bytes.length,
    abrir: async function* () {
      yield bytes;
    },
  }));
  const partes = [];
  for await (const p of zipEmFluxo(lista, opcoes)) partes.push(Buffer.from(p));
  writeFileSync(destino, Buffer.concat(partes));
}

await etapa("zip do nosso escritor (descritor depois dos bytes)", async () => {
  const z = path.join(pasta, "nosso.zip");
  await doNossoEscritor(z);
  return conferir(z);
});

await etapa("zip do nosso escritor com ZIP64 forçado", async () => {
  const z = path.join(pasta, "nosso-64.zip");
  await doNossoEscritor(z, { limiteZip64: 1000 });
  return conferir(z);
});

await etapa("pastas e lixo do Mac (__MACOSX, .DS_Store) ficam de fora", async () => {
  const z = path.join(pasta, "mac.zip");
  rodar("zip", ["-r", "-q", z, "Ana e Pedro"], origem);
  mkdirSync(path.join(origem, "__MACOSX"), { recursive: true });
  writeFileSync(path.join(origem, "__MACOSX", "._IMG_0001.jpg"), "recurso do mac");
  rodar("zip", ["-r", "-q", z, "__MACOSX"], origem);
  rmSync(path.join(origem, "__MACOSX"), { recursive: true });
  return conferir(z);
});

await etapa("arquivo com senha é RECUSADO pelo nome, não some calado", async () => {
  const z = path.join(pasta, "senha.zip");
  rodar("zip", ["-q", "-P", "segredo", z, "Ana e Pedro/solta.jpg"], origem);
  const { entradas, recusadas } = await lerZip(await openAsBlob(z));
  if (entradas.length !== 0) throw new Error("entrou arquivo com senha");
  if (recusadas[0]?.caminho !== "Ana e Pedro/solta.jpg") throw new Error("não disse qual");
  return recusadas[0].motivo;
});

await etapa("ZIP cortado (download que não terminou) vira recado, não travamento", async () => {
  const inteiro = readFileSync(path.join(pasta, "infozip-guardado.zip"));
  const z = path.join(pasta, "cortado.zip");
  writeFileSync(z, inteiro.subarray(0, Math.floor(inteiro.length / 2)));
  try {
    await lerZip(await openAsBlob(z));
  } catch (e) {
    if (e instanceof ZipIlegivel) return e.message;
    throw e;
  }
  throw new Error("leu um ZIP cortado como se estivesse inteiro");
});

await etapa("arquivo que não é ZIP vira recado", async () => {
  const z = path.join(pasta, "foto.zip");
  writeFileSync(z, randomBytes(5000));
  try {
    await lerZip(await openAsBlob(z));
  } catch (e) {
    if (e instanceof ZipIlegivel) return e.message;
    throw e;
  }
  throw new Error("aceitou bytes aleatórios como ZIP");
});

await etapa("reconhece ZIP pela extensão quando o navegador não dá o mime", () => {
  if (!ehZip({ name: "Ana e Pedro.ZIP", type: "" })) throw new Error("não reconheceu .ZIP");
  if (ehZip({ name: "foto.jpg", type: "image/jpeg" })) throw new Error("achou que JPG é ZIP");
});

rmSync(pasta, { recursive: true, force: true });

console.log(falhou ? "\nFALHOU" : "\nOK");
process.exit(falhou ? 1 : 0);
