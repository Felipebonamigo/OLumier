#!/usr/bin/env node
/**
 * Testa a LISTA DE GALERIAS DO PAINEL — a tela, a busca e a paginação.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-lista-do-painel.mjs
 *
 * ── POR QUE EXISTE (23/09/2026) ───────────────────────────────────────────
 *
 * Felipe, com a foto do painel: "como fica quando ficar muitas galerias? a
 * lista aqui". Ficava assim: TODAS num documento só — 811 KB de HTML para 300
 * galerias, e 300 subconsultas de contagem de fotos por carregamento.
 *
 * A lista virou uma TELA de 24, e com ela a busca teve de sair do navegador:
 * filtrar no cliente as 24 que chegaram esconderia a galeria que está na
 * página 3.
 *
 * O que este teste prende:
 *   1. a tela tem tamanho, e o `total` é a conta INTEIRA e não a da tela;
 *   2. as páginas se encaixam — nenhuma galeria em duas, nenhuma em nenhuma;
 *   3. a busca acha por nome, local, endereço e DATA, e conta o filtrado;
 *   4. `%` e `_` são texto, e não curinga do `like`;
 *   5. página além do fim volta vazia SABENDO o total — sem isso o painel
 *      desenharia "crie sua primeira galeria" para quem tem 300;
 *   6. galeria na lixeira não entra, nem a do estúdio vizinho.
 *
 * O item 2 é o que justifica o `g.id desc` no fim da ordem: com galerias do
 * mesmo dia e o mesmo `criado_em` — o que qualquer importação produz, porque
 * `now()` é um só para a transação — a ordem entre empatadas é livre, e duas
 * consultas podem devolver ordens diferentes. Aí uma galeria aparece nas
 * páginas 1 e 2 e outra não aparece em nenhuma.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { listarGalerias, GALERIAS_POR_TELA } from "../src/lib/tenants.ts";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

let falhou = false;
async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

const marca = randomUUID().slice(0, 8);
const { rows: ts } = await db.query(
  `insert into tenants (nome_estudio, slug, email, senha_hash)
   values ($1, $2, $3, 'x') returning id`,
  [`Teste Lista ${marca}`, `teste-lista-${marca}`, `lista-${marca}@exemplo.test`],
);
const tenantId = ts[0].id;

const { rows: outros } = await db.query(
  `insert into tenants (nome_estudio, slug, email, senha_hash)
   values ($1, $2, $3, 'x') returning id`,
  [`Vizinho ${marca}`, `vizinho-lista-${marca}`, `vizinho-lista-${marca}@exemplo.test`],
);
const outroTenantId = outros[0].id;

/*
 * 70 galerias TODAS NO MESMO DIA e no mesmo `criado_em` — o pior caso de
 * propósito. Uma inserção só: `now()` é idêntico para as 70, e `data_evento`
 * também. É exatamente o empate que solta a ordem do Postgres, e é nele que a
 * paginação perde item quando falta o desempate por `id`.
 */
const TOTAL = 70;
await db.query(
  `insert into galerias (tenant_id, slug, titulo, data_evento, publicada)
   select $1, 'casal-' || n || '-${marca}', 'Casal ' || lpad(n::text, 2, '0'),
          date '2026-06-13', true
     from generate_series(1, $2) as n`,
  [tenantId, TOTAL],
);

/* Três galerias com nome, local, data e endereço distintos, para a busca. */
await db.query(
  `insert into galerias (tenant_id, slug, titulo, subtitulo, data_evento, publicada) values
     ($1, 'julia-gustavo-${marca}', 'Júlia & Gustavo', 'Serra Gaúcha', date '2026-03-08', true),
     ($1, 'promo-50-${marca}',      'Ensaio 50% off',  'Estúdio',      date '2026-04-09', true),
     ($1, 'aniversario-${marca}',   'Festa da Malu',   'Casa de Festa',date '2026-05-10', true)`,
  [tenantId],
);

/* A GALERIA RENOMEADA: título acentuado, endereço de outro nome. É o estado em
   que o acidente do endereço-sem-acento para de salvar a busca. */
