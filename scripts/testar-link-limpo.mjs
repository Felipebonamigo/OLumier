#!/usr/bin/env node
/**
 * Testa o LINK LIMPO na barra do navegador. Uso (servidor de pé em :3040):
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-link-limpo.mjs
 *
 * ── O PROBLEMA (29/09/2026) ───────────────────────────────────────────────
 *
 * Um fotógrafo abriu "Ver como o cliente vê", entrou no capítulo Making of,
 * copiou a barra e mandou para o casal:
 *
 *     galeriaatomo.com.br/g/allan-santana-fotografia/sarah-e-levi/making-of?previa=1
 *
 * Pedido dele, pelo Felipe: tirar o "making of" e o "previa". Esta suíte prende
 * os dois lados de cada troca — o que sai da barra, e o que NÃO pode parar de
 * funcionar por causa disso:
 *
 *   - o `?previa=1` vira cookie da galeria e sai da barra; o cookie continua
 *     sendo só o pedido (sem sessão do dono ele não abre nada);
 *   - a caixinha do editor (iframe) continua com o parâmetro, sem redirecionar;
 *   - rascunho abre para o dono mesmo sem pedido — o cookie vencer não vira 404;
 *   - o capítulo abre, e a barra volta para o endereço da galeria.
 */
import pg from "pg";
import { createRequire } from "node:module";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

exigirBancoDeTeste();
const { COOKIE_PREVIA, VALIDADE_PREVIA_S, baseDaGaleria } = await import("../src/config/previa.ts");
const { criarSecao } = await import("../src/lib/secoes.ts");
const { enderecoDaBarra } = await import("../src/lib/endereco-na-galeria.ts");

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

const noAr = await galeriaDaRodada(db, { nome: "link-limpo-no-ar", medias: 4, publicada: true });
const rascunho = await galeriaDaRodada(db, { nome: "link-limpo-rascunho", medias: 4, publicada: false });
/* Dois capítulos: com um só, a barra de pastilhas nem aparece. */
for (const g of [noAr, rascunho]) {
  const makingOf = await criarSecao(g.id, g.estudio.id, "Making of");
  const cerimonia = await criarSecao(g.id, g.estudio.id, "Cerimônia");
  const [a, b, c, d] = g.midias.map((m) => m.id);
  await db.query("update medias set secao_id = $2 where id = any($1)", [[a, b], makingOf.id]);
  await db.query("update medias set secao_id = $2 where id = any($1)", [[c, d], cerimonia.id]);
  g.capitulo = makingOf.slug;
}
const sessao = cookieDeSessao(noAr.estudio.id);
const caminhoNoAr = `/g/${noAr.tslug}/${noAr.gslug}`;
const caminhoRascunho = `/g/${rascunho.tslug}/${rascunho.gslug}`;

const pedir = (caminho, cabecalhos = {}) =>
  fetch(`${BASE}${caminho}`, { redirect: "manual", cache: "no-store", headers: cabecalhos });

const aberturas = async (galeriaId) =>
  Number(
    (await db.query("select count(*) from acessos where galeria_id = $1 and acao = 'abriu'", [galeriaId]))
      .rows[0].count,
  );

console.log("\nO caminho do cookie\n");

await etapa("a base é a galeria, com ou sem capítulo", async () => {
  const casos = [
    ["/g/estudio/casamento", "/g/estudio/casamento"],
    ["/g/estudio/casamento/", "/g/estudio/casamento"],
    ["/g/estudio/casamento/making-of", "/g/estudio/casamento"],
    ["/g/estudio", null],
    ["/g/estudio/casamento/a/b", null],
    ["/painel/galerias", null],
  ];
  for (const [entrada, esperado] of casos) {
    const obtido = baseDaGaleria(entrada);
    if (obtido !== esperado) throw new Error(`${entrada} → ${obtido}, esperava ${esperado}`);
  }
  return `${casos.length} casos`;
});

