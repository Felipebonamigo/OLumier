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

const {
  PROPORCAO_DEITADA,
  agruparEmFileiras,
  colunasDoItem,
  colunasQueCabem,
  ehDeitada,
  fileiraChegaNaBorda,
  fileirasDeColunas,
  fileirasPorAltura,
} = mod;

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
   densidade, toda foto valendo uma. Ver `fileirasDeColunas`. */
const colunasDe = (proporcoes, n, completa = true) => fileirasDeColunas(proporcoes.length, n, completa);
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

etapa("a deitada não empurra ninguém para a fileira seguinte", () => {
  /* A diferença para a Panorama: lá a deitada vale por duas e a fileira fica
     com menos fotos. Aqui ela conta como uma, e sai mais larga porque a
     fileira é justificada. */
  const p = Array.from({ length: 25 }, (_, i) => (i % 4 === 1 ? 16 / 9 : 2 / 3));
  const f = colunasDe(p, 5);
  igual(f.map((r) => r.length), [5, 5, 5, 5, 5], "25 fotos, 7 deitadas, 5 colunas");
  return "cinco fileiras de cinco";
});

/*
 * ── SEM ESPAÇO VAZIO NO FIM (26/09/2026) ──────────────────────────────────
 *
 * Felipe: "tente deixar sem espaçamento, é importante seguir a ordem". O
 * único vazio das fileiras era a última, curta, com a borda direita em branco.
 * A falta passou a ser repartida pelas últimas fileiras — 5 + 5 + 3 vira
 * 5 + 4 + 4 — e toda fileira chega à borda.
 */
etapa("nenhuma fileira curta no fim: toda fileira tem N ou N − 1 fotos", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    /* Da primeira galeria em que dá para repartir sem ninguém ficar com menos
       de N − 1 até uma de 300 fotos. */
    for (let q = n * (n - 1); q <= 300; q++) {
      const f = colunasDe(retratos(q), n);
      const fora = f.find((r) => r.length !== n && r.length !== n - 1);
      if (fora) throw new Error(`${q} fotos em ${n} colunas: uma fileira com ${fora.length}`);
      igual(f.flat(), Array.from({ length: q }, (_, i) => i), `${q} fotos em ${n} colunas, na ordem`);
    }
  }
  const exemplo = colunasDe(retratos(48), 5).map((r) => r.length).join(" + ");
  return `48 fotos em 5: ${exemplo}`;
});

etapa("galeria pequena reparte o que dá, o mais igual possível", () => {
  igual(colunasDe(retratos(7), 5).map((r) => r.length), [4, 3], "7 fotos, 5 colunas");
  igual(colunasDe(retratos(6), 5).map((r) => r.length), [3, 3], "6 fotos, 5 colunas");
  igual(colunasDe(retratos(3), 5).map((r) => r.length), [3], "3 fotos, 5 colunas");
});

etapa("capítulo de uma ou duas fotos não vira pôster", () => {
  /* Esticar até a borda deixa a foto `colunas ÷ fotos` vezes maior que numa
     fileira cheia. Até o dobro é o que o fim repartido e o capítulo pequeno
     pedem; uma foto sozinha em cinco colunas sairia cinco vezes maior — da
     largura da tela e mais alta que ela. */
  const casos = [
    [4, 5, true, "4 em 5: 25% maiores"],
    [3, 5, true, "3 em 5"],
    [2, 5, false, "2 em 5 seriam 2,5×"],
    [1, 5, false, "1 em 5 seria 5×"],
    [1, 2, true, "1 em 2, no celular: a foto inteira na largura, como no resto do celular"],
    [4, 8, true, "4 em 8"],
    [3, 8, false, "3 em 8"],
  ];
  for (const [fotos, n, esperado, rotulo] of casos) {
    if (fileiraChegaNaBorda(fotos, n) !== esperado) {
      throw new Error(`${rotulo}: esperava ${esperado ? "chegar" : "não chegar"} à borda`);
    }
  }
  /* Enquanto a galeria chega rolando, só fileira cheia estica. */
  if (fileiraChegaNaBorda(4, 5, false)) throw new Error("fim de lote esticado até a borda");
  if (!fileiraChegaNaBorda(5, 5, false)) throw new Error("fileira cheia deixou de chegar à borda");
});

