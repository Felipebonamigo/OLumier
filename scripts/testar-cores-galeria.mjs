#!/usr/bin/env node
/**
 * Testa as CORES PRÓPRIAS da galeria — o fotógrafo escolhendo fundo, texto e
 * cor dos botões por cima do tema.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-cores-galeria.mjs
 *
 * ── O PEDIDO (05/09/2026) ─────────────────────────────────────────────────
 *
 * Os presets já vinham com tudo — capa, fonte, grade, tema. O que faltava era
 * poder mexer NAS CORES: três temas prontos serviam a todo mundo mais ou menos
 * e a ninguém exatamente. O dono pediu cores editáveis, "inclusive dos botões".
 *
 * Três cores, e não oito: a pessoa escolhe FUNDO, TEXTO e DESTAQUE (o botão),
 * e o resto da paleta — superfície, texto suave, linha, texto sobre o botão — é
 * DERIVADO delas. Oito seletores de cor virariam oito jeitos de quebrar a
 * legibilidade; três, com derivação, mantêm a paleta coerente por construção.
 *
 * ── AS DUAS COISAS QUE ESTA SUÍTE PRENDE ──────────────────────────────────
 *
 * 1. SEGURANÇA. As cores vão parar num `style` em linha, como variáveis CSS.
 *    Uma string que não seja EXATAMENTE `#rrggbb` é descartada — não corrigida,
 *    não "limpa", descartada. `"#fff; background:url(...)"` dentro de um style é
 *    injeção de CSS na galeria do cliente. A regra é a mesma de `lerAparencia`
 *    para todo eixo: o que não está na lista vira o padrão.
 *
 * 2. LEGIBILIDADE DO BOTÃO. O texto sobre o destaque é derivado (preto ou
 *    branco, o que contrastar mais). Para qualquer cor de botão que a pessoa
 *    escolher, esse texto tem de passar de 4,5:1 — é a única derivação em que
 *    o sistema promete algo, então é a única medida aqui contra um piso.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { contraste } from "../src/lib/marca-estudio.ts";

exigirBancoDeTeste();
const { lerAparencia, variaveisDoTema, presetEquivalente, PRESETS, TEMAS, APARENCIA_PADRAO } =
  await import("../src/config/aparencia.ts");

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

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

console.log("a leitura");

await etapa("galeria antiga, sem cores, continua sem cores", () => {
  const a = lerAparencia({ capa: "imersa", tema: "noite" });
  if ("cores" in a && a.cores !== undefined) {
    throw new Error(`apareceu cores=${JSON.stringify(a.cores)} do nada`);
  }
});

await etapa("cor válida entra, em minúsculas", () => {
  const a = lerAparencia({ cores: { fundo: "#1B0E08", texto: "#F6EDE4", destaque: "#D9A373" } });
  if (a.cores?.fundo !== "#1b0e08" || a.cores?.texto !== "#f6ede4" || a.cores?.destaque !== "#d9a373") {
    throw new Error(`veio ${JSON.stringify(a.cores)}`);
  }
  return JSON.stringify(a.cores);
});

/*
 * O que vai para um `style` em linha tem de ser um hexadecimal e mais nada.
 * Cada entrada abaixo é um jeito diferente de alguém tentar passar CSS por
 * dentro de uma cor — ou só de errar — e todas têm de virar "sem cor".
 */
await etapa("o que não é #rrggbb é descartado, não corrigido", () => {
  const lixo = [
    "red",
    "#fff",
    "#ggg000",
    "#fff; background:url(x)",
    "#ffffff url(x)",
    "rgb(0,0,0)",
    "#fffffff",
    " #ffffff ",
    123,
    null,
    {},
    "expression(alert(1))",
  ];
  for (const v of lixo) {
    const a = lerAparencia({ cores: { fundo: v, texto: v, destaque: v } });
    if (a.cores !== undefined) {
      throw new Error(`${JSON.stringify(v)} passou como ${JSON.stringify(a.cores)}`);
    }
  }
  return `${lixo.length} entradas recusadas`;
});

await etapa("uma cor válida e duas inválidas: fica só a válida", () => {
  const a = lerAparencia({ cores: { fundo: "#101010", texto: "red", destaque: 7 } });
  if (JSON.stringify(a.cores) !== JSON.stringify({ fundo: "#101010" })) {
    throw new Error(`veio ${JSON.stringify(a.cores)}`);
  }
});

console.log("\na tradução para CSS");

await etapa("sem cores próprias, as variáveis são exatamente as do tema", () => {
  for (const tema of Object.keys(TEMAS)) {
    const v = variaveisDoTema({ ...APARENCIA_PADRAO, tema });
    if (JSON.stringify(v) !== JSON.stringify(TEMAS[tema])) {
      throw new Error(`${tema}: a tradução mudou o tema sem ninguém pedir`);
    }
  }
  return `${Object.keys(TEMAS).length} temas intactos`;
});

await etapa("as três cores escolhidas entram, e o resto é derivado delas", () => {
  const v = variaveisDoTema({
    ...APARENCIA_PADRAO,
    tema: "noite",
    cores: { fundo: "#1b0e08", texto: "#f6ede4", destaque: "#d9a373" },
  });
  if (v["--g-fundo"] !== "#1b0e08") throw new Error(`fundo ${v["--g-fundo"]}`);
  if (v["--g-texto"] !== "#f6ede4") throw new Error(`texto ${v["--g-texto"]}`);
  if (v["--g-destaque"] !== "#d9a373") throw new Error(`destaque ${v["--g-destaque"]}`);
  for (const derivada of ["--g-superficie", "--g-suave", "--g-tenue", "--g-linha", "--g-sobre-destaque"]) {
    if (!v[derivada]) throw new Error(`${derivada} sumiu`);
    if (v[derivada] === TEMAS.noite[derivada]) {
      throw new Error(`${derivada} continuou a do tema noite — não foi derivada das cores escolhidas`);
    }
  }
  return `superfície ${v["--g-superficie"]} · suave ${v["--g-suave"]} · sobre-destaque ${v["--g-sobre-destaque"]}`;
});

