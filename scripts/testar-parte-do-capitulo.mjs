#!/usr/bin/env node
/**
 * A pasta maior que uma tela, vista por partes. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-parte-do-capitulo.mjs
 *
 * ── O BURACO QUE A FATIA DEIXOU (achado em 16/09/2026) ─────────────────────
 *
 * O corte por fatia (11/09/2026) serve UM capítulo por tela, com teto de
 * `FOTOS_POR_TELA`. O teto vale dentro do capítulo também — e nada levava ao
 * resto. Numa pasta "Festa" de 800 fotos, da 601ª em diante não havia como
 * VER, nem no computador nem no celular. Numa galeria de 2000 fotos sem
 * capítulo nenhum, 1400 fotos simplesmente não existiam na tela.
 *
 * O download já não dependia disso (zip e lista vêm do servidor). Ver, sim.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { FOTOS_POR_TELA, fatiarGaleria } from "../src/config/fatia-galeria.ts";
import { enderecoNaGaleria } from "../src/lib/endereco-na-galeria.ts";

exigirBancoDeTeste();

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

console.log("O corte, sem servidor\n");

const fotos = (n, secao_id = null) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, secao_id }));

await etapa("a parte 2 de uma pasta grande começa onde a 1 parou", () => {
  const festa = fotos(FOTOS_POR_TELA * 2 + 1, "festa");
  const p1 = fatiarGaleria(festa, "festa");
  const p2 = fatiarGaleria(festa, "festa", FOTOS_POR_TELA, 2);
  const p3 = fatiarGaleria(festa, "festa", FOTOS_POR_TELA, 3);
  if (p1.partes !== 3 || p2.partes !== 3) throw new Error(`partes = ${p1.partes}/${p2.partes}`);
  if (p2.itens[0]?.id !== `f${FOTOS_POR_TELA}`) throw new Error(`a parte 2 começa em ${p2.itens[0]?.id}`);
  if (p3.itens.length !== 1 || p3.itens[0].id !== `f${FOTOS_POR_TELA * 2}`) {
    throw new Error(`a parte 3 trouxe ${p3.itens.length}`);
  }
  if (p1.parte !== 1 || p2.parte !== 2 || p3.parte !== 3) throw new Error("o número da parte não volta");
  return `3 partes: ${p1.itens.length} + ${p2.itens.length} + ${p3.itens.length}`;
});

await etapa("parte que não existe vira a última, não uma tela vazia", () => {
  const r = fatiarGaleria(fotos(FOTOS_POR_TELA + 1), undefined, FOTOS_POR_TELA, 99);
  if (r.parte !== 2 || r.itens.length !== 1) throw new Error(`parte ${r.parte} com ${r.itens.length} fotos`);
  const zero = fatiarGaleria(fotos(FOTOS_POR_TELA + 1), undefined, FOTOS_POR_TELA, 0);
  if (zero.parte !== 1) throw new Error(`parte 0 virou ${zero.parte}`);
  return "99 → 2 · 0 → 1";
});

await etapa("galeria que cabe inteira continua uma parte só", () => {
  const r = fatiarGaleria(fotos(10), undefined, FOTOS_POR_TELA, 2);
  if (r.partes !== 1 || r.parte !== 1 || r.itens.length !== 10) throw new Error(JSON.stringify(r));
});

/*
 * O endereço de uma parte ou de uma pastilha mexe SÓ em cap e parte. A primeira
 * versão montava "?cap=X&parte=2" do zero e jogava fora o "?previa=1" do dono:
 * no rascunho a parte 2 dava 404, e na publicada contava um "abriu" do próprio
 * fotógrafo na Atividade do casal (revisão de 16/09/2026).
 */
await etapa("o link de parte guarda a prévia do dono e larga o recorte", () => {
  const e = enderecoNaGaleria("previa=1&fotos=a,b&cap=velho&parte=3", { cap: "novo", parte: 2 });
  const p = new URLSearchParams(e.replace(/^\?/, ""));
  if (p.get("previa") !== "1") throw new Error(`perdeu a prévia: ${e}`);
  if (p.get("cap") !== "novo" || p.get("parte") !== "2") throw new Error(`cap/parte errados: ${e}`);
  if (p.has("fotos")) throw new Error(`levou o recorte junto: ${e}`);
  return e;
});

await etapa("parte 1 não precisa de número, e sem cap não inventa cap", () => {
  const e = enderecoNaGaleria("previa=1&parte=4", { cap: null, parte: 1 });
  if (e !== "?previa=1") throw new Error(e);
  if (enderecoNaGaleria("", { cap: null, parte: 1 }) !== "?") throw new Error("vazio não virou ?");
});

