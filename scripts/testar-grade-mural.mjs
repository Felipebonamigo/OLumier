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
  EMPATE_VISUAL,
  PROPORCAO_DEITADA,
  agruparEmFileiras,
  colunasDoItem,
  colunasQueCabem,
  distribuirEmColunas,
  ehDeitada,
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

/* ── O RODAPÉ DAS COLUNAS (16/09/2026) ────────────────────────────────────
 *
 * Felipe, com a foto do fim da galeria: "ficou estranho, umas partes vazias e
 * outra comprida". Repartir por CONTAGEM dá a cada coluna o mesmo número de
 * fotos e ignora que retrato é quase o dobro da altura de uma deitada — basta
 * a ordem das fotos conspirar para uma coluna esticar.
 *
 * O teste usa a pior ordem para a repartição por contagem, e ela não é rara:
 * uma deitada a cada quatro fotos, com quatro colunas na tela. `i % colunas`
 * manda TODAS as deitadas para a coluna 0 e deixa as outras três só com
 * retratos — uma coluna curta ao lado de três compridas, que é a foto que o
 * Felipe mandou. Pela altura isso não tem como acontecer.
 */
console.log("\nO rodapé das colunas\n");

/** Altura de cada coluna, somando `1/proporção` de cada foto que caiu nela. */
const alturasDasColunas = (cols, proporcoes) =>
  cols.map((c) => c.reduce((t, i) => t + 1 / proporcoes[i], 0));

etapa("a repartição pela altura fecha as colunas quase no mesmo rodapé", () => {
  /* 24 fotos, uma deitada (3:2) a cada quatro; o resto retrato (2:3). */
  const proporcoes = Array.from({ length: 24 }, (_, i) => (i % 4 === 0 ? 3 / 2 : 2 / 3));
  const alturaDe = (i) => 1 / proporcoes[i];

  const porContagem = alturasDasColunas(distribuirEmColunas(24, 4), proporcoes);
  const porAltura = alturasDasColunas(distribuirEmColunas(24, 4, alturaDe), proporcoes);

  const vao = (a) => Math.max(...a) - Math.min(...a);
  if (!(vao(porAltura) < vao(porContagem))) {
    throw new Error(
      `por altura o vão é ${vao(porAltura).toFixed(2)} e por contagem ${vao(porContagem).toFixed(2)}`,
    );
  }
  /* O vão que sobra não pode passar de UMA foto mais o empate visual.
     
     Até 26/09 o teto era uma foto exata, o mínimo teórico de quem manda cada
     foto para a coluna mais curta. O empate visual (ver `distribuirEmColunas`)
     pode escolher uma coluna até `EMPATE_VISUAL` mais comprida, e a conta
     acompanha: a última foto da coluna mais alta entrou quando ela estava no
     máximo essa folga acima da mais curta. Neste caso o vão foi de 0,8 para
     1,5; em 600 galerias sortidas, o médio foi de 0,92 para 0,98. É o preço
     de a foto 1 não ir para o lado errado da fileira por um pixel — e ele é
     limitado por construção, não por sorte. */
  const maisAlta = Math.max(...proporcoes.map((p) => 1 / p));
  if (vao(porAltura) > maisAlta + EMPATE_VISUAL + 1e-9) {
    throw new Error(
      `sobrou um vão de ${vao(porAltura).toFixed(2)}, maior que uma foto (${maisAlta.toFixed(2)}) mais o empate visual`,
    );
  }
  return `vão: ${vao(porContagem).toFixed(1)} → ${vao(porAltura).toFixed(1)}`;
});

etapa("repartir pela altura não mexe na ordem de leitura", () => {
  const proporcoes = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 3 / 2 : 2 / 3));
  const cols = distribuirEmColunas(30, 4, (i) => 1 / proporcoes[i]);
  igual(cols.map((c) => c[0]), [0, 1, 2, 3], "topo das colunas");
  for (const c of cols) {
    for (let k = 1; k < c.length; k++) {
      if (c[k] <= c[k - 1]) throw new Error(`coluna fora de ordem: ${c}`);
    }
  }
  igual(cols.flat().sort((a, b) => a - b), Array.from({ length: 30 }, (_, i) => i), "todas uma vez");
});

etapa("proporção inválida não contamina a repartição", () => {
  /* Foto sem largura/altura no banco. Um NaN na soma faria a coluna nunca mais
     ser escolhida, e tudo cairia numa só. */
  const cols = distribuirEmColunas(9, 3, (i) => (i === 0 ? NaN : 1));
  for (const c of cols) {
    if (c.length === 0) throw new Error(`coluna vazia: ${JSON.stringify(cols)}`);
  }
  return cols.map((c) => c.length).join(" · ");
});

/* ── O EMPATE QUE O OLHO VÊ (26/09/2026) ──────────────────────────────────
 *
 * Juan, com o print numerado à mão: "era pra ser nessa ordem dos números, mas
 * está 2 - 1 - 4 - 5 - 3". As fotos 1 e 2 começavam na mesma altura da tela,
 * e 3, 4 e 5 também — colunas niveladas a olho, diferentes por um ou dois
 * pixels no número. A regra desempatava pelo pixel.
 *
 * A etapa "repartir pela altura não mexe na ordem de leitura", acima, nunca
 * pegou isso: ela confere o topo de cada COLUNA, e dentro da coluna a ordem
 * sempre esteve certa. O erro é da FILEIRA.
 *
 * `lidasAoContrario` mede a fileira como se lê um mural: duas fotos cujos
 * topos diferem menos que meia foto estão na mesma fileira e se leem da
 * esquerda para a direita; fora disso, quem começa mais acima vem antes.
 */
