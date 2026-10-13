#!/usr/bin/env node
/**
 * A TABELA DE ESTÚDIOS E AS SEÇÕES DA ADMINISTRAÇÃO, NO HTML SERVIDO. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-tabela-de-estudios.mjs
 *
 * Precisa do servidor de desenvolvimento rodando E de um estúdio no banco cujo
 * e-mail esteja em `ADMINS` — sem isso a página responde 404 e não há o que
 * conferir. Nesse caso PULA, como `testar-indice-do-admin`: "não rodou" não pode
 * ser confundido com "quebrou".
 *
 * ── O PEDIDO (13/10/2026) ─────────────────────────────────────────────────
 *
 * Felipe, com 44 estúdios na tela: "está bem bugado para mexer aqui e
 * reordenar". Cada clique num título era um link para a mesma página com outro
 * `?ordem=`: o servidor refazia a Administração inteira e o navegador saltava
 * para a âncora. Agora a ordem é feita NO NAVEGADOR (o que o HTML cru não
 * mostra — isso foi visto num navegador de verdade, à parte), e o que este
 * arquivo prende é o que o servidor entrega:
 *
 *   - toda coluna tem um título que é um link de verdade (`?ordem=…`), para
 *     funcionar sem JavaScript, em outra aba e no "copiar endereço";
 *   - a ordem do endereço já sai pronta no HTML, igual à da regra pura;
 *   - a tabela tem uma linha por estúdio, e a linha de total tem uma célula
 *     para cada coluna;
 *   - as colunas de envio e download aparecem, com "sem medida" quando não há;
 *   - toda seção da página é recolhível, vem aberta, e o índice continua
 *     apontando para as mesmas âncoras.
 */
import pg from "pg";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

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
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

console.log("A tabela de estúdios e as seções da Administração\n");

const admins = (process.env.ADMINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
if (admins.length === 0) {
  console.log("  ⚠ ADMINS não está configurada — pulado");
  process.exit(0);
}

let servidor = false;
try {
  servidor = (await fetch(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(4000) })).ok;
} catch {
  servidor = false;
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows: donos } = await db.query("select id from tenants where lower(email) = any($1) limit 1", [admins]);
if (!servidor || donos.length === 0) {
  console.log("  ⚠ sem servidor ou sem estúdio de admin no banco (ADMINS) — pulado");
  await db.end();
  process.exit(0);
}

const { COLUNAS_DOS_ESTUDIOS } = await import("../src/lib/ordem-dos-estudios.ts");
const cookie = cookieDeSessao(donos[0].id);
const pagina = async (busca = "") =>
  (await fetch(`${BASE}/painel/admin${busca}`, { headers: { cookie }, cache: "no-store" })).text();

const html = await pagina();
const secao = (h, id) => {
  const i = h.indexOf(`<section id="${id}"`);
  if (i < 0) throw new Error(`sem a seção ${id}`);
  return h.slice(i, h.indexOf("</section>", i));
};
const estudios = secao(html, "estudios");
const nomesNaTabela = (h) =>
  [...secao(h, "estudios").matchAll(/<tr class="align-top"><td[^>]*><a[^>]*href="\/painel\/admin\/estudios\/[^"]+"[^>]*>([^<]+)</g)].map(
    (m) => m[1].replaceAll("&amp;", "&"),
  );

const { rows: totalNoBanco } = await db.query("select count(*)::int as n from tenants");

await etapa("cada coluna tem um título que é um link de verdade para a ordem dela", () => {
  const ths = [...estudios.matchAll(/<th[^>]*>(.*?)<\/th>/gs)].map((m) => m[1]);
  igual(ths.length, COLUNAS_DOS_ESTUDIOS.length, "colunas no cabeçalho");
  for (const c of COLUNAS_DOS_ESTUDIOS) {
    const re = new RegExp(`<a href="\\?ordem=${c.id}&amp;sentido=(asc|desc)#estudios"`);
    if (!ths.some((t) => re.test(t))) throw new Error(`a coluna ${c.id} não tem link para ordenar`);
  }
  return `${ths.length} colunas, ${ths.length} links`;
});

