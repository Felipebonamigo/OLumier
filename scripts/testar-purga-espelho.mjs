#!/usr/bin/env node
/**
 * Testa a purga do espelho.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-purga-espelho.mjs
 *
 * Por que existe: o espelho guarda uma segunda cópia de tudo, e isso cria dois
 * problemas que só a purga resolve — a cópia de uma galeria já destruída
 * continua sendo paga todo mês, e um pedido de exclusão da LGPD não é atendido
 * de verdade enquanto ela existir.
 *
 * Mas purgar é a operação mais perigosa do sistema: apagar do espelho a cópia
 * de um arquivo que AINDA EXISTE destrói exatamente a proteção que justifica o
 * espelho — e destrói em silêncio, porque o arquivo principal continua lá e
 * ninguém percebe até o dia em que ele não estiver.
 *
 * Por isso o teste central aqui não é "a purga apaga", é "a purga NÃO apaga o
 * que não devia".
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  espelhoConfigurado,
  espelharObjeto,
  objetoEspelhadoExiste,
  apagarDoEspelho,
  purgarEspelho,
} from "../src/lib/espelho.ts";
import { urlDeUpload, apagarObjeto } from "../src/lib/r2.ts";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

if (!espelhoConfigurado) {
  console.log("⚠ ESPELHO_* não configurado — suíte pulada por inteiro");
  process.exit(0);
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
   values ($1,$2,$3,'x') returning id`,
  [`Purga ${marca}`, `purga-${marca}`, `purga-${marca}@exemplo.test`],
);
const tenantId = ts[0].id;

const { rows: gs } = await db.query(
  `insert into galerias (tenant_id, slug, titulo) values ($1,$2,'Galeria da Purga') returning id`,
  [tenantId, `purga-${marca}`],
);
const galeriaId = gs[0].id;

/** Põe um objeto no armazenamento principal e o espelha. */
async function plantar(sufixo) {
  const chave = `${tenantId}/${galeriaId}/purga-${sufixo}.bin`;
  const url = await urlDeUpload(chave, "application/octet-stream");
  const r = await fetch(url, {
    method: "PUT",
    body: Buffer.from(`conteudo ${sufixo}`),
    headers: { "content-type": "application/octet-stream" },
  });
  if (!r.ok) throw new Error(`não consegui plantar ${chave}`);
  const e = await espelharObjeto(chave);
  if (!e.ok) throw new Error(`não consegui espelhar ${chave}: ${e.erro}`);
  return chave;
}

const chaveViva = await plantar("viva");
const chaveOrfa = await plantar("orfa");

// A "viva" tem linha no banco; a "órfã" não — é a situação de uma galeria já
// destruída, cuja cópia ficou para trás no espelho.
await db.query(
  `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime, bytes, pronto)
   values ($1,$2,$3,'viva.bin','foto','image/jpeg',10,true)`,
  [galeriaId, tenantId, chaveViva],
);

try {
  console.log("o que a purga enxerga");

  await etapa("previsão encontra a órfã e não toca em nada", async () => {
    const r = await purgarEspelho({ tenantId });
    if (!r.orfas.includes(chaveOrfa)) throw new Error("não encontrou a órfã");
    igual(await objetoEspelhadoExiste(chaveOrfa), true, "a órfã deveria continuar lá na previsão");
    igual(r.apagadas, 0, "previsão não pode apagar");
    return `${r.orfas.length} órfã(s) encontrada(s)`;
  });

  /*
   * O TESTE QUE IMPORTA. Se este passar a falhar, a purga virou a maior fonte
   * de perda de dado do sistema — e uma que não dá sintoma: o arquivo principal
   * continua no lugar, e a ausência da cópia só aparece no dia do desastre.
   */
  await etapa("NUNCA apaga a cópia de arquivo que ainda existe", async () => {
    const r = await purgarEspelho({ tenantId });
    if (r.orfas.includes(chaveViva)) {
      throw new Error("marcou como órfã um arquivo que tem linha no banco");
    }
    await purgarEspelho({ tenantId, aplicar: true });
    igual(await objetoEspelhadoExiste(chaveViva), true, "a cópia viva foi apagada");
    return "cópia viva preservada";
  });

  await etapa("apaga a órfã quando mandam aplicar", async () => {
    igual(await objetoEspelhadoExiste(chaveOrfa), false, "a órfã deveria ter sido apagada");
  });

  console.log("\npedido de exclusão");

  await etapa("purga por galeria alcança até o que ainda tem linha", async () => {
    /*
     * Um pedido de exclusão da LGPD é diferente da varredura: ali o titular
     * quer que o dado suma AGORA, inclusive o que ainda está registrado. Por
     * isso este modo é explícito e separado — jamais o padrão.
     */
    const r = await purgarEspelho({ tenantId, galeriaId, exclusaoSolicitada: true, aplicar: true });
    if (r.apagadas < 1) throw new Error("não apagou nada");
    igual(await objetoEspelhadoExiste(chaveViva), false, "a exclusão solicitada deveria alcançar tudo");
    return `${r.apagadas} objeto(s) apagado(s)`;
  });

  await etapa("registra no log de auditoria", async () => {
    const { rows } = await db.query(
      "select acao, ator, detalhe from eventos where tenant_id = $1 order by id desc limit 1",
      [tenantId],
    );
    if (rows.length === 0) throw new Error("não registrou evento nenhum");
    igual(rows[0].acao, "espelho.purgado", "ação");
    igual(rows[0].ator, "sistema", "ator");
    if (typeof rows[0].detalhe.apagadas !== "number") throw new Error("sem contagem no detalhe");
    return `${rows[0].detalhe.apagadas} no registro`;
  });

  console.log("\nlimites");

  await etapa("estúdio sem nada no espelho não quebra", async () => {
    const { rows: o } = await db.query(
      `insert into tenants (nome_estudio, slug, email, senha_hash)
       values ($1,$2,$3,'x') returning id`,
      [`Vazio ${marca}`, `vazio-${marca}`, `vazio-${marca}@exemplo.test`],
    );
    const r = await purgarEspelho({ tenantId: o[0].id, aplicar: true });
    igual(r.apagadas, 0, "não havia o que apagar");
    await db.query("delete from tenants where id = $1", [o[0].id]);
  });
} finally {
  await apagarDoEspelho(chaveViva).catch(() => {});
  await apagarDoEspelho(chaveOrfa).catch(() => {});
  await apagarObjeto(chaveViva).catch(() => {});
  await apagarObjeto(chaveOrfa).catch(() => {});
  await db.query("alter table eventos disable trigger all");
  await db.query("delete from eventos where tenant_id = $1", [tenantId]);
  await db.query("alter table eventos enable trigger all");
  await db.query("delete from tenants where id = $1", [tenantId]);
  await db.end();
}

console.log(falhou ? "\n✗ a purga tem problema\n" : "\n✓ purga do espelho ok\n");
process.exit(falhou ? 1 : 0);