await etapa("a barra depois do capítulo é a da galeria — no domínio e no endereço do estúdio", async () => {
  const casos = [
    ["/g/estudio/casamento", "", "/g/estudio/casamento"],
    ["/g/estudio/casamento/", "", "/g/estudio/casamento"],
    ["/casamento", "", "/casamento"],
    ["/g/estudio/casamento", "?cap=making-of", "/g/estudio/casamento"],
    ["/casamento", "?cap=making-of&parte=2", "/casamento"],
    ["/g/estudio/casamento", "?fotos=a,b", "/g/estudio/casamento?fotos=a%2Cb"],
    ["/g/estudio/casamento", "?previa=1&amostra=1", "/g/estudio/casamento?previa=1&amostra=1"],
  ];
  for (const [base, busca, esperado] of casos) {
    const obtido = enderecoDaBarra(base, busca);
    if (obtido !== esperado) throw new Error(`${base}${busca} → ${obtido}, esperava ${esperado}`);
  }
  return `${casos.length} casos`;
});

console.log("\nO ?previa=1 sai da barra\n");

await etapa("o botão da prévia volta ao endereço limpo, com o pedido num cookie da galeria", async () => {
  const r = await pedir(`${caminhoNoAr}?previa=1`, { cookie: sessao, "sec-fetch-dest": "document" });
  if (r.status < 300 || r.status > 399) throw new Error(`HTTP ${r.status}, esperava redirecionamento`);
  const destino = new URL(r.headers.get("location"), BASE);
  if (destino.pathname !== caminhoNoAr || destino.search) {
    throw new Error(`foi para ${destino.pathname}${destino.search}`);
  }
  const c = r.headers.get("set-cookie") ?? "";
  for (const parte of [`${COOKIE_PREVIA}=1`, `Path=${caminhoNoAr}`, "HttpOnly", `Max-Age=${VALIDADE_PREVIA_S}`]) {
    if (!c.includes(parte)) throw new Error(`o cookie não tem "${parte}": ${c}`);
  }
  return `→ ${destino.pathname}`;
});

await etapa("no capítulo sai só o previa — o resto da consulta fica", async () => {
  const r = await pedir(`${caminhoNoAr}/${noAr.capitulo}?previa=1&fotos=x`, { "sec-fetch-dest": "document" });
  const destino = new URL(r.headers.get("location") ?? "", BASE);
  if (destino.pathname !== `${caminhoNoAr}/${noAr.capitulo}` || destino.search !== "?fotos=x") {
    throw new Error(`foi para ${destino.pathname}${destino.search}`);
  }
  const c = r.headers.get("set-cookie") ?? "";
  if (!c.includes(`Path=${caminhoNoAr};`)) throw new Error(`o cookie não ficou preso à galeria: ${c}`);
  return "cookie na galeria, não no capítulo";
});

await etapa("a caixinha do editor (iframe) não é redirecionada", async () => {
  const r = await pedir(`${caminhoNoAr}?previa=1&amostra=1`, { cookie: sessao, "sec-fetch-dest": "iframe" });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return "HTTP 200, parâmetro intacto";
});

await etapa("navegador que não manda Sec-Fetch-Dest continua como antes", async () => {
  const r = await pedir(`${caminhoNoAr}?previa=1`, { cookie: sessao });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return "HTTP 200";
});

console.log("\nO cookie vale como o pedido, e só como o pedido\n");

const cookiePrevia = `${COOKIE_PREVIA}=1`;

await etapa("dono com o cookie não conta como abertura", async () => {
  const antes = await aberturas(noAr.id);
  const r = await pedir(caminhoNoAr, { cookie: `${sessao}; ${cookiePrevia}` });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const depois = await aberturas(noAr.id);
  if (depois !== antes) throw new Error(`contou ${depois - antes} abertura(s) do dono em prévia`);
  return "0 aberturas";
});

await etapa("dono SEM o cookie vê a galeria como o cliente (conta abertura)", async () => {
  const antes = await aberturas(noAr.id);
  await pedir(caminhoNoAr, { cookie: sessao });
  const depois = await aberturas(noAr.id);
  if (depois !== antes + 1) throw new Error(`esperava 1 abertura, contou ${depois - antes}`);
  return "a prévia não gruda no dono sem ele pedir";
});