console.log("\nNa tela\n");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let prefixoFalso = null;
try {
  const g = await galeriaDaRodada(db, { nome: "partes", medias: 0, publicada: true });
  prefixoFalso = `${g.tenant_id}/${g.id}/parte-`;
  await db.query("update galerias set senha_hash = null, permite_download = true where id = $1", [g.id]);
  const { rows: [festa] } = await db.query(
    "insert into secoes (galeria_id, nome, ordem) values ($1, 'Festa', 0) returning id",
    [g.id],
  );
  const quantas = FOTOS_POR_TELA * 2 + 1;
  /* Em massa, numa consulta só. `ordem = i` é o que fixa quem é a 601ª. */
  await db.query(
    `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime,
                         bytes, largura, altura, ordem, pronto, secao_id)
     select $1, $2, $3 || lpad(i::text, 5, '0') || '.jpg',
            'festa-' || lpad(i::text, 5, '0') || '.jpg', 'foto', 'image/jpeg', 1000, 1600, 1067, i, true, $4
       from generate_series(0, $5::int - 1) i`,
    [g.id, g.tenant_id, prefixoFalso, festa.id, quantas],
  );
  const url = (consulta) => `${BASE}/g/${g.tslug}/${g.gslug}${consulta}`;
  const html = async (consulta) => (await fetch(url(consulta), { cache: "no-store" })).text();
  const tem = (h, i) => h.includes(`festa-${String(i).padStart(5, "0")}.jpg`);

  await etapa(`a primeira tela da pasta mostra as ${FOTOS_POR_TELA} primeiras`, async () => {
    const h = await html(`?cap=${festa.id}`);
    if (!tem(h, 0)) throw new Error("a foto 1 não está na tela");
    if (tem(h, FOTOS_POR_TELA)) throw new Error(`a foto ${FOTOS_POR_TELA + 1} já está na primeira tela`);
  });

  await etapa("e leva para a parte seguinte", async () => {
    const h = await html(`?cap=${festa.id}`);
    const links = [...h.matchAll(/href="([^"]*parte=(\d+)[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    const paraDois = links.find((l) => /parte=2/.test(l) && l.includes(`cap=${festa.id}`));
    if (!paraDois) throw new Error(`não há link para a parte 2 desta pasta (${links.length} links de parte)`);
    return paraDois;
  });

  await etapa(`a parte 2 mostra da ${FOTOS_POR_TELA + 1}ª em diante`, async () => {
    const h = await html(`?cap=${festa.id}&parte=2`);
    if (!tem(h, FOTOS_POR_TELA)) throw new Error(`a foto ${FOTOS_POR_TELA + 1} não aparece na parte 2`);
    if (tem(h, 0)) throw new Error("a parte 2 repete a foto 1");
    if (tem(h, FOTOS_POR_TELA * 2)) throw new Error("a parte 2 já traz a última foto");
  });

  await etapa("e a parte 3 traz a última", async () => {
    const h = await html(`?cap=${festa.id}&parte=3`);
    if (!tem(h, FOTOS_POR_TELA * 2)) throw new Error("a última foto não aparece em lugar nenhum");
  });

  await etapa("sem cap, na parte 2, nenhuma pastilha finge ser o capítulo da tela", async () => {
    /* A parte 2 da galeria inteira mostra fotos de outro capítulo; destacar o
       primeiro com aria-current dizia "você está no Making Of" sobre a Festa. */
    const { rows: [outro] } = await db.query(
      "insert into secoes (galeria_id, nome, ordem) values ($1, 'Making Of', 1) returning id",
      [g.id],
    );
    await db.query(
      `update medias set secao_id = $1
        where id = (select id from medias where galeria_id = $2 order by ordem desc limit 1)`,
      [outro.id, g.id],
    );
    const h = await html("?parte=2");
    const barra = h.match(/<nav[^>]*aria-label="Menu da galeria"[^]*?<\/nav>/)?.[0] ?? "";
    if (!barra) throw new Error("não achei a barra de menus");
    if (/aria-current="page"/.test(barra)) {
      throw new Error("uma pastilha de capítulo se diz ativa na parte 2 da galeria");
    }
    if (!/aria-label="Partes da galeria"/.test(h)) throw new Error("a navegação chama a galeria de pasta");
    return "nenhuma ativa · Partes da galeria";
  });

  await etapa("galeria sem capítulo nenhum também tem partes", async () => {
    await db.query("update medias set secao_id = null where galeria_id = $1", [g.id]);
    await db.query("delete from secoes where galeria_id = $1", [g.id]);
    const h = await html("?parte=2");
    if (!tem(h, FOTOS_POR_TELA)) throw new Error(`sem capítulo, a foto ${FOTOS_POR_TELA + 1} não aparece`);
    const h1 = await html("");
    if (!/href="[^"]*parte=2[^"]*"/.test(h1)) throw new Error("a primeira tela não leva à parte 2");
  });
} finally {
  /* As 1201 chaves são de mentira — nada subiu para o balde. Tirá-las antes
     poupa a limpeza de pedir 1201 exclusões de objetos que não existem. */
  if (prefixoFalso) {
    await db.query("delete from medias where chave like $1", [`${prefixoFalso}%`]).catch(() => {});
  }
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ a pasta grande ainda esconde fotos");
  process.exit(1);
}
console.log("\n✓ toda foto de uma pasta grande tem uma tela onde aparece");
