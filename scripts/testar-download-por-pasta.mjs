#!/usr/bin/env node
/**
 * BAIXAR SEPARADO EM PASTAS. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-download-por-pasta.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (10/09/2026) ─────────────────────────────────────────────────
 *
 * Juan: "MENU do download das fotos. Pra poder escolher se será feito todas de
 * uma única vez ou se será separado em pastas."
 *
 * As pastas já existem — são os CAPÍTULOS da galeria (Making Of, Cerimônia,
 * Festa), que o envio por pasta do Lightroom já cria sozinho. O que faltava era
 * poder baixar um só.
 *
 * ── O QUE ISSO MEXE NA ATIVIDADE ──────────────────────────────────────────
 *
 * "Baixou tudo" é prova de entrega que o fotógrafo lê para saber se o casal
 * recebeu. Se baixar UMA pasta contasse como baixar tudo, a aba Atividade
 * diria que o casal levou o casamento inteiro quando ele levou a cerimônia —
 * e é justamente essa tela que ele abre quando o cliente diz que não recebeu.
 * Mesma família do defeito de 05/09, em que o clique contava como entrega.
 *
 * Por isso a ação registrada depende do TAMANHO DO PEDIDO, e é `acaoDeEntrega`
 * que decide. Uma pasta vira um "baixou" comum: menos do que aconteceu, nunca
 * mais — número subestimado é lacuna, número inflado é mentira.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { acaoDeEntrega } from "../src/lib/salvar-client.ts";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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

console.log("O que fica registrado na Atividade:\n");

await etapa("pedir a galeria inteira conta como “baixou tudo”", () => {
  const a = acaoDeEntrega(200, 200);
  if (a !== "baixou_tudo") throw new Error(`veio ${a}`);
  return a;
});

await etapa("pedir UMA pasta NÃO conta como “baixou tudo”", () => {
  const a = acaoDeEntrega(42, 200);
  if (a !== "baixou") throw new Error(`42 de 200 fotos viraram ${a} — a Atividade mentiria`);
  return a;
});

await etapa("uma pasta que por acaso tem tudo conta como tudo", () => {
  /* Galeria de capítulo único: baixar "Cerimônia" É baixar a galeria. O que
     manda é o tamanho do pedido, não o nome do botão que foi clicado. */
  const a = acaoDeEntrega(30, 30);
  if (a !== "baixou_tudo") throw new Error(`veio ${a}`);
  return a;
});

console.log("\nOs itens do menu:\n");

const g = await galeriaDaRodada(db, { nome: "pastas", medias: 4, publicada: true });
await db.query("update galerias set senha_hash = null, permite_download = true where id = $1", [
  g.id,
]);

const menuBaixar = async () => {
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  const barra = html.match(/<nav[^>]*aria-label="Menu da galeria"[^]*?<\/nav>/)?.[0] ?? "";
  if (!barra) throw new Error("não achei a barra de menus");
  const menu = barra.match(/<details[^]*?<summary[^>]*>[^]*?Baixar[^]*?<\/details>/)?.[0];
  if (!menu) throw new Error("não achei o menu Baixar");
  return menu;
};

await etapa("sem capítulos, o menu tem só o baixar tudo", async () => {
  const m = await menuBaixar();
  if (!/Todas as fotos \(4\)/.test(m)) throw new Error("sumiu o baixar tudo");
  return "um item";
});

let capA, capB;
await etapa("com capítulos, cada um vira um item com a sua contagem", async () => {
  const { rows } = await db.query(
    `insert into secoes (galeria_id, nome, ordem)
          values ($1, 'Cerimônia', 0), ($1, 'Festa', 1) returning id, nome`,
    [g.id],
  );
  [capA, capB] = rows;
  /* Três fotos na Cerimônia, uma na Festa: contagens DIFERENTES de propósito —
     com dois números iguais, um item que mostrasse o total da galeria passaria
     despercebido. */
  for (const m of g.midias.slice(0, 3)) {
    await db.query("update medias set secao_id = $2 where id = $1", [m.id, capA.id]);
  }
  await db.query("update medias set secao_id = $2 where id = $1", [g.midias[3].id, capB.id]);

  const m = await menuBaixar();
  if (!/Cerimônia \(3\)/.test(m)) throw new Error("não achei “Cerimônia (3)”");
  if (!/Festa \(1\)/.test(m)) throw new Error("não achei “Festa (1)”");
  if (!/Todas as fotos \(4\)/.test(m)) throw new Error("o baixar tudo sumiu junto");
  return "Cerimônia (3) · Festa (1) · Todas (4)";
});

/* Capítulo vazio não vira item, mas isso não se prende aqui: a página do
   cliente já não manda capítulo sem foto, e `testar-secoes.mjs` prende esse
   lado. Uma etapa aqui passaria mesmo com o menu errado. */

await etapa("com UM capítulo só, não há pasta a escolher", async () => {
  /* Uma pasta que é a galeria inteira oferece a mesma coisa duas vezes. */
  await db.query("update medias set secao_id = $2 where galeria_id = $1", [g.id, capA.id]);
  try {
    const m = await menuBaixar();
    if (/Cerimônia/.test(m)) throw new Error("ofereceu a pasta única ao lado do baixar tudo");
    if (!/Todas as fotos \(4\)/.test(m)) throw new Error("e ainda perdeu o baixar tudo");
    return "só o baixar tudo";
  } finally {
    await db.query("update medias set secao_id = null where galeria_id = $1", [g.id]);
    await db.query("delete from secoes where galeria_id = $1", [g.id]);
  }
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o download por pasta tem problema" : "\n✓ download por pasta ok");
process.exit(falhou ? 1 : 0);
