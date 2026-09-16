#!/usr/bin/env node
/**
 * ORDENAR AS FOTOS DE UM CAPÍTULO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-ordem-das-fotos.mjs
 *
 * ── O PEDIDO (16/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe: "adicionar um sistema de controle das fotos em cada capítulo. Para
 * além de ter a funcionalidade de mover de um capítulo pro outro, poder
 * organizar por ordem de upload/adição // por ordem cronológica // por nome
 * A-Z // por nome Z-A".
 *
 * ── O QUE ESTE TESTE PRENDE ───────────────────────────────────────────────
 *
 * 1. As quatro ordens fazem o que o nome diz.
 * 2. O A→Z é NATURAL: foto_2 antes de foto_10. É a mesma regra do envio, e a
 *    razão de a ordenação acontecer em JavaScript e não num `order by`.
 * 3. A cronológica usa a data da CÂMERA e cai na de envio onde ela falta —
 *    dizendo quantas caíram, em vez de fingir que valeu para todas.
 * 4. Ordenar um capítulo não mexe na ordem de outro.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

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

const { criarSecao, ordenarFotosDaSecao } = await import("../src/lib/secoes.ts");

const g = await galeriaDaRodada(db, { nome: "ordem", medias: 0, publicada: true });
const cerimonia = await criarSecao(g.id, g.estudio.id, "Cerimônia");
const festa = await criarSecao(g.id, g.estudio.id, "Festa");

/**
 * Põe uma foto no capítulo.
 *
 * `criado_em` é a ordem de ENVIO e `tirada_em` a da câmera — os dois são
 * cravados aqui de propósito, e DESENCONTRADOS: é o caso real do casamento com
 * dois fotógrafos, onde a pasta que subiu depois tem fotos mais antigas.
 */
let n = 0;
const por = async (secaoId, nome, envio, camera) => {
  const { rows } = await db.query(
    `insert into medias (galeria_id, tenant_id, secao_id, chave, nome_original, tipo, mime,
                         bytes, ordem, pronto, criado_em, tirada_em)
     values ($1,$2,$3,$4,$5,'foto','image/jpeg',1000,$6,true,$7,$8) returning id`,
    [g.id, g.estudio.id, secaoId, `x/${g.id}/${n}.jpg`, nome, n++, envio, camera],
  );
  return rows[0].id;
};

const ordemAgora = async (secaoId) =>
  (
    await db.query(
      "select nome_original from medias where galeria_id = $1 and secao_id = $2 order by ordem, criado_em",
      [g.id, secaoId],
    )
  ).rows.map((r) => r.nome_original);

const D = (iso) => new Date(iso);

/* Enviadas em ordem alfabética; a câmera diz outra coisa. */
await por(cerimonia.id, "foto_10.jpg", D("2026-09-15T10:00:00Z"), D("2026-09-14T18:40:00Z"));
await por(cerimonia.id, "foto_2.jpg", D("2026-09-15T10:01:00Z"), D("2026-09-14T18:10:00Z"));
await por(cerimonia.id, "DSC_0001.jpg", D("2026-09-15T10:02:00Z"), D("2026-09-14T18:25:00Z"));
await por(festa.id, "festa_a.jpg", D("2026-09-15T11:00:00Z"), D("2026-09-14T23:00:00Z"));
await por(festa.id, "festa_b.jpg", D("2026-09-15T11:01:00Z"), D("2026-09-14T22:00:00Z"));

console.log("\nA ordem das fotos do capítulo:\n");

await etapa("ordem de envio", async () => {
  await ordenarFotosDaSecao(g.id, g.estudio.id, cerimonia.id, "envio");
  const lida = await ordemAgora(cerimonia.id);
  const esperada = ["foto_10.jpg", "foto_2.jpg", "DSC_0001.jpg"];
  if (lida.join() !== esperada.join()) throw new Error(`veio ${lida.join(", ")}`);
  return lida.join(" · ");
});

