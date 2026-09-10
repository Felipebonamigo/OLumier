#!/usr/bin/env node
/**
 * O SLIDESHOW. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-slideshow.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (10/09/2026) ─────────────────────────────────────────────────
 *
 * Juan: "criar um sistema de SLIDESHOW com as fotos. Também pode ter nesse
 * menu da galeria. É possível?"
 *
 * ── O QUE ELE TOCA, E O QUE ISSO CUSTA ────────────────────────────────────
 *
 * Nada de tela nova: o visualizador que já existe abre a foto em tela cheia,
 * anda de seta, guarda a vizinha em cache e fecha no Esc. Slideshow é ele com
 * um relógio por cima — quatro segundos e a próxima.
 *
 * O que precisou nascer foi a ORDEM. A galeria tem dois filtros que somam ("só
 * as favoritas" e "só onde eu apareço"), e o slideshow tem de passar pelo que o
 * cliente está VENDO — senão ligar o filtro das favoritas e mandar tocar
 * devolveria o casamento inteiro na tela. A grade e o slideshow agora
 * perguntam à MESMA função quais fotos estão visíveis; era isso ou duas cópias
 * da regra, que é como filtros passam a discordar.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { indicesVisiveis, SEGUNDOS_POR_FOTO } from "../src/lib/fotos-visiveis.ts";

await exigirBancoDeTeste();

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
const igual = (a, b, o) => {
  const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
  if (x !== y) throw new Error(`${o}: esperava ${y}, veio ${x}`);
};

console.log("A ordem que o slideshow segue:\n");

const FOTOS = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
const semFiltro = { soFavoritas: false, favoritas: new Set(), encontradas: null };

await etapa("sem filtro, passa por todas na ordem da página", () => {
  igual(indicesVisiveis(FOTOS, semFiltro), [0, 1, 2, 3], "ordem");
  return "4 fotos";
});

await etapa("com o filtro das favoritas, só as marcadas", () => {
  const ordem = indicesVisiveis(FOTOS, {
    ...semFiltro,
    soFavoritas: true,
    favoritas: new Set(["b", "d"]),
  });
  igual(ordem, [1, 3], "ordem");
  return "b, d";
});

await etapa("favoritas marcadas mas filtro DESLIGADO não muda nada", () => {
  /* Marcar não é filtrar: quem marcou trinta fotos e não ligou o filtro
     continua vendo — e tocando — a galeria inteira. */
  const ordem = indicesVisiveis(FOTOS, { ...semFiltro, favoritas: new Set(["b"]) });
  igual(ordem, [0, 1, 2, 3], "ordem");
});

await etapa("com a busca por rosto, só onde a pessoa aparece", () => {
  const ordem = indicesVisiveis(FOTOS, { ...semFiltro, encontradas: new Set(["a", "c"]) });
  igual(ordem, [0, 2], "ordem");
  return "a, c";
});

await etapa("os dois filtros somam — é a interseção, não a soma", () => {
  const ordem = indicesVisiveis(FOTOS, {
    soFavoritas: true,
    favoritas: new Set(["b", "c"]),
    encontradas: new Set(["c", "d"]),
  });
  igual(ordem, [2], "ordem");
  return "só c";
});

await etapa("filtro que não deixa nada passar devolve lista vazia", () => {
  const ordem = indicesVisiveis(FOTOS, {
    ...semFiltro,
    soFavoritas: true,
    favoritas: new Set(["z"]),
  });
  igual(ordem, [], "ordem");
});

await etapa("o intervalo entre as fotos é um número de segundos plausível", () => {
  if (!(SEGUNDOS_POR_FOTO >= 2 && SEGUNDOS_POR_FOTO <= 10)) {
    throw new Error(`${SEGUNDOS_POR_FOTO}s por foto não é ritmo de slideshow`);
  }
  return `${SEGUNDOS_POR_FOTO}s`;
});

console.log("\nO comando na barra:\n");

const g = await galeriaDaRodada(db, { nome: "slideshow", medias: 3, publicada: true });
await db.query("update galerias set senha_hash = null where id = $1", [g.id]);

const barra = async () => {
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  const b = html.match(/<nav[^>]*aria-label="Menu da galeria"[^]*?<\/nav>/)?.[0];
  if (!b) throw new Error('não achei <nav aria-label="Menu da galeria">');
  return b;
};

await etapa("a barra traz o Slideshow", async () => {
  if (!/Slideshow/.test(await barra())) throw new Error("não achei o comando na barra");
});

await etapa("com uma foto só, o Slideshow não aparece", async () => {
  /* Tocar uma foto sozinha é a mesma coisa que abri-la, e um comando que não
     faz nada é pior que comando nenhum: gasta o clique e ensina a desconfiar. */
  await db.query(
    "update medias set pronto = false where galeria_id = $1 and id <> $2",
    [g.id, g.midias[0].id],
  );
  try {
    if (/Slideshow/.test(await barra())) throw new Error("apareceu com uma foto só");
    return "some";
  } finally {
    await db.query("update medias set pronto = true where galeria_id = $1", [g.id]);
  }
});

await etapa("galeria sem download liberado continua com Slideshow", async () => {
  /* Ver não é baixar: bloquear o download não pode tirar do cliente o direito
     de assistir às fotos. */
  await db.query("update galerias set permite_download = false where id = $1", [g.id]);
  try {
    if (!/Slideshow/.test(await barra())) throw new Error("o Slideshow sumiu junto com o download");
    return "continua";
  } finally {
    await db.query("update galerias set permite_download = true where id = $1", [g.id]);
  }
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o slideshow tem problema" : "\n✓ slideshow ok");
process.exit(falhou ? 1 : 0);
