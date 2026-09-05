#!/usr/bin/env node
/**
 * A ordem das fotos no mural, e o modo que valoriza a foto deitada. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *        scripts/testar-grade-mural.mjs
 *
 * Não fala com banco nem com servidor: é matemática de layout.
 *
 * ── O DEFEITO QUE ISTO PRENDE (04/09/2026) ─────────────────────────────────
 *
 * O sócio: "o formato coluna está confuso, fotos do fim aparecerem bem em
 * cima". Está certo, e a causa é o CSS. A grade "colunas" usava `column-width`,
 * e multi-column do CSS preenche uma coluna INTEIRA antes de começar a
 * seguinte. Com 30 fotos em 3 colunas, as fotos 1–10 ficam na primeira, 11–20
 * na segunda, e a **21 aparece no topo da terceira** — bem em cima, como ele
 * disse.
 *
 * A ordem que a pessoa espera é de linha: 1, 2, 3 na primeira fileira. É isso
 * que `distribuirEmColunas` faz, e é a razão de ela existir como função pura:
 * a distribuição é a regra do produto, e regra do produto se testa.
 *
 * ── E O MODO "PANORAMA" ────────────────────────────────────────────────────
 *
 * "Ter um modo de organização que a foto horizontal seja mais valorizada."
 * Foto deitada passa a ocupar duas colunas. A regra tem um porém que este
 * arquivo prende: quando só cabe UMA coluna (celular), ninguém pode ocupar
 * duas — o item estouraria a largura da tela.
 */
import * as mod from "../src/lib/grade-mural.ts";
import { DENSIDADES, LARGURA_DA_FOTO as LARGURA } from "../src/config/aparencia.ts";

const { PROPORCAO_DEITADA, colunasDoItem, colunasQueCabem, distribuirEmColunas, ehDeitada } = mod;

