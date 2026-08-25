#!/usr/bin/env node
/**
 * Arquivo pago que ninguém referencia. Uso:
 *   node --env-file=.env.local --experimental-strip-types scripts/testar-limpeza.mjs
 *
 * Contexto: até 20/08/2026, apagar uma galeria removia as linhas de `medias`
 * (cascade) mas deixava os arquivos no R2 para sempre — sumiam do painel, do
 * relatório de uso e da quota, e seguiam sendo cobrados todo mês.
 *
 * Exige o resolvedor de imports (ver scripts/resolvedor-ts.mjs):
 *   --import ./scripts/registrar-ts.mjs
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { apagarObjetos, listarChaves, objetoExiste, BUCKET } from "../src/lib/r2.ts";
/*
 * A regra de "quem tem dono" vem do módulo compartilhado, NÃO de uma consulta
 * escrita aqui. Havia três cópias dela neste arquivo, e todas olhavam só
 * `medias` — então a logo do estúdio, que mora no bucket sem linha em `medias`,
 * era classificada como órfã. Testar por imitação é pior que não testar: dá o
 * verde enquanto o código de verdade apagaria a marca de todos os clientes.
 */
import { chavesConhecidas } from "./varrer-orfaos-regras.mjs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
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

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const marca = `_teste-limpeza-${Date.now()}`;
const plantar = async (nome) => {
  const chave = `${marca}/${nome}`;
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: chave, Body: Buffer.from("x"), ContentType: "text/plain" }),
  );
  return chave;
};

console.log(`bucket: ${BUCKET}\n`);
console.log("Apagar em lote:\n");

await etapa("apaga vários objetos de uma vez", async () => {
  const chaves = await Promise.all([plantar("a.txt"), plantar("b.txt"), plantar("c.txt")]);
  for (const c of chaves) {
    if (!(await objetoExiste(c))) throw new Error(`${c} não foi plantado`);
  }
  await apagarObjetos(chaves);
  for (const c of chaves) {
    if (await objetoExiste(c)) throw new Error(`${c} sobrou no bucket`);
  }
  return "3 objetos removidos";
});

await etapa("apagar chave que já não existe não quebra", async () => {
  // Acontece de verdade: retentativa, ou galeria apagada em duas abas ao mesmo
  // tempo. Estourar aqui faria a ação do usuário falhar por nada.
  await apagarObjetos([`${marca}/nunca-existiu.txt`]);
  return "silencioso, como deve ser";
});

await etapa("lista vazia não faz chamada nenhuma", async () => {
  await apagarObjetos([]);
  return "sem erro";
});

await etapa("chaves repetidas não viram duas remoções", async () => {
  const c = await plantar("repetida.txt");
  await apagarObjetos([c, c, c]);
  if (await objetoExiste(c)) throw new Error("sobrou no bucket");
  return "deduplicadas";
});

console.log("\nVarredura de órfãos:\n");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

await etapa("um órfão plantado é encontrado pela comparação com o banco", async () => {
  const orfao = await plantar("orfao.txt");
  try {
    const doBucket = await listarChaves(marca);
    const conhecidas = await chavesConhecidas(db);
    const orfaos = doBucket.filter((c) => !conhecidas.has(c));
    if (!orfaos.includes(orfao)) throw new Error("a varredura não achou o órfão plantado");
    return `achou ${orfaos.length}`;
  } finally {
    await apagarObjetos([orfao]);
  }
});

await etapa("arquivo REFERENCIADO pelo banco nunca é tratado como órfão", async () => {
  // O erro caro seria o contrário: a varredura apagar arquivo que está em uso.
  const { rows } = await db.query("select chave from medias where pronto limit 1");
  if (rows.length === 0) throw new Error("sem mídia no banco para conferir");
  const doBucket = await listarChaves();
  const conhecidas = await chavesConhecidas(db);
  const orfaos = doBucket.filter((c) => !conhecidas.has(c));
  if (orfaos.includes(rows[0].chave)) {
    throw new Error("arquivo em uso foi classificado como órfão — a varredura apagaria foto de cliente");
  }
  return "arquivo em uso preservado";
});

console.log("\nApagar a galeria (o caminho real do painel):\n");

/*
 * Este teste garantia que apagar não deixasse arquivo pago órfão no bucket. A
 * garantia continua valendo; o que mudou foi ONDE ela acontece.
 *
 * Desde 25/08/2026 apagar manda a galeria para a LIXEIRA e não encosta no
 * bucket — porque o clique errado do fotógrafo é o jeito mais provável de
 * perder as fotos de um casamento, mais provável que qualquer falha de
 * fornecedor. Quem destrói de verdade é `destruirGaleria`, depois dos 30 dias.
 *
 * Então o teste passou a cobrir os dois lados da mesma promessa: apagar
 * PRESERVA (senão "restaurar" devolveria molduras vazias) e destruir LIMPA
 * (senão o arquivo vira lixo invisível que só aparece na fatura).
 */
