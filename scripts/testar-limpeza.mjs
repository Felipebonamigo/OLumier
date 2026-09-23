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
import {
  estudioDaRodada,
  segundoEstudioDaRodada,
  galeriaDaRodada,
  limparRodada,
} from "./fixture-de-teste.mjs";
import { apagarObjetos, listarChaves, objetoExiste, BUCKET } from "../src/lib/r2.ts";
/*
 * A regra de "quem tem dono" vem do módulo compartilhado, NÃO de uma consulta
 * escrita aqui. Havia três cópias dela neste arquivo, e todas olhavam só
 * `medias` — então a logo do estúdio, que mora no bucket sem linha em `medias`,
 * era classificada como órfã. Testar por imitação é pior que não testar: dá o
 * verde enquanto o código de verdade apagaria a marca de todos os clientes.
 */
import { chavesConhecidas, deOutroAmbiente } from "./varrer-orfaos-regras.mjs";
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


/* O endereço do armazém vem do `lib/r2.ts`: eram cinco cópias desta conta,
   e as cópias não acompanharam o dia em que o armazém mudou de lugar. */
const { OPCOES_DO_CLIENTE } = await import("../src/lib/r2.ts");
const s3 = new S3Client({
  ...OPCOES_DO_CLIENTE,
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
    // `doBucket` veio da listagem do R2, então compara contra o conjunto do R2.
    const orfaos = doBucket.filter((c) => !conhecidas.r2.has(c));
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
  // `doBucket` veio da listagem do R2, então compara contra o conjunto do R2.
  const orfaos = doBucket.filter((c) => !conhecidas.r2.has(c));
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
  const tenantId = (await estudioDaRodada(db)).id;

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
  const t = [await estudioDaRodada(db)];

  /*
   * ── O VIZINHO VEM DA BANCADA, NÃO DAQUI (17/09/2026) ────────────────────
   *
   * Este estúdio era criado à mão com o e-mail FIXO `outro-limpeza@teste`. O
   * `finally` lá embaixo o apagava — quando chegava lá. Qualquer rodada que
   * morresse antes (um Postgres que cai, um Ctrl+C, uma etapa acima que
   * estoura) deixava a linha para trás, e daí em diante TODA execução futura
   * reprovava com `duplicate key value violates unique constraint
   * "tenants_email_key"`.
   *
   * É o vermelho que não fala do código: o teste passa a acusar o ambiente, e
   * quem for depurar vai procurar defeito na limpeza de arquivos, que está
   * certa. Aconteceu de verdade nesta bancada.
   *
   * `segundoEstudioDaRodada` existe exatamente para isto: nome único por
   * execução, e `limparRodada` no fim do arquivo leva o estúdio e tudo que
   * pendura nele — inclusive quando uma etapa estoura no meio.
   */
  const outro = { rows: [await segundoEstudioDaRodada(db)] };
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
    /* O estúdio NÃO é apagado aqui: ele é da bancada, e quem o leva é o
       `limparRodada` no fim do arquivo. O objeto sim, porque subiu por cima. */
    await apagarObjetos([chave]);
  }
});

await etapa("o bucket está sem órfãos agora", async () => {
  const doBucket = await listarChaves();
  const conhecidas = await chavesConhecidas(db);
  /*
   * O bucket é compartilhado com produção, então o que é de estúdio que ESTE
   * banco não conhece fica fora da conta — é o mesmo escopo que a varredura de
   * verdade usa (`deOutroAmbiente`), e não uma imitação dele.
   *
   * Sem isso, esta etapa passou a falhar em 27/08/2026, no minuto em que a
   * primeira foto de verdade subiu em produção: as derivadas dela apareceram
   * como "órfãs" para o banco de dev. O teste estaria certo em reclamar se o
   * bucket fosse só nosso — e a varredura, sem o escopo, teria APAGADO.
   */
  const nossos = doBucket.filter((c) => !deOutroAmbiente(c, conhecidas.donos));
  const orfaos = nossos.filter((c) => !conhecidas.r2.has(c));
  if (orfaos.length) throw new Error(`${orfaos.length} órfão(s): ${orfaos[0]}`);
  const deFora = doBucket.length - nossos.length;
  return `${nossos.length} objetos nossos, todos referenciados${deFora ? ` (${deFora} de outro ambiente, fora do escopo)` : ""}`;
});

console.log("\nDois armazéns — o original pode estar no B2, a derivada nunca:\n");

