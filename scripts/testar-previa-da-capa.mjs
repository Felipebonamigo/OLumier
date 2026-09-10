#!/usr/bin/env node
/**
 * A PRÉVIA MOSTRA A CAPA ESCOLHIDA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-previa-da-capa.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (10/09/2026) ─────────────────────────────────────────────────
 *
 * Juan: "Tem como essa pré visualização da capa já ser a foto que eu escolhi
 * de capa?"
 *
 * ── AS DUAS CAUSAS, QUE SE SOMAM ──────────────────────────────────────────
 *
 * A prévia da aba Design é a galeria pública de verdade dentro de um iframe,
 * com `?amostra=1`. E o modo amostra CORTA a lista de fotos nas 12 primeiras
 * antes de a página procurar a capa dentro dela. Numa galeria de 1400 fotos —
 * que é a do Juan — escolher a foto 300 como capa faz a busca não achar nada e
 * cair na terceira via, "a primeira foto". A prévia mostra, com toda a
 * convicção, a foto errada; e a galeria publicada mostra a certa, porque fora
 * da amostra a lista está inteira. Ou seja: o defeito só existe na tela em que
 * ele escolhe.
 *
 * A segunda causa é o iframe não recarregar. O `src` dele é feito da APARÊNCIA
 * pendente (`?ap=`), e a capa não mora na aparência — mora em colunas da
 * galeria. Trocar a capa não muda uma letra do `src`, e um iframe cujo `src`
 * não mudou não recarrega: a prévia segue desenhando o documento velho até
 * alguém recarregar a página na mão.
 *
 * Uma sem a outra não resolve: consertar só o corte deixa a tela parada, e
 * consertar só a recarga faz a prévia recarregar para mostrar a foto errada de
 * novo.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { AMOSTRA_PREVIA } from "../src/config/aparencia.ts";

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

/* Mais fotos que o corte da amostra: é a diferença entre os dois números que
   cria o caso. Com 3 fotos o defeito é invisível, porque toda foto da galeria
   está dentro das 12 primeiras. */
const QUANTAS = AMOSTRA_PREVIA + 2;

const g = await galeriaDaRodada(db, { nome: "previa-capa", medias: QUANTAS, publicada: true });
const cookie = cookieDeSessao(g.tenant_id);
await db.query(
  `update galerias
      set senha_hash = null,
          aparencia = jsonb_set(coalesce(aparencia,'{}'::jsonb), '{capa}', '"imersa"')
    where id = $1`,
  [g.id],
);

/** A última foto — de propósito FORA das 12 que a amostra deixa passar. */
const longe = g.midias[QUANTAS - 1];
const primeira = g.midias[0];

const definirCapa = (mediaId) =>
  db.query("update galerias set capa_media_id = $2 where id = $1", [g.id, mediaId]);

const pegar = async (url) => {
  const r = await fetch(url, { headers: { cookie }, cache: "no-store" });
  if (!r.ok) throw new Error(`${url} respondeu ${r.status}`);
  return r.text();
};

const publica = (extra) => pegar(`${BASE}/g/${g.tslug}/${g.gslug}?previa=1${extra}`);
const design = () => pegar(`${BASE}/painel/galerias/${g.id}/design`);

/** A foto que a CAPA está desenhando, pelo nome do arquivo na URL assinada. */
const fotoDaCapa = (html) => {
  const cabecalho = html.match(/<header[^]*?<\/header>/)?.[0] ?? "";
  const src = cabecalho.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? "";
  /* A chave da bancada termina em `-<i>.jpg`, e a derivada em `-<i>_prev.webp`;
     o `&amp;` do HTML não atrapalha porque só o caminho interessa. */
  return decodeURIComponent(src).match(/-(\d+)(?:_prev)?\.(?:jpg|webp)/)?.[1] ?? null;
};

const indiceDe = (media) => Number(media.chave.match(/-(\d+)\.jpg$/)[1]);

console.log("A prévia mostra a capa escolhida:\n");

await etapa("a galeria PUBLICADA já acertava — é o contraste", async () => {
  await definirCapa(longe.id);
  const i = fotoDaCapa(await publica(""));
  if (i !== String(indiceDe(longe))) {
    throw new Error(`fora da amostra a capa veio ${i}, esperava ${indiceDe(longe)}`);
  }
  return `foto ${i}`;
});

await etapa("a PRÉVIA mostra a capa mesmo fora das 12 primeiras", async () => {
  await definirCapa(longe.id);
  const i = fotoDaCapa(await publica("&amostra=1"));
  if (i !== String(indiceDe(longe))) {
    throw new Error(
      `a prévia desenhou a foto ${i}, e a capa escolhida é a ${indiceDe(longe)}` +
        ` — o corte da amostra (${AMOSTRA_PREVIA}) escondeu a escolha`,
    );
  }
  return `foto ${i}`;
});

await etapa("sem capa escolhida, a prévia segue na primeira foto", async () => {
  await definirCapa(null);
  const i = fotoDaCapa(await publica("&amostra=1"));
  if (i !== String(indiceDe(primeira))) {
    throw new Error(`sem escolha veio a foto ${i}, esperava a ${indiceDe(primeira)}`);
  }
  return `foto ${i}`;
});

console.log("\nTrocar a capa recarrega a prévia:\n");

/** O `src` do iframe da prévia, que é o que decide se ele recarrega. */
const srcDaPrevia = (html) => {
  const src = html.match(/<iframe[^>]+src="([^"]*)"/)?.[1];
  if (!src) throw new Error("não achei o iframe da prévia na aba Design");
  return src;
};

await etapa("o endereço da prévia muda quando a capa muda", async () => {
  await definirCapa(primeira.id);
  const antes = srcDaPrevia(await design());
  await definirCapa(longe.id);
  const depois = srcDaPrevia(await design());
  if (antes === depois) {
    throw new Error(
      "o src do iframe é o mesmo com capas diferentes — o navegador não recarrega," +
        " e a prévia fica no documento velho",
    );
  }
  return "recarrega";
});

await etapa("mexer só na aparência não depende da capa", async () => {
  /* O contrário do de cima: a mesma capa em duas visitas tem de dar o MESMO
     endereço. Sem esta etapa, um `Date.now()` no `src` passaria na anterior e
     faria a prévia recarregar a cada tecla. */
  await definirCapa(longe.id);
  const a = srcDaPrevia(await design());
  const b = srcDaPrevia(await design());
  if (a !== b) throw new Error("duas visitas iguais deram endereços diferentes");
  return "estável";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a prévia da capa tem problema" : "\n✓ prévia da capa ok");
process.exit(falhou ? 1 : 0);
