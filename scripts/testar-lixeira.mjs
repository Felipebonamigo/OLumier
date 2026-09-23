#!/usr/bin/env node
/**
 * Testa a lixeira — a rede de proteção contra o clique errado.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-lixeira.mjs
 *
 * Por que existe: até 25/08/2026 apagar uma galeria apagava a linha do banco E
 * os arquivos do bucket, na hora, sem desfazer. Olhando o risco de perder dado
 * com honestidade, esse era o caminho MAIS PROVÁVEL de todos — mais provável que
 * a Cloudflare falhar, mais provável que a conta ser suspensa. O fornecedor tem
 * durabilidade de onze noves; o dedo humano não tem nenhuma.
 *
 * A lixeira transforma "apagou, perdeu" em "apagou, tem 30 dias". O que este
 * teste prende:
 *   1. apagar NÃO toca no bucket — os arquivos continuam lá;
 *   2. galeria na lixeira some da listagem e do link público;
 *   3. restaurar traz de volta inteira, com as mesmas mídias;
 *   4. a limpeza definitiva só pega o que passou do prazo;
 *   5. galeria de OUTRO estúdio não pode ser apagada nem restaurada.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  PRAZO_LIXEIRA_DIAS,
  apagarGaleria,
  restaurarGaleria,
  listarLixeira,
  galeriasVencidasNaLixeira,
} from "../src/lib/tenants.ts";
import { listarGalerias } from "../src/lib/tenants.ts";
import { buscarGaleriaPublica } from "../src/lib/galerias-publicas.ts";

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

/* Estúdio e galeria descartáveis: o teste nunca mexe em dado que já existia. */
const marca = randomUUID().slice(0, 8);
const { rows: ts } = await db.query(
  `insert into tenants (nome_estudio, slug, email, senha_hash)
   values ($1, $2, $3, 'x') returning id`,
  [`Teste Lixeira ${marca}`, `teste-lixeira-${marca}`, `lixeira-${marca}@exemplo.test`],
);
const tenantId = ts[0].id;

const { rows: outros } = await db.query(
  `insert into tenants (nome_estudio, slug, email, senha_hash)
   values ($1, $2, $3, 'x') returning id`,
  [`Outro ${marca}`, `outro-${marca}`, `outro-${marca}@exemplo.test`],
);
const outroTenantId = outros[0].id;

const { rows: gs } = await db.query(
  `insert into galerias (tenant_id, slug, titulo, publicada)
   values ($1, $2, $3, true) returning id`,
  [tenantId, `casamento-${marca}`, "Ana e Pedro"],
);
const galeriaId = gs[0].id;

const chaveFalsa = `${tenantId}/${galeriaId}/${randomUUID()}.jpg`;
await db.query(
  `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime, bytes, pronto)
   values ($1, $2, $3, 'foto.jpg', 'foto', 'image/jpeg', 1024, true)`,
  [galeriaId, tenantId, chaveFalsa],
);

