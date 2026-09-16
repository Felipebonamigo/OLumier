#!/usr/bin/env node
/**
 * O PADRÃO DE DESIGN DO ESTÚDIO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-padrao-do-estudio.mjs
 *
 * ── O PEDIDO (16/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe: "adicionar algum método de 'salvar padrão criado', para sempre se
 * repetir na hora do design da capa".
 *
 * ── O QUE ESTE TESTE PRENDE ───────────────────────────────────────────────
 *
 * 1. Salvar o padrão NÃO mexe em galeria nenhuma. É a promessa escrita na tela,
 *    e quebrá-la reescreveria entregas já feitas a partir de um botão que diz
 *    "salvar".
 * 2. Galeria nova nasce com ele.
 * 3. O estilo escolhido no assistente VENCE o padrão: é decisão tomada agora.
 * 4. Sem padrão salvo, nada muda — é o estado de todo estúdio hoje.
 * 5. O padrão é de um estúdio só.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";

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

const { salvarPadraoDoEstudio, esquecerPadraoDoEstudio, padraoDoEstudio } = await import(
  "../src/lib/aparencia-galeria.ts"
);
const { lerAparencia, APARENCIA_PADRAO } = await import("../src/config/aparencia.ts");

const t = await estudioDaRodada(db);
const antiga = await galeriaDaRodada(db, { nome: "padrao-antiga", medias: 0, publicada: true });

/* A combinação do estúdio: nada a ver com o padrão do código. */
const MEU = {
  ...APARENCIA_PADRAO,
  capa: "redonda",
  tema: "creme",
  tipografia: "bodoni",
  grade: "linhas",
  canto: "reto",
  linhasTitulo: "uma",
  tamanhoTitulo: 130,
};

console.log("\nO padrão de design do estúdio:\n");

await etapa("sem padrão salvo, a galeria nova nasce como sempre", async () => {
  if (await padraoDoEstudio(t.id)) throw new Error("nasceu com padrão do nada");
  return "nulo, que é o estado de todo estúdio hoje";
});

await etapa("salvar o padrão NÃO mexe nas galerias existentes", async () => {
  const antes = (await db.query("select aparencia from galerias where id = $1", [antiga.id]))
    .rows[0].aparencia;
  await salvarPadraoDoEstudio(t.id, MEU);
  const depois = (await db.query("select aparencia from galerias where id = $1", [antiga.id]))
    .rows[0].aparencia;
  if (JSON.stringify(antes) !== JSON.stringify(depois)) {
    throw new Error("a galeria já entregue mudou de cara");
  }
  return "entrega intacta";
});

await etapa("o padrão salvo é lido de volta, validado", async () => {
  const lido = lerAparencia(await padraoDoEstudio(t.id));
  if (lido.capa !== "redonda" || lido.tema !== "creme" || lido.tipografia !== "bodoni") {
    throw new Error(`voltou ${lido.capa}/${lido.tema}/${lido.tipografia}`);
  }
  if (lido.tamanhoTitulo !== 130) throw new Error(`a barrinha voltou em ${lido.tamanhoTitulo}`);
  return `${lido.capa} · ${lido.tema} · ${lido.tipografia}`;
});

await etapa("campo inventado no padrão não vaza para as galerias", async () => {
  /* A origem é a tela, e o que se grava vale para um ano de entregas: um campo
     torto aqui se propagaria em silêncio. Por isso passa por `lerAparencia`
     ANTES de gravar, ao contrário do rascunho, que já chega validado. */
  await salvarPadraoDoEstudio(t.id, { ...MEU, capa: "holograma", peso: "gigante" });
  const lido = lerAparencia(await padraoDoEstudio(t.id));
  if (lido.capa === "holograma") throw new Error("gravou uma capa que não existe");
  if (lido.peso === "gigante") throw new Error("gravou um peso que não existe");
  await salvarPadraoDoEstudio(t.id, MEU);
  return "aparado na gravação";
});

await etapa("o padrão é de um estúdio só", async () => {
  const { rows } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status)
     values ($1,$2,$3,'x',1,'ativo') returning id`,
    [`vizinho-${Date.now()}`, "Vizinho", `vizinho-${Date.now()}@teste.local`],
  );
  try {
    if (await padraoDoEstudio(rows[0].id)) throw new Error("o vizinho herdou o meu padrão");
    return "o vizinho continua sem padrão";
  } finally {
    await db.query("delete from tenants where id = $1", [rows[0].id]);
  }
});

await etapa("esquecer devolve o padrão do código", async () => {
  await esquecerPadraoDoEstudio(t.id);
  if (await padraoDoEstudio(t.id)) throw new Error("continuou salvo");
  await salvarPadraoDoEstudio(t.id, MEU);
  return "nulo de novo";
});

/*
 * A ORDEM entre o estilo do assistente e o padrão do estúdio.
 *
 * Quem parou na etapa de estilo e apontou um cartão tomou a decisão AGORA,
 * sobre esta galeria. O padrão é a decisão de sempre, e serve a quem passou
 * direto — que é o caminho de quem salvou o próprio padrão justamente para não
 * escolher de novo.
 */
await etapa("a criação usa o padrão do estúdio", async () => {
  const { criarGaleria } = await import("../src/lib/tenants.ts");
  const nova = await criarGaleria({ tenantId: t.id, titulo: `Nova ${Date.now()}` });
  try {
    /* Reproduz o que `criarGaleriaAction` faz quando não há preset escolhido. */
    const padrao = await padraoDoEstudio(t.id);
    await db.query("update galerias set aparencia = $1 where id = $2", [
      JSON.stringify(padrao),
      nova.id,
    ]);
    const lido = lerAparencia(
      (await db.query("select aparencia from galerias where id = $1", [nova.id])).rows[0].aparencia,
    );
    if (lido.capa !== "redonda") throw new Error(`nasceu com capa ${lido.capa}`);
    return `nasceu ${lido.capa} · ${lido.tema}`;
  } finally {
    await db.query("delete from galerias where id = $1", [nova.id]);
  }
});

await etapa("a action de criar conhece as duas fontes, na ordem certa", async () => {
  /* Leitura do código, e não do banco: o que se guarda é a ORDEM da decisão, e
     ela é uma linha só — trocá-la faria o estilo escolhido na hora perder para
     o padrão, sem nada quebrar. */
  const fonte = await import("node:fs/promises").then((fs) =>
    fs.readFile("src/app/painel/actions.ts", "utf8"),
  );
  if (!/preset\?\.aparencia \?\? \(await padraoDoEstudio\(tenantId\)\)/.test(fonte)) {
    throw new Error("a ordem entre o preset e o padrão do estúdio mudou");
  }
  return "preset escolhido vence o padrão";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o padrão do estúdio tem problema" : "\n✓ padrão do estúdio ok");
process.exit(falhou ? 1 : 0);
