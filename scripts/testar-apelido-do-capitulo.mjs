#!/usr/bin/env node
/**
 * O APELIDO DO CAPÍTULO — o link curto. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-apelido-do-capitulo.mjs
 *
 * ── O PEDIDO (16/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe, com a foto da barra de endereço:
 *
 *   .../g/sirius-fotografia/lumarinowedding?previa=1&cap=c6bcbed2-5d1f-49ca-…
 *
 * "O link do capítulo está muito extenso, temos que diminuir e ficar mais
 * simples, para quando mandar."
 *
 * ── O QUE ESTE TESTE PRENDE ───────────────────────────────────────────────
 *
 * 1. Capítulo novo nasce com apelido legível, e ele é único na galeria.
 * 2. O link de HOJE leva o apelido; o de ONTEM, com UUID, continua abrindo.
 * 3. RENOMEAR não muda o apelido — senão o link já mandado morreria em
 *    silêncio, que é o defeito que os apelidos de endereço existem para evitar.
 * 4. Dois capítulos que geram o mesmo apelido não derrubam a criação.
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

const { criarSecao, renomearSecao, secaoPeloApelido, listarSecoes } =
  await import("../src/lib/secoes.ts");

const g = await galeriaDaRodada(db, { nome: "apelido", medias: 2, publicada: true });
await db.query("update galerias set senha_hash = null where id = $1", [g.id]);

console.log("\nO apelido do capítulo:\n");

await etapa("capítulo novo nasce com apelido legível", async () => {
  const s = await criarSecao(g.id, g.estudio.id, "Cerimônia");
  if (!s) throw new Error("não criou");
  if (s.slug !== "cerimonia") throw new Error(`apelido veio "${s.slug}"`);
  /* O que o Felipe queria: curto o bastante para caber numa mensagem. */
  if (s.slug.length > 40) throw new Error(`apelido de ${s.slug.length} caracteres`);
  return `/?cap=${s.slug} em vez de ${s.id}`;
});

await etapa("dois nomes que dão o mesmo apelido não derrubam a criação", async () => {
  /* "Making Of" e "Making-of" são nomes diferentes — a recusa de repetido olha
     o NOME — e os dois geram `making-of`. Sem desempate, o índice único da
     migração recusaria a segunda inserção e o capítulo simplesmente não
     nasceria, por causa de um hífen. */
  const a = await criarSecao(g.id, g.estudio.id, "Making Of");
  const b = await criarSecao(g.id, g.estudio.id, "Making-of");
  if (!a || !b) throw new Error("um dos dois não foi criado");
  if (a.slug === b.slug) throw new Error(`os dois ficaram com "${a.slug}"`);
  return `${a.slug} · ${b.slug}`;
});

await etapa("o apelido resolve para o capítulo certo", async () => {
  const s = await criarSecao(g.id, g.estudio.id, "Festa");
  const achado = await secaoPeloApelido(g.id, "festa");
  if (achado !== s.id) throw new Error(`"festa" resolveu para ${achado}`);
  return "festa → o capítulo Festa";
});

/*
 * O link de ontem leva o UUID, e link de capítulo mandado para o casal não se
 * reenvia — mesma razão dos apelidos de endereço das migrações 025 e 030. Se
 * esta etapa cair, todo link de capítulo já entregue morreu.
 */
await etapa("o link ANTIGO, com o id, continua abrindo", async () => {
  const s = await criarSecao(g.id, g.estudio.id, "Recepção");
  const achado = await secaoPeloApelido(g.id, s.id);
  if (achado !== s.id) throw new Error("o id deixou de ser aceito");
  return "id aceito";
});

await etapa("renomear NÃO muda o apelido", async () => {
  const s = await criarSecao(g.id, g.estudio.id, "Ensaio");
  await renomearSecao(s.id, g.estudio.id, "Ensaio de Casal 💍");
  const depois = (await listarSecoes(g.id)).find((x) => x.id === s.id);
  if (depois.slug !== s.slug) throw new Error(`o apelido virou "${depois.slug}"`);
  if (depois.nome === s.nome) throw new Error("o nome não chegou a mudar — o teste não provou nada");
  return `"${depois.nome}" continua em /?cap=${depois.slug}`;
});

await etapa("apelido de OUTRA galeria não é alcançado", async () => {
  const outra = await galeriaDaRodada(db, { nome: "apelido-2", medias: 0, publicada: true });
  await criarSecao(outra.id, outra.estudio.id, "Cerimônia");
  /* O mesmo apelido pode existir nas duas: ele vive dentro da galeria. O que
     não pode é um resolver para o capítulo do outro. */
  const meu = await secaoPeloApelido(g.id, "cerimonia");
  const dela = await secaoPeloApelido(outra.id, "cerimonia");
  if (!meu || !dela) throw new Error("uma das duas não resolveu");
  if (meu === dela) throw new Error("as duas galerias resolveram para o mesmo capítulo");
  return "mesmo apelido, duas galerias, dois capítulos";
});

await etapa("a barra da galeria escreve o apelido, não o id", async () => {
  /* A galeria precisa estar FATIADA para as pastilhas virarem link de verdade;
     abaixo do teto elas são âncoras (`#cap-<id>`), que é interno. */
  const html = await (
    await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })
  ).text();
  const comId = html.match(/cap=[0-9a-f]{8}-[0-9a-f]{4}/);
  if (comId) throw new Error(`ainda há link com id: ${comId[0]}`);
  return "nenhum link de capítulo com UUID";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o apelido do capítulo tem problema" : "\n✓ apelido do capítulo ok");
process.exit(falhou ? 1 : 0);
