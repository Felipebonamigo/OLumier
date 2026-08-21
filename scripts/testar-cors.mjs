#!/usr/bin/env node
/**
 * Testa o CORS do bucket de verdade — do jeito que o navegador faz.
 * Uso: node --env-file=.env.local scripts/testar-cors.mjs
 *
 * POR QUE ISTO EXISTE: o "salvar na galeria do celular" busca a foto com `fetch`
 * antes de abrir o menu nativo. Se o bucket não autorizar a origem, o navegador
 * bloqueia — e o botão cai no download comum, que no iPhone joga a foto no app
 * Arquivos em vez das Fotos. O download no computador continua funcionando (é
 * navegação, não fetch), então o defeito aparece SÓ no celular e SÓ no endereço
 * do estúdio: a combinação mais difícil de perceber testando na mão.
 *
 * Foi exatamente o que aconteceu até 21/08/2026: a política do bucket listava
 * `app.fotonio.com.br` (endereço que nunca existiu) e não cobria o subdomínio
 * dos estúdios.
 *
 * O teste faz as DUAS metades, porque passar numa não garante a outra:
 *   1. o preflight (OPTIONS) — a pergunta que o navegador faz antes
 *   2. o GET assinado com Origin — a resposta que ele precisa aceitar
 *
 * Usa a chave normal, de objeto: não mexe em configuração, só exercita.
 */
import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error("✗ faltam variáveis do R2 no .env.local");
  process.exit(1);
}

const ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const s3 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

/*
 * `estudio-que-nao-existe` não é enfeite: é o teste que prova que o curinga
 * está valendo. Se um dia alguém trocar a política por uma lista explícita, os
 * estúdios já cadastrados continuariam passando e só o cliente NOVO quebraria —
 * meses depois, sem ninguém ligar uma coisa à outra.
 */
const PERMITIDAS = [
  "https://fotonio.com.br",
  "https://www.fotonio.com.br",
  "https://siriusfotografia.fotonio.com.br",
  "https://estudio-que-nao-existe-ainda.fotonio.com.br",
];
const BARRADAS = ["https://site-invasor.com", "https://fotonio.com.br.golpe.net"];

let falhas = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const erro = (m) => {
  falhas++;
  console.log(`  ✗ ${m}`);
};

const chave = `_teste-cors/${randomUUID()}.txt`;

try {
  console.log("preflight (OPTIONS)");
  for (const origem of PERMITIDAS) {
    const r = await fetch(`${ENDPOINT}/${R2_BUCKET}/${chave}`, {
      method: "OPTIONS",
      headers: { Origin: origem, "Access-Control-Request-Method": "GET" },
    });
    const liberou = r.headers.get("access-control-allow-origin");
    if (r.status === 204 && liberou === origem) ok(`${origem} liberado`);
    else erro(`${origem} deveria ser liberado — HTTP ${r.status}, permissão: ${liberou ?? "nenhuma"}`);
  }

  for (const origem of BARRADAS) {
    const r = await fetch(`${ENDPOINT}/${R2_BUCKET}/${chave}`, {
      method: "OPTIONS",
      headers: { Origin: origem, "Access-Control-Request-Method": "GET" },
    });
    // `fotonio.com.br.golpe.net` termina com nosso domínio no meio do nome: se a
    // regra estivesse escrita como "contém", ele passaria. Precisa ser barrado.
    if (r.headers.get("access-control-allow-origin")) erro(`${origem} NÃO deveria ser liberado`);
    else ok(`${origem} barrado`);
  }

  console.log("\nGET assinado (o que o botão realmente faz)");
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: chave,
      Body: "teste de cors",
      ContentType: "text/plain",
    }),
  );

  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: R2_BUCKET, Key: chave }), {
    expiresIn: 120,
  });

  const origem = "https://siriusfotografia.fotonio.com.br";
  const r = await fetch(url, { headers: { Origin: origem } });
  const liberou = r.headers.get("access-control-allow-origin");
  const corpo = await r.text();

  if (!r.ok) erro(`o arquivo não voltou — HTTP ${r.status}`);
  else if (liberou !== origem) erro(`voltou sem permissão para ${origem} (${liberou ?? "nenhuma"})`);
  else if (corpo !== "teste de cors") erro(`conteúdo inesperado: ${corpo.slice(0, 40)}`);
  else ok(`arquivo lido de ${origem} com permissão`);

  // ETag exposto é o que o envio em partes (>5 GB) precisa ler de cada pedaço.
  const expostos = (r.headers.get("access-control-expose-headers") ?? "").toLowerCase();
  if (expostos.includes("etag")) ok("ETag exposto (envio em partes)");
  else erro(`ETag não exposto — envio de arquivo grande quebra (expostos: ${expostos || "nenhum"})`);
} finally {
  // Um objeto de teste esquecido no bucket é invisível: não aparece no painel,
  // não conta na quota, e é cobrado todo mês.
  await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: chave })).catch((e) => {
    console.log(`  ! não consegui apagar ${chave}: ${e.name}`);
  });
}

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : "\n✓ CORS ok\n");
process.exit(falhas ? 1 : 0);
