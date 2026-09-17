#!/usr/bin/env node
/**
 * Testa as credenciais do R2 de ponta a ponta. Uso:
 *   node --env-file=.env.local scripts/testar-r2.mjs
 *
 * Faz o mesmo caminho que o app vai fazer: grava um objeto, gera uma URL
 * assinada, baixa por ela e apaga. Se isso passa, upload de galeria funciona.
 * NUNCA imprime chave — só o resultado de cada etapa.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;

const faltando = Object.entries({
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (faltando.length) {
  console.error(`✗ faltam variáveis no .env.local: ${faltando.join(", ")}`);
  process.exit(1);
}

console.log(`conta ...${R2_ACCOUNT_ID.slice(-6)} · bucket "${R2_BUCKET}"`);


/* O endereço do armazém vem do `lib/r2.ts`: eram cinco cópias desta conta,
   e as cópias não acompanharam o dia em que o armazém mudou de lugar. */
const { OPCOES_DO_CLIENTE } = await import("../src/lib/r2.ts");
const s3 = new S3Client({
  ...OPCOES_DO_CLIENTE,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const chave = `_teste/conexao-${Date.now()}.txt`;
const conteudo = "olumier: teste de conexao";
let falhou = false;

async function etapa(nome, fn) {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
    return true;
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.name}: ${e.message}`);
    falhou = true;
    return false;
  }
}

await etapa("bucket acessível", async () => {
  await s3.send(new HeadBucketCommand({ Bucket: R2_BUCKET }));
});

await etapa("gravar objeto", async () => {
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: chave,
      Body: conteudo,
      ContentType: "text/plain",
    }),
  );
  return chave;
});

await etapa("gerar URL assinada e baixar", async () => {
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: R2_BUCKET, Key: chave }), {
    expiresIn: 60,
  });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const texto = await r.text();
  if (texto !== conteudo) throw new Error("conteúdo veio diferente do enviado");
  return "conteúdo confere";
});

await etapa("apagar objeto de teste", async () => {
  await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: chave }));
});

if (falhou) {
  console.error("\n✗ o armazenamento NÃO está pronto — confira as chaves e a permissão do token");
  process.exit(1);
}
console.log("\n✓ armazenamento pronto: leitura, gravação e URL assinada funcionando");
