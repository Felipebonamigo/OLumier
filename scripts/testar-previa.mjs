#!/usr/bin/env node
/**
 * Testa a AMOSTRA da prévia de aparência. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-previa.mjs
 *
 * ── O PROBLEMA (31/08/2026, reclamação da Carol) ──────────────────────────
 *
 * A prévia do editor de aparência é a galeria pública de verdade dentro de um
 * iframe de 460 px — e isso é uma qualidade do produto, não um atalho: o que se
 * vê ali é o que o cliente vê, sem imitação para sair do lugar. O custo é que
 * ela carregava a galeria INTEIRA a cada mudança de eixo: 192 fotos assinadas
 * três vezes cada (miniatura, preview e original), e 192 miniaturas baixadas
 * numa caixa onde cabem seis. Trocar de fonte levava segundos.
 *
 * A correção é uma AMOSTRA: `?amostra=1` desenha as primeiras fotos e nada mais.
 *
 * ── A ARMADILHA QUE ESTA SUÍTE EXISTE PARA PEGAR ──────────────────────────
 *
 * O botão "Visualizar galeria ↗" abre o MESMO endereço da prévia, e a promessa
 * dele é o contrário da amostra: mostrar a galeria inteira, do jeito que o
 * cliente vê. Se a amostra pegasse no `?previa=1` — que é o parâmetro que os
 * dois compartilhavam — o botão passaria a mentir, mostrando doze fotos e
 * chamando aquilo de "como o seu cliente vê".
 *
 * Por isso são dois parâmetros: `previa` continua sendo "sou o dono, deixa eu
 * ver o rascunho", e `amostra` é "estou na caixinha, manda pouco". A etapa que
 * confere o botão é a mais importante daqui.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

exigirBancoDeTeste();
import { AMOSTRA_PREVIA } from "../src/config/aparencia.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const QUANTAS = 30; // bem acima da amostra, para a diferença ser inequívoca

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

const noAr = await galeriaDaRodada(db, { nome: "previa-no-ar", medias: QUANTAS, publicada: true });
const rascunho = await galeriaDaRodada(db, {
  nome: "previa-rascunho",
  medias: QUANTAS,
  publicada: false,
});

const cookie = cookieDeSessao(noAr.estudio.id);

/**
 * Busca a página e conta ARQUIVOS DISTINTOS, não ocorrências.
 *
 * A mesma URL aparece várias vezes no HTML — no atributo da imagem e de novo na
 * carga do React que hidrata a página. Contar ocorrência dava 68 para 30 fotos e
 * fazia o teto parecer estourado quando não estava. O que custa dinheiro e tempo
 * é o arquivo distinto: uma assinatura no servidor, um download no navegador.
 *
 * As chaves do fixture terminam em `-N_thumb.webp` e `-N_prev.webp`, então o
 * sufixo identifica a foto sem depender da URL assinada, que muda a cada
 * requisição.
 */
async function medir(caminho, comCookie = false) {
  const r = await fetch(`${BASE}${caminho}`, {
    cache: "no-store",
    headers: comCookie ? { cookie } : {},
  });
  const html = r.ok ? await r.text() : "";
  const distintos = (padrao) => new Set(html.match(padrao) ?? []).size;
  return {
    status: r.status,
    thumbs: distintos(/[\w-]+-\d+_thumb\.webp/g),
    previews: distintos(/[\w-]+-\d+_prev\.webp/g),
    bytes: html.length,
  };
}

console.log("a galeria inteira");

const cheia = await medir(`/g/${noAr.tslug}/${noAr.gslug}`);

await etapa("sem parâmetro nenhum, vêm todas as fotos", () => {
  if (cheia.status !== 200) throw new Error(`HTTP ${cheia.status}`);
  if (cheia.thumbs < QUANTAS) {
    throw new Error(`${cheia.thumbs} miniaturas para ${QUANTAS} fotos — a galeria veio cortada`);
  }
  return `${cheia.thumbs} miniaturas · ${cheia.previews} previews`;
});

