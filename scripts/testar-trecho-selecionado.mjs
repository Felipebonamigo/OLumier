#!/usr/bin/env node
/**
 * MARCAR UM TRECHO COM SHIFT, E A GRADE DE CONTATO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-trecho-selecionado.mjs
 *
 * ── O PEDIDO (25/09/2026) ─────────────────────────────────────────────────
 *
 * Juan, olhando a aba Fotos com 4.577 arquivos, mandou dois ajustes que são da
 * mesma tela:
 *
 *   "Adicionar a função de selecionar várias através do comando 'segurar shift
 *    ou alt', como é padrão na movimentação de arquivos. Clica em uma, segura
 *    shift, clica em outra. E todas entre elas serem selecionadas."
 *
 *   "Deixar essas miniaturas beeeem menores. Tá quase uma visualização de
 *    galeria. Pode ser algo bem menor, pra ter mais praticidade (…) quando eu
 *    rodo muito rápido nessa parte aqui dá um lagzinho."
 *
 * ── O QUE ESTE TESTE PRENDE, E O QUE ELE NÃO ALCANÇA ──────────────────────
 *
 * A regra do trecho é função pura justamente para caber aqui: nenhuma suíte
 * desta casa abre navegador. As três invariantes que um ajuste futuro quebra
 * sem perceber são o intervalo FECHADO, o trecho que só ACRESCENTA e a âncora
 * que NÃO ANDA — cada uma tem sua etapa.
 *
 * O GESTO em si (o `shiftKey` chegando ao `onClick`, o texto que o navegador
 * pinta entre dois cliques) foi conferido no navegador, à mão, em 25/09:
 * `scratchpad/provar-shift.mjs` mediu 1 → 8 → 13 fotos marcadas e zero texto
 * selecionado. Isso aqui não alcança, e dizer que alcança seria pior que não
 * ter o teste.
 *
 * Da grade pequena o que dá para prender é a FORMA no HTML: as colunas e o
 * `content-visibility`. Os números vieram do navegador, com os 4.577 dele:
 * ladrilho de 236×295 para 116×145, página de 370.051 px para 102.173, e a
 * rolagem de 57,1 ms por quadro (148 de 149 quadros abaixo de 30 fps) para
 * 27,3 ms (43 de 149).
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

exigirBancoDeTeste();

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

const { depoisDoClique } = await import("../src/lib/trecho-selecionado.ts");

/** A grade desenhada: dez fotos, na ordem em que a tela as mostra. */
const ORDEM = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
const marcadas = (r) => [...r.selecao].sort().join("");

console.log("\nMarcar um trecho com shift:\n");

await etapa("clique comum marca uma, e vira a âncora", () => {
  const r = depoisDoClique(ORDEM, new Set(), "c", null, false);
  if (marcadas(r) !== "c") throw new Error(`veio ${marcadas(r)}`);
  if (r.ancora !== "c") throw new Error(`âncora ficou em ${r.ancora}`);
  return "c";
});

await etapa("clique comum de novo DESmarca — alternar continua valendo", () => {
  const r = depoisDoClique(ORDEM, new Set(["c"]), "c", "c", false);
  if (marcadas(r) !== "") throw new Error(`sobrou ${marcadas(r)}`);
  return "vazio";
});

await etapa("shift marca o trecho, FECHADO nas duas pontas", () => {
  const r = depoisDoClique(ORDEM, new Set(["c"]), "f", "c", true);
  /* "clica em uma, segura shift, clica em outra, e todas entre elas" inclui as
     duas que ele clicou: c, d, e, f — e não só d e e. */
  if (marcadas(r) !== "cdef") throw new Error(`veio ${marcadas(r)} (esperado cdef)`);
  return "c…f = 4 fotos";
});

await etapa("shift PARA TRÁS marca o mesmo trecho", () => {
  const r = depoisDoClique(ORDEM, new Set(["f"]), "c", "f", true);
  if (marcadas(r) !== "cdef") throw new Error(`veio ${marcadas(r)}`);
  return "f…c = as mesmas 4";
});

await etapa("a ÂNCORA NÃO ANDA: o segundo shift corrige o fim, não recomeça", () => {
  const primeiro = depoisDoClique(ORDEM, new Set(["c"]), "f", "c", true);
  if (primeiro.ancora !== "c") throw new Error(`a âncora andou para ${primeiro.ancora}`);
  /* Passou do ponto e volta: quem faz isso quer c…d, não um trecho novo a
     partir de f. Com a âncora andando viria "cdef" + "def" = cdef, e o erro
     passaria despercebido — por isso o segundo clique é ANTES do primeiro. */
  const segundo = depoisDoClique(ORDEM, primeiro.selecao, "d", primeiro.ancora, true);
  if (segundo.ancora !== "c") throw new Error(`a âncora andou para ${segundo.ancora}`);
  return "os dois shifts mediram a partir de c";
});