/*
 * A ÚNICA PROMESSA: o texto do botão sempre se lê. Preto ou branco, o que
 * contrastar mais com a cor que a pessoa escolheu. Cinza médio é o pior caso —
 * nem preto nem branco passa com folga — e ainda assim passa de 4,5:1.
 */
await etapa("o texto sobre o botão passa de 4,5:1 para qualquer cor de botão", () => {
  const cores = ["#000000", "#ffffff", "#777777", "#808080", "#d9a373", "#39ff14", "#ff0080", "#1e3a8a", "#f5f5dc", "#8b0000"];
  let pior = Infinity;
  for (const destaque of cores) {
    const v = variaveisDoTema({ ...APARENCIA_PADRAO, cores: { destaque } });
    const r = contraste(v["--g-destaque"], v["--g-sobre-destaque"]);
    if (r < 4.5) throw new Error(`${destaque}: ${r.toFixed(2)}:1 com ${v["--g-sobre-destaque"]}`);
    pior = Math.min(pior, r);
  }
  return `${cores.length} cores · pior ${pior.toFixed(2)}:1`;
});

await etapa("o texto suave continua legível sobre o fundo escolhido", () => {
  const pares = [
    ["#1b0e08", "#f6ede4"],
    ["#ffffff", "#211d16"],
    ["#0a0a0a", "#fafafa"],
    ["#f7f1e6", "#43382a"],
  ];
  let pior = Infinity;
  for (const [fundo, texto] of pares) {
    const v = variaveisDoTema({ ...APARENCIA_PADRAO, cores: { fundo, texto } });
    const r = contraste(v["--g-fundo"], v["--g-suave"]);
    if (r < 4.5) throw new Error(`${fundo}/${texto}: suave ${v["--g-suave"]} dá ${r.toFixed(2)}:1`);
    pior = Math.min(pior, r);
  }
  return `pior ${pior.toFixed(2)}:1`;
});

console.log("\nos presets");

await etapa("cor própria tira a galeria de qualquer preset", () => {
  const base = PRESETS[0].aparencia;
  if (presetEquivalente(base) !== PRESETS[0].id) throw new Error("o preset nem casa consigo mesmo");
  const comCor = { ...base, cores: { destaque: "#d9a373" } };
  if (presetEquivalente(comCor) !== null) {
    throw new Error(`continuou "${presetEquivalente(comCor)}" com cor própria — a tela diria "no ar: Átomo" para uma galeria que não é`);
  }
  const coresVazias = lerAparencia({ ...base, cores: {} });
  if (presetEquivalente(coresVazias) !== PRESETS[0].id) {
    throw new Error("cores vazias deveriam continuar casando com o preset");
  }
});

/*
 * ── PONTA A PONTA: a cor escolhida chega ao <main> da galeria ─────────────
 *
 * Passa pelo mesmo caminho da prévia (`?ap=`), que só pinta para o dono. Se a
 * variável não aparecer no style do <main>, nada acima importa — a galeria
 * continuaria com as cores do tema e a prévia estaria mentindo de novo.
 */
console.log("\nna galeria de verdade");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const g = await galeriaDaRodada(db, { nome: "cores", medias: 3, publicada: true });
const cookie = cookieDeSessao(g.estudio.id);
const FUNDO = "#123456";
const ap = encodeURIComponent(JSON.stringify({ ...APARENCIA_PADRAO, cores: { fundo: FUNDO, destaque: "#abcdef" } }));

await etapa("o dono vê a cor própria pintada na galeria", async () => {
  const r = await fetch(`${BASE}/g/${g.tslug}/${g.gslug}?previa=1&amostra=1&ap=${ap}`, {
    cache: "no-store",
    headers: { cookie },
  });
  const html = await r.text();
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const main = /<main[^>]*style="([^"]*)"/.exec(html)?.[1] ?? "";
  if (!main.includes(`--g-fundo:${FUNDO}`) && !main.includes(`--g-fundo: ${FUNDO}`)) {
    throw new Error(`o <main> não tem --g-fundo:${FUNDO}: ${main.slice(0, 200)}`);
  }
  if (!/--g-destaque:\s*#abcdef/.test(main)) throw new Error("o destaque escolhido não chegou");
  if (!/--g-sobre-destaque:\s*#(000000|ffffff)/.test(main)) {
    throw new Error("o texto do botão não foi derivado no <main>");
  }
  return "fundo, destaque e sobre-destaque no <main>";
});

await etapa("sem sessão, a cor da URL é ignorada", async () => {
  const r = await fetch(`${BASE}/g/${g.tslug}/${g.gslug}?ap=${ap}`, { cache: "no-store" });
  const html = await r.text();
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (html.includes(`--g-fundo:${FUNDO}`) || html.includes(`--g-fundo: ${FUNDO}`)) {
    throw new Error("qualquer pessoa com o link conseguiu repintar a galeria alheia");
  }
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ as cores têm problema" : "\n✓ cores ok");
process.exitCode = falhou ? 1 : 0;
