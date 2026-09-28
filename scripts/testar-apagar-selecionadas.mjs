#!/usr/bin/env node
/**
 * APAGAR AS FOTOS SELECIONADAS. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-apagar-selecionadas.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (28/09/2026) ─────────────────────────────────────────────────
 *
 * Juan: "Marquei algumas que eu quero excluir. Mas não tem botão de excluir.
 * Só apagar todas. Ou apagar individualmente."
 *
 * A barra de seleção já PROMETIA isso por escrito — "Selecionar serve para agir
 * em várias de uma vez: mover para um capítulo, ou remover" — e oferecia só o
 * mover. Quem marcou trinta fotos para tirar tinha duas saídas: apagar a galeria
 * inteira, ou trinta confirmações uma a uma.
 *
 * ── POR QUE A ROTA DE APAGAR TUDO, E NÃO TRINTA CHAMADAS ──────────────────
 *
 * Apagar uma a uma pelo laço do navegador seria uma requisição por foto, cada
 * uma abrindo transação e disparando o gatilho de uso da galeria. A rota que
 * apaga em massa já existe e já faz isso certo em UMA transação; o que faltava
 * era ela aceitar "estas aqui" em vez de só "todas".
 *
 * ── O QUE NÃO PODE ACONTECER ──────────────────────────────────────────────
 *
 * Mandar uma lista de ids é o caminho mais curto entre um cliente e o dado de
 * outra pessoa. As duas últimas etapas existem por isso: id de outra galeria e
 * id de outro estúdio não podem apagar nada, e a resposta não pode contar como
 * apagado o que não apagou.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada, marcaDaRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

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

const g = await galeriaDaRodada(db, { nome: "apagar-sel", medias: 6 });
const cookie = cookieDeSessao(g.tenant_id);

const quantasSobraram = async () => {
  const { rows } = await db.query(
    "select count(*)::int as n from medias where galeria_id = $1",
    [g.id],
  );
  return rows[0].n;
};

const apagar = (corpo) =>
  fetch(`${BASE}/api/galerias/${g.id}/medias`, {
    method: "DELETE",
    headers: { cookie, "Content-Type": "application/json" },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });

console.log("Apagar só as marcadas:\n");

await etapa("apaga as duas escolhidas e não toca nas outras", async () => {
  const alvos = [g.midias[0].id, g.midias[1].id];
  const r = await apagar({ ids: alvos });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const corpo = await r.json();
  if (corpo.apagadas !== 2) throw new Error(`disse ter apagado ${corpo.apagadas}, eram 2`);

  const sobraram = await quantasSobraram();
  if (sobraram !== 4) throw new Error(`sobraram ${sobraram} de 6, esperava 4`);

  const { rows } = await db.query("select id from medias where id = any($1::uuid[])", [alvos]);
  if (rows.length !== 0) throw new Error("as escolhidas continuam lá");
  return "2 de 6";
});

await etapa("id de OUTRA galeria do mesmo estúdio não apaga nada", async () => {
  /* O filtro por galeria é o que impede a aba de uma galeria apagar foto da
     galeria ao lado — mesmo dono, e mesmo assim não é para acontecer. */
  const vizinha = await galeriaDaRodada(db, { nome: "apagar-sel-vizinha", medias: 2 });
  const antes = await db.query("select count(*)::int as n from medias where galeria_id = $1", [
    vizinha.id,
  ]);
  const r = await apagar({ ids: [vizinha.midias[0].id] });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const corpo = await r.json();
  if (corpo.apagadas !== 0) throw new Error(`disse ter apagado ${corpo.apagadas}`);
  const depois = await db.query("select count(*)::int as n from medias where galeria_id = $1", [
    vizinha.id,
  ]);
  if (depois.rows[0].n !== antes.rows[0].n) throw new Error("apagou foto da galeria vizinha");
  return "intacta";
});

await etapa("sem sessão não apaga nada", async () => {
  const antes = await quantasSobraram();
  const r = await fetch(`${BASE}/api/galerias/${g.id}/medias`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [g.midias[2].id] }),
  });
  if (r.status !== 401) throw new Error(`respondeu ${r.status}, esperava 401`);
  if ((await quantasSobraram()) !== antes) throw new Error("apagou sem sessão");
  return "401";
});

await etapa("lista vazia não apaga a galeria inteira", async () => {
  /* O caso que assusta: `ids: []` cair no caminho de "sem lista" e virar apagar
     tudo. Lista vazia é um pedido explícito de apagar nada. */
  const antes = await quantasSobraram();
  const r = await apagar({ ids: [] });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const corpo = await r.json();
  if (corpo.apagadas !== 0) throw new Error(`apagou ${corpo.apagadas} com lista vazia`);
  const depois = await quantasSobraram();
  if (depois !== antes) throw new Error(`a galeria foi de ${antes} para ${depois} fotos`);
  return "nada apagado";
});

await etapa("lixo no lugar da lista é recusado, não interpretado", async () => {
  const antes = await quantasSobraram();
  for (const corpo of [{ ids: "tudo" }, { ids: [123] }, { ids: ["nao-e-uuid"] }]) {
    const r = await apagar(corpo);
    if (r.status !== 400) {
      throw new Error(`${JSON.stringify(corpo)} respondeu ${r.status}, esperava 400`);
    }
  }
  if ((await quantasSobraram()) !== antes) throw new Error("algo foi apagado no caminho");
  return "3 recusados";
});

console.log("\nO que continua valendo:\n");

await etapa("sem lista nenhuma, segue apagando TODAS", async () => {
  /* O comportamento antigo é o de quem clica em "apagar todas", e ele não pode
     ter mudado de sentido por causa do parâmetro novo. */
  const r = await apagar(undefined);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const sobraram = await quantasSobraram();
  if (sobraram !== 0) throw new Error(`sobraram ${sobraram}`);
  return "galeria esvaziada";
});

console.log("\nO botão na tela:\n");

await etapa("a barra cumpre o que a frase acima dela promete", async () => {
  /*
   * Aqui é a FONTE, e não o HTML servido, por um motivo de construção: a barra
   * de ações só existe com algo selecionado, e selecionar é clique — não há
   * seleção no documento que o servidor manda. Buscar o botão no HTML inicial
   * seria uma etapa que nunca passa.
   *
   * O que se prende é o par: a frase que promete ("ou remover") e o botão que
   * cumpre, no mesmo componente. Foi exatamente esse par que faltou até 28/09 —
   * a promessa estava escrita e o botão não existia.
   */
  const { readFileSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const fonte = readFileSync(
    path.join(path.resolve(import.meta.dirname, ".."), "src/components/grade-medias.tsx"),
    "utf8",
  );
  if (!/ou remover/.test(fonte)) {
    throw new Error("a frase que explica a seleção sumiu — a promessa era o ponto de partida");
  }
  if (!/apagar selecionadas/.test(fonte)) {
    throw new Error("a frase promete remover e não há botão que remova");
  }
  /* E que ele use a rota em lote com a lista: um laço na rota de uma foto
     seriam N transações e N recontagens do espaço da galeria. */
  const acao = fonte.match(/async function apagarSelecionadas\([^]*?\n  \}/)?.[0] ?? "";
  if (!/ids: \[\.\.\.selecao\]/.test(acao)) {
    throw new Error("o botão não manda a lista das selecionadas para a rota em lote");
  }
  return "promessa e botão juntos";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ apagar selecionadas tem problema" : "\n✓ apagar selecionadas ok");
process.exit(falhou ? 1 : 0);