await etapa("o trecho só ACRESCENTA — não desmarca quem já estava dentro", () => {
  /* `d` já marcada. Alternar aqui a apagaria no meio de um intervalo que a
     pessoa acabou de pedir inteiro. */
  const r = depoisDoClique(ORDEM, new Set(["d"]), "f", "c", true);
  if (!r.selecao.has("d")) throw new Error("a foto já marcada saiu da seleção");
  if (marcadas(r) !== "cdef") throw new Error(`veio ${marcadas(r)}`);
  return "d continuou marcada";
});

await etapa("o que estava marcado FORA do trecho não se perde", () => {
  const r = depoisDoClique(ORDEM, new Set(["j"]), "f", "c", true);
  if (!r.selecao.has("j")) throw new Error("a seleção de fora do trecho foi apagada");
  return "j sobreviveu";
});

await etapa("shift SEM âncora vale como clique comum", () => {
  /* Primeiro clique da pessoa na grade, com shift segurado por acaso. Inventar
     um trecho desde a primeira foto marcaria centenas que ninguém pediu. */
  const r = depoisDoClique(ORDEM, new Set(), "f", null, true);
  if (marcadas(r) !== "f") throw new Error(`veio ${marcadas(r)} — inventou um trecho`);
  if (r.ancora !== "f") throw new Error("não virou âncora");
  return "marcou só a clicada";
});

await etapa("âncora que saiu da lista (foto removida) não quebra nada", () => {
  const r = depoisDoClique(ORDEM, new Set(), "f", "sumiu", true);
  if (marcadas(r) !== "f") throw new Error(`veio ${marcadas(r)}`);
  return "caiu no clique comum";
});

await etapa("um trecho de 300 fotos é um clique, e não 300", () => {
  const muitas = Array.from({ length: 4577 }, (_, i) => `f${i}`);
  const r = depoisDoClique(muitas, new Set([muitas[100]]), muitas[399], muitas[100], true);
  if (r.selecao.size !== 300) throw new Error(`marcou ${r.selecao.size}, esperado 300`);
  return "300 fotos de 4.577";
});

console.log("\nA grade de contato:\n");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

await etapa("a grade é de contato, e pula o que está fora da tela", async () => {
  const g = await galeriaDaRodada(db, { nome: "grade-contato", medias: 6, publicada: true });
  const html = await (
    await fetch(`${BASE}/painel/galerias/${g.id}/fotos`, {
      headers: { cookie: cookieDeSessao(g.tenant_id) },
      cache: "no-store",
    })
  ).text();

  const ul = html.match(/<ul class="[^"]*grid[^"]*"/g)?.find((t) => t.includes("grid-cols-")) ?? "";
  if (!ul) throw new Error("não achei a grade no HTML");

  /*
   * Quatro colunas eram 236 px de ladrilho — tamanho de VER a foto, e esta
   * tela é de achar, marcar e mover. O piso é oito colunas na tela larga.
   */
  const colunas = +(ul.match(/xl:grid-cols-(\d+)/)?.[1] ?? 0);
  if (colunas < 8) {
    throw new Error(
      `a grade voltou a ${colunas || "?"} colunas na tela larga — o ladrilho volta a ter o` +
        " tamanho de galeria, que é o que o Juan pediu para sair de lá",
    );
  }

  const li = html.match(/<li class="[^"]*content-visibility[^"]*"/)?.[0];
  if (!li) {
    throw new Error(
      "os ladrilhos perderam o `content-visibility` — com 4.577 fotos a rolagem volta" +
        " de 27 ms para 57 ms por quadro, que é o 'lagzinho' do relato",
    );
  }
  if (!/contain-intrinsic-size/.test(li)) {
    throw new Error("sem `contain-intrinsic-size` a barra de rolagem dança enquanto se rola");
  }

  /* O gesto tem de estar ESCRITO: ninguém tenta um atalho que a tela não
     anuncia, e foi assim que o "ordenar A-Z" ficou três dias invisível. */
  if (!/segurando\s*<kbd[^>]*>Shift<\/kbd>/.test(html.replace(/\s+/g, " "))) {
    throw new Error("a tela não conta que dá para marcar um trecho com Shift");
  }

  return `${colunas} colunas, ladrilhos contidos, gesto anunciado`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o trecho selecionado tem problema" : "\n✓ trecho selecionado ok");
process.exit(falhou ? 1 : 0);
