#!/usr/bin/env node
/**
 * As galerias favoritas — a faixa do topo da tela inicial. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-favoritas-da-lista.mjs
 *
 * Não confundir com `testar-favoritas.mjs`: aquelas são as FOTOS que o cliente
 * marca dentro da galeria. Estas são as galerias que o ESTÚDIO marca na lista
 * dele (migração 078).
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, segundoEstudioDaRodada, limparRodada, marcaDaRodada } from "./fixture-de-teste.mjs";
import {
  listarGalerias,
  listarFavoritas,
  definirFavorita,
  MAXIMO_DE_FAVORITAS,
} from "../src/lib/tenants.ts";

exigirBancoDeTeste();
const RAIZ = path.resolve(import.meta.dirname, "..");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};
const igual = (a, b, o) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${o}: veio ${JSON.stringify(a)}, esperava ${JSON.stringify(b)}`);
};

const marca = marcaDaRodada();
const novaGaleria = async (t, titulo, extra = {}) => {
  const { rows } = await db.query(
    `insert into galerias (tenant_id, slug, titulo, estado, data_evento)
     values ($1, $2, $3, $4, $5) returning id`,
    [t.id, `${titulo.toLowerCase().replace(/\W+/g, "-")}-${marca}`, titulo, extra.estado ?? "online", extra.data ?? null],
  );
  return rows[0].id;
};

try {
  const t = await estudioDaRodada(db);
  const v = await segundoEstudioDaRodada(db);
  console.log("As galerias favoritas:\n");

  const a = await novaGaleria(t, "Portfólio", { data: "2026-01-10" });
  const b = await novaGaleria(t, "Analógicas", { data: "2026-02-10" });
  const c = await novaGaleria(t, "Casamento Paula", { data: "2026-03-10" });
  const lixo = await novaGaleria(t, "Na lixeira", { estado: "lixeira" });
  const dele = await novaGaleria(v, "Do vizinho");

  await etapa("ninguém nasce favorita", async () => {
    igual((await listarFavoritas(t.id)).length, 0, "favoritas");
  });

  await etapa("marcar e desmarcar", async () => {
    igual(await definirFavorita(t.id, a, true), { ok: true }, "marcar a");
    igual(await definirFavorita(t.id, b, true), { ok: true }, "marcar b");
    igual((await listarFavoritas(t.id)).map((g) => g.id), [a, b], "na ordem em que foram marcadas");
    igual(await definirFavorita(t.id, a, false), { ok: true }, "desmarcar a");
    igual((await listarFavoritas(t.id)).map((g) => g.id), [b], "só b");
    await definirFavorita(t.id, a, true);
  });

  await etapa("marcar de novo não muda a ordem", async () => {
    const antes = (await listarFavoritas(t.id)).map((g) => g.id);
    await definirFavorita(t.id, b, true);
    igual((await listarFavoritas(t.id)).map((g) => g.id), antes, "ordem");
  });

  await etapa("a lista de baixo não repete as favoritas — mas a busca as acha", async () => {
    const sem = await listarGalerias(t.id, { semFavoritas: true });
    igual(sem.itens.map((g) => g.id).sort(), [c].sort(), "sem as favoritas");
    igual(sem.total, 1, "total sem as favoritas");
    const buscando = await listarGalerias(t.id, { semFavoritas: true, busca: "Portf" });
    igual(buscando.itens.map((g) => g.id), [a], "busca traz a favorita");
    const todas = await listarGalerias(t.id);
    igual(todas.total, 3, "sem o filtro, tudo");
  });

  await etapa("a página fora do fim ainda conta o total certo", async () => {
    const fora = await listarGalerias(t.id, { semFavoritas: true, pagina: 9 });
    igual(fora.itens.length, 0, "vazia");
    igual(fora.total, 1, "total");
  });

  await etapa("galeria de outro estúdio e da lixeira não se marcam", async () => {
    igual((await definirFavorita(t.id, dele, true)).ok, false, "do vizinho");
    igual((await definirFavorita(t.id, lixo, true)).ok, false, "da lixeira");
    igual((await definirFavorita(v.id, a, false)).ok, false, "desmarcar a do outro");
    igual((await listarFavoritas(t.id)).length, 2, "nada mudou");
  });

  await etapa(`o teto é ${MAXIMO_DE_FAVORITAS}, e diz que está cheio`, async () => {
    const ids = [];
    for (let i = 0; i < MAXIMO_DE_FAVORITAS; i++) ids.push(await novaGaleria(t, `Extra ${i}`));
    let ok = 0;
    for (const id of ids) if ((await definirFavorita(t.id, id, true)).ok) ok++;
    igual(ok, MAXIMO_DE_FAVORITAS - 2, "coube só o que faltava");
    const r = await definirFavorita(t.id, c, true);
    igual(r, { ok: false, cheia: true }, "cheia");
    igual((await listarFavoritas(t.id)).length, MAXIMO_DE_FAVORITAS, "no teto");
    igual((await definirFavorita(t.id, a, true)).ok, true, "quem já é favorita continua marcável");
  });

  await etapa("a tela está ligada à regra", async () => {
    const pagina = readFileSync(path.join(RAIZ, "src/app/painel/page.tsx"), "utf8");
    if (!pagina.includes("listarFavoritas") || !pagina.includes("semFavoritas: true")) {
      throw new Error("a tela inicial não monta a faixa de favoritas");
    }
    const lista = readFileSync(path.join(RAIZ, "src/components/lista-galerias.tsx"), "utf8");
    for (const trecho of ["alternarFavoritaAction", "Favoritas", "estrelaDe("]) {
      if (!lista.includes(trecho)) throw new Error(`a lista não tem ${trecho}`);
    }
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ as favoritas têm problema" : "\n✓ favoritas ok");
process.exitCode = falhou ? 1 : 0;