function lidasAoContrario(cols, alturaDe) {
  const pos = [];
  cols.forEach((c, k) => {
    let y = 0;
    for (const i of c) {
      pos[i] = { k, t: y, h: alturaDe(i) };
      y += alturaDe(i);
    }
  });
  let lado = 0, acima = 0;
  for (let i = 0; i + 1 < pos.length; i++) {
    const a = pos[i], b = pos[i + 1];
    const mesmaFileira = Math.abs(a.t - b.t) <= 0.5 * Math.min(a.h, b.h);
    if (mesmaFileira && b.k < a.k) lado++;
    else if (!mesmaFileira && b.t < a.t) acima++;
  }
  return { lado, acima };
}

/* Galerias sortidas, semente fixa: 2 a 6 colunas, 10 a 50% de deitadas, e
   metade das fotos seguidas da sua PB — a mesma exportação, mesma proporção.
   Cada foto tem alguns pixels de diferença da proporção nominal, como na vida
   real: é isso que transforma empate em "desempate por um pixel". */
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
          if (rnd() < 0.5) p.push(x);
        }
        saida.push({ p, colunas });
      }
    }
  }
  return saida;
}

console.log("\nO empate que o olho vê\n");

etapa("o print do Juan: colunas niveladas a olho saem 1, 2, 3, 4, 5", () => {
  /* A fileira de cima do print, reconstruída pela altura em que cada coluna
     terminava (na escala em que a coluna mede 1 de largura): a primeira e a
     última niveladas, com a última um fio mais curta; as três do meio também
     niveladas entre si, mais embaixo. Depois, cinco retratos — as fotos 1 a 5
     dele — e mais uma fileira, para nenhuma delas ser a última da galeria. */
  const topoDaFileira = [1.17, 1.98, 2.0, 1.99, 1.15];
  const alt = (i) => (i < 5 ? topoDaFileira[i] : 1.5);
  const cols = distribuirEmColunas(15, 5, alt);
  const colunaDe = (i) => cols.findIndex((c) => c.includes(i));
  const numeradas = [5, 6, 7, 8, 9]; // as fotos 1..5 do print
  const lidas = [...numeradas].sort((a, b) => {
    const [ca, cb] = [colunaDe(a), colunaDe(b)];
    const topo = (i) => cols[colunaDe(i)].slice(0, cols[colunaDe(i)].indexOf(i)).reduce((t, j) => t + alt(j), 0);
    const mesma = Math.abs(topo(a) - topo(b)) <= 0.75;
    return mesma ? ca - cb : topo(a) - topo(b);
  });
  const comoSeLe = lidas.map((i) => i - 4).join(" - ");
  if (comoSeLe !== "1 - 2 - 3 - 4 - 5") {
    throw new Error(`lido como ${comoSeLe} — era pra ser 1 - 2 - 3 - 4 - 5`);
  }
  return comoSeLe;
});

etapa("em galerias sortidas, metade dos pares lidos ao contrário some", () => {
  let lado = 0, fotos = 0;
  for (const { p, colunas } of galeriasSortidas()) {
    const alt = (i) => 1 / p[i];
    lado += lidasAoContrario(distribuirEmColunas(p.length, colunas, alt), alt).lado;
    fotos += p.length;
  }
  const por100 = (100 * lado) / fotos;
  /* A regra do pixel dava ~35 por 100 fotos nestas galerias. O que sobra é o
     que nenhuma regra de coluna resolve (depois de uma deitada, a coluna fica
     curta DE VERDADE), e é por isso que o teto não é zero. */
  if (por100 > 22) {
    throw new Error(`${por100.toFixed(1)} pares consecutivos lidos ao contrário por 100 fotos`);
  }
  return `${por100.toFixed(1)} por 100 fotos (a regra do pixel: ~35)`;
});

etapa("nenhuma foto posterior aparece claramente ACIMA de uma anterior", () => {
  /* A garantia da regra antiga, e o motivo de o empate ser só um quarto de
     foto: uma folga maior fecha mais casos de fileira e passa a jogar fotos
     posteriores para cima das anteriores — medido, com 0,5 são ~5 por 100. */
  let acima = 0;
  for (const { p, colunas } of galeriasSortidas()) {
    const alt = (i) => 1 / p[i];
    acima += lidasAoContrario(distribuirEmColunas(p.length, colunas, alt), alt).acima;
  }
  if (acima > 0) throw new Error(`${acima} fotos posteriores começam claramente acima de uma anterior`);
  return "nenhuma";
});

etapa("o rodapé fecha dentro de uma foto mais o empate, em toda galeria", () => {
  let pior = 0;
  for (const { p, colunas } of galeriasSortidas()) {
    const hs = alturasDasColunas(distribuirEmColunas(p.length, colunas, (i) => 1 / p[i]), p);
    const vao = Math.max(...hs) - Math.min(...hs);
    const maisAlta = Math.max(...p.map((x) => 1 / x));
    if (vao > maisAlta + EMPATE_VISUAL + 1e-9) {
      throw new Error(`vão de ${vao.toFixed(2)} com a foto mais alta medindo ${maisAlta.toFixed(2)}`);
    }
    pior = Math.max(pior, vao);
  }
  return `pior vão ${pior.toFixed(2)}`;
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