/*
 * A PROMESSA DO BOTÃO "VISUALIZAR GALERIA".
 *
 * Ele abre `?previa=1` e diz, embaixo, "do jeito que o seu cliente vê". Uma
 * amostra colada no parâmetro errado transforma essa frase em mentira, e é o
 * tipo de mentira que ninguém descobre até um cliente reclamar de foto sumida.
 */
await etapa('"Visualizar galeria" continua mostrando a galeria inteira', async () => {
  const m = await medir(`/g/${noAr.tslug}/${noAr.gslug}?previa=1`, true);
  if (m.status !== 200) throw new Error(`HTTP ${m.status}`);
  if (m.thumbs < QUANTAS) {
    throw new Error(
      `${m.thumbs} miniaturas para ${QUANTAS} fotos — a amostra vazou para o botão, ` +
        `que promete mostrar a galeria como o cliente vê`,
    );
  }
  return `${m.thumbs} miniaturas`;
});

console.log("\na amostra da caixinha");

const amostra = await medir(`/g/${noAr.tslug}/${noAr.gslug}?previa=1&amostra=1`, true);

await etapa("a amostra manda poucas fotos", () => {
  if (amostra.status !== 200) throw new Error(`HTTP ${amostra.status}`);
  if (amostra.thumbs > AMOSTRA_PREVIA) {
    throw new Error(`${amostra.thumbs} miniaturas, o teto é ${AMOSTRA_PREVIA}`);
  }
  if (amostra.thumbs >= cheia.thumbs) {
    throw new Error(`${amostra.thumbs} contra ${cheia.thumbs} da inteira — não encolheu nada`);
  }
  return `${amostra.thumbs} de ${cheia.thumbs}`;
});

/*
 * O preview de 2048 px serve ao lightbox, e não existe lightbox numa caixa de
 * 460 px — ninguém clica para ampliar dentro da prévia. Cada um deles é uma
 * assinatura a mais no servidor por foto, gasta para nada.
 *
 * Sobra o da CAPA, que é a única imagem grande que a prévia realmente mostra.
 */
await etapa("a amostra não assina os previews de 2048 px", () => {
  if (amostra.previews > 1) {
    throw new Error(
      `${amostra.previews} previews assinados — só o da capa deveria sobrar ` +
        `(a inteira assina ${cheia.previews})`,
    );
  }
  return `${amostra.previews} contra ${cheia.previews} da inteira`;
});

await etapa("a página da amostra é bem menor", () => {
  if (amostra.bytes >= cheia.bytes) {
    throw new Error(`${amostra.bytes} bytes contra ${cheia.bytes} da inteira`);
  }
  const queda = Math.round((1 - amostra.bytes / cheia.bytes) * 100);
  if (queda < 20) throw new Error(`só ${queda}% menor — a amostra não está economizando`);
  return `${queda}% menor`;
});

console.log("\na permissão não afrouxou");

/*
 * `amostra` é conveniência de desenho, e nunca uma porta. A regra continua a de
 * sempre: rascunho só abre para quem está logado como dono. Um parâmetro novo é
 * exatamente o lugar onde uma checagem esquecida vira vazamento silencioso.
 */
await etapa("rascunho com ?amostra=1 e sem sessão continua fechado", async () => {
  const m = await medir(`/g/${rascunho.tslug}/${rascunho.gslug}?previa=1&amostra=1`);
  if (m.status === 200) throw new Error("abriu o rascunho para quem não está logado");
  return `HTTP ${m.status}`;
});

await etapa("o dono continua vendo o próprio rascunho", async () => {
  const m = await medir(
    `/g/${rascunho.tslug}/${rascunho.gslug}?previa=1&amostra=1`,
    true,
  );
  if (m.status !== 200) throw new Error(`HTTP ${m.status} — o dono perdeu o acesso ao rascunho`);
  return `${m.thumbs} miniaturas`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a prévia tem problema" : "\n✓ prévia ok");
process.exitCode = falhou ? 1 : 0;