etapa("galeria que ainda chega rolando: o lote novo não mexe no que já está na tela", () => {
  /* Enquanto vem mais, a última fileira fica curta de propósito. Se o fim
     fosse repartido, as fotos de baixo mudariam de fileira na frente da
     pessoa quando o próximo lote chegasse. */
  const antes = colunasDe(retratos(58), 5, false);
  const depois = colunasDe(retratos(90), 5, false);
  antes.slice(0, -1).forEach((r, k) => igual(depois[k], r, `fileira ${k} depois do lote`));
  igual(antes.at(-1).length, 3, "o fim do lote fica curto");
  return `${antes.length - 1} fileiras intactas quando o lote chega`;
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


console.log("\nLinhas: fileiras na altura-alvo, até a borda\n");

/* A "Linhas" desde 28/09/2026 — ver `fileirasPorAltura`. Os números são os do
   celular: 358 px úteis, altura-alvo 145 (compacta), respiro 4. */
const V = 2 / 3, H = 3 / 2, W = 2;
const LARG = 358, ALVO = 145, GAP = 4;
const alturas = (proporcoes, r) =>
  r.fileiras.map((f) => (LARG - GAP * (f.length - 1)) / f.reduce((t, i) => t + proporcoes[i], 0));

etapa("a vertical não fica sozinha antes de uma deitada — a barra branca do print", () => {
  /* O print do Felipe: a vertical sem vizinha cabendo ao lado crescia 2/3 da
     sobra (soma de flex-grow < 1) e o resto ficava branco. */
  const proporcoes = [V, W, V, V, V, W, H, V];
  const r = fileirasPorAltura(proporcoes, LARG, ALVO, GAP);
  for (const f of r.fileiras.slice(0, -1)) {
    if (f.length === 1 && proporcoes[f[0]] < 1) throw new Error(`vertical sozinha na fileira ${JSON.stringify(f)}`);
  }
  igual(r.fileiras[0], [0, 1], "primeira fileira");
  return r.fileiras.map((f) => `[${f.join(",")}]`).join(" ");
});

etapa("toda fileira do meio chega à borda, perto da altura-alvo", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let rodada = 0; rodada < 200; rodada++) {
    const proporcoes = Array.from({ length: 5 + Math.floor(rnd() * 80) }, () => [V, V, V, H, H, W, 1, 4 / 5, 3][Math.floor(rnd() * 9)]);
    const r = fileirasPorAltura(proporcoes, LARG, ALVO, GAP);
    alturas(proporcoes, r).slice(0, -1).forEach((a, f) => {
      if (a < ALVO / 2 || a > ALVO * 2) throw new Error(`rodada ${rodada}, fileira ${f}: altura ${a.toFixed(0)}`);
    });
  }
  return "200 galerias sortidas";
});

etapa("toda foto entra exatamente uma vez, na ordem", () => {
  const proporcoes = Array.from({ length: 41 }, (_, i) => [V, H, W, V, 1][i % 5]);
  igual(fileirasPorAltura(proporcoes, LARG, ALVO, GAP).fileiras.flat(), proporcoes.map((_, i) => i), "ordem");
});

etapa("o fim não deixa faixa branca: estica ou junta com a anterior", () => {
  /* Três verticais cabem numa fileira; a quarta sozinha no fim se junta à
     de cima em vez de virar um pôster ou deixar o resto da linha vazio. */
  const proporcoes = [V, V, V, V];
  const r = fileirasPorAltura(proporcoes, LARG, ALVO, GAP);
  igual(r.fileiras, [[0, 1, 2, 3]], "fileiras");
  igual(r.ultimaEstica, true, "a última estica");
  /* Duas deitadas fecham uma fileira; a vertical que sobra no fim entra nela
     (esticada sozinha ela teria 3,7 vezes a altura-alvo). */
  igual(fileirasPorAltura([H, H, V], LARG, ALVO, GAP), { fileiras: [[0, 1, 2]], ultimaEstica: true }, "junta");
});

etapa("capítulo de uma foto vertical fica na altura-alvo, e não do tamanho da tela", () => {
  const r = fileirasPorAltura([V], LARG, ALVO, GAP);
  igual(r, { fileiras: [[0]], ultimaEstica: false }, "uma vertical");
  igual(fileirasPorAltura([H, H], LARG, ALVO, GAP).ultimaEstica, true, "duas deitadas esticam");
});

etapa("enquanto a galeria ainda chega, só o fim do lote espera", () => {
  /* As fileiras de um lote são as mesmas depois que o resto chega — só a
     última muda. Senão a foto pularia de fileira na frente da pessoa. */
  const proporcoes = Array.from({ length: 60 }, (_, i) => [V, H, V, W, V, V, H][i % 7]);
  const inteiro = fileirasPorAltura(proporcoes, LARG, ALVO, GAP).fileiras;
  for (const corte of [10, 23, 37, 51]) {
    const lote = fileirasPorAltura(proporcoes.slice(0, corte), LARG, ALVO, GAP, false);
    igual(lote.ultimaEstica, false, `a última do lote de ${corte} não estica`);
    igual(lote.fileiras.slice(0, -1), inteiro.slice(0, lote.fileiras.length - 1), `lote de ${corte}`);
  }
});

etapa("antes de medir, uma foto por fileira; galeria vazia, nenhuma", () => {
  igual(fileirasPorAltura([V, H], 0, ALVO, GAP).fileiras, [[0], [1]], "sem largura");
  igual(fileirasPorAltura([], LARG, ALVO, GAP).fileiras, [], "vazia");
});

console.log(falhou ? "\n✗ mural com falha\n" : "\n✓ mural ok\n");
process.exit(falhou ? 1 : 0);
