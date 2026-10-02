#!/usr/bin/env node
/**
 * A TELA DA SENHA USA O DESIGN DA GALERIA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-portao-com-a-cara-da-galeria.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (01/10/2026) ─────────────────────────────────────────────────
 *
 * Juan, com um print da tela de senha de uma galeria da VicenteFilms: "o design
 * dessa tela pré não segue o da galeria?". E o Felipe: "o design da página que
 * coloca a senha tem que seguir o padrão do design bonito/escolhido pra
 * galeria. Tá ficando de outro jeito".
 *
 * Estava mesmo: o portão desenhava com os tokens da PLATAFORMA — o fundo do
 * painel, a serifada do produto, o âmbar do botão de ação. O fotógrafo escolhe
 * capa, tema, duas fontes, cor e acabamento, e a PRIMEIRA tela que o casal vê
 * ignorava tudo.
 *
 * Isso contraria o princípio central escrito em `docs/estrategia-de-marca.md`:
 * "A Galeria Átomo fica por trás. A marca do fotógrafo fica na frente". Não há
 * lugar onde isso valha mais do que aqui, que é onde o casal chega primeiro.
 *
 * ── O QUE O PORTÃO NÃO PODE GANHAR JUNTO ─────────────────────────────────
 *
 * A FOTO. Design é do fotógrafo e não conta nada sobre o casamento; foto é o
 * conteúdo que a senha protege. Vestir o portão com a aparência da galeria não
 * pode virar uma brecha para ver a capa sem a senha — e a última etapa deste
 * arquivo existe só para isso.
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

const g = await galeriaDaRodada(db, { nome: "portao-com-cara", medias: 3 });
/* Publicada E com senha: é o estado em que o casal recebe o link. */
await db.query(
  "update galerias set publicada = true, senha_hash = crypt('abracadabra', gen_salt('bf')) where id = $1",
  [g.id],
).catch(async () => {
  /* Sem pgcrypto na bancada, grava um hash qualquer: o portão só precisa que a
     coluna não seja nula para aparecer. */
  await db.query("update galerias set publicada = true, senha_hash = 'x' where id = $1", [g.id]);
});

const url = `${BASE}/g/${g.tslug}/${g.gslug}`;
const comAparencia = async (ap) => {
  await db.query("update galerias set aparencia = $1 where id = $2", [JSON.stringify(ap), g.id]);
  return (await fetch(url, { cache: "no-store" })).text();
};

console.log("A tela da senha:\n");

const claro = await comAparencia({
  capa: "minima",
  tema: "claro",
  tipografia: "bodoni",
  grade: "colunas",
  canto: "reto",
});

await etapa("é mesmo a tela da senha, e não a galeria", () => {
  if (!/Esta galeria é protegida/.test(claro)) {
    throw new Error("não caiu no portão — a bancada não tem senha");
  }
  return "portão";
});

await etapa("o portão desenha com as variáveis da galeria", () => {
  /*
   * São elas que carregam o tema inteiro. Sem elas na página, qualquer cor que
   * apareça é da plataforma por definição.
   */
  for (const v of ["--g-fundo", "--g-texto"]) {
    if (!claro.includes(v)) throw new Error(`${v} não chegou na tela da senha`);
  }
  return "--g-fundo e --g-texto";
});

await etapa("o fundo e o texto saem das variáveis, não de classe da plataforma", () => {
  const principal = claro.match(/<main[^>]*>/)?.[0] ?? "";
  if (!principal) throw new Error("não achei o <main> do portão");
  if (!/var\(--g-fundo\)/.test(principal)) {
    throw new Error(`o <main> não pinta com --g-fundo: ${principal.slice(0, 160)}`);
  }
  return "pinta pela variável";
});

await etapa("o título do casal sai na fonte escolhida", () => {
  /*
   * A Bodoni foi escolhida de propósito: ela não é a fonte da plataforma, então
   * se ela aparecer é porque veio da aparência da galeria.
   */
  /*
   * No ELEMENTO do título, e não solta na página: a primeira versão desta
   * etapa procurava a palavra "Bodoni" em qualquer lugar do HTML, e passava
   * ANTES da correção — a fonte aparece na folha de estilo da plataforma de
   * qualquer jeito. Verde sobre coisa nenhuma, de novo.
   */
  const titulo = claro.match(/<h1[^>]*>/)?.[0] ?? "";
  if (!titulo) throw new Error("não achei o <h1> do portão");
  if (!/[Bb]odoni/.test(titulo)) {
    throw new Error(`o título não sai na fonte da galeria: ${titulo.slice(0, 160)}`);
  }
  return "Bodoni no <h1>";
});

await etapa("trocar o tema da galeria troca o portão", () => {
  /* A prova de que não é coincidência: o mesmo portão, outro tema, outras
     cores. Se os dois saíssem iguais, as variáveis seriam enfeite. */
  return comAparencia({
    capa: "minima",
    tema: "noite",
    tipografia: "bodoni",
    grade: "colunas",
    canto: "reto",
  }).then((noite) => {
    const corDo = (html) => html.match(/--g-fundo:\s*([^;"]+)/)?.[1]?.trim();
    const a = corDo(claro);
    const b = corDo(noite);
    if (!a || !b) throw new Error("não achei a cor de fundo nos dois");
    if (a === b) throw new Error(`claro e noite pintam igual (${a})`);
    return `${a} → ${b}`;
  });
});

await etapa("a senha continua protegendo a FOTO", async () => {
  /*
   * A trava que esta mudança não pode afrouxar. O portão passou a mostrar o
   * DESIGN do fotógrafo — que não conta nada sobre o casamento. A foto é outra
   * coisa: é o conteúdo que a senha existe para proteger.
   */
  const html = await (await fetch(url, { cache: "no-store" })).text();
  const { rows } = await db.query(
    "select nome_original, chave from medias where galeria_id = $1",
    [g.id],
  );
  for (const m of rows) {
    if (html.includes(m.chave)) throw new Error(`a chave de ${m.nome_original} vazou no portão`);
  }
  if (/<img[^>]+src="https?:\/\/[^"]*X-Amz-Signature/.test(html)) {
    throw new Error("há uma foto assinada na tela da senha");
  }
  return `${rows.length} fotos, nenhuma na página`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a tela da senha não é a da galeria" : "\n✓ a tela da senha tem a cara da galeria");
process.exitCode = falhou ? 1 : 0;
