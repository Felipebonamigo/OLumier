#!/usr/bin/env node
/**
 * O TAMANHO E A QUEBRA DO TÍTULO DA CAPA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-titulo-da-capa.mjs
 *
 * ── O DEFEITO (16/09/2026) ────────────────────────────────────────────────
 *
 * Felipe mandou a foto da prévia: "Nathalia & Matheus" empilhado em três
 * linhas na capa redonda. "O título fica obrigatoriamente um em cima do outro.
 * Eu acho que eu iria preferir se tudo ficasse em uma linha só."
 *
 * A causa era uma conta na fonte errada. As capas embrulhavam o título assim:
 *
 *     <div class="mt-2 max-w-[18ch] mx-auto">
 *       <h1 style="font-family: Cormorant; font-size: 48px">…</h1>
 *
 * O `18ch` estava na `div`, e `ch` é a largura do "0" DO ELEMENTO EM QUE A
 * REGRA ESTÁ. A `div` herda a fonte do corpo em 16 px, então o limite valia uns
 * 145 px — enquanto o título ao lado desenhava em 48 px e pedia uns 430. O
 * nome não cabia, e caía em três linhas dentro de uma caixa estreita demais
 * para qualquer uma delas.
 *
 * ── O QUE ESTE TESTE PRENDE ───────────────────────────────────────────────
 *
 * 1. O limite de largura mora no `h1` — onde o `ch` mede a fonte do título.
 * 2. Nome de casal comum cabe em uma linha quando a escolha é "1 linha", e o
 *    `nowrap` vem com um teto que impede o título de vazar a tela.
 * 3. "2 linhas" e "3 linhas" produzem caixas progressivamente mais estreitas,
 *    e nunca mais estreitas que a maior palavra do nome.
 * 4. A barrinha multiplica o tamanho da capa, e 100% não muda nada.
 * 5. Valor fora da faixa é aparado, não quebra a página.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import {
  OPCOES,
  lerAparencia,
  APARENCIA_PADRAO,
  TAMANHO_TITULO,
  PRESETS,
} from "../src/config/aparencia.ts";

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

/* O nome que gerou a queixa. Mantido ao pé da letra de propósito: é curto,
   tem uma palavra de oito letras e um "&" no meio — o formato de praticamente
   toda galeria de casamento, e o caso que o defeito quebrava. */
const NOME = "Nathalia & Matheus";

/* `nome` é a chave da bancada e entra no SLUG; o texto da capa é `titulo`.
   Passar "Nathalia & Matheus" como nome montaria uma URL com espaço e "&". */
const g = await galeriaDaRodada(db, {
  nome: "titulo-da-capa",
  titulo: NOME,
  medias: 3,
  publicada: true,
});
await db.query("update galerias set senha_hash = null, capa_media_id = $2 where id = $1", [
  g.id,
  g.midias[0].id,
]);

const base = { ...APARENCIA_PADRAO, capa: "redonda", tema: "claro", tipografia: "serifada" };

/** Devolve a tag `<h1 …>` da capa com a aparência pedida. */
const tituloCom = async (extra) => {
  await db.query("update galerias set aparencia = $1 where id = $2", [
    JSON.stringify({ ...base, ...extra }),
    g.id,
  ]);
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  const h1 = html.match(/<h1[^>]*>/)?.[0];
  if (!h1) throw new Error("a capa não desenhou nenhum <h1>");
  return h1;
};

console.log("\nO título da capa:\n");

/* ── 1. A CONTA SAIU DA FONTE ERRADA ─────────────────────────────────────── */