await etapa("o cookie sozinho, sem sessão, não abre prévia de ninguém", async () => {
  const antes = await aberturas(noAr.id);
  await pedir(caminhoNoAr, { cookie: cookiePrevia });
  const depois = await aberturas(noAr.id);
  if (depois !== antes + 1) throw new Error("um visitante com o cookie virou dono");
  const r = await pedir(caminhoRascunho, { cookie: cookiePrevia });
  if (r.status !== 404) throw new Error(`rascunho respondeu HTTP ${r.status} para quem não é dono`);
  return "abertura contada, rascunho 404";
});

console.log("\nO rascunho\n");

await etapa("abre para o dono logado mesmo sem pedido", async () => {
  const r = await pedir(caminhoRascunho, { cookie: cookieDeSessao(rascunho.estudio.id) });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return "HTTP 200 — o cookie vencer não vira 404";
});

await etapa("continua 404 para quem não entrou", async () => {
  const r = await pedir(caminhoRascunho);
  if (r.status !== 404) throw new Error(`HTTP ${r.status}`);
  return "HTTP 404";
});

console.log("\nNo navegador\n");

/* O Playwright não é dependência do projeto (a publicação não o instala), então
   esta parte roda onde ele existir — `NODE_PATH=$(npm root -g)` na máquina de
   quem mexe na galeria. A regra do endereço é coberta sempre, pela etapa pura
   lá em cima; aqui se prova que a barra de fato troca. */
let chromium = null;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.log("  – pulado: Playwright não está instalado aqui (a regra pura já foi conferida)");
}
const navegador = chromium ? await chromium.launch() : null;
if (navegador) {
  try {
    const [nome, valor] = sessao.split(/=(.*)/s);
    const contexto = await navegador.newContext();
    await contexto.addCookies([{ name: nome, value: valor, domain: new URL(BASE).hostname, path: "/" }]);
    const pagina = await contexto.newPage();

    await etapa("\"Ver como o cliente vê\" abre com a barra limpa", async () => {
      await pagina.goto(`${BASE}${caminhoRascunho}?previa=1`);
      const agora = new URL(pagina.url());
      if (agora.pathname !== caminhoRascunho || agora.search) throw new Error(`a barra ficou ${agora.pathname}${agora.search}`);
      if (!(await pagina.locator(`a[href$="/${rascunho.capitulo}"]`).count())) {
        throw new Error("a galeria (rascunho) não abriu — não achei a pastilha do capítulo");
      }
      return agora.pathname;
    });

    await etapa("o capítulo abre, e a barra volta para o endereço da galeria", async () => {
      await pagina.locator(`a[href$="/${rascunho.capitulo}"]`).first().click();
      await pagina.waitForURL((u) => u.pathname === caminhoRascunho, { timeout: 15000 });
      const ativo = await pagina
        .locator(`a[href$="/${rascunho.capitulo}"][aria-current="page"]`)
        .count();
      if (!ativo) throw new Error("a pastilha do capítulo não está marcada — o capítulo não abriu");
      const agora = new URL(pagina.url());
      if (agora.search) throw new Error(`sobrou consulta: ${agora.search}`);
      return `${agora.pathname} (em prévia, pelo cookie)`;
    });

    await etapa("link de capítulo já mandado ao casal continua abrindo — e a barra limpa", async () => {
      const cliente = await (await navegador.newContext()).newPage();
      await cliente.goto(`${BASE}${caminhoNoAr}/${noAr.capitulo}`);
      await cliente.waitForURL((u) => u.pathname === caminhoNoAr, { timeout: 15000 });
      const ativo = await cliente.locator(`a[href$="/${noAr.capitulo}"][aria-current="page"]`).count();
      if (!ativo) throw new Error("o capítulo não abriu");
      return caminhoNoAr;
    });
  } finally {
    await navegador.close();
  }
}

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o link ainda leva o que não devia" : "\n✓ link limpo");
process.exitCode = falhou ? 1 : 0;