await etapa("nome A → Z, e é NATURAL: foto_2 antes de foto_10", async () => {
  await ordenarFotosDaSecao(g.id, g.estudio.id, cerimonia.id, "nome");
  const lida = await ordemAgora(cerimonia.id);
  const esperada = ["DSC_0001.jpg", "foto_2.jpg", "foto_10.jpg"];
  if (lida.join() !== esperada.join()) throw new Error(`veio ${lida.join(", ")}`);
  return lida.join(" · ");
});

await etapa("nome Z → A", async () => {
  await ordenarFotosDaSecao(g.id, g.estudio.id, cerimonia.id, "nome-invertido");
  const lida = await ordemAgora(cerimonia.id);
  const esperada = ["foto_10.jpg", "foto_2.jpg", "DSC_0001.jpg"];
  if (lida.join() !== esperada.join()) throw new Error(`veio ${lida.join(", ")}`);
  return lida.join(" · ");
});

await etapa("cronológica usa a data da CÂMERA, não a do envio", async () => {
  const r = await ordenarFotosDaSecao(g.id, g.estudio.id, cerimonia.id, "cronologica");
  const lida = await ordemAgora(cerimonia.id);
  /* Pelo envio seria foto_10, foto_2, DSC_0001. Pela câmera é outra coisa — e é
     essa diferença que o recurso existe para resolver. */
  const esperada = ["foto_2.jpg", "DSC_0001.jpg", "foto_10.jpg"];
  if (lida.join() !== esperada.join()) throw new Error(`veio ${lida.join(", ")}`);
  if (r.semData !== 0) throw new Error(`disse que ${r.semData} estavam sem data`);
  return lida.join(" · ");
});

await etapa("foto sem data da câmera cai no envio, e a tela é avisada", async () => {
  /* Toda foto enviada antes da migração 035 está assim, e vídeo nunca terá. */
  await por(cerimonia.id, "sem_exif.jpg", D("2026-09-15T10:03:00Z"), null);
  const r = await ordenarFotosDaSecao(g.id, g.estudio.id, cerimonia.id, "cronologica");
  if (r.semData !== 1) throw new Error(`contou ${r.semData} sem data, esperava 1`);
  if (r.quantas !== 4) throw new Error(`ordenou ${r.quantas}`);
  const lida = await ordemAgora(cerimonia.id);
  if (lida.length !== 4) throw new Error("perdeu foto no caminho");
  return `${r.semData} de ${r.quantas} pela data de envio`;
});

await etapa("ordenar um capítulo não mexe no outro", async () => {
  const antes = await ordemAgora(festa.id);
  await ordenarFotosDaSecao(g.id, g.estudio.id, cerimonia.id, "nome");
  const depois = await ordemAgora(festa.id);
  if (antes.join() !== depois.join()) throw new Error(`a Festa virou ${depois.join(", ")}`);
  return "Festa intacta";
});

await etapa("a galeria continua agrupando por capítulo depois de renumerar", async () => {
  /* A renumeração põe as fotos de cada capítulo em 0..N-1, então os números se
     repetem entre capítulos. A galeria pública ordena por CAPÍTULO antes de
     `ordem` — se essa consulta mudar, a entrega embaralha e este passo cai. */
  const { listarMediasPublicas } = await import("../src/lib/galerias-publicas.ts");
  const todas = await listarMediasPublicas(g.id);
  const secoes = todas.map((m) => m.secao_id);
  const blocos = secoes.filter((s, i) => i === 0 || s !== secoes[i - 1]);
  if (new Set(blocos).size !== blocos.length) {
    throw new Error("as fotos de um capítulo apareceram em dois blocos separados");
  }
  return `${blocos.length} blocos, um por capítulo`;
});

await etapa("galeria de outro estúdio é recusada", async () => {
  const r = await ordenarFotosDaSecao(g.id, "00000000-0000-0000-0000-000000000000", cerimonia.id, "nome");
  if (r.ok) throw new Error("ordenou a galeria alheia");
  return "recusado";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a ordem das fotos tem problema" : "\n✓ ordem das fotos ok");
process.exit(falhou ? 1 : 0);