await db.query(
  `insert into galerias (tenant_id, slug, titulo, subtitulo, data_evento, publicada)
   values ($1, 'paula-bruno-${marca}', 'Mônica e Antônio', 'São José dos Pinhais',
           date '2026-07-11', true)`,
  [tenantId],
);

/* Uma na lixeira e uma do vizinho: nenhuma das duas pode aparecer. */
await db.query(
  `insert into galerias (tenant_id, slug, titulo, estado, apagada_em, publicada)
   values ($1, 'apagada-${marca}', 'Júlia apagada', 'lixeira', now(), true)`,
  [tenantId],
);
await db.query(
  `insert into galerias (tenant_id, slug, titulo, publicada)
   values ($1, 'julia-do-vizinho-${marca}', 'Júlia do vizinho', true)`,
  [outroTenantId],
);

const VISIVEIS = TOTAL + 4;

try {
  console.log("a tela tem tamanho");

  await etapa("a primeira tela vem com 24, e o total é a conta inteira", async () => {
    const t = await listarGalerias(tenantId);
    igual(t.itens.length, GALERIAS_POR_TELA, "galerias na tela");
    igual(t.total, VISIVEIS, "total");
    igual(t.pagina, 1, "página");
    igual(t.paginas, Math.ceil(VISIVEIS / GALERIAS_POR_TELA), "páginas");
    return `${t.itens.length} de ${t.total} em ${t.paginas} páginas`;
  });

  await etapa("a última página traz o resto, e não uma tela cheia", async () => {
    const t = await listarGalerias(tenantId, { pagina: Math.ceil(VISIVEIS / GALERIAS_POR_TELA) });
    igual(t.itens.length, VISIVEIS % GALERIAS_POR_TELA, "galerias na última tela");
    return `${t.itens.length} na página ${t.pagina}`;
  });

  console.log("\nas páginas se encaixam");

  /*
   * O teste que dá nome ao arquivo. Percorre TODAS as páginas e confere que a
   * união é o conjunto inteiro, sem repetida. Rodado dez vezes porque a ordem
   * indefinida do Postgres não erra sempre — sem o desempate, ela erra às
   * vezes, que é o jeito mais caro de um bug existir.
   */
  await etapa("varre a lista inteira: nenhuma em duas páginas, nenhuma sumida", async () => {
    /*
     * Vários tamanhos de tela DE PROPÓSITO. Com 24 por página este teste passa
     * mesmo sem o desempate — as quatro fatias caem em lugares que o Postgres,
     * naquele plano, devolve na mesma ordem, e o teste diria "verde" sobre um
     * código quebrado. Conferido: tirando o `g.id desc`, a varredura de 24
     * passa e as de 7 e 10 reprovam.
     *
     * É a mesma lição de sempre aqui: um teste que não reprova quando o
     * conserto sai é decoração. O tamanho pequeno é o que põe a borda da página
     * DENTRO do bloco de galerias empatadas, que é onde a ordem solta morde.
     */
    for (const porTela of [7, 10, 24]) {
      for (let volta = 1; volta <= 5; volta++) {
        const vistas = [];
        const paginas = Math.ceil(VISIVEIS / porTela);
        for (let p = 1; p <= paginas; p++) {
          const t = await listarGalerias(tenantId, { pagina: p, porTela });
          vistas.push(...t.itens.map((g) => g.id));
        }
        const unicas = new Set(vistas);
        if (vistas.length !== VISIVEIS) {
          throw new Error(
            `${porTela}/tela, volta ${volta}: vieram ${vistas.length} linhas, esperava ${VISIVEIS}`,
          );
        }
        if (unicas.size !== VISIVEIS) {
          throw new Error(
            `${porTela}/tela, volta ${volta}: ${VISIVEIS - unicas.size} galeria(s) em duas páginas`,
          );
        }
      }
    }
    return `3 tamanhos × 5 voltas × ${VISIVEIS} galerias, todas distintas`;
  });

  await etapa("a ordem é a mesma toda vez que se pede a mesma página", async () => {
    const primeira = (await listarGalerias(tenantId, { pagina: 2 })).itens.map((g) => g.id);
    for (let i = 0; i < 5; i++) {
      const outra = (await listarGalerias(tenantId, { pagina: 2 })).itens.map((g) => g.id);
      if (outra.join() !== primeira.join()) throw new Error(`a página 2 mudou de ordem na volta ${i + 1}`);
    }
  });

  console.log("\na busca é do servidor");

  await etapa("acha pelo nome, e conta só o que casa", async () => {
    const t = await listarGalerias(tenantId, { busca: "Júlia" });
    igual(t.total, 1, "total filtrado");
    igual(t.itens[0].titulo, "Júlia & Gustavo", "título");
    igual(t.paginas, 1, "páginas de um resultado só");
  });

  await etapa("acha pelo local (subtítulo)", async () => {
    const t = await listarGalerias(tenantId, { busca: "Serra" });
    igual(t.total, 1, "total");
    igual(t.itens[0].slug, `julia-gustavo-${marca}`, "slug");
  });

  await etapa("acha pelo endereço (slug)", async () => {
    const t = await listarGalerias(tenantId, { busca: `aniversario-${marca}` });
    igual(t.total, 1, "total");
    igual(t.itens[0].titulo, "Festa da Malu", "título");
  });

  /* A data era achada por acaso quando a lista chegava inteira e o texto já
     vinha formatado no HTML. No servidor ela precisa ser dita. */
  await etapa("acha pela data escrita como o fotógrafo a lê", async () => {
    const dia = await listarGalerias(tenantId, { busca: "08/03/2026" });
    igual(dia.total, 1, "total de 08/03/2026");
    igual(dia.itens[0].titulo, "Júlia & Gustavo", "título por data cheia");
    const ano = await listarGalerias(tenantId, { busca: "/2026" });
    igual(ano.total, VISIVEIS, "todas as galerias são de 2026");
    return "08/03/2026 e /2026";
  });

  await etapa("acha sem acento: 'julia' encontra 'Júlia'", async () => {
    const t = await listarGalerias(tenantId, { busca: "julia" });
    igual(t.total, 1, "total sem acento");
    igual(t.itens[0].titulo, "Júlia & Gustavo", "título");
  });

  /*
   * O CASO QUE O ACIDENTE NÃO COBRE — e a razão da migração 039.
   *
   * Sem `sem_acento`, "julia" achava "Júlia & Gustavo" mesmo assim: o ENDEREÇO
   * é gerado do título sem acento e entra na busca. O acidente funciona
   * enquanto os dois combinarem — e eles deixam de combinar no momento mais
   * comum do sistema, o fotógrafo corrigindo o nome do casal. O endereço não
   * acompanha DE PROPÓSITO: o link já foi para o WhatsApp da família.
   *
   * Esta galeria tem título acentuado e endereço que não lembra o título — é o
   * estado de uma galeria renomeada. Tirar o `sem_acento` da consulta faz esta
   * etapa ficar vermelha, e só ela.
   */
  await etapa("e acha mesmo quando o endereço não lembra mais o nome", async () => {
    const semAcento = await listarGalerias(tenantId, { busca: "monica e antonio" });
    igual(semAcento.total, 1, "total digitado sem acento");
    igual(semAcento.itens[0].titulo, "Mônica e Antônio", "título");

    const comAcento = await listarGalerias(tenantId, { busca: "Mônica" });
    igual(comAcento.total, 1, "total digitado com acento");

    const noLocal = await listarGalerias(tenantId, { busca: "sao jose" });
    igual(noLocal.total, 1, "o local também ignora acento");
    return "nome e local, com e sem acento";
  });

  await etapa("caixa não importa", async () => {
    const t = await listarGalerias(tenantId, { busca: "fEsTa dA mAlU" });
    igual(t.total, 1, "total");
  });

  await etapa("'50%' procura '50%', e não 'qualquer coisa depois do 50'", async () => {
    const t = await listarGalerias(tenantId, { busca: "50%" });
    igual(t.total, 1, "total de '50%'");
    igual(t.itens[0].titulo, "Ensaio 50% off", "título");
    /* Sem o escape, `%` vira curinga e "Casal 5%" — quer dizer, "Casal 5" e
       tudo o que vier depois — entraria junto. */
    const sublinhado = await listarGalerias(tenantId, { busca: "Casal_0" });
    igual(sublinhado.total, 0, "'_' como curinga acharia 'Casal 01'");
  });

  await etapa("a busca vazia é a lista inteira, não o nada", async () => {
    const t = await listarGalerias(tenantId, { busca: "   " });
    igual(t.total, VISIVEIS, "total");
  });

  await etapa("busca + página: a página 2 do filtro continua filtrada", async () => {
    const p1 = await listarGalerias(tenantId, { busca: "Casal", porTela: 10, pagina: 1 });
    const p2 = await listarGalerias(tenantId, { busca: "Casal", porTela: 10, pagina: 2 });
    igual(p1.total, TOTAL, "total filtrado na página 1");
    igual(p2.total, TOTAL, "total filtrado na página 2");
    igual(p2.itens.length, 10, "galerias na página 2");
    if (p2.itens.some((g) => !g.titulo.startsWith("Casal"))) {
      throw new Error("a página 2 trouxe galeria que não casa com a busca");
    }
    const juntas = new Set([...p1.itens, ...p2.itens].map((g) => g.id));
    igual(juntas.size, 20, "galerias distintas entre as duas páginas");
  });

  console.log("\nas bordas");

  await etapa("página além do fim volta vazia SABENDO o total", async () => {
    const t = await listarGalerias(tenantId, { pagina: 99 });
    igual(t.itens.length, 0, "galerias");
    /* Se isto voltasse 0, o painel desenharia "crie sua primeira galeria" para
       quem tem 73 — e a barra de páginas sumiria junto com o caminho de volta. */
    igual(t.total, VISIVEIS, "total");
    igual(t.paginas, Math.ceil(VISIVEIS / GALERIAS_POR_TELA), "páginas");
  });

  await etapa("página 0 e negativa viram a página 1", async () => {
    for (const p of [0, -3, 0.4]) {
      const t = await listarGalerias(tenantId, { pagina: p });
      igual(t.pagina, 1, `página pedida ${p}`);
      igual(t.itens.length, GALERIAS_POR_TELA, `galerias com página ${p}`);
    }
  });

  await etapa("estúdio sem galeria nenhuma: total 0 e uma página", async () => {
    const t = await listarGalerias(outroTenantId, { busca: "não existe isso" });
    igual(t.total, 0, "total");
    igual(t.paginas, 1, "páginas");
    igual(t.itens.length, 0, "galerias");
  });

  console.log("\no que não pode aparecer");

  await etapa("a galeria na lixeira não entra — nem na busca que casa com ela", async () => {
    const t = await listarGalerias(tenantId, { busca: "apagada" });
    igual(t.total, 0, "total");
  });

  await etapa("a galeria do estúdio vizinho não entra", async () => {
    const t = await listarGalerias(tenantId, { busca: "vizinho" });
    igual(t.total, 0, "total");
    /* E a varredura inteira também não pode trazê-la. */
    const paginas = Math.ceil(VISIVEIS / GALERIAS_POR_TELA);
    for (let p = 1; p <= paginas; p++) {
      const tela = await listarGalerias(tenantId, { pagina: p });
      if (tela.itens.some((g) => g.tenant_id !== tenantId)) {
        throw new Error("apareceu galeria de outro estúdio na listagem");
      }
    }
  });

  console.log("\no peso da página");

  /*
   * A razão de tudo isto. Não mede HTML — mede o que o servidor devolve, que é
   * o que vira HTML. Com a lista inteira eram 811 KB para 300 galerias.
   */
  await etapa("a tela não cresce com o tamanho do estúdio", async () => {
    const tela = await listarGalerias(tenantId);
    const bytes = Buffer.byteLength(JSON.stringify(tela.itens));
    if (tela.itens.length > GALERIAS_POR_TELA) {
      throw new Error(`a tela veio com ${tela.itens.length} galerias`);
    }
    return `${(bytes / 1024).toFixed(1)} KB para ${tela.itens.length} de ${tela.total}`;
  });
} finally {
  await db.query("delete from tenants where id = any($1)", [[tenantId, outroTenantId]]);
  await db.end();
}

console.log(falhou ? "\n✗ a lista do painel tem problema\n" : "\n✓ lista do painel ok\n");
process.exit(falhou ? 1 : 0);