await etapa("nenhuma capa embrulha mais o título numa caixa medida na fonte do corpo", async () => {
  const fonte = await import("node:fs/promises").then((fs) =>
    fs.readFile("src/components/galeria-capa.tsx", "utf8"),
  );
  /* O padrão antigo: `max-w-[NNch]` numa classe do Tailwind, que só pode estar
     numa `div` — o `h1` recebe a largura por `style`, calculada em JavaScript.
     Os comentários saem antes da varredura: o arquivo EXPLICA o defeito citando
     a classe que o causava, e o teste não pode confundir a explicação com ele. */
  const codigo = fonte.replace(/\/\*[^]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const sobrou = codigo.match(/max-w-\[\d+ch\]/g);
  if (sobrou) throw new Error(`ainda existem: ${[...new Set(sobrou)].join(", ")}`);
  return "a largura mora no h1, onde o ch é o da fonte do título";
});

await etapa("o limite de largura chega no h1, e não num pai", async () => {
  const h1 = await tituloCom({ linhasTitulo: "duas" });
  if (!/max-width:\s*\d+ch/.test(h1)) throw new Error(`o h1 veio sem max-width em ch: ${h1}`);
  return h1.match(/max-width:\s*\d+ch/)[0];
});

/* ── 2. UMA LINHA ────────────────────────────────────────────────────────── */

await etapa('"1 linha" impede a quebra', async () => {
  const h1 = await tituloCom({ linhasTitulo: "uma" });
  if (!/white-space:\s*nowrap/.test(h1)) throw new Error(`sem nowrap: ${h1}`);
  return "white-space: nowrap";
});

/*
 * O teto é o que separa "uma linha" de "uma linha que vaza a tela". Sem ele,
 * um nome comprido com `nowrap` empurra a página inteira e a galeria ganha
 * rolagem horizontal — num celular, a foto sai de vista junto.
 */
await etapa('"1 linha" vem com teto de largura, para o nome não vazar a tela', async () => {
  const h1 = await tituloCom({ linhasTitulo: "uma" });
  if (!h1.includes("cqw")) throw new Error(`o font-size não se mede contra a coluna: ${h1}`);
  if (!/min\(/.test(h1)) throw new Error(`sem min() entre o pedido e o que cabe: ${h1}`);
  return "font-size: min(pedido, o que cabe na coluna)";
});

await etapa('"1 linha" não estreita a caixa — seria contradição', async () => {
  const h1 = await tituloCom({ linhasTitulo: "uma" });
  if (/max-width:\s*\d+ch/.test(h1)) throw new Error(`veio com caixa estreita: ${h1}`);
  return "sem max-width";
});

/* ── 3. DUAS E TRÊS LINHAS ───────────────────────────────────────────────── */

const larguraCh = (h1) => Number(h1.match(/max-width:\s*(\d+)ch/)?.[1] ?? NaN);

await etapa("três linhas pedem caixa mais estreita que duas", async () => {
  const duas = larguraCh(await tituloCom({ linhasTitulo: "duas" }));
  const tres = larguraCh(await tituloCom({ linhasTitulo: "tres" }));
  if (!(tres <= duas)) throw new Error(`três (${tres}ch) não é mais estreita que duas (${duas}ch)`);
  return `duas ${duas}ch · três ${tres}ch`;
});

/*
 * O piso da maior palavra. "Nathalia & Matheus" tem 18 caracteres; em três
 * linhas a conta ingênua pediria 6ch, e "Nathalia" tem oito letras que não
 * podem quebrar. A caixa menor que a palavra não faz três linhas — faz três
 * linhas tortas com a primeira transbordando.
 */
await etapa("a caixa nunca fica menor que a maior palavra do nome", async () => {
  const maiorPalavra = NOME.split(/\s+/).reduce((m, p) => Math.max(m, p.length), 0);
  for (const linhas of ["duas", "tres"]) {
    const ch = larguraCh(await tituloCom({ linhasTitulo: linhas }));
    if (ch < maiorPalavra) throw new Error(`${linhas}: ${ch}ch para uma palavra de ${maiorPalavra}`);
  }
  return `"Nathalia" tem ${maiorPalavra} letras e cabe nas duas`;
});

/* ── 4. A BARRINHA ───────────────────────────────────────────────────────── */

await etapa("a barrinha multiplica o tamanho da capa", async () => {
  const cem = await tituloCom({ tamanhoTitulo: 100 });
  const cento50 = await tituloCom({ tamanhoTitulo: 150 });
  if (!cem.includes("* 1")) throw new Error(`100% não saiu como fator 1: ${cem}`);
  if (!cento50.includes("* 1.5")) throw new Error(`150% não saiu como fator 1.5: ${cento50}`);
  return "100% → ×1 · 150% → ×1.5";
});

/*
 * O celular deixou de herdar o tamanho do computador. Era `text-4xl sm:text-5xl`
 * — 36 px abaixo de 640 px de tela, um degrau só. Felipe: "na visualização pro
 * celular ficou exageradamente grande, poderia ficar um pouco menor, mas
 * delicado". Com `clamp`, o mínimo é menor que o máximo e o meio é contínuo.
 */
await etapa("o tamanho é contínuo entre celular e computador, não um degrau", async () => {
  const h1 = await tituloCom({});
  const clamp = h1.match(/clamp\(([\d.]+)rem,\s*([\d.]+)vw,\s*([\d.]+)rem\)/);
  if (!clamp) throw new Error(`o font-size não veio em clamp: ${h1}`);
  const [, min, , max] = clamp.map(Number);
  if (!(min < max)) throw new Error(`mínimo ${min}rem não é menor que o máximo ${max}rem`);
  return `${min}rem no celular → ${max}rem no computador`;
});

/* ── 5. O EIXO SE COMPORTA COMO OS OUTROS ────────────────────────────────── */

await etapa("os dois eixos existem na interface", () => {
  const ids = OPCOES.linhasTitulo.map((o) => o.id);
  for (const esperado of ["auto", "uma", "duas", "tres"]) {
    if (!ids.includes(esperado)) throw new Error(`falta "${esperado}" em OPCOES.linhasTitulo`);
  }
  return ids.join(", ");
});

await etapa("a barrinha é aparada para dentro da faixa", () => {
  for (const [bruto, esperado] of [
    [10, TAMANHO_TITULO.min],
    [900, TAMANHO_TITULO.max],
    ["grande", TAMANHO_TITULO.padrao],
    [null, TAMANHO_TITULO.padrao],
  ]) {
    const a = lerAparencia({ tamanhoTitulo: bruto });
    if (a.tamanhoTitulo !== esperado) {
      throw new Error(`${JSON.stringify(bruto)} virou ${a.tamanhoTitulo}, esperado ${esperado}`);
    }
  }
  return `faixa ${TAMANHO_TITULO.min}–${TAMANHO_TITULO.max}%`;
});

await etapa("a barrinha assenta num passo inteiro, para voltar onde a pessoa soltou", () => {
  const a = lerAparencia({ tamanhoTitulo: 103 });
  if (a.tamanhoTitulo % TAMANHO_TITULO.passo !== 0) {
    throw new Error(`103 virou ${a.tamanhoTitulo}, que não é múltiplo de ${TAMANHO_TITULO.passo}`);
  }
  return `103 → ${a.tamanhoTitulo}`;
});

/* Galeria gravada antes de 16/09/2026 não tem os campos. Ela tem de desenhar
   exatamente o que desenhava: quebra automática e tamanho cheio. */
await etapa("aparência antiga cai no padrão que não muda nada", () => {
  const a = lerAparencia({ capa: "redonda", tema: "claro" });
  if (a.linhasTitulo !== "auto") throw new Error(`linhas caiu em "${a.linhasTitulo}"`);
  if (a.tamanhoTitulo !== 100) throw new Error(`tamanho caiu em ${a.tamanhoTitulo}`);
  return "auto e 100%";
});

await etapa("todo preset declara os dois campos", () => {
  for (const p of PRESETS) {
    if (!p.aparencia.linhasTitulo) throw new Error(`"${p.id}" sem linhasTitulo`);
    if (typeof p.aparencia.tamanhoTitulo !== "number") {
      throw new Error(`"${p.id}" sem tamanhoTitulo`);
    }
  }
  return `${PRESETS.length} presets`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o título da capa tem problema" : "\n✓ título da capa ok");
process.exit(falhou ? 1 : 0);