try {
  console.log("apagar é reversível");

  await etapa("apagar põe na lixeira em vez de destruir", async () => {
    await apagarGaleria(tenantId, galeriaId);
    const { rows } = await db.query("select estado, apagada_em from galerias where id = $1", [
      galeriaId,
    ]);
    if (rows.length === 0) throw new Error("a galeria foi destruída — deveria ir para a lixeira");
    igual(rows[0].estado, "lixeira", "estado");
    if (!rows[0].apagada_em) throw new Error("apagada_em ficou nulo");
    return `prazo de ${PRAZO_LIXEIRA_DIAS} dias`;
  });

  /*
   * O ponto inteiro da lixeira. Se o arquivo saísse do bucket aqui, "restaurar"
   * devolveria uma galeria de molduras vazias — pior que o erro original,
   * porque parece que deu certo.
   */
  await etapa("as mídias continuam registradas, com a chave intacta", async () => {
    const { rows } = await db.query("select chave from medias where galeria_id = $1", [galeriaId]);
    igual(rows.length, 1, "quantidade de mídias");
    igual(rows[0].chave, chaveFalsa, "chave do arquivo");
  });

  await etapa("some da lista do painel", async () => {
    const lista = await listarGalerias(tenantId);
    if (lista.itens.some((g) => g.id === galeriaId)) throw new Error("ainda aparece na listagem");
    return `${lista.total} galeria(s) visível(is)`;
  });

  await etapa("aparece na lixeira, com os dias que faltam", async () => {
    const lixo = await listarLixeira(tenantId);
    const achada = lixo.find((g) => g.id === galeriaId);
    if (!achada) throw new Error("não apareceu na lixeira");
    if (typeof achada.dias_restantes !== "number") throw new Error("sem contagem de dias");
    if (achada.dias_restantes > PRAZO_LIXEIRA_DIAS || achada.dias_restantes < 0) {
      throw new Error(`dias_restantes fora da faixa: ${achada.dias_restantes}`);
    }
    return `${achada.dias_restantes} dia(s)`;
  });

  await etapa("o link público para de abrir", async () => {
    const { rows } = await db.query("select slug from tenants where id = $1", [tenantId]);
    const g = await buscarGaleriaPublica(rows[0].slug, `casamento-${marca}`);
    if (g) throw new Error("a galeria na lixeira continua abrindo para o cliente");
  });

  console.log("\nrestaurar");

  await etapa("restaurar traz de volta inteira", async () => {
    await restaurarGaleria(tenantId, galeriaId);
    const { rows } = await db.query("select estado, apagada_em from galerias where id = $1", [
      galeriaId,
    ]);
    igual(rows[0].estado, "online", "estado depois de restaurar");
    igual(rows[0].apagada_em, null, "apagada_em deveria voltar a ser nulo");

    const lista = await listarGalerias(tenantId);
    if (!lista.itens.some((g) => g.id === galeriaId)) throw new Error("não voltou para a listagem");

    const { rows: m } = await db.query("select count(*)::int as n from medias where galeria_id = $1", [
      galeriaId,
    ]);
    igual(m[0].n, 1, "mídias depois de restaurar");
  });

  console.log("\nprazo e limpeza");

  await etapa("recém-apagada NÃO entra na limpeza", async () => {
    await apagarGaleria(tenantId, galeriaId);
    const vencidas = await galeriasVencidasNaLixeira();
    if (vencidas.some((v) => v.id === galeriaId)) {
      throw new Error("galeria apagada hoje seria destruída pela limpeza");
    }
  });

  await etapa("passado o prazo, entra na limpeza", async () => {
    await db.query(
      `update galerias set apagada_em = now() - ($2 || ' days')::interval where id = $1`,
      [galeriaId, PRAZO_LIXEIRA_DIAS + 1],
    );
    const vencidas = await galeriasVencidasNaLixeira();
    const achada = vencidas.find((v) => v.id === galeriaId);
    if (!achada) throw new Error("não entrou na limpeza depois do prazo");
    if (!Array.isArray(achada.chaves) || achada.chaves.length !== 1) {
      throw new Error("a limpeza não sabe quais arquivos apagar");
    }
    igual(achada.chaves[0], chaveFalsa, "chave a apagar");
    return `${vencidas.length} vencida(s)`;
  });

  console.log("\nisolamento entre estúdios");

  await etapa("outro estúdio não apaga nem restaura o que não é dele", async () => {
    await db.query("update galerias set estado = 'online', apagada_em = null where id = $1", [
      galeriaId,
    ]);
    await apagarGaleria(outroTenantId, galeriaId);
    const { rows } = await db.query("select estado from galerias where id = $1", [galeriaId]);
    igual(rows[0].estado, "online", "estado depois da tentativa alheia de apagar");

    await db.query("update galerias set estado = 'lixeira', apagada_em = now() where id = $1", [
      galeriaId,
    ]);
    await restaurarGaleria(outroTenantId, galeriaId);
    const { rows: r2 } = await db.query("select estado from galerias where id = $1", [galeriaId]);
    igual(r2[0].estado, "lixeira", "estado depois da tentativa alheia de restaurar");
  });
} finally {
  await db.query("delete from tenants where id = any($1)", [[tenantId, outroTenantId]]);
  await db.end();
}

console.log(falhou ? "\n✗ a lixeira tem problema\n" : "\n✓ lixeira ok\n");
process.exit(falhou ? 1 : 0);
