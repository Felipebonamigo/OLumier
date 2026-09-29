#!/usr/bin/env node
/**
 * CAPA DE VÍDEO EM BRANCO NÃO É CAPA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-quadro-em-branco.mjs
 *
 * Suíte PURA: a decisão "este quadro tem imagem?" é aritmética sobre pixels, e
 * mora numa função que roda sem navegador. O resto de `quadroDoVideo` (o
 * <video>, o seek, o canvas) só existe no navegador e é conferido por leitura
 * da fonte, lá embaixo.
 *
 * ── O QUE FOI MEDIDO, E QUE NINGUÉM TINHA MEDIDO (29/09/2026) ─────────────
 *
 * Juan, com um print: "os vídeos não tem uma visualização, uma capa, eles ficam
 * assim" — dois ladrilhos vazios com um botão de play.
 *
 * O primeiro diagnóstico foi que faltava a miniatura, e havia um defeito real
 * ali (o mime vazio, commit de15fc0). Mas ele explicava DOIS vídeos. Baixando
 * as 46 capas de vídeo de produção e comparando o conteúdo:
 *
 *     46 vídeos · 2 sem capa nenhuma
 *     40 com a MESMA capa, byte a byte: 4.195 B, PNG 360×640, transparente
 *      1 com outra quase idêntica: 4.194 B
 *      3 com capa de verdade (375 KB, 465 KB, 484 KB)
 *
 * Quarenta e um de quarenta e seis com a mesma imagem em branco, em três
 * estúdios diferentes. A capa existia, estava gravada, e era vazia.
 *
 * A assinatura diz de onde veio: são PNG com chave `.webp`. O gerador pede
 * `canvas.toBlob(…, "image/webp")`, e o Safari antigo não codifica webp — cai
 * para PNG em silêncio. Ou seja, foram gerados no iPhone, onde
 * `createImageBitmap(<video>)` devolve quadro vazio.
 *
 * São dois erros somados, e este arquivo prende os dois:
 *
 *   1. tirar o quadro por um caminho que o Safari não honra;
 *   2. NÃO CONFERIR se o quadro tem imagem antes de guardá-lo. Este é o pior:
 *      sem a conferência, qualquer falha de decodificação vira uma capa branca
 *      gravada como se tivesse dado certo — e ninguém descobre, porque a tela
 *      mostra um ladrilho, não um erro.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { quadroTemImagem } from "../src/lib/derivadas-client.ts";

const RAIZ = path.resolve(import.meta.dirname, "..");

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const extra = fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    falhou = true;
    console.error(`  ✗ ${nome} — ${e.message}`);
  }
};

/** `n` pixels RGBA iguais a `cor`. */
const uniforme = (n, cor) => {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) d.set(cor, i * 4);
  return d;
};

console.log("O quadro do vídeo tem imagem?\n");

etapa("quadro totalmente transparente é recusado", () => {
  /* É EXATAMENTE o caso de produção: alfa zero em todos os pixels, que é o que
     o Safari devolve quando não decodificou o vídeo. */
  if (quadroTemImagem(uniforme(256, [0, 0, 0, 0]))) {
    throw new Error("um quadro transparente passou — é a capa em branco de 41 vídeos");
  }
  return "alfa zero";
});

etapa("quadro de uma cor só é recusado", () => {
  /*
   * Preto chapado é o segundo caso comum: vídeo que abre em fade. Uma capa
   * preta não é melhor do que capa nenhuma — some do mesmo jeito na grade —, e
   * guardá-la impede a tentativa no segundo seguinte.
   */
  for (const cor of [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
    [17, 17, 17, 255],
  ]) {
    if (quadroTemImagem(uniforme(256, cor))) {
      throw new Error(`a cor chapada ${cor.join(",")} passou`);
    }
  }
  return "preto, branco e cinza";
});

etapa("quadro com imagem de verdade passa", () => {
  const d = uniforme(256, [10, 10, 10, 255]);
  /* Um único pixel claro no meio do escuro já é imagem: é assim que um quadro
     noturno legítimo se parece, e recusá-lo jogaria fora capa boa. */
  d.set([200, 190, 180, 255], 128 * 4);
  if (!quadroTemImagem(d)) throw new Error("um quadro com conteúdo foi recusado");
  return "1 pixel diferente basta";
});

etapa("ruído de compressão não conta como imagem", () => {
  /*
   * O contrário do caso acima, e o que separa esta função de um `!==` ingênuo:
   * um quadro "preto" real não é 0,0,0 em todo pixel — tem ±2 de ruído. Se
   * qualquer diferença contasse, a conferência nunca recusaria nada e a capa
   * branca voltaria pela porta dos fundos.
   */
  const d = uniforme(256, [0, 0, 0, 255]);
  for (let i = 0; i < 256; i++) d[i * 4] = i % 3; // 0, 1 ou 2 no vermelho
  if (quadroTemImagem(d)) throw new Error("ruído de ±2 passou como imagem");
  return "±2 ainda é chapado";
});

etapa("dados vazios não quebram", () => {
  if (quadroTemImagem(new Uint8ClampedArray(0))) throw new Error("array vazio passou");
  return "recusa";
});

/* ── A outra metade: o caminho de extração ──────────────────────────────── */
const semComentarios = (f) =>
  f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const fonte = semComentarios(readFileSync(path.join(RAIZ, "src/lib/derivadas-client.ts"), "utf8"));

etapa("o quadro não sai mais de `createImageBitmap` sobre o <video>", () => {
  /*
   * É o caminho que o Safari não honra. Desenhar num canvas com `drawImage` é
   * o jeito antigo e universalmente suportado — e é de um canvas que o bitmap
   * passa a nascer.
   */
  if (/createImageBitmap\(\s*v\s*\)/.test(fonte)) {
    throw new Error("ainda tira o bitmap direto do elemento <video>");
  }
  if (!/drawImage\(\s*v\s*,/.test(fonte)) {
    throw new Error("não desenha o vídeo num canvas — não há de onde ler os pixels");
  }
  return "drawImage num canvas";
});

etapa("o gerador confere o quadro antes de devolvê-lo", () => {
  if (!/quadroTemImagem\(/.test(fonte)) {
    throw new Error("nada confere se o quadro tem imagem — a capa branca volta");
  }
  return "confere";
});

etapa("tenta mais de um segundo antes de desistir", () => {
  /*
   * Um vídeo que abre em fade tem o segundo 1 preto de verdade. Desistir ali
   * entregaria "sem capa" para um filme perfeitamente bom — então o gerador
   * tenta outros pontos antes de dizer não.
   */
  const segundos = fonte.match(/SEGUNDOS_DO_POSTER\s*=\s*\[([^\]]*)\]/)?.[1];
  if (!segundos) throw new Error("não há lista de tentativas (SEGUNDOS_DO_POSTER)");
  const quantos = segundos.split(",").filter((s) => s.trim()).length;
  if (quantos < 2) throw new Error(`só ${quantos} tentativa(s)`);
  return `${quantos} tentativas`;
});

console.log(falhou ? "\n✗ a capa em branco ainda passa" : "\n✓ quadro em branco recusado");
process.exitCode = falhou ? 1 : 0;
