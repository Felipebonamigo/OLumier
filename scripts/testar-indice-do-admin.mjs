#!/usr/bin/env node
/**
 * O ÍNDICE DO PAINEL DE ADMINISTRAÇÃO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-indice-do-admin.mjs
 *
 * Precisa do servidor de desenvolvimento rodando E de um estúdio no banco cujo
 * e-mail esteja em `ADMINS` — sem isso a página responde 404 para todo mundo, e
 * não há o que conferir. Nesse caso o arquivo PULA em vez de reprovar: "não
 * rodou" não pode ser confundido com "quebrou".
 *
 * ── O PEDIDO (29/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe, com um print da tabela de estúdios: "cadê a página dos sócios, que
 * mostrava tudo?".
 *
 * Nada tinha sumido. A página inteira estava lá — Dinheiro, Contas, Espaço, Uso
 * e entrega, Tráfego, Doze meses, Precisa de atenção — só que ACIMA da tabela,
 * e ele estava rolado até o pé. Uma página de nove blocos que só se percorre
 * rolando não mostra o que tem; ela esconde tudo menos onde o dedo parou.
 *
 * O índice no topo é a resposta: cada bloco ganha um nome clicável antes de a
 * rolagem começar.
 *
 * ── O QUE ESTE ARQUIVO PRENDE, E POR QUÊ ──────────────────────────────────
 *
 * Índice escrito à mão apodrece: alguém acrescenta um bloco e não acrescenta o
 * link, ou renomeia uma âncora e deixa o link apontando para o vazio. As duas
 * falhas são mudas — o link simplesmente não leva a lugar nenhum, e ninguém
 * repara até precisar.
 *
 * Então a conferência é nos dois sentidos: todo link do índice aponta para um
 * `id` que existe, e todo bloco da página aparece no índice.
 */
import pg from "pg";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let falhou = false;
const ok = (m) => console.log(`  ✓ ${m}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

console.log("O índice do painel de administração\n");

const admins = (process.env.ADMINS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (admins.length === 0) {
  console.log("  ⚠ ADMINS não está configurada — pulado");
  process.exit(0);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query("select id from tenants where lower(email) = any($1) limit 1", [
  admins,
]);
await db.end();

if (rows.length === 0) {
  console.log("  ⚠ nenhum estúdio no banco tem e-mail de admin — pulado");
  process.exit(0);
}

const r = await fetch(`${BASE}/painel/admin`, {
  headers: { cookie: cookieDeSessao(rows[0].id) },
  cache: "no-store",
});
if (!r.ok) {
  erro(`a página de administração respondeu ${r.status}`);
  process.exit(1);
}
const html = await r.text();

/* Os blocos: cada `<section id="...">` com um `<h2>` dentro. */
const blocos = [...html.matchAll(/<section id="([^"]+)"[^>]*>.*?<h2[^>]*>(.*?)<\/h2>/gs)].map(
  ([, id, titulo]) => ({ id, titulo: titulo.replace(/<[^>]*>/g, "").trim() }),
);

/* O índice: os links internos que apontam para uma âncora da própria página. */
const links = [...html.matchAll(/<a[^>]*href="#([^"]+)"[^>]*>(.*?)<\/a>/gs)].map(
  ([, id, texto]) => ({ id, texto: texto.replace(/<[^>]*>/g, "").trim() }),
);

if (blocos.length >= 5) ok(`a página tem ${blocos.length} blocos com âncora`);
else erro(`só ${blocos.length} blocos têm \`id\` — o índice não teria para onde apontar`);

if (links.length > 0) ok(`o índice tem ${links.length} links`);
else erro("não há índice nenhum no topo da página");

/* ── Sentido 1: nenhum link morto ─────────────────────────────────────────── */
const idsExistentes = new Set(blocos.map((b) => b.id));
const mortos = links.filter((l) => !idsExistentes.has(l.id));
if (mortos.length === 0) ok("todo link do índice cai num bloco que existe");
else erro(`link que não leva a lugar nenhum: ${mortos.map((l) => `#${l.id}`).join(", ")}`);

/* ── Sentido 2: nenhum bloco de fora ──────────────────────────────────────── */
const idsNoIndice = new Set(links.map((l) => l.id));
const esquecidos = blocos.filter((b) => !idsNoIndice.has(b.id));
if (esquecidos.length === 0) {
  ok("todo bloco da página aparece no índice");
} else {
  erro(
    `bloco fora do índice: ${esquecidos.map((b) => `${b.titulo} (#${b.id})`).join(", ")}` +
      " — quem acrescentar um bloco precisa acrescentar o link",
  );
}

/* ── E o índice vem ANTES do primeiro bloco ───────────────────────────────── */
const ondeIndice = html.search(/href="#/);
const ondePrimeiro = html.search(/<section id="/);
if (ondeIndice !== -1 && ondePrimeiro !== -1 && ondeIndice < ondePrimeiro) {
  ok("o índice aparece antes do primeiro bloco — antes de a rolagem começar");
} else {
  erro("o índice não está no topo; ele só serve se for a primeira coisa da página");
}

console.log(falhou ? "\n✗ o índice do admin não fecha" : "\n✓ índice do admin ok");
/*
 * `exitCode` e não `process.exit()`.
 *
 * Sair enquanto o socket do `fetch` ainda está fechando derruba o processo no
 * Windows com "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)", e o
 * 127 que sobra faria a suíte acusar VERMELHO depois de este arquivo imprimir
 * verde — o pior formato de falha que existe, porque a saída mente.
 */
process.exitCode = falhou ? 1 : 0;
