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

const { PROPORCAO_DEITADA, agruparEmFileiras, colunasDoItem, colunasQueCabem, ehDeitada } = mod;

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

console.log("\nColunas: fileiras na ordem\n");

/* A grade "Colunas" desde 26/09/2026: fileiras de N fotos, N = colunas da
   densidade, toda foto valendo uma. Ver `lib/grade-mural.ts`. */
const colunasDe = (proporcoes, n) => agruparEmFileiras(proporcoes, n, false);
const retratos = (q) => Array.from({ length: q }, () => 2 / 3);

etapa("a primeira fileira é 1, 2, 3 — e não 1, 11, 21", () => {
  /* O defeito de 04/09: o `column-width` do CSS punha a foto 21 no topo da
     terceira coluna. */
  const f = colunasDe(retratos(30), 3);
  igual(f[0], [0, 1, 2], "primeira fileira");
  return `primeira fileira: ${f[0].join(", ")}`;
});

etapa("a foto do FIM nunca aparece no topo", () => {
  for (const n of [2, 3, 4, 5]) {
    const f = colunasDe(Array.from({ length: 30 }, (_, i) => (i % 3 ? 2 / 3 : 3 / 2)), n);
    igual(f[0], Array.from({ length: n }, (_, i) => i), `primeira fileira com ${n} colunas`);
  }
  return "conferido de 2 a 5 colunas";
});

etapa("toda foto entra exatamente uma vez, na ordem", () => {
  for (const [q, n] of [[30, 3], [7, 4], [1, 3], [12, 1], [0, 3]]) {
    const plano = colunasDe(retratos(q), n).flat();
    igual(plano, Array.from({ length: q }, (_, i) => i), `${q} fotos em ${n} colunas`);
  }
});

etapa("toda fileira tem exatamente N fotos — a deitada não empurra ninguém", () => {
  /* A diferença para a Panorama: lá a deitada vale por duas e a fileira fica
     com menos fotos. Aqui a fileira é sempre do tamanho que a densidade
     prometeu, e a deitada sai mais larga porque a fileira é justificada. */
  const p = Array.from({ length: 23 }, (_, i) => (i % 4 === 1 ? 16 / 9 : 2 / 3));
  const f = colunasDe(p, 5);
  f.slice(0, -1).forEach((fileira, k) => igual(fileira.length, 5, `fileira ${k}`));
  igual(f.at(-1).length, 3, "a última, com o que sobrou");
  return `${f.length} fileiras de 5, a última com 3`;
});

