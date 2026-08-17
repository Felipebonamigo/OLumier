#!/usr/bin/env node
/**
 * Configura o CORS do bucket. Uso:
 *   node --env-file=.env.local scripts/configurar-cors.mjs
 *
 * Por que é obrigatório: o navegador envia o arquivo DIRETO para o bucket, que
 * é outro domínio. Sem uma regra de CORS autorizando nossa origem, o navegador
 * bloqueia o PUT antes de sair — e o erro que aparece é genérico ("Failed to
 * fetch"), difícil de diagnosticar. Rode isto uma vez por bucket, e de novo
 * quando um domínio novo entrar na lista.
 *
 * ExposeHeaders inclui ETag porque o envio em partes (multipart, para arquivos
 * acima de 5 GB) vai precisar ler esse cabeçalho de cada parte.
 */
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error("✗ faltam variáveis do R2 no .env.local");
  process.exit(1);
}

const ORIGENS = [
  "http://localhost:3040",
  "http://localhost:3000",
  "https://fotonio.com.br",
  "https://www.fotonio.com.br",
  "https://app.fotonio.com.br",
];

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

try {
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: R2_BUCKET,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ORIGENS,
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  console.log(`✓ CORS aplicado no bucket "${R2_BUCKET}"`);

  const atual = await s3.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET }));
  for (const regra of atual.CORSRules ?? []) {
    console.log("  métodos:", regra.AllowedMethods?.join(", "));
    console.log("  origens:", regra.AllowedOrigins?.join(", "));
  }
} catch (e) {
  console.error(`✗ falhou: ${e.name}: ${e.message}`);
  process.exit(1);
}
