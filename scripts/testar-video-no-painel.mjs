#!/usr/bin/env node
/**
 * O VÍDEO DO PAINEL TOCA, E A CAPA É CAPA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-video-no-painel.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O DEFEITO (achado em 29/09/2026, olhando o código por outro motivo) ────
 *
 * A grade do painel desenhava `<video src={m.url}>`, e `m.url` sai de
 * `urlDaDerivada(m.chave_thumb, m.chave, …)` — que devolve a MINIATURA quando
 * ela existe, e só cai no original quando não existe.
 *
 * Ou seja: para todo vídeo COM capa, o `src` do player era um arquivo WebP. O
 * `<video>` não toca uma imagem, e o fotógrafo via um player quebrado. E os
 * únicos que tocavam eram os que estavam SEM capa — a inversão perfeita.
 *
 * Em produção, 44 dos 46 vídeos tinham `chave_thumb` gravada. Quarenta e quatro
 * players quebrados no painel de quem paga.
 *
 * ── O DESENHO CERTO ───────────────────────────────────────────────────────
 *
 * `<video src={ORIGINAL} poster={CAPA}>`: são dois endereços diferentes para
 * duas coisas diferentes, e o HTML tem um atributo para cada uma. Sem capa, o
 * `poster` some — apontá-lo para o original mandaria o navegador desenhar um
 * filme como imagem.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

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

const g = await galeriaDaRodada(db, { nome: "video-no-painel", medias: 1 });
const cookie = cookieDeSessao(g.tenant_id);

/* Dois vídeos: um com capa gravada, outro sem. É o par que prova a inversão. */
const base = `${g.tenant_id}/${g.id}`;
for (const [nome, thumb] of [
  ["com-capa.mp4", `${base}/com-capa_thumb.webp`],
  ["sem-capa.mp4", null],
]) {
  await db.query(
    /* Sem `armazem`: vale o padrão da coluna, que é onde a fixture põe as
       fotos. Cravar 'b2' aqui faria a bancada exigir as chaves do Backblaze, que
       a máquina de desenvolvimento não tem — e o teste reprovaria por ambiente,
       no arquivo errado, que é o vermelho mais caro de diagnosticar. */
    `insert into medias (galeria_id, tenant_id, chave, chave_thumb, nome_original, mime, tipo,
                         bytes, largura, altura, pronto, ordem)
     values ($1,$2,$3,$4,$5,'video/mp4','video',1000,1920,1080,true,0)`,
    [g.id, g.tenant_id, `${base}/${nome}`, thumb, nome],
  );
}

const resposta = await fetch(`${BASE}/painel/galerias/${g.id}/fotos`, {
  headers: { cookie },
  cache: "no-store",
});
const html = await resposta.text();
if (!resposta.ok) {
  console.error(`  ✗ a aba Fotos respondeu ${resposta.status} — a bancada não seria medida`);
  process.exit(1);
}

const players = [...html.matchAll(/<video[^>]*>/g)].map((m) => m[0]);

console.log("O player do painel:\n");

await etapa("a grade desenha um player por vídeo", () => {
  if (players.length < 2) throw new Error(`achei ${players.length} <video> para 2 vídeos`);
  return `${players.length} players`;
});

await etapa("o `src` do player é o FILME, nunca a miniatura", () => {
  /*
   * A assinatura da miniatura carrega `_thumb` no caminho da chave. Se ele
   * aparecer no `src`, é o defeito de volta — e ele é MUDO: a página responde
   * 200, o elemento existe, e só não toca.
   */
  const comThumb = players.filter((p) => /src="[^"]*_thumb/.test(p));
  if (comThumb.length) {
    throw new Error(`${comThumb.length} player(s) apontam para a miniatura em vez do filme`);
  }
  return "todos apontam para o original";
});

await etapa("o vídeo COM capa leva a capa no `poster`", () => {
  const comPoster = players.filter((p) => /poster="[^"]*_thumb/.test(p));
  if (comPoster.length !== 1) {
    throw new Error(`${comPoster.length} player(s) com poster de miniatura; esperava 1`);
  }
  return "poster = miniatura";
});

await etapa("o vídeo SEM capa não ganha poster nenhum", () => {
  /* Um `poster` apontando para o original mandaria o navegador desenhar um
     filme como imagem — e o que aparece é nada, sem erro. */
  const semPoster = players.filter((p) => !/poster=/.test(p));
  if (semPoster.length !== 1) {
    throw new Error(`${semPoster.length} player(s) sem poster; esperava 1`);
  }
  return "sem poster";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o player do painel não fecha" : "\n✓ player do painel ok");
process.exitCode = falhou ? 1 : 0;
