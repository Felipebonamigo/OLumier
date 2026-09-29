// UM ARMAZÉM S3 PARA O CI, SEM DEPENDER DE REGISTRADOR NENHUM.
//
// ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
//
// O armazém do CI era um MinIO, e em um mês o fornecedor dele fechou as TRÊS
// portas que havia:
//
//   · Docker Hub (`minio/minio`) — `pull access denied ... may require
//     'docker login'`;
//   · `quay.io/minio/minio` — `unauthorized: access to the requested resource
//     is not authorized`, em qualquer tag;
//   · o binário de `dl.min.io` — **410 Gone**.
//
// Não é tag que sumiu: é o acesso público que acabou. Um CI cuja peça central
// depende de alguém continuar distribuindo de graça é um CI que quebra sozinho
// num dia em que ninguém mexeu em nada — e foi o que aconteceu, duas vezes.
//
// Este servidor vem do npm, que o CI já usa para existir (`npm ci`), e portanto
// não acrescenta ponto de falha nenhum. Se o npm cair, não há CI de qualquer
// jeito.
//
// ── E POR QUE NÃO UM DUBLÊ ────────────────────────────────────────────────
//
// Porque o que as suítes testam é o caminho de verdade: elas assinam URL de
// upload, sobem arquivo pela rede, leem de volta, apagam em lote e conferem que
// o objeto saiu do bucket. `s3rver` implementa o protocolo S3 sobre o sistema
// de arquivos — o app fala com ele pelo `R2_ENDPOINT` usando o mesmo
// `@aws-sdk/client-s3` de produção, sem nenhuma linha de desvio no código.
// Trocar o MinIO por ele muda QUEM atende, não O QUE é exercitado.
//
// ── O `overrides` DO package.json FAZ PARTE DISTO ─────────────────────────
//
// O `s3rver` está arquivado e trazia três advisories **high**, todas pelo
// `busboy@0.3` (o `dicer`, que quebra ao parsear cabeçalho de multipart). O CI
// tem portão de `npm audit --audit-level=high`, e ele ia barrar — com razão:
// um portão que aprende a ignorar vermelho morre, e é o próprio arquivo do CI
// que diz isso.
//
// Então o `busboy` está pinado em `^1.6.0` pelo `overrides` — versão em que o
// `dicer` já não existe. Conferido: as três high somem e a suíte inteira
// continua verde (129 · 0), porque o caminho do `busboy` aqui é o POST de
// formulário de navegador, que este app não usa — o cliente S3 grava com PUT.
//
// O `fast-xml-parser` NÃO dá para pinar junto, e isto está escrito para
// ninguém tentar de novo: a v4 trocou `parser.parse()` por `new XMLParser()`,
// e o `s3rver` morre na carga com `xmlParser.parse is not a function`. A
// advisory dele é **moderate**, que o portão não barra — e a decisão de barrar
// só high está explicada no `verificar.yml`.
//
// ── COMO USAR ──────────────────────────────────────────────────────────────
//
//   node scripts/armazem-de-teste.mjs            # sobe e fica no ar
//   node scripts/armazem-de-teste.mjs --porta 9000 --bucket galerias
//   node scripts/armazem-de-teste.mjs --conferir  # NÃO sobe: prova o que já subiu
//
// Imprime "armazém pronto" quando estiver atendendo, para o CI poder esperar.
//
// `--conferir` faz uma ida e volta de verdade — grava, lê, apaga — com o MESMO
// `@aws-sdk/client-s3` que o app usa, lendo o endereço e as chaves do ambiente.
// É a sonda do CI, e é assim de propósito: "a porta 9000 aceita conexão" não
// prova que o armazém responde S3, e uma sonda que mede a coisa errada é como
// o CI passa a cobrir menos sem ninguém notar.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";

/* A conferência vem ANTES de qualquer coisa subir: aqui o script é cliente, não
   servidor. Sobe-e-confere na mesma invocação seria um teste do próprio
   processo, que passaria mesmo com o servidor errado no ar. */
if (process.argv.includes("--conferir")) {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } =
    await import("@aws-sdk/client-s3");
  const bucket = process.env.R2_BUCKET;
  const s3 = new S3Client({
    region: process.env.R2_REGIAO ?? "us-east-1",
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: process.env.ARMAZEM_CAMINHO_NO_ENDERECO === "1",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const chave = "armazem-de-teste/sonda";
  const conteudo = "ida e volta";
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: chave, Body: conteudo }));
  const lido = await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: chave })))
    .Body.transformToString();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: chave }));
  if (lido !== conteudo) {
    console.error(`o armazém devolveu outra coisa: ${JSON.stringify(lido)}`);
    process.exit(1);
  }
  console.log(`armazém responde S3 em ${process.env.R2_ENDPOINT} (bucket ${bucket})`);
  process.exit(0);
}

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const porta = Number(arg("porta", "9000"));
const bucket = arg("bucket", "galerias");
/* Pasta nova a cada subida: o armazém do CI não tem passado, e não deve ter —
   sobra de uma rodada anterior é a origem clássica do teste que passa sozinho
   e reprova quando roda limpo. */
const diretorio = arg("dados", mkdtempSync(join(tmpdir(), "armazem-")));

const servidor = new S3rver({
  port: porta,
  address: "127.0.0.1",
  silent: true,
  directory: diretorio,
  /* O bucket já nasce criado: quem sobe o armazém não deveria precisar de um
     segundo programa (a AWS CLI) só para ter onde escrever. */
  configureBuckets: [{ name: bucket, configs: [] }],
});

servidor.run((erro, { address, port } = {}) => {
  if (erro) {
    console.error("armazém NÃO subiu:", erro.message);
    process.exit(1);
  }
  console.log(`armazém pronto em http://${address}:${port} (bucket ${bucket}, dados em ${diretorio})`);
});

/* Sem isto o Ctrl-C deixa a porta ocupada, e a próxima subida falha com
   EADDRINUSE — erro que não parece ter relação com o teste que reprovou. */
for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => servidor.close(() => process.exit(0)));
}
