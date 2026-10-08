#!/usr/bin/env node
/**
 * ESCOLHER A CENA DA CAPA DE UM FILME (08/10/2026). Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs scripts/testar-cena-do-filme.mjs
 *
 * Juan: "existe a opção de a pessoa selecionar uma cena do próprio vídeo para
 * ser a capa? Ou um 'selecionar cena aleatória do vídeo'". O que isto prende:
 *
 *   1. O SORTEIO nunca cai nas pontas (letreiro, tela preta, créditos).
 *   2. O instante é preso dentro do filme.
 *   3. A janela e o componente da capa estão ligados: filme abre a janela,
 *      imagem sobe direto, e a duração do filme vence a da imagem.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const fonte = (arq) => readFileSync(path.join(RAIZ, arq), "utf8");
const { sortearCena, limitarCena, cenaInicial, MARGEM_DO_SORTEIO } = await import("../src/lib/cena-do-filme.ts");

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const d = fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
};
const perto = (a, b) => Math.abs(a - b) < 1e-9;

console.log("Cena da capa do filme:\n");

etapa("o sorteio fica entre 5% e 95% do filme, em qualquer sorte", () => {
  const d = 600;
  if (!perto(sortearCena(d, 0), d * MARGEM_DO_SORTEIO)) throw new Error("sorte 0 não parou na margem");
  if (!perto(sortearCena(d, 1), d * (1 - MARGEM_DO_SORTEIO))) throw new Error("sorte 1 passou da margem");
  if (!perto(sortearCena(d, 0.5), d / 2)) throw new Error("sorte 0,5 não caiu no meio");
  for (let i = 0; i < 2000; i++) {
    const t = sortearCena(d);
    if (t < d * MARGEM_DO_SORTEIO - 1e-9 || t > d * (1 - MARGEM_DO_SORTEIO) + 1e-9) throw new Error(`caiu na ponta: ${t}`);
  }
  if (sortearCena(d, -3) < d * MARGEM_DO_SORTEIO - 1e-9) throw new Error("sorte negativa vazou");
  if (sortearCena(d, 9) > d * (1 - MARGEM_DO_SORTEIO) + 1e-9) throw new Error("sorte acima de 1 vazou");
});

etapa("sem duração conhecida, o sorteio não inventa um instante", () => {
  for (const d of [0, -5, NaN, Infinity]) {
    const t = sortearCena(d, 0.5);
    if (t !== 0) throw new Error(`duração ${d} deu ${t}`);
  }
});

etapa("o instante é preso dentro do filme", () => {
  if (limitarCena(-4, 100) !== 0) throw new Error("passou do começo");
  if (limitarCena(250, 100) !== 100) throw new Error("passou do fim");
  if (limitarCena(42, 100) !== 42) throw new Error("mexeu num instante válido");
  if (limitarCena(NaN, 100) !== 0) throw new Error("NaN não virou zero");
  if (!perto(cenaInicial(300), 30)) throw new Error(`cena inicial ${cenaInicial(300)}`);
});

etapa("a capa: filme abre a janela, imagem sobe direto, a duração do filme vence", () => {
  const capa = fonte("src/components/capa-de-video.tsx");
  if (!capa.includes("EscolherCena")) throw new Error("a capa não usa a janela");
  if (!/reconhecerArquivo\(arquivo\.name, arquivo\.type\)\?\.tipo === "video"/.test(capa)) {
    throw new Error("o tipo do arquivo não decide entre janela e envio direto");
  }
  if (!capa.includes("duracaoDoFilme ?? derivadas.duracao")) throw new Error("a duração do filme não vence a da imagem");
  if (!capa.includes("aoAutomatico")) throw new Error("sumiu a saída do quadro automático");
  if (!capa.includes("URL.revokeObjectURL")) throw new Error("o endereço local do filme nunca é revogado");
});

etapa("a janela tem as três saídas e a conferência do quadro vazio", () => {
  const j = fonte("src/components/escolher-cena.tsx");
  for (const texto of ["Usar esta cena", "Cena aleatória", "Quadro automático", "Cancelar"]) {
    if (!j.includes(texto)) throw new Error(`falta o botão «${texto}»`);
  }
  if (!j.includes("quadroTemImagem")) throw new Error("não confere o quadro vazio (o Safari já devolveu transparente)");
  if (!j.includes('role="dialog"') || !j.includes('aria-modal="true"')) throw new Error("não é uma janela acessível");
  if (!j.includes("PRAZO_PARA_ABRIR_MS")) throw new Error("filme que nunca abre deixaria a janela esperando para sempre");
});

console.log(falhou ? "\n✗ cena do filme com falha" : "\n✓ cena do filme ok");
process.exit(falhou ? 1 : 0);