etapa("menos fotos que colunas: uma fileira só, com o que tem", () => {
  igual(colunasDe(retratos(2), 4), [[0, 1]], "duas fotos, quatro colunas");
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

/* ── A ORDEM QUE O OLHO LÊ (26/09/2026) ───────────────────────────────────
 *
 * Juan, com o print numerado à mão: "era pra ser 1 2 3 4 5, mas está 2 - 1 -
 * 4 - 5 - 3". Felipe: "não pode trocar, ele tem que seguir a ordem".
 *
 * O mural de colunas desempatava pela coluna mais curta, e nenhuma regra
 * daquele desenho zerava as trocas — em galerias sortidas lia 35 de cada 100
 * pares seguidos ao contrário, e a melhor variante ainda 17. Em fileira
 * justificada todas as fotos de uma fileira começam na mesma altura, então a
 * leitura é a ordem da fileira, e a fileira é um trecho contínuo da galeria.
 *
 * A etapa mede como o olho lê: posição = (fileira, lugar na fileira), e confere
 * que isso dá a sequência exata, em galerias com a mistura de verdade.
 */
console.log("\nA ordem que o olho lê\n");

function galeriasSortidas() {
  let s = 11;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const saida = [];
  for (const deitadas of [0.1, 0.25, 0.5]) {
    for (const colunas of [2, 3, 4, 5, 6]) {
      for (let g = 0; g < 12; g++) {
        const tam = 60 + Math.floor(rnd() * 240);
        const p = [];
        while (p.length < tam) {
          const nominal = rnd() < deitadas ? (rnd() < 0.5 ? 3 / 2 : 16 / 9) : rnd() < 0.8 ? 2 / 3 : 4 / 5;
          const x = nominal * (1 + (rnd() - 0.5) * 0.006);
          p.push(x);
          if (rnd() < 0.5) p.push(x); // a PB, mesma exportação
        }
        saida.push({ p, colunas });
      }
    }
  }
  return saida;
}

etapa("o print do Juan sai 1, 2, 3, 4, 5", () => {
  /* A fileira de cima do print tinha alturas desencontradas — era isso que o
     mural usava para decidir a coluna. Em fileira, altura não decide nada. */
  const p = [0.85, 0.5, 0.5, 0.5, 0.87, 2 / 3, 2 / 3, 2 / 3, 2 / 3, 2 / 3];
  const f = colunasDe(p, 5);
  const lugar = new Map();
  f.forEach((fileira, r) => fileira.forEach((i, k) => lugar.set(i, [r, k])));
  const lidas = [5, 6, 7, 8, 9].sort((a, b) => {
    const [ra, ka] = lugar.get(a), [rb, kb] = lugar.get(b);
    return ra - rb || ka - kb;
  });
  const comoSeLe = lidas.map((i) => i - 4).join(" - ");
  if (comoSeLe !== "1 - 2 - 3 - 4 - 5") throw new Error(`lido como ${comoSeLe}`);
  return comoSeLe;
});

etapa("em nenhuma galeria sortida um par sai lido ao contrário", () => {
  let fotos = 0;
  for (const { p, colunas } of galeriasSortidas()) {
    const lidas = colunasDe(p, colunas).flat();
    for (let i = 0; i < lidas.length; i++) {
      if (lidas[i] !== i) throw new Error(`com ${colunas} colunas, a ${i + 1}ª lida é a foto ${lidas[i] + 1}`);
    }
    fotos += p.length;
  }
  return `${fotos} fotos em ${galeriasSortidas().length} galerias, todas na ordem`;
});

/* ── AS FILEIRAS DO PANORAMA ─────────────────────────────────────────────── */
console.log("\nPanorama: fileiras cheias\n");

etapa("nenhuma fileira passa da largura da tela", () => {
  const proporcoes = Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? 16 / 9 : 2 / 3));
  for (const colunas of [1, 2, 3, 4, 5]) {
    for (const fileira of agruparEmFileiras(proporcoes, colunas)) {
      const unidades = fileira.reduce((t, i) => t + colunasDoItem(proporcoes[i], colunas), 0);
      if (unidades > colunas) {
        throw new Error(`fileira de ${unidades} unidades com ${colunas} colunas`);
      }
    }
  }
  return "conferido de 1 a 5 colunas";
});

etapa("toda foto entra em exatamente uma fileira, na ordem", () => {
  const proporcoes = Array.from({ length: 37 }, (_, i) => (i % 3 === 0 ? 3 / 2 : 2 / 3));
  const plano = agruparEmFileiras(proporcoes, 4).flat();
  igual(plano, Array.from({ length: 37 }, (_, i) => i), "ordem preservada");
});

etapa("só a última fileira pode vir incompleta", () => {
  /* É o que impede o vão no meio da galeria — a deitada que não cabia era
     empurrada para a fileira seguinte e deixava o buraco para trás. */
  const proporcoes = Array.from({ length: 21 }, (_, i) => (i % 5 === 0 ? 16 / 9 : 2 / 3));
  const fileiras = agruparEmFileiras(proporcoes, 4);
  fileiras.slice(0, -1).forEach((fileira, f) => {
    const unidades = fileira.reduce((t, i) => t + colunasDoItem(proporcoes[i], 4), 0);
    if (unidades !== 4) throw new Error(`fileira ${f} fechou com ${unidades} de 4 unidades`);
  });
  return `${fileiras.length} fileiras`;
});

etapa("galeria vazia não inventa fileira", () => {
  igual(agruparEmFileiras([], 4), [], "nenhuma foto");
});

console.log(falhou ? "\n✗ mural com falha\n" : "\n✓ mural ok\n");
process.exit(falhou ? 1 : 0);
