#!/usr/bin/env node
/**
 * PASTAS E STREAM SÓ PARA AS CONTAS LIBERADAS (30/09/2026). Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-formatos-liberados.mjs
 *
 * Felipe: "isso só ficará visível para sócios primeiramente". O que este
 * arquivo prende é o lado que ninguém vê quando dá errado:
 *
 *   1. A GALERIA PÚBLICA obedece à trava. A aparência gravada pode dizer
 *      "pastas" — o formulário é um endpoint —, e uma conta sem liberação
 *      continua entregando a galeria de sempre.
 *   2. Liberada (o botão do Admin grava `formatos_liberados_em`), a mesma
 *      galeria abre em pastas, sem republicar nada.
 *   3. O Design da conta sem liberação não oferece o grupo Formato.
 *   4. A regra: carimbo OU admin.
 *
 * 07/10/2026 — "Libere as pastas e stream para todos": a chave
 * `FORMATOS_ABERTOS_A_TODOS` abre para toda conta. Os passos 1 e 3 esperam o
 * que a chave manda (aberta: a conta sem carimbo também vê; fechada: não vê),
 * então o arquivo vale nos dois estados, e a regra por conta do passo 4 é
 * conferida com a chave fechada à força.
 *
 * Os dados são desta rodada (ver o aviso em `testar-tudo.mjs`): um estúdio
 * próprio, uma galeria com dois capítulos e uma foto em cada. As fotos não
 * precisam existir no armazém — a página só ASSINA a miniatura, não a busca.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
async function etapa(nome, fn, detalhe) {
  try {
    const d = (await fn()) ?? detalhe;
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}

console.log("Pastas e Stream — a trava por conta e a chave de abrir a todos:\n");

/* ── 4. a regra, sem servidor ─────────────────────────────────────────── */
const antes = process.env.ADMINS;
process.env.ADMINS = "socio@teste.local";
const { formatosLiberados, FORMATOS_ABERTOS_A_TODOS } = await import("../src/config/formatos-liberados.ts");
await etapa("chave fechada: carimbo ou admin libera; nenhum dos dois, não", () => {
  if (!formatosLiberados({ formatos_liberados_em: new Date(), email: "x@y.z" }, false)) throw new Error("carimbo não liberou");
  if (!formatosLiberados({ formatos_liberados_em: null, email: "SOCIO@teste.local" }, false)) throw new Error("admin não liberou");
  if (formatosLiberados({ formatos_liberados_em: null, email: "cliente@y.z" }, false)) throw new Error("liberou sem nada");
});
await etapa("chave aberta: toda conta libera, com ou sem carimbo", () => {
  if (!formatosLiberados({ formatos_liberados_em: null, email: "cliente@y.z" }, true)) throw new Error("conta comum não liberou");
  if (!formatosLiberados({}, true)) throw new Error("conta sem dados não liberou");
});
await etapa("sem argumento vale a chave do código", () => {
  const sem = formatosLiberados({ formatos_liberados_em: null, email: "cliente@y.z" });
  if (sem !== FORMATOS_ABERTOS_A_TODOS) throw new Error(`devolveu ${sem} com a chave em ${FORMATOS_ABERTOS_A_TODOS}`);
}, `chave em ${FORMATOS_ABERTOS_A_TODOS}`);
process.env.ADMINS = antes ?? "";

/* ── a bancada ─────────────────────────────────────────────────────────── */
const estudio = await estudioDaRodada(db);
const galeria = await galeriaDaRodada(db, { nome: "formatos" });
await db.query("update tenants set formatos_liberados_em = null where id = $1", [estudio.id]);
const secoes = [];
for (const [i, nome] of ["Cerimônia", "Festa"].entries()) {
  const { rows } = await db.query(
    "insert into secoes (galeria_id, nome, slug, ordem) values ($1, $2, $3, $4) returning id",
    [galeria.id, nome, `cap-${i}`, i],
  );
  secoes.push(rows[0].id);
  await db.query(
    `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime, bytes, secao_id, ordem, pronto)
     values ($1, $2, $3, $4, 'foto', 'image/jpeg', 1000, $5, $6, true)`,
    [galeria.id, estudio.id, `${estudio.id}/${galeria.id}/f${i}-${Date.now()}.jpg`, `f${i}.jpg`, rows[0].id, i],
  );
}
/* A aparência já gravada em pastas — o caso de quem mandou o campo por fora. */
await db.query("update galerias set aparencia = $1 where id = $2", [
  JSON.stringify({ formato: "pastas", estiloPastas: "capas" }),
  galeria.id,
]);
const endereco = `${BASE}/g/${estudio.slug}/${galeria.slug}`;
const ehPastas = (html) => html.includes('aria-label="Pastas"') && html.includes("Cerimônia");

/* ── 1. sem carimbo: o que a chave manda ──────────────────────────────── */
const abre = FORMATOS_ABERTOS_A_TODOS ? "abre em pastas" : "abre como galeria";
await etapa(`sem carimbo, a galeria pública ${abre}`, async () => {
  const html = await (await fetch(endereco)).text();
  if (ehPastas(html) !== FORMATOS_ABERTOS_A_TODOS) {
    throw new Error(
      FORMATOS_ABERTOS_A_TODOS
        ? "a chave está aberta e a conta sem carimbo não viu pastas"
        : "abriu em pastas sem a conta estar liberada",
    );
  }
}, `chave em ${FORMATOS_ABERTOS_A_TODOS}`);

/* ── 3. o Design oferece (ou não) o formato ─────────────────────────────── */
await etapa(`sem carimbo, o Design ${FORMATOS_ABERTOS_A_TODOS ? "mostra" : "não mostra"} o grupo Formato`, async () => {
  const r = await fetch(`${BASE}/painel/galerias/${galeria.id}/design`, {
    headers: { cookie: cookieDeSessao(estudio.id) },
  });
  const html = await r.text();
  if (r.status !== 200) throw new Error(`design respondeu ${r.status}`);
  if (html.includes(">Formato<") !== FORMATOS_ABERTOS_A_TODOS) {
    throw new Error(FORMATOS_ABERTOS_A_TODOS ? "o grupo Formato não apareceu" : "o grupo Formato apareceu");
  }
});

/* ── 2. liberada, pastas ───────────────────────────────────────────────── */
await db.query("update tenants set formatos_liberados_em = now() where id = $1", [estudio.id]);
await etapa("liberada, a mesma galeria abre em pastas", async () => {
  const html = await (await fetch(endereco)).text();
  if (!ehPastas(html)) throw new Error("não abriu em pastas com a conta liberada");
});
await etapa("liberada, o Design mostra o grupo Formato", async () => {
  const html = await (
    await fetch(`${BASE}/painel/galerias/${galeria.id}/design`, { headers: { cookie: cookieDeSessao(estudio.id) } })
  ).text();
  if (!html.includes(">Formato<")) throw new Error("o grupo Formato não apareceu");
});

await limparRodada(db);
await db.end();
console.log(falhou ? "\n✗ trava dos formatos com falha" : "\n✓ trava dos formatos ok");
process.exit(falhou ? 1 : 0);
