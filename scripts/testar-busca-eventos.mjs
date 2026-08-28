#!/usr/bin/env node
/**
 * Testa a pesquisa do log de auditoria. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-busca-eventos.mjs
 *
 * Por que existe: o painel mostrava os 40 eventos mais recentes numa lista
 * corrida, e uma limpeza de galeria despeja trinta `media.apagada` no mesmo
 * minuto — a lista inteira virava a mesma linha repetida, e o evento que
 * importava ficava fora da tela. A saída foi mostrar POUCOS no painel e ter uma
 * tela de pesquisa; esta suíte prende a pesquisa.
 *
 * Os filtros vêm da URL, digitados por quem quiser. Três etapas aqui existem
 * por causa disso: o texto passa por `like` (e `%` sozinho casaria tudo), a
 * página vem como texto (e `?pagina=0` daria deslocamento negativo), e o
 * tamanho da página também (e `?porPagina=999999` despejaria a tabela inteira
 * numa página que o admin abre com pressa).
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { procurarEventos, acoesRegistradas, POR_PAGINA_MAX } from "../src/lib/admin.ts";

await exigirBancoDeTeste();

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
async function etapa(nome, fn) {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

/*
 * Bancada própria, com uma marca que só existe nesta execução. O log é
 * append-only e nunca é limpo, então filtrar pela marca é a única forma de
 * afirmar contagens exatas num banco que outras suítes também escrevem.
 */
const MARCA = `busca-${Date.now().toString(36)}`;
const ACAO_A = `teste.${MARCA}.alfa`;
const ACAO_B = `teste.${MARCA}.beta`;
const ESTUDIO_ESTRANHO = `Estúdio 100% ${MARCA}`;

try {
  for (let i = 0; i < 7; i++) {
    await db.query(
      `insert into eventos (tenant_id, estudio, ator, acao, alvo_tipo, alvo_id, detalhe)
       values (null, $1, 'estudio', $2, 'galeria', $3, '{}'::jsonb)`,
      [i === 0 ? ESTUDIO_ESTRANHO : `Estúdio ${MARCA}`, i < 5 ? ACAO_A : ACAO_B, `alvo-${MARCA}-${i}`],
    );
  }

  console.log("o filtro por ação");

  await etapa("devolve só a ação pedida", async () => {
    const p = await procurarEventos({ acao: ACAO_A });
    igual(p.total, 5, "total");
    for (const e of p.eventos) igual(e.acao, ACAO_A, "ação da linha");
  });

  await etapa("ação inexistente devolve página vazia, não a tabela toda", async () => {
    const p = await procurarEventos({ acao: `nao.existe.${MARCA}` });
    igual(p.total, 0, "total");
    igual(p.eventos.length, 0, "linhas");
  });

  console.log("\na busca por texto");

  await etapa("acha pelo nome do estúdio, sem diferenciar maiúscula", async () => {
    const p = await procurarEventos({ busca: MARCA.toUpperCase() });
    igual(p.total, 7, "total");
  });

  await etapa("acha pelo alvo", async () => {
    const p = await procurarEventos({ busca: `alvo-${MARCA}-3` });
    igual(p.total, 1, "total");
  });

  /*
   * O CASO QUE VAZA A TABELA INTEIRA: `%` é curinga do `like`. Sem escapar,
   * quem digitasse "100%" (ou só "%") receberia todos os eventos de todos os
   * estúdios — uma busca que devolve tudo se lê como "achei tudo isso", não
   * como "seu filtro foi ignorado".
   */
  await etapa("porcento no texto é literal, não curinga", async () => {
    const p = await procurarEventos({ busca: `100% ${MARCA}` });
    igual(p.total, 1, "só o estúdio com porcento no nome");
    const tudo = await procurarEventos({ busca: "%" });
    const semFiltro = await procurarEventos({});
    if (tudo.total >= semFiltro.total) {
      throw new Error(`"%" devolveu ${tudo.total} de ${semFiltro.total} — está casando tudo`);
    }
  });

  await etapa("sublinhado também é literal", async () => {
    const p = await procurarEventos({ busca: `alvo_${MARCA}_3` });
    igual(p.total, 0, "o sublinhado casaria qualquer caractere se não fosse escapado");
  });

  console.log("\na paginação");

  await etapa("página 2 não repete a página 1", async () => {
    const um = await procurarEventos({ busca: MARCA, pagina: 1, porPagina: 3 });
    const dois = await procurarEventos({ busca: MARCA, pagina: 2, porPagina: 3 });
    igual(um.eventos.length, 3, "linhas na primeira");
    igual(dois.eventos.length, 3, "linhas na segunda");
    const ids = new Set(um.eventos.map((e) => String(e.id)));
    for (const e of dois.eventos) {
      if (ids.has(String(e.id))) throw new Error(`evento ${e.id} apareceu nas duas páginas`);
    }
    igual(um.paginas, 3, "quantidade de páginas para 7 itens de 3 em 3");
  });

  await etapa("o total é o do filtro, não o da tabela", async () => {
    const p = await procurarEventos({ busca: MARCA, porPagina: 2 });
    igual(p.total, 7, "total do filtro");
    igual(p.eventos.length, 2, "linhas na página");
  });

  await etapa("página inválida vira a primeira", async () => {
    for (const pagina of [0, -3, NaN, undefined]) {
      const p = await procurarEventos({ busca: MARCA, pagina, porPagina: 3 });
      igual(p.pagina, 1, `pagina=${pagina}`);
      igual(p.eventos.length, 3, `linhas com pagina=${pagina}`);
    }
  });

  await etapa("página além do fim devolve vazio sem quebrar", async () => {
    const p = await procurarEventos({ busca: MARCA, pagina: 99, porPagina: 3 });
    igual(p.eventos.length, 0, "linhas");
    igual(p.total, 7, "o total continua sendo o do filtro");
  });

  await etapa("o tamanho da página tem teto", async () => {
    const p = await procurarEventos({ porPagina: 999_999 });
    if (p.eventos.length > POR_PAGINA_MAX) {
      throw new Error(`veio ${p.eventos.length}, o teto é ${POR_PAGINA_MAX}`);
    }
    return `teto ${POR_PAGINA_MAX}`;
  });

  console.log("\na lista de ações");

  await etapa("lista as ações que existem, com a contagem", async () => {
    const acoes = await acoesRegistradas();
    const a = acoes.find((x) => x.acao === ACAO_A);
    if (!a) throw new Error(`${ACAO_A} não apareceu na lista`);
    igual(a.n, 5, "contagem");
    // Ordenada pela mais usada: numa lista longa, o que se procura está no topo.
    for (let i = 1; i < acoes.length; i++) {
      if (acoes[i].n > acoes[i - 1].n) throw new Error("a lista não está ordenada por uso");
    }
    return `${acoes.length} ações`;
  });
} finally {
  /*
   * A tabela recusa `delete` por gatilho — é append-only de propósito. Desligar
   * o gatilho é a única saída, e ela deixa rastro aqui, no código, de quem a
   * usou. Mesmo caminho de `testar-auditoria.mjs`.
   */
  await db.query("alter table eventos disable trigger eventos_sem_delete");
  await db.query("delete from eventos where acao like $1 or estudio like $2", [
    `teste.${MARCA}.%`,
    `%${MARCA}%`,
  ]);
  await db.query("alter table eventos enable trigger eventos_sem_delete");
  await db.end();
}

if (falhou) {
  console.error("\n✗ a pesquisa do log tem problema");
  process.exit(1);
}
console.log("\n✓ pesquisa do log íntegra\n");
