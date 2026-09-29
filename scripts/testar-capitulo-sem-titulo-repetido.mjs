#!/usr/bin/env node
/**
 * A PASTILHA E O TÍTULO NÃO DIZEM A MESMA COISA DUAS VEZES. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-capitulo-sem-titulo-repetido.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (29/09/2026) ─────────────────────────────────────────────────
 *
 * Juan, com um print da galeria no celular e o título circulado: "ainda está
 * aparecendo aqui 'prévia do casamento', ou seja ainda aparece ali em cima a
 * 'aba' prévia e embaixo o mesmo título, fica repetitivo, não deixe os 2 se
 * repetirem, tire esse 'título', deixe só a 'aba'".
 *
 * Era a segunda vez que ele reclamava do mesmo desenho. Em 28/09 o título já
 * tinha sumido do capítulo ABERTO (`?cap=...`), e o raciocínio de então era que
 * na galeria inteira ele devia ficar, porque seria ele a separar uma seção da
 * outra enquanto se rola.
 *
 * Esse raciocínio estava errado, e dá para mostrar por quê: a barra de
 * capítulos é `sticky top-0` (`menus-da-galeria.tsx`) e um `IntersectionObserver`
 * acende a pastilha do capítulo que está na tela. Ou seja, rolando a galeria
 * inteira, o nome do capítulo corrente JÁ está sempre visível, a poucos pixels
 * do título que o repetia. Não havia o caso que justificava manter os dois.
 *
 * ── O TÍTULO SAI DA TELA, NÃO DA SEMÂNTICA ────────────────────────────────
 *
 * A `<section>` continua nomeada por `aria-label`. Quem navega por seções — ou
 * por leitor de tela, que não vê a pastilha acesa — continua sabendo onde
 * começa cada capítulo. Apagar o nome dos dois lugares resolveria a queixa
 * criando uma pior, e invisível para quem a criou.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

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

const g = await galeriaDaRodada(db, { nome: "titulo-repetido", medias: 4 });
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);

/* Dois capítulos, com foto em cada um: é a galeria inteira, que é o caso do
   print — e é o que sobrou de fora da correção de 28/09. */
const ids = [];
for (const [i, nome] of ["Prévia do casamento", "Última prova"].entries()) {
  const { rows } = await db.query(
    "insert into secoes (galeria_id, nome, slug, ordem) values ($1,$2,$3,$4) returning id",
    [g.id, nome, `cap-${i}-${g.id.slice(0, 8)}`, i],
  );
  ids.push(rows[0].id);
}
await db.query("update medias set secao_id = $2 where galeria_id = $1 and ordem < 2", [g.id, ids[0]]);
await db.query("update medias set secao_id = $2 where galeria_id = $1 and ordem >= 2", [g.id, ids[1]]);

const url = `${BASE}/g/${g.tslug}/${g.gslug}`;
const html = await (await fetch(url, { cache: "no-store" })).text();

console.log("A galeria inteira, com dois capítulos:\n");

await etapa("a barra de capítulos mostra os dois nomes", () => {
  for (const nome of ["Prévia do casamento", "Última prova"]) {
    if (!html.includes(nome)) throw new Error(`"${nome}" não aparece em lugar nenhum da página`);
  }
  /*
   * A pastilha se reconhece pela classe do acabamento (`--g-pilula`), e não
   * pelo `?cap=` do `href`: abaixo do teto de fotos a barra usa ÂNCORA em vez
   * de endereço (ver `menus-da-galeria.tsx`), e o link da galeria pequena não
   * tem `?cap=` nenhum. Procurar pelo href faria este teste passar só nas
   * galerias grandes.
   */
  const pastilhas = [...html.matchAll(/<a[^>]*rounded-\[var\(--g-pilula[^>]*>(.*?)<\/a>/gs)].map(
    (m) => m[1].replace(/<[^>]*>/g, "").trim(),
  );
  const faltando = ["Prévia do casamento", "Última prova"].filter(
    (n) => !pastilhas.some((p) => p.toLowerCase() === n.toLowerCase()),
  );
  if (faltando.length) throw new Error(`sem pastilha para: ${faltando.join(", ")}`);
  return `${pastilhas.length} pastilhas`;
});

await etapa("o nome do capítulo NÃO aparece também como título no corpo", () => {
  /*
   * A queixa, medida: o mesmo texto duas vezes, a três linhas de distância.
   * Procuramos qualquer cabeçalho (`<h2>`…`<h4>`) que repita o nome de um
   * capítulo — é o desenho que saiu.
   */
  const cabecalhos = [...html.matchAll(/<h[234][^>]*>(.*?)<\/h[234]>/gs)].map((m) =>
    m[1].replace(/<[^>]*>/g, "").trim(),
  );
  const repetidos = cabecalhos.filter((t) =>
    ["Prévia do casamento", "Última prova"].some((n) => t.toLowerCase() === n.toLowerCase()),
  );
  if (repetidos.length) {
    throw new Error(
      `o título ainda está no corpo: ${repetidos.join(", ")} — é o que o Juan circulou no print`,
    );
  }
  return `${cabecalhos.length} cabeçalhos, nenhum repete capítulo`;
});

await etapa("a seção do capítulo continua nomeada para leitor de tela", () => {
  /*
   * Sem isto, "tire o título" viraria "apague o nome do capítulo da estrutura",
   * e quem não enxerga a pastilha acesa deixaria de saber onde um capítulo
   * termina e o outro começa.
   */
  const secoes = [...html.matchAll(/<section[^>]*id="cap-[^"]*"[^>]*>/g)].map((m) => m[0]);
  if (secoes.length === 0) throw new Error("não achei as seções dos capítulos");
  const semNome = secoes.filter((s) => !/aria-label="/.test(s) && !/\bhidden\b/.test(s));
  if (semNome.length) {
    throw new Error(`${semNome.length} seção(ões) de capítulo sem aria-label`);
  }
  return `${secoes.length} seções nomeadas`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o título ainda se repete" : "\n✓ pastilha e título não se repetem");
process.exitCode = falhou ? 1 : 0;
