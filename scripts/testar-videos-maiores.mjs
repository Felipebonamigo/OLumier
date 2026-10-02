#!/usr/bin/env node
/**
 * CAPÍTULO DE VÍDEO APARECE MAIOR. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-videos-maiores.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (30/09/2026) ─────────────────────────────────────────────────
 *
 * Juan, sobre a galeria de uma cliente: "os vídeos dela estão separados em 3
 * capítulos (…) e, como são poucos vídeos, acho que podemos aumentar a
 * visualização deles".
 *
 * Três vídeos numa grade calibrada para cinquenta fotos saem do tamanho de uma
 * miniatura, com uma faixa de nada à direita. O capítulo que é só vídeo não tem
 * o problema que a grade resolve — ele tem o oposto.
 *
 * ── A REGRA, E POR QUE ELA É ESTREITA ─────────────────────────────────────
 *
 * Só capítulo em que TODOS os itens são vídeo, e poucos. As duas condições
 * existem para não estragar o resto:
 *
 *  · capítulo MISTO cresceria junto com as fotos, e trinta fotos gigantes é
 *    exatamente a queixa contrária — foi por isso que a grade tem densidade;
 *  · capítulo com MUITOS vídeos é uma lista, e lista grande em cartão grande
 *    só vira rolagem.
 *
 * ── COMO O TESTE MEDE TAMANHO SEM UM NAVEGADOR ────────────────────────────
 *
 * A grade "Colunas" desenha, antes de medir a tela, cada item com a altura de
 * reserva — `largura × 1.25`, com `largura` saindo da densidade. Essa altura sai
 * no HTML do servidor, em pixel, no `style` de cada célula. Então comparar a
 * altura do primeiro item de dois capítulos da MESMA galeria compara o tamanho
 * que a grade reservou para cada um, sem abrir navegador nenhum.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
};

const g = await galeriaDaRodada(db, { nome: "videos-maiores", medias: 3 });
await db.query("update galerias set publicada = true, senha_hash = null, aparencia = $1 where id = $2", [
  JSON.stringify({ capa: "minima", tema: "claro", grade: "colunas", densidade: "normal" }),
  g.id,
]);

/** Um capítulo, com `quantos` vídeos dentro (ou nenhum, para só fotos). */
async function capitulo(nome, slug, ordem, videos) {
  const { rows: [s] } = await db.query(
    "insert into secoes (galeria_id,nome,slug,ordem) values ($1,$2,$3,$4) returning id",
    [g.id, nome, slug, ordem],
  );
  for (let i = 0; i < videos; i++) {
    const chave = `${g.tenant_id}/${g.id}/${slug}-${i}.mp4`;
    await db.query(
      `insert into medias
         (galeria_id, tenant_id, secao_id, chave, chave_thumb, nome_original, tipo, mime,
          bytes, largura, altura, ordem, pronto)
       values ($1,$2,$3,$4,$5,$6,'video','video/mp4',$7,1920,1080,$8,true)`,
      [g.id, g.tenant_id, s.id, chave, `${chave}_thumb.webp`, `${slug}-${i}.mp4`, 5_000_000, 100 + i],
    );
  }
  return s.id;
}

/* "Fotos" leva as três fotos da bancada; os outros nascem com vídeo. */
const fotos = await capitulo("Fotos", "fotos", 0, 0);
await db.query("update medias set secao_id = $2 where galeria_id = $1 and tipo = 'foto'", [g.id, fotos]);
const filmes = await capitulo("Filmes", "filmes", 1, 3);
const lista = await capitulo("Lista", "lista", 2, 12);
const misto = await capitulo("Misto", "misto", 3, 2);

const base = `${BASE}/g/${g.tslug}/${g.gslug}`;
const html = async (cap) => (await fetch(`${base}?cap=${cap}`, { cache: "no-store" })).text();

/**
 * A altura que a grade reservou para o primeiro item do capítulo aberto.
 *
 * Lê DENTRO da `<section>` do capítulo: a mesma página tem a capa e, em galeria
 * fatiada, outras seções — pegar o primeiro `height:` do documento mediria
 * qualquer coisa. A seção é identificada pelo `id="cap-<uuid>"`.
 */
function alturaDoPrimeiro(pagina, secaoId) {
  const i = pagina.indexOf(`id="cap-${secaoId}"`);
  if (i === -1) throw new Error(`não achei a seção ${secaoId} na página`);
  const fim = pagina.indexOf("</section>", i);
  const trecho = pagina.slice(i, fim === -1 ? undefined : fim);
  const m = trecho.match(/height:([\d.]+)px/);
  if (!m) throw new Error("não achei a altura reservada na seção");
  return Number(m[1]);
}

console.log("O tamanho dos vídeos na grade:\n");

let alturaDasFotos = 0;

await etapa("o capítulo de fotos continua do tamanho de sempre", async () => {
  alturaDasFotos = alturaDoPrimeiro(await html("fotos"), fotos);
  if (!(alturaDasFotos > 0)) throw new Error("altura inválida");
  return `${alturaDasFotos}px`;
});

await etapa("o capítulo com poucos vídeos aparece maior", async () => {
  const a = alturaDoPrimeiro(await html("filmes"), filmes);
  if (a <= alturaDasFotos) {
    throw new Error(`o vídeo saiu em ${a}px, a foto em ${alturaDasFotos}px — é a queixa do Juan`);
  }
  return `${a}px contra ${alturaDasFotos}px`;
});

await etapa("capítulo com MUITOS vídeos não cresce", async () => {
  /* Doze vídeos em cartão grande viram rolagem, não visualização. */
  const a = alturaDoPrimeiro(await html("lista"), lista);
  if (a !== alturaDasFotos) throw new Error(`cresceu para ${a}px com 12 vídeos`);
  return `${a}px`;
});

await etapa("capítulo MISTO não cresce — as fotos cresceriam junto", async () => {
  const { rows: [m] } = await db.query(
    "select id from medias where galeria_id = $1 and tipo = 'foto' order by ordem limit 1",
    [g.id],
  );
  await db.query("update medias set secao_id = $2 where id = $1", [m.id, misto]);
  const a = alturaDoPrimeiro(await html("misto"), misto);
  if (a !== alturaDasFotos) throw new Error(`cresceu para ${a}px com foto dentro`);
  return `${a}px`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o tamanho dos vídeos não fecha" : "\n✓ vídeo em capítulo de vídeo sai maior");
process.exitCode = falhou ? 1 : 0;