await etapa("há uma linha por estúdio, e o total tem uma célula por coluna", () => {
  const linhas = [...estudios.matchAll(/<tr class="align-top">/g)].length;
  igual(linhas, totalNoBanco[0].n, "linhas na tabela");
  const rodape = estudios.slice(estudios.indexOf("<tfoot>"), estudios.indexOf("</tfoot>"));
  igual([...rodape.matchAll(/<td\b/g)].length, COLUNAS_DOS_ESTUDIOS.length, "células do total");
  const primeira = estudios.slice(estudios.indexOf('<tr class="align-top">'));
  igual([...primeira.slice(0, primeira.indexOf("</tr>")).matchAll(/<td\b/g)].length, COLUNAS_DOS_ESTUDIOS.length, "células de uma linha");
  return `${linhas} linhas`;
});

await etapa("a ordem do endereço já sai pronta no HTML, em ordem alfabética para ?ordem=estudio", async () => {
  const nomes = nomesNaTabela(await pagina("?ordem=estudio&sentido=asc"));
  if (nomes.length < 2) throw new Error("poucas linhas para conferir a ordem");
  const certa = [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  igual(nomes.join("|"), certa.join("|"), "ordem alfabética");
  const invertida = nomesNaTabela(await pagina("?ordem=estudio&sentido=desc"));
  igual(invertida.join("|"), [...certa].reverse().join("|"), "ordem alfabética invertida");
  return `${nomes.length} estúdios, nos dois sentidos`;
});

await etapa("endereço torto não quebra a página", async () => {
  for (const busca of ["?ordem=drop%20table", "?ordem=espaco&sentido=de-lado", "?ordem="]) {
    const h = await pagina(busca);
    if (!h.includes('<section id="estudios"')) throw new Error(`${busca}: a tabela sumiu`);
  }
  return "3 endereços tortos";
});

await etapa("as colunas de envio e download mostram 'sem medida' quando não há", () => {
  if (!estudios.includes("sem medida")) throw new Error("nenhuma célula diz 'sem medida'");
  const titulos = [...estudios.matchAll(/<th[^>]*>.*?<\/th>/gs)].map((m) => m[0]);
  if (!titulos.some((t) => t.includes(">Envio<")) && !titulos.some((t) => /Envio\s*<span/.test(t))) {
    throw new Error("falta a coluna Envio");
  }
  if (!titulos.some((t) => /Download\s*<span/.test(t))) throw new Error("falta a coluna Download");
  return "Envio e Download no cabeçalho";
});

await etapa("toda seção é recolhível, vem aberta, e o índice aponta para as mesmas âncoras", () => {
  const detalhes = [...html.matchAll(/<details open="" data-secao="([a-z-]+)"/g)].map((m) => m[1]);
  const indice = [...html.matchAll(/<a[^>]*href="#([a-z-]+)"[^>]*>/g)].map((m) => m[1]);
  const ancoras = [...new Set(indice)];
  if (detalhes.length < 11) throw new Error(`só ${detalhes.length} seções recolhíveis: ${detalhes.join(", ")}`);
  for (const id of ancoras.filter((i) => ["dinheiro", "contas", "espaco", "uso", "trafego", "velocidade", "meses", "mes-a-mes", "atencao", "estudios", "eventos"].includes(i))) {
    if (!detalhes.includes(id)) throw new Error(`a seção ${id} está no índice mas não é recolhível`);
    if (!html.includes(`<section id="${id}"`)) throw new Error(`o índice aponta para ${id}, que não existe`);
  }
  if (!html.includes("Recolher tudo") || !html.includes("Expandir tudo")) throw new Error("faltam os botões de recolher e expandir tudo");
  return `${detalhes.length} seções, todas abertas de início`;
});

await db.end();
console.log(falhou ? "\n✗ a tabela de estúdios tem problema\n" : "\n✓ a tabela de estúdios e as seções chegam como deveriam\n");
process.exit(falhou ? 1 : 0);