let falhou = false;
function etapa(nome, fn) {
  try {
    const d = fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
  if (x !== y) throw new Error(`${o}: esperava ${y}, veio ${x}`);
};

console.log("\nMural: ordem e foto deitada\n");

etapa("a primeira fileira é 1, 2, 3 — e não 1, 11, 21", () => {
  const cols = distribuirEmColunas(30, 3);
  igual(cols.length, 3, "quantas colunas");
  /* O topo de cada coluna é o que a pessoa vê primeiro, da esquerda para a
   * direita. Com o CSS antigo isto dava [0, 10, 20]. */
  igual(
    cols.map((c) => c[0]),
    [0, 1, 2],
    "topo das colunas",
  );
  return `topos: ${cols.map((c) => c[0]).join(", ")}`;
});

etapa("a foto do FIM nunca aparece no topo", () => {
  for (const n of [2, 3, 4, 5]) {
    const cols = distribuirEmColunas(30, n);
    for (const topo of cols.map((c) => c[0])) {
      if (topo >= n) throw new Error(`com ${n} colunas, a foto ${topo + 1} está no topo`);
    }
  }
  return "conferido de 2 a 5 colunas";
});

etapa("toda foto entra exatamente uma vez, na ordem", () => {
  for (const [q, n] of [[30, 3], [7, 4], [1, 3], [12, 1], [0, 3]]) {
    const cols = distribuirEmColunas(q, n);
    const todas = cols.flat().sort((a, b) => a - b);
    igual(todas, Array.from({ length: q }, (_, i) => i), `${q} fotos em ${n} colunas`);
    for (const c of cols) {
      /* Dentro da coluna a ordem tem de ser crescente: é o que faz a leitura
       * continuar de cima para baixo dentro de cada fileira. */
      for (let k = 1; k < c.length; k++) {
        if (c[k] <= c[k - 1]) throw new Error(`coluna fora de ordem: ${c}`);
      }
    }
  }
});

etapa("menos fotos que colunas não cria coluna vazia no meio", () => {
  const cols = distribuirEmColunas(2, 4);
  igual(cols.map((c) => c.length), [1, 1], "colunas usadas");
});

etapa("quantas colunas cabem", () => {
  /* 1200 de largura, alvo 230, gap 12: (1200+12) / (230+12) = 5,0 */
  igual(colunasQueCabem(1200, 230, 12), 5, "notebook");
  igual(colunasQueCabem(390, 230, 12), 1, "celular");
  /* Nunca zero: com zero, não se desenha nada. */
  igual(colunasQueCabem(0, 230, 12), 1, "antes de medir");
  igual(colunasQueCabem(100, 230, 12), 1, "mais estreito que uma foto");
});

etapa("deitada é a partir de 1,3 de proporção", () => {
  igual(ehDeitada(3 / 2), true, "3:2 paisagem");
  igual(ehDeitada(16 / 9), true, "16:9");
  igual(ehDeitada(1), false, "quadrada");
  igual(ehDeitada(2 / 3), false, "retrato");
  igual(ehDeitada(PROPORCAO_DEITADA), true, "exatamente no limite");
  igual(ehDeitada(PROPORCAO_DEITADA - 0.01), false, "logo abaixo");
});

etapa("no panorama, a deitada ocupa duas colunas", () => {
  igual(colunasDoItem(3 / 2, 4), 2, "deitada com 4 colunas");
  igual(colunasDoItem(2 / 3, 4), 1, "retrato com 4 colunas");
});

etapa("com UMA coluna, ninguém ocupa duas — senão estoura a tela do celular", () => {
  igual(colunasDoItem(16 / 9, 1), 1, "deitada no celular");
  igual(colunasDoItem(2 / 3, 1), 1, "retrato no celular");
});

/*
 * ── O CELULAR E O MONITOR (05/09/2026) ────────────────────────────────────
 *
 * Juan: "achei ruim a visualização no celular só ficar boa quando está em
 * 'compacta'. No pc fica MUITA informação e no celular fica 2 colunas de fotos.
 * Daí se bota o tamanho do outro jeito, no celular fica só uma foto por vez."
 *
 * A conta explica os dois lados. A largura-alvo por foto era um número fixo por
 * densidade (170 / 230 / 320 px), e num iPhone sobram ~366 px de largura útil:
 *
 *   compacta  (366+4)  / 174 = 2 colunas
 *   normal    (366+8)  / 238 = 1 coluna
 *   arejada   (366+20) / 340 = 1 coluna
 *
 * Do outro lado, num notebook de 1280 sobram ~1232, e a compacta dá SETE
 * colunas — a "muita informação" que ele viu.
 *
 * Uma largura-alvo só não serve para as duas pontas. O piso e o teto de colunas
 * servem: o piso salva o celular, o teto salva o monitor, e a largura-alvo
 * continua mandando no meio, que é onde ela acerta.
 */
const { colunasDaGrade } = mod;
const CELULAR = 366; // iPhone comum, descontada a margem da página
const NOTEBOOK = 1232; // 1280 menos a margem

etapa("no celular, nenhuma densidade cai para uma foto por vez", () => {
  for (const [nome, { gapPx, minColunas, maxColunas }] of Object.entries(DENSIDADES)) {
    const n = colunasDaGrade(CELULAR, LARGURA[nome], gapPx, minColunas, maxColunas);
    if (n < 2) throw new Error(`${nome} deu ${n} coluna no celular`);
  }
});

etapa("no notebook, a compacta para de virar parede de fotos", () => {
  const n = colunasDaGrade(NOTEBOOK, LARGURA.compacta, DENSIDADES.compacta.gapPx, DENSIDADES.compacta.minColunas, DENSIDADES.compacta.maxColunas);
  if (n > 6) throw new Error(`compacta deu ${n} colunas num notebook`);
  if (n < 4) throw new Error(`compacta deu só ${n} colunas — deixou de ser compacta`);
});

etapa("a densidade continua significando algo: mais arejada, menos colunas", () => {
  const cols = (nome, w) =>
    colunasDaGrade(w, LARGURA[nome], DENSIDADES[nome].gapPx, DENSIDADES[nome].minColunas, DENSIDADES[nome].maxColunas);
  for (const w of [CELULAR, 768, NOTEBOOK, 1600]) {
    if (!(cols("compacta", w) >= cols("normal", w) && cols("normal", w) >= cols("arejada", w))) {
      throw new Error(
        `em ${w}px: compacta ${cols("compacta", w)}, normal ${cols("normal", w)}, arejada ${cols("arejada", w)}`,
      );
    }
  }
});

console.log(falhou ? "\n✗ mural com falha\n" : "\n✓ mural ok\n");
process.exit(falhou ? 1 : 0);