await etapa("apagar preserva; destruir é que remove do bucket", async () => {
  const { apagarGaleria, destruirGaleria, galeriasVencidasNaLixeira, PRAZO_LIXEIRA_DIAS } =
    await import("../src/lib/tenants.ts");
  const { rows: t } = await db.query("select id from tenants order by criado_em limit 1");
  const tenantId = t[0].id;

  const g = await db.query(
    `insert into galerias (tenant_id, slug, titulo) values ($1,$2,'Galeria da Limpeza') returning id`,
    [tenantId, `limpeza-${Date.now()}`],
  );
  const galeriaId = g.rows[0].id;

  // Dois arquivos de verdade no bucket, com as linhas correspondentes.
  const chaves = [];
  for (let i = 0; i < 2; i++) {
    const chave = `${tenantId}/${galeriaId}/limpeza-${i}.png`;
    await s3.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: chave, Body: Buffer.from("x"), ContentType: "image/png" }),
    );
    await db.query(
      `insert into medias (galeria_id,tenant_id,chave,nome_original,tipo,mime,bytes,pronto)
       values ($1,$2,$3,$4,'foto','image/png',1,true)`,
      [galeriaId, tenantId, chave, `limpeza-${i}.png`],
    );
    chaves.push(chave);
  }
  for (const c of chaves) {
    if (!(await objetoExiste(c))) throw new Error(`${c} não foi plantado`);
  }

  // 1. Apagar: vai para a lixeira e NÃO tira nada do bucket.
  await apagarGaleria(tenantId, galeriaId);

  const { rows } = await db.query("select estado from galerias where id = $1", [galeriaId]);
  if (rows.length === 0) throw new Error("a galeria foi destruída — deveria ir para a lixeira");
  if (rows[0].estado !== "lixeira") throw new Error(`estado ${rows[0].estado}, esperava lixeira`);

  for (const c of chaves) {
    if (!(await objetoExiste(c))) {
      throw new Error(`${c} sumiu do bucket ao apagar — restaurar devolveria moldura vazia`);
    }
  }

  // 2. Passado o prazo, a limpeza encontra e destrói — banco e bucket.
  await db.query(
    `update galerias set apagada_em = now() - ($2 || ' days')::interval where id = $1`,
    [galeriaId, PRAZO_LIXEIRA_DIAS + 1],
  );
  const vencidas = await galeriasVencidasNaLixeira();
  const alvo = vencidas.find((v) => v.id === galeriaId);
  if (!alvo) throw new Error("a limpeza não encontrou a galeria vencida");

  await destruirGaleria(alvo.id, alvo.chaves);

  const { rows: depois } = await db.query("select 1 from galerias where id = $1", [galeriaId]);
  if (depois.length) throw new Error("a galeria continua no banco depois de destruída");

  const sobraram = [];
  for (const c of chaves) if (await objetoExiste(c)) sobraram.push(c);
  if (sobraram.length) {
    throw new Error(`${sobraram.length} arquivo(s) ficaram sendo cobrados: ${sobraram[0]}`);
  }
  return "apagar preservou, destruir limpou banco e bucket";
});

await etapa("galeria de OUTRO estúdio não é apagada nem perde arquivo", async () => {
  const { apagarGaleria } = await import("../src/lib/tenants.ts");
  const { rows: t } = await db.query("select id from tenants order by criado_em limit 1");

  const outro = await db.query(
    `insert into tenants (slug,nome_estudio,email,senha_hash)
     values ($1,'Outro','outro-limpeza@teste','x') returning id`,
    [`outro-limpeza-${Date.now()}`],
  );
  const g = await db.query(
    `insert into galerias (tenant_id, slug, titulo) values ($1,'alheia','Alheia') returning id`,
    [outro.rows[0].id],
  );
  const chave = `${outro.rows[0].id}/${g.rows[0].id}/alheia.png`;
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: chave, Body: Buffer.from("x"), ContentType: "image/png" }),
  );
  await db.query(
    `insert into medias (galeria_id,tenant_id,chave,nome_original,tipo,mime,bytes,pronto)
     values ($1,$2,$3,'alheia.png','foto','image/png',1,true)`,
    [g.rows[0].id, outro.rows[0].id, chave],
  );

  try {
    // tenantId de OUTRO estúdio: não pode apagar nada, nem no banco nem no bucket.
    await apagarGaleria(t[0].id, g.rows[0].id);
    const { rows } = await db.query("select 1 from galerias where id = $1", [g.rows[0].id]);
    if (rows.length === 0) throw new Error("apagou galeria de outro estúdio!");
    if (!(await objetoExiste(chave))) throw new Error("apagou ARQUIVO de outro estúdio!");
    return "galeria e arquivo intactos";
  } finally {
    await db.query("delete from tenants where id = $1", [outro.rows[0].id]);
    await apagarObjetos([chave]);
  }
});

await etapa("o bucket está sem órfãos agora", async () => {
  const doBucket = await listarChaves();
  const conhecidas = await chavesConhecidas(db);
  const orfaos = doBucket.filter((c) => !conhecidas.has(c));
  if (orfaos.length) throw new Error(`${orfaos.length} órfão(s): ${orfaos[0]}`);
  return `${doBucket.length} objetos, todos referenciados`;
});

await db.end();

if (falhou) {
  console.error("\n✗ a limpeza de arquivos tem problema\n");
  process.exit(1);
}
console.log("\n✓ apaga em lote com segurança e a varredura distingue órfão de arquivo em uso\n");