/*
 * ── POR QUE ESTA SEÇÃO EXISTE ─────────────────────────────────────────────
 * A varredura listava só o R2 e comparava com um conjunto ÚNICO de chaves
 * conhecidas, vindo dos dois armazéns misturados. Isso era inofensivo enquanto
 * ela apagasse apenas o que veio da listagem do R2: chave de B2 no conjunto
 * ficava inerte. Mas deixava órfão do B2 invisível — arquivo pago que ninguém
 * referencia e nenhuma ferramenta enxerga.
 *
 * O conserto óbvio — separar as conhecidas por `medias.armazem` — é uma
 * armadilha, e é ela que estas etapas prendem: `armazem` descreve UM dos três
 * arquivos da linha. O original segue a coluna; `chave_thumb` e `chave_preview`
 * ficam SEMPRE no R2 (ver `urlDaDerivada` em src/lib/armazem.ts, que lê a
 * derivada sem passar pelo despachante).
 *
 * Separar por linha jogaria as derivadas de toda mídia do B2 no conjunto do B2.
 * A varredura do R2 deixaria de reconhecê-las, chamaria de órfãs e, com
 * `--apagar`, removeria miniatura e prévia de todas as galerias servidas do B2.
 *
 * E o estrago não apareceria como imagem quebrada: `urlDaDerivada` cai no
 * `urlDoOriginal` quando a derivada falta. A galeria passaria a servir o
 * ORIGINAL no lugar da miniatura — 800 fotos de casamento viram 800 downloads
 * de arquivo cheio, com egresso pago do B2. Fica lenta e cara, não quebrada:
 * ninguém abre chamado, e a conta chega no fim do mês.
 */
await etapa("as chaves conhecidas vêm separadas por armazém", async () => {
  const c = await chavesConhecidas(db);
  if (!(c.r2 instanceof Set) || !(c.b2 instanceof Set)) {
    throw new Error("chavesConhecidas devia devolver { r2, b2 } — veio conjunto único");
  }
  return `r2 com ${c.r2.size}, b2 com ${c.b2.size}`;
});

await etapa("o original de mídia no B2 é conhecido pelo B2, não pelo R2", async () => {
  const g = await galeriaDaRodada(db, { nome: "no-b2", medias: 1 });
  const m = g.midias[0];
  await db.query("update medias set armazem = 'b2' where id = $1", [m.id]);

  const c = await chavesConhecidas(db);
  if (!c.b2.has(m.chave)) {
    throw new Error("o original do B2 não está nas conhecidas do B2 — a varredura do B2 o apagaria");
  }
  if (c.r2.has(m.chave)) {
    throw new Error("o original do B2 aparece como conhecido do R2 — protegeria órfão homônimo lá");
  }
  return "original só no conjunto do B2";
});

await etapa("as derivadas de mídia no B2 continuam sendo conhecidas do R2", async () => {
  /* A etapa mais importante do arquivo: é o caminho da perda silenciosa. */
  const g = await galeriaDaRodada(db, { nome: "no-b2" });
  const m = g.midias[0];
  const { rows } = await db.query(
    "select chave_thumb, chave_preview, armazem from medias where id = $1",
    [m.id],
  );
  if (rows[0].armazem !== "b2") throw new Error("a bancada não ficou em b2");

  const c = await chavesConhecidas(db);
  for (const [qual, chave] of [
    ["miniatura", rows[0].chave_thumb],
    ["prévia", rows[0].chave_preview],
  ]) {
    if (!c.r2.has(chave)) {
      throw new Error(
        `a ${qual} de mídia do B2 saiu das conhecidas do R2 — a varredura apagaria e a galeria passaria a servir o original inteiro`,
      );
    }
  }
  return "miniatura e prévia protegidas no R2";
});

await etapa("a logo do estúdio continua sendo conhecida do R2", async () => {
  // Ela não tem linha em `medias` e nunca vai para o B2. Já custou caro uma vez.
  const t = await estudioDaRodada(db);
  const logo = `${t.id}/logo-${Date.now()}.png`;
  await db.query("update tenants set logo_chave = $1 where id = $2", [logo, t.id]);
  const c = await chavesConhecidas(db);
  if (!c.r2.has(logo)) throw new Error("a logo sairia como órfã — apagaria a marca do estúdio");
  return "logo protegida";
});

await etapa("sem derivada, a leitura degrada para o original em vez de falhar", async () => {
  /* Documenta o porquê de a etapa acima ser grave. Se um dia alguém trocar este
   * fallback por erro, esta etapa avisa que o modo de falha mudou — de caro e
   * silencioso para visível. */
  const { urlDaDerivada } = await import("../src/lib/armazem.ts");
  const g = await galeriaDaRodada(db, { nome: "principal" });
  const m = g.midias[0];
  const semDerivada = await urlDaDerivada(null, m.chave, "r2");
  if (!semDerivada) throw new Error("não devolveu URL nenhuma");
  const comDerivada = await urlDaDerivada(`${m.chave}_thumb.webp`, m.chave, "r2");
  if (semDerivada === comDerivada) throw new Error("derivada ausente e presente deram a mesma URL");
  return "cai no original — perda de derivada é cara, não visível";
});

// A bancada desta execucao sai inteira (ver fixture-de-teste.mjs).
await limparRodada(db);
await db.end();

if (falhou) {
  console.error("\n✗ a limpeza de arquivos tem problema\n");
  process.exit(1);
}
console.log("\n✓ apaga em lote com segurança e a varredura distingue órfão de arquivo em uso\n");
