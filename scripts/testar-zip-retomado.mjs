#!/usr/bin/env node
/**
 * A conexão que caiu e voltou não é queda (migração 050).
 *
 * Felipe, 29/09/2026, com o print do painel: "13 de 21 downloads de ZIP
 * caíram no meio". O servidor de ZIP relata 'abortado' toda vez que uma
 * conexão fecha antes do fim — e o navegador fecha conexão sem o download
 * cair: o Chrome do Android reabre o link no gerenciador do sistema, o
 * "Retomar" pede o resto numa conexão nova, e a pessoa às vezes só clica de
 * novo.
 *
 * O que se prende aqui, contra o banco:
 *
 *   · entrega completa marca como `retomado` a queda anterior do MESMO ZIP
 *     pela MESMA pessoa — mesmo pedido, mesmo IP ou mesma pessoa identificada;
 *   · não marca a queda de outra pessoa, de outro capítulo, nem a antiga;
 *   · 'trecho' (pedaço de Range) não vira linha na Atividade;
 *   · as somas do painel contam só a queda de verdade.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

import { lerPedidoDeZip, registrarEntregaDeZip } from "../src/lib/pedidos-zip.ts";
import { entregaDeZipDoMes } from "../src/lib/admin.ts";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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

const g = await galeriaDaRodada(db, { nome: "zip-retomado", medias: 2, publicada: true });
const { rows: [secao] } = await db.query(
  `insert into secoes (galeria_id, nome, ordem) values ($1, 'Festa', 0) returning id`,
  [g.id],
);

/** Um pedido como a rota do ZIP grava — só o que a marcação lê. */
async function pedido({ ip = "ip-noiva", pessoa = null, tipo = "tudo", secaoId = null } = {}) {
  const { rows: [p] } = await db.query(
    `insert into pedidos_zip (galeria_id, tipo, secao_id, entradas, nome_do_zip, ip_hash, pessoa_id)
     values ($1, $2, $3, '[]', 'teste.zip', $4, $5) returning id`,
    [g.id, tipo, secaoId, ip, pessoa],
  );
  return lerPedidoDeZip(p.id);
}
const relato = (evento, bytes = 1000) => ({ evento, bytes, doCache: true, duracaoMs: 10 });
async function retomado(pedidoId) {
  const { rows } = await db.query(
    `select retomado from entregas_zip where pedido_id = $1 and evento = 'abortado'`,
    [pedidoId],
  );
  return rows.map((r) => r.retomado);
}
async function naAtividade() {
  const { rows: [r] } = await db.query(
    `select count(*)::int n from acessos where galeria_id = $1 and acao in ('baixou','baixou_tudo')`,
    [g.id],
  );
  return r.n;
}

