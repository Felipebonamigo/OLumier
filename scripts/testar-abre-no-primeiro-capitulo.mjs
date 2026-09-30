#!/usr/bin/env node
/**
 * COM CAPÍTULO, A GALERIA ABRE NO PRIMEIRO — NÃO EM TUDO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-abre-no-primeiro-capitulo.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (30/09/2026) ─────────────────────────────────────────────────
 *
 * Juan, sobre a galeria de uma storymaker: "assim que abre a galeria ele tá
 * aparecendo todos os capítulos. Os vídeos dela estão separados em 3 capítulos,
 * mas assim que abre aparece tudo junto, deveria mostrar apenas o do capítulo".
 *
 * O desenho até aqui: abaixo de 600 itens a galeria vinha inteira e os
 * capítulos eram seções empilhadas — a pastilha rolava até elas. Acima de 600
 * ela abria um capítulo por vez. Ou seja, o produto mudava de natureza entre
 * 599 e 601 itens, e quem tem 8 vídeos caía no lado errado: três capítulos
 * empilhados viram uma tira alta, e o capítulo deixa de significar alguma coisa.
 *
 * Felipe decidiu pelo mesmo comportamento em qualquer tamanho: com capítulo, a
 * galeria abre no PRIMEIRO. É uma mudança de experiência em toda galeria
 * entregue que tem capítulo — o casal que rolava tudo passa a navegar por
 * pastilha —, e por isso ela vem com este arquivo.
 *
 * ── O QUE NÃO PODE MUDAR JUNTO ───────────────────────────────────────────
 *
 * Galeria SEM capítulo continua vindo inteira: ali não há o que escolher, e
 * cortá-la seria inventar um capítulo que o fotógrafo não criou.
 *
 * E a busca — `?fotos=` da busca por rosto e do "ver só as favoritas" — NÃO
 * pode ser restringida ao primeiro capítulo. Ela responde "onde eu apareço na
 * galeria inteira"; limitá-la ao capítulo de abertura devolveria um subconjunto
 * silencioso, que é o pior jeito de errar: o convidado vê 4 fotos e acredita
 * que são todas.
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

/* Nove mídias, MUITO abaixo do teto de 600: é o caso do Juan. */
const g = await galeriaDaRodada(db, { nome: "abre-no-primeiro", medias: 9 });
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);
const url = `${BASE}/g/${g.tslug}/${g.gslug}`;

const nomes = (html) =>
  [...html.matchAll(/abre-no-primeiro-(\d+)\.jpg/g)].map((m) => Number(m[1]));
const unicos = (html) => [...new Set(nomes(html))].sort((a, b) => a - b);

console.log("Sem capítulo nenhum:\n");

await etapa("a galeria sem capítulo continua vindo inteira", async () => {
  const html = await (await fetch(url, { cache: "no-store" })).text();
  const vistas = unicos(html);
  if (vistas.length !== 9) throw new Error(`vieram ${vistas.length} de 9 fotos`);
  return "9 de 9";
});

/* Três capítulos, três fotos em cada — o desenho da galeria dela. */
const ids = [];
for (const [i, nome] of ["Aftermovie", "Cerimônia", "Festa"].entries()) {
  const { rows: [s] } = await db.query(
    "insert into secoes (galeria_id,nome,slug,ordem) values ($1,$2,$3,$4) returning id",
    [g.id, nome, ["aftermovie", "cerimonia", "festa"][i], i],
  );
  ids.push(s.id);
}
for (const [i, id] of ids.entries()) {
  await db.query(
    "update medias set secao_id = $2 where galeria_id = $1 and ordem >= $3 and ordem < $4",
    [g.id, id, i * 3, i * 3 + 3],
  );
}

console.log("\nCom três capítulos:\n");

await etapa("abrir a galeria mostra SÓ o primeiro capítulo", async () => {
  const html = await (await fetch(url, { cache: "no-store" })).text();
  const vistas = unicos(html);
  /* As três primeiras (ordem 0,1,2) são do Aftermovie. */
  if (vistas.length !== 3) {
    throw new Error(`vieram ${vistas.length} fotos: ${vistas.join(",")} — era para vir 3`);
  }
  if (vistas.some((n) => n > 2)) {
    throw new Error(`veio foto de outro capítulo: ${vistas.join(",")}`);
  }
  return "3 do Aftermovie";
});

await etapa("os outros capítulos continuam alcançáveis pela pastilha", async () => {
  const html = await (await fetch(`${url}/festa`, { cache: "no-store" })).text();
  const vistas = unicos(html);
  if (vistas.length !== 3 || vistas.some((n) => n < 6)) {
    throw new Error(`a Festa veio com ${vistas.join(",")}`);
  }
  return "3 da Festa";
});

await etapa("a barra continua oferecendo os três", async () => {
  const html = await (await fetch(url, { cache: "no-store" })).text();
  for (const nome of ["Aftermovie", "Cerimônia", "Festa"]) {
    if (!html.includes(nome)) throw new Error(`"${nome}" sumiu da barra`);
  }
  return "3 pastilhas";
});

await etapa("a busca por fotos NÃO é presa ao capítulo de abertura", async () => {
  /*
   * A regressão que esta mudança poderia criar, e a mais silenciosa: a busca
   * por rosto e o "ver só as favoritas" respondem sobre a galeria INTEIRA. Se
   * o corte do primeiro capítulo valesse aqui, o convidado veria 1 foto de 3 e
   * acreditaria que são todas.
   */
  const { rows } = await db.query(
    "select id from medias where galeria_id = $1 order by ordem",
    [g.id],
  );
  const escolhidas = [rows[0].id, rows[4].id, rows[8].id]; // um de cada capítulo
  const html = await (
    await fetch(`${url}?fotos=${escolhidas.join(",")}`, { cache: "no-store" })
  ).text();
  const vistas = unicos(html);
  if (vistas.length !== 3) throw new Error(`a busca devolveu ${vistas.join(",")}`);
  if (!vistas.includes(0) || !vistas.includes(4) || !vistas.includes(8)) {
    throw new Error(`a busca perdeu foto de outro capítulo: ${vistas.join(",")}`);
  }
  return "as 3, de capítulos diferentes";
});

await etapa("foto sem capítulo continua alcançável", async () => {
  /* Se sobrar foto solta, ela não pode ficar inalcançável só porque a galeria
     passou a abrir no primeiro capítulo. */
  await db.query(
    "update medias set secao_id = null where galeria_id = $1 and ordem = 8",
    [g.id],
  );
  const html = await (await fetch(`${url}/sem-capitulo`, { cache: "no-store" })).text();
  const vistas = unicos(html);
  if (!vistas.includes(8)) throw new Error(`as soltas vieram ${vistas.join(",")}`);
  return "alcançável";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a galeria não abre no capítulo" : "\n✓ abre no primeiro capítulo");
process.exitCode = falhou ? 1 : 0;
