#!/usr/bin/env node
/**
 * As capas REDONDA e ARCO, e o rótulo do evento. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-capas-novas.mjs
 *
 * ── OS PEDIDOS (10/09/2026) ───────────────────────────────────────────────
 *
 * Juan: "adicionar mais formas de capa: foto redonda com título embaixo, mais
 * minimalista. Foto em formato de arco, reta na parte inferior horizontal,
 * título embaixo."
 *
 * E, logo depois: "adicionar a opção de subtítulo para a capa: por exemplo,
 * casamento, aniversário, prewedding. Para não ocupar tanto espaço visual se
 * estivesse no título em si."
 *
 * ── POR QUE O RÓTULO NÃO É O `subtitulo` QUE JÁ EXISTE ────────────────────
 *
 * Porque o `subtitulo` já tem dono: é o LOCAL. Na galeria do Juan ele vale
 * "Casa na Chácara", e sai na legenda junto da data — "04 DE SETEMBRO DE 2026 ·
 * CASA NA CHÁCARA". Enfiar "Casamento" ali empurraria o local para uma terceira
 * informação na mesma linha, que é exatamente o "ocupar espaço visual" de que
 * ele reclamou.
 *
 * O rótulo é outra coisa e vai em outro lugar: acima do título, curto, em
 * maiúsculas — o que a tipografia chama de sobrancelha. Diz o QUE é o evento
 * antes de dizer de QUEM é.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { OPCOES, lerAparencia, APARENCIA_PADRAO } from "../src/config/aparencia.ts";

exigirBancoDeTeste();

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

const g = await galeriaDaRodada(db, { nome: "capas", medias: 3, publicada: true });
await db.query(
  "update galerias set senha_hash = null, capa_media_id = $2 where id = $1",
  [g.id, g.midias[0].id],
);

const comCapa = async (capa) => {
  await db.query(
    `update galerias
        set aparencia = jsonb_set(coalesce(aparencia,'{}'::jsonb), '{capa}', $2::jsonb)
      where id = $1`,
    [g.id, JSON.stringify(capa)],
  );
  return (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
};
const bloco = (html, nome) =>
  html.match(new RegExp(`<header[^>]*data-capa="${nome}"[^]*?</header>`))?.[0] ?? "";

console.log("As capas novas:\n");

await etapa("as duas entram na lista de escolhas", () => {
  const ids = OPCOES.capa.map((c) => c.id);
  for (const nova of ["redonda", "arco"]) {
    if (!ids.includes(nova)) throw new Error(`"${nova}" não está em OPCOES.capa`);
  }
  return ids.join(", ");
});

for (const nome of ["redonda", "arco"]) {
  await etapa(`a capa ${nome} desenha a foto`, async () => {
    const b = bloco(await comCapa(nome), nome);
    if (!b) throw new Error(`não achei <header data-capa="${nome}">`);
    if (!/<img/.test(b)) throw new Error("desenhou sem foto");
    /* As duas nasceram DEPOIS do ponto focal; ignorá-lo seria entregar duas
       capas em que o enquadramento volta a ser automático. */
    if (!/object-position/.test(b)) throw new Error("ignora o ponto focal");
    return "foto + ponto focal";
  });
}

await etapa("a redonda recorta em círculo", async () => {
  const b = bloco(await comCapa("redonda"), "redonda");
  if (!/rounded-full/.test(b)) throw new Error("o recorte não é circular");
  return "rounded-full";
});

/* Arco = topo arredondado e base RETA. Um `rounded-full` aqui seria a redonda
   com outro nome, e é o erro fácil de cometer neste par. */
await etapa("o arco é redondo em cima e reto embaixo", async () => {
  const b = bloco(await comCapa("arco"), "arco");
  const moldura = b.match(/<div class="[^"]*rounded-t-full[^"]*"/)?.[0] ?? "";
  if (!moldura) throw new Error("não achei o topo arredondado (rounded-t-full)");
  if (/rounded-b-full|rounded-full/.test(moldura)) {
    throw new Error("arredondou embaixo também — vira a redonda com outro nome");
  }
  return "rounded-t-full, base reta";
});

await etapa("as duas sem foto NENHUMA caem na mínima, sem quebrar", async () => {
  /*
   * "Sem foto escolhida" não é a condição: a página tem uma terceira via —
   * usar a PRIMEIRA foto da galeria quando ninguém escolheu — e ela vale para
   * a redonda e o arco como vale para a imersa. A reserva de que se fala aqui
   * é a galeria sem foto alguma, que é quando `urlImagem` fica nula.
   */
  await db.query("update medias set pronto = false where galeria_id = $1", [g.id]);
  try {
    for (const nome of ["redonda", "arco"]) {
      const html = await comCapa(nome);
      if (!/data-capa="minima"/.test(html)) {
        throw new Error(`${nome} sem foto não caiu na mínima`);
      }
      if (!html.includes(g.titulo)) throw new Error(`${nome} sem foto quebrou a página`);
    }
    return "reserva igual à das outras capas com foto";
  } finally {
    await db.query("update medias set pronto = true where galeria_id = $1", [g.id]);
  }
});

console.log("\nO rótulo do evento:\n");

await etapa("galeria sem rótulo continua exatamente como está", () => {
  const a = lerAparencia({});
  if (a.rotulo !== APARENCIA_PADRAO.rotulo) throw new Error("o padrão não é o de sempre");
  if (a.rotulo !== "") throw new Error(`o padrão é ${JSON.stringify(a.rotulo)}, esperava vazio`);
  return "vazio";
});

await etapa("o rótulo escolhido aparece na capa", async () => {
  await db.query(
    `update galerias set aparencia = jsonb_set(
        jsonb_set(coalesce(aparencia,'{}'::jsonb), '{capa}', '"minima"'),
        '{rotulo}', '"Casamento"')
      where id = $1`,
    [g.id],
  );
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  if (!/Casamento/.test(bloco(html, "minima"))) {
    throw new Error("o rótulo não saiu na capa");
  }
  return "Casamento";
});

/* O rótulo entra num `style`/texto da galeria do cliente. Texto livre com 300
   caracteres viraria uma parede em cima do nome do casal. */
await etapa("rótulo comprido demais é aparado, não recusado", () => {
  const a = lerAparencia({ rotulo: "x".repeat(200) });
  if (a.rotulo.length > 40) throw new Error(`passou ${a.rotulo.length} caracteres`);
  return `aparado em ${a.rotulo.length}`;
});

await etapa("rótulo que não é texto vira vazio", () => {
  for (const lixo of [123, null, {}, []]) {
    const a = lerAparencia({ rotulo: lixo });
    if (a.rotulo !== "") throw new Error(`${JSON.stringify(lixo)} virou ${JSON.stringify(a.rotulo)}`);
  }
  return "4 recusados";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ as capas novas têm problema" : "\n✓ capas novas ok");
process.exit(falhou ? 1 : 0);