try {
  console.log("a queda que voltou");

  await etapa("mesmo pedido: caiu e o Retomar completou → retomado", async () => {
    const p = await pedido();
    await registrarEntregaDeZip(p, "servidor", relato("abortado", 500));
    igual((await retomado(p.id)).join(), "false", "antes da entrega");
    await registrarEntregaDeZip(p, "servidor", relato("servido"));
    igual((await retomado(p.id)).join(), "true", "depois da entrega");
  });

  await etapa("outro pedido, mesmo IP: clicou de novo e completou → retomado", async () => {
    const caiu = await pedido({ ip: "ip-madrinha" });
    await registrarEntregaDeZip(caiu, "servidor", relato("abortado"));
    const deNovo = await pedido({ ip: "ip-madrinha" });
    await registrarEntregaDeZip(deNovo, "servidor", relato("servido"));
    igual((await retomado(caiu.id)).join(), "true", "a queda do primeiro clique");
  });

  await etapa("outro IP, mesma pessoa identificada (trocou do Wi-Fi para o 4G) → retomado", async () => {
    const { rows: [pessoa] } = await db.query(
      `insert into pessoas_da_galeria (galeria_id, nome) values ($1, 'Noivo') returning id`,
      [g.id],
    );
    const caiu = await pedido({ ip: "ip-wifi", pessoa: pessoa.id });
    await registrarEntregaDeZip(caiu, "servidor", relato("abortado"));
    const deNovo = await pedido({ ip: "ip-4g", pessoa: pessoa.id });
    await registrarEntregaDeZip(deNovo, "servidor", relato("servido"));
    igual((await retomado(caiu.id)).join(), "true", "a queda no Wi-Fi");
  });

  console.log("\no que NÃO é a mesma entrega");

  await etapa("outra pessoa completar não apaga a queda de quem não conseguiu", async () => {
    const caiu = await pedido({ ip: "ip-tia" });
    await registrarEntregaDeZip(caiu, "servidor", relato("abortado"));
    const outra = await pedido({ ip: "ip-primo" });
    await registrarEntregaDeZip(outra, "servidor", relato("servido"));
    igual((await retomado(caiu.id)).join(), "false", "a queda da tia continua queda");
  });

  await etapa("completar a galeria inteira não apaga a queda de um capítulo", async () => {
    const caiu = await pedido({ ip: "ip-avo", tipo: "capitulo", secaoId: secao.id });
    await registrarEntregaDeZip(caiu, "servidor", relato("abortado"));
    const tudo = await pedido({ ip: "ip-avo" });
    await registrarEntregaDeZip(tudo, "servidor", relato("servido"));
    igual((await retomado(caiu.id)).join(), "false", "o capítulo continua caído");
  });

  await etapa("queda de mais de 12 h atrás não é retomada por uma entrega de hoje", async () => {
    const caiu = await pedido({ ip: "ip-antigo" });
    await registrarEntregaDeZip(caiu, "servidor", relato("abortado"));
    await db.query(
      `update entregas_zip set criado_em = now() - interval '13 hours' where pedido_id = $1`,
      [caiu.id],
    );
    await registrarEntregaDeZip(await pedido({ ip: "ip-antigo" }), "servidor", relato("servido"));
    igual((await retomado(caiu.id)).join(), "false", "velha demais para ser a mesma");
  });

  await etapa("pedaço de Range ('trecho') não retoma nada e não vira linha na Atividade", async () => {
    const p = await pedido({ ip: "ip-acelerador" });
    await registrarEntregaDeZip(p, "servidor", relato("abortado"));
    const antes = await naAtividade();
    await registrarEntregaDeZip(p, "servidor", relato("trecho", 4000));
    await registrarEntregaDeZip(p, "servidor", relato("trecho", 4000));
    igual(await naAtividade(), antes, "linhas na Atividade");
    igual((await retomado(p.id)).join(), "false", "trecho não é entrega");
    await registrarEntregaDeZip(p, "servidor", relato("servido", 4000));
    igual(await naAtividade(), antes + 1, "só a entrega vira linha");
    igual((await retomado(p.id)).join(), "true", "o último pedaço completou");
  });

  console.log("\no painel");

  await etapa("as somas do mês separam queda de conexão retomada", async () => {
    const s = await entregaDeZipDoMes();
    const { rows: [minhas] } = await db.query(
      `select count(*) filter (where evento = 'abortado')::int abortados,
              count(*) filter (where evento = 'abortado' and not retomado)::int quedas,
              count(*) filter (where evento = 'abortado' and not retomado
                                 and criado_em >= date_trunc('month', now()))::int quedas_do_mes,
              coalesce(sum(bytes) filter (where evento = 'trecho'), 0)::int trechos
         from entregas_zip where tenant_id = $1`,
      [g.tenant_id],
    );
    /* Outras suítes podem ter linhas no mesmo banco: confere que as minhas
       entram, e com o sinal certo. */
    igual(minhas.abortados, 7, "abortados desta suíte");
    igual(minhas.quedas, 3, "quedas desta suíte (tia, capítulo e a de 13 h)");
    if (s.quedasN < minhas.quedas_do_mes) throw new Error(`quedas do mês (${s.quedasN}) < as desta suíte`);
    if (s.abortadosN - s.quedasN < 4) throw new Error("as retomadas desta suíte não foram descontadas");
    if (s.trechosBytes < minhas.trechos) throw new Error("os trechos não entraram no tráfego");
  });
} finally {
  /* `entregas_zip` sobrevive à galeria (on delete set null): sai antes. */
  await db.query(`delete from entregas_zip where tenant_id = $1`, [g.tenant_id]);
  await limparRodada(db);
  await db.end();
}

process.exit(falhou ? 1 : 0);
