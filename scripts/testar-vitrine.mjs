#!/usr/bin/env node
/**
 * Testa a vitrine `/e/<slug>` desenhada de verdade, no HTML que sai.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-vitrine.mjs
 *
 * `testar-site-estudio.mjs` prende as REGRAS (leitura tolerante, normalização,
 * quais seções existem) sem subir nada. Esta suíte prende o que só aparece na
 * página montada, e que passou despercebido na primeira leitura do código:
 *
 *  1. estúdio COM logo desenhava a marca e ficava sem `<h1>` nenhum — a página
 *     pública mais importante do fotógrafo sem o título que o Google lê;
 *  2. um valor torto gravado direto no banco (psql, importação) não pode virar
 *     `href` — a garantia existe em `urlDoWhatsapp`, e é aqui que ela se prova
 *     de ponta a ponta;
 *  3. site desligado tem de esconder o conteúdo mesmo já escrito, senão o
 *     rascunho do fotógrafo vaza para os clientes dele.
 *
 * Guarda e devolve o `site` que estava no banco: teste que apaga o trabalho de
 * quem estava mexendo no dev é pior que teste nenhum.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let falhou = false;
async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const { rows } = await db.query("select id, slug, site from tenants order by criado_em limit 1");
const estudio = rows[0];
if (!estudio) {
  console.error("✗ nenhum estúdio no banco de teste");
  process.exit(1);
}

const url = `${BASE}/e/${estudio.slug}`;
const siteOriginal = estudio.site;

const CHEIO = {
  ligado: true,
  frase: "Fotografia com cor e vida.",
  selo: "Agenda 2027 aberta",
  sobre: "Fotografamos casamentos desde 2014.",
  citacao: "As coisas findas, essas ficarão.",
  citacaoAutor: "Drummond",
  depoimentos: [{ texto: "Ficou perfeito!", autor: "Ana & Pedro" }],
  contatoTexto: "Chame no WhatsApp para consultar a data.",
  whatsapp: "5554999998888",
  instagram: "sirius.fotografia",
  email: "contato@estudioteste.com.br",
};

const gravar = (site) =>
  db.query("update tenants set site = $1 where id = $2", [JSON.stringify(site), estudio.id]);

const baixar = async () => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

const contar = (html, agulha) => html.split(agulha).length - 1;

try {
  console.log(`vitrine: ${url}\n`);
  console.log("com o site ligado");

  await gravar(CHEIO);
  const cheio = await baixar();

  /*
   * UM `<h1>`, sempre — e é a parte que estava quebrada.
   *
   * A capa desenha a logo quando o estúdio tem uma, e o nome escrito quando não
   * tem. O caminho da logo era só um `<img>`: a página pública que existe para
   * o casal ACHAR o fotógrafo ficava sem o título que o buscador lê primeiro, e
   * sem nada para um leitor de tela anunciar como cabeçalho da página. Não dava
   * para ver lendo o código — só contando as tags do HTML pronto.
   */
  await etapa("a página tem exatamente um <h1>", () => {
    const n = contar(cheio, "<h1");
    if (n !== 1) throw new Error(`achei ${n} <h1> (com logo ou sem, tem de haver um só)`);
  });

  await etapa("as cinco seções são desenhadas", () => {
    for (const id of ["capa", "sobre", "galerias", "depoimentos", "contato"]) {
      if (!cheio.includes(`id="${id}"`)) throw new Error(`faltou a seção ${id}`);
    }
  });

  await etapa("o menu de âncoras aparece", () => {
    if (!cheio.includes('href="#contato"')) throw new Error("sem âncora para o contato");
  });

  await etapa("os endereços de contato saem montados", () => {
    if (!cheio.includes("https://wa.me/5554999998888")) throw new Error("sem link do WhatsApp");
    if (!cheio.includes("https://instagram.com/sirius.fotografia")) {
      throw new Error("sem link do Instagram");
    }
    if (!cheio.includes("mailto:contato@estudioteste.com.br")) throw new Error("sem e-mail");
  });

  console.log("\nvalor torto gravado por fora do formulário");

  /*
   * Grava direto no banco o que o formulário jamais aceitaria. É o cenário real
   * de um `psql` na mão, uma importação ou uma action futura que esqueça de
   * normalizar — e o único jeito de provar que a peneira de `lerSite` mais os
   * montadores de endereço seguram sozinhos, sem depender da tela.
   */
  await gravar({
    ...CHEIO,
    whatsapp: "javascript:alert(1)",
    instagram: "javascript:alert(1)",
    frase: '"><script>alert(1)</script>',
  });
  const torto = await baixar();

  await etapa("nenhum href de script chega na página", () => {
    if (/href="javascript:/i.test(torto)) throw new Error("saiu um href javascript:");
    igual(contar(torto, "wa.me/"), 0, "botão do WhatsApp com valor inválido");
  });

  await etapa("texto com HTML sai escapado, não executado", () => {
    if (torto.includes("<script>alert(1)</script>")) throw new Error("o script saiu cru no HTML");
    if (!torto.includes("&lt;script&gt;")) throw new Error("esperava o texto escapado na página");
  });

  await etapa("a página continua de pé", () => igual(torto.includes('id="capa"'), true, "capa"));

  console.log("\ncom o site desligado");

  /*
   * `ligado` é o mesmo contrato de `publicada` na galeria: o fotógrafo escreve
   * antes de mostrar. Se o conteúdo escrito vazasse com o site desligado, o
   * rascunho dele estaria no ar sem que ninguém tivesse decidido isso.
   */
  await gravar({ ...CHEIO, ligado: false });
  const desligado = await baixar();

  await etapa("o que foi escrito não vaza", () => {
    igual(desligado.includes("Fotografamos casamentos desde 2014"), false, "sobre");
    igual(desligado.includes("Ficou perfeito!"), false, "depoimento");
    igual(desligado.includes("wa.me/"), false, "contato");
  });

  await etapa("a lista de galerias continua no ar", () =>
    igual(desligado.includes('id="galerias"'), true, "galerias"),
  );

  await etapa("sem menu quando só há capa e galerias", () =>
    igual(desligado.includes('href="#contato"'), false, "âncora de contato"),
  );

  console.log("\nsite em branco (como todo estúdio nasce)");

  await gravar({});
  const branco = await baixar();

  await etapa("a vitrine de antes continua idêntica", () => {
    igual(branco.includes('id="capa"'), true, "capa");
    igual(branco.includes('id="galerias"'), true, "galerias");
    igual(branco.includes('id="sobre"'), false, "sobre não aparece");
    igual(contar(branco, "<h1"), 1, "um <h1>");
  });
} finally {
  // Devolve o que estava lá. O estúdio de teste é usado por outras suítes e
  // pelo dev que estiver com a tela aberta.
  await gravar(siteOriginal ?? {});
  await db.end();
}

console.log(falhou ? "\n✗ a vitrine tem problema\n" : "\n✓ vitrine ok\n");
process.exit(falhou ? 1 : 0);
