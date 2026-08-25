#!/usr/bin/env node
/**
 * Testa o log de auditoria — a prova de quem fez o quê, e quando.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-auditoria.mjs
 *
 * Por que existe: numa disputa, o fotógrafo dirá "o sistema apagou minhas
 * fotos". A diferença entre pagar e não pagar é conseguir mostrar que às 14h32
 * do dia 3 foi a CONTA DELE que clicou em apagar. Sem registro, a palavra dele
 * vale tanto quanto a nossa — e quem tem o ônus de provar diligência somos nós.
 *
 * As três propriedades sem as quais o log não serve de prova:
 *
 *   1. SOBREVIVE AO QUE REGISTRA. Se a linha morrer junto com a galeria
 *      apagada, some justamente a evidência. Nada de chave estrangeira com
 *      cascata: o alvo é texto solto e o que importa fica copiado no detalhe.
 *   2. NÃO SE REESCREVE. Log que pode ser alterado depois não prova nada.
 *      O banco recusa update e delete.
 *   3. NÃO DERRUBA NADA. Falha ao registrar não pode impedir a ação do
 *      usuário — senão o log vira o motivo do incidente que ele documentaria.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { registrarEvento, eventosDoEstudio, ACOES } from "../src/lib/eventos.ts";
import { apagarGaleria, destruirGaleria, galeriasVencidasNaLixeira, PRAZO_LIXEIRA_DIAS } from "../src/lib/tenants.ts";

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
  [`Teste Auditoria ${marca}`, `teste-aud-${marca}`, `aud-${marca}@exemplo.test`],
);
const tenantId = ts[0].id;

try {
  console.log("registro");

  await etapa("grava ator, ação, alvo e detalhe", async () => {
    await registrarEvento({
      tenantId,
      ator: "estudio",
      acao: ACOES.GALERIA_APAGADA,
      alvoTipo: "galeria",
      alvoId: "id-qualquer",
      detalhe: { titulo: "Ana e Pedro", medias: 340 },
      ip: "203.0.113.7",
    });

    const eventos = await eventosDoEstudio(tenantId);
    igual(eventos.length, 1, "quantidade de eventos");
    const e = eventos[0];
    igual(e.acao, ACOES.GALERIA_APAGADA, "ação");
    igual(e.ator, "estudio", "ator");
    igual(e.alvo_id, "id-qualquer", "alvo");
    igual(e.detalhe.titulo, "Ana e Pedro", "título no detalhe");
    return `${eventos.length} evento`;
  });

  /*
   * IP cru é dado pessoal (LGPD). O log guarda hash, seguindo o que a tabela
   * `acessos` já fazia: dá para provar que dois eventos vieram do mesmo lugar,
   * sem guardar de onde.
   */
  await etapa("IP é guardado com hash, nunca cru", async () => {
    const { rows } = await db.query(
      "select ip_hash from eventos where tenant_id = $1 order by id desc limit 1",
      [tenantId],
    );
    const h = rows[0].ip_hash;
    if (!h) throw new Error("não guardou nada");
    if (h.includes("203.0.113.7")) throw new Error("guardou o IP cru");
    return `hash de ${h.length} caracteres`;
  });

  console.log("\né prova, não é rascunho");

  await etapa("o banco recusa ALTERAR um evento", async () => {
    try {
      await db.query("update eventos set acao = 'mentira' where tenant_id = $1", [tenantId]);
      throw new Error("o update passou — o log pode ser reescrito");
    } catch (e) {
      if (e.message.includes("o update passou")) throw e;
      return "recusado pelo banco";
    }
  });

  await etapa("o banco recusa APAGAR um evento", async () => {
    try {
      await db.query("delete from eventos where tenant_id = $1", [tenantId]);
      throw new Error("o delete passou — o log pode ser limpo");
    } catch (e) {
      if (e.message.includes("o delete passou")) throw e;
      return "recusado pelo banco";
    }
  });

  console.log("\nsobrevive ao que registra");

  /*
   * O caso que justifica o log existir. A galeria é apagada, espera o prazo,
   * é destruída de vez — e o registro do que aconteceu continua lá, com o
   * título dentro, mesmo sem a galeria existir para consultar.
   */
  await etapa("evento sobrevive à destruição definitiva da galeria", async () => {
    const { rows: gs } = await db.query(
      `insert into galerias (tenant_id, slug, titulo) values ($1,$2,'Casamento Sumido') returning id`,
      [tenantId, `sumida-${marca}`],
    );
    const galeriaId = gs[0].id;

    await apagarGaleria(tenantId, galeriaId);
    await db.query(
      `update galerias set apagada_em = now() - ($2 || ' days')::interval where id = $1`,
      [galeriaId, PRAZO_LIXEIRA_DIAS + 1],
    );
    const vencidas = await galeriasVencidasNaLixeira();
    const alvo = vencidas.find((v) => v.id === galeriaId);
    if (!alvo) throw new Error("a galeria não entrou na limpeza");
    await destruirGaleria(alvo.id, alvo.chaves);

    const { rows: existe } = await db.query("select 1 from galerias where id = $1", [galeriaId]);
    igual(existe.length, 0, "a galeria deveria ter sido destruída");

    const eventos = await eventosDoEstudio(tenantId);
    const doAlvo = eventos.filter((e) => e.alvo_id === galeriaId);
    if (doAlvo.length === 0) throw new Error("os eventos sumiram junto com a galeria");
    if (!doAlvo.some((e) => e.detalhe?.titulo === "Casamento Sumido")) {
      throw new Error("o título não foi preservado no detalhe — sem a galeria, não há como saber qual era");
    }
    return `${doAlvo.length} evento(s) preservado(s)`;
  });

  console.log("\nnunca derruba a ação");

  await etapa("evento com alvo inexistente não quebra", async () => {
    await registrarEvento({
      tenantId,
      ator: "estudio",
      acao: ACOES.GALERIA_RESTAURADA,
      alvoTipo: "galeria",
      alvoId: randomUUID(),
      detalhe: {},
    });
    return "aceito — o log não valida a existência do alvo";
  });

  await etapa("falha de gravação é engolida, não propagada", async () => {
    // Ação absurdamente longa: o banco recusa, e registrarEvento tem de
    // silenciar. Se propagasse, apagar uma galeria falharia por causa do log.
    await registrarEvento({
      tenantId,
      ator: "estudio",
      acao: "x".repeat(5000),
      alvoTipo: "galeria",
      alvoId: "z",
      detalhe: {},
    });
    return "não lançou";
  });

  console.log("\nconsulta");

  await etapa("lista em ordem, do mais recente para o mais antigo", async () => {
    const eventos = await eventosDoEstudio(tenantId);
    for (let i = 1; i < eventos.length; i++) {
      if (eventos[i - 1].id < eventos[i].id) throw new Error("fora de ordem");
    }
    return `${eventos.length} evento(s)`;
  });

  await etapa("um estúdio não enxerga o log do outro", async () => {
    const { rows: o } = await db.query(
      `insert into tenants (nome_estudio, slug, email, senha_hash)
       values ($1,$2,$3,'x') returning id`,
      [`Outro Aud ${marca}`, `outro-aud-${marca}`, `outro-aud-${marca}@exemplo.test`],
    );
    const eventos = await eventosDoEstudio(o[0].id);
    igual(eventos.length, 0, "eventos do estúdio novo");
    await db.query("delete from tenants where id = $1", [o[0].id]);
  });
} finally {
  /*
   * O log é append-only, então apagar o tenant NÃO leva os eventos junto — de
   * propósito: conta encerrada é exatamente quando alguém questiona o que
   * aconteceu. A limpeza do teste tira as linhas por fora da regra.
   */
  await db.query("alter table eventos disable trigger all");
  await db.query("delete from eventos where tenant_id = $1", [tenantId]);
  await db.query("alter table eventos enable trigger all");
  await db.query("delete from tenants where id = $1", [tenantId]);
  await db.end();
}

console.log(falhou ? "\n✗ a auditoria tem problema\n" : "\n✓ auditoria ok\n");
process.exit(falhou ? 1 : 0);
