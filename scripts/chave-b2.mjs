#!/usr/bin/env node
/**
 * Confere e conserta a chave do Backblaze B2 que guarda os ORIGINAIS.
 *
 * Nasceu apontado para o espelho de arquivos; o espelho foi cancelado em
 * 27/08/2026 (ver `scripts/testar-sem-espelho.mjs`) e o script foi reapontado
 * em vez de apagado — o `olumier-arquivos` guarda as fotos dos clientes, que é
 * o bucket que mais precisa de uma chave incapaz de furar a própria trava.
 *
 *   ... scripts/chave-b2.mjs                 → mostra o que a chave atual pode fazer
 *   ... scripts/chave-b2.mjs --criar-restrita → cria uma chave nova SEM bypassGovernance
 *
 * Por que existe: o bucket tem Object Lock (governance, 30 dias), que
 * deveria impedir qualquer exclusão antes do prazo. Só que a Backblaze concede
 * a capacidade `bypassGovernance` por padrão às chaves criadas pela INTERFACE —
 * e com ela a trava vira decoração: uma chave roubada apaga o arquivo travado
 * do mesmo jeito.
 *
 * A capacidade não pode ser removida de uma chave existente. O único caminho é
 * criar outra, pela API, com a lista de capacidades escrita à mão. É isto que
 * o `--criar-restrita` faz.
 *
 * NUNCA imprime a chave secreta antiga. A nova aparece UMA vez, porque a
 * Backblaze também só mostra uma vez — sem isso não haveria como configurá-la.
 */
const AUTORIZAR = "https://api.backblazeb2.com/b2api/v3/b2_authorize_account";

const CRIAR = process.argv.includes("--criar-restrita");

const keyId = process.env.ARQUIVOS_ACCESS_KEY_ID;
const appKey = process.env.ARQUIVOS_SECRET_ACCESS_KEY;
const bucketNome = process.env.ARQUIVOS_BUCKET;

if (!keyId || !appKey || !bucketNome) {
  console.error("Faltam ARQUIVOS_ACCESS_KEY_ID, ARQUIVOS_SECRET_ACCESS_KEY e ARQUIVOS_BUCKET.");
  process.exit(1);
}

/*
 * O que o app REALMENTE precisa fazer com os originais:
 *   listBuckets  — o cliente S3 resolve o bucket no começo
 *   listFiles    — saber se o objeto já está lá
 *   readFiles    — servir a galeria e conferir o que foi gravado
 *   writeFiles   — gravar o original enviado pelo fotógrafo
 *   deleteFiles  — a limpeza de órfãos, com conferência, e os testes
 *
 * O que fica de FORA, de propósito:
 *   bypassGovernance — furar o Object Lock. É o buraco que este script fecha.
 *   writeKeys/deleteKeys — uma chave que cria outras chaves não é restrita.
 *   writeBuckets/deleteBuckets — o app não administra bucket.
 */
const CAPACIDADES = ["listBuckets", "listFiles", "readFiles", "writeFiles", "deleteFiles"];

const autorizacao = "Basic " + Buffer.from(`${keyId}:${appKey}`).toString("base64");
const r = await fetch(AUTORIZAR, { headers: { Authorization: autorizacao } });
if (!r.ok) {
  console.error(`✗ a Backblaze recusou a chave: HTTP ${r.status}`);
  process.exit(1);
}
const conta = await r.json();
/*
 * A v3 moveu o que a v2 chamava de `allowed` para dentro de
 * `apiInfo.storageApi`. Ler o campo antigo devolve undefined e o script diria
 * "nenhuma capacidade, chave irrestrita" — o oposto perigoso da verdade, já que
 * é justamente com essa leitura que se decide se a chave fura o Object Lock.
 */
const storage = conta.apiInfo?.storageApi ?? {};
const permissoes = storage.capabilities ?? conta.allowed?.capabilities ?? [];
const api = storage.apiUrl ?? conta.apiUrl;
const bucketDaChave = storage.bucketName ?? conta.allowed?.bucketName ?? null;

console.log(`conta: ${conta.accountId}`);
console.log(`chave restrita ao bucket: ${bucketDaChave ?? "(nenhum — chave irrestrita)"}`);
console.log(`capacidades (${permissoes.length}): ${permissoes.join(", ")}`);

const temBypass = permissoes.includes("bypassGovernance");
const podeCriarChave = permissoes.includes("writeKeys");

console.log(
  temBypass
    ? "\n⚠ ESTA CHAVE FURA O OBJECT LOCK (bypassGovernance). Uma chave vazada apaga arquivo travado."
    : "\n✓ sem bypassGovernance — a chave não consegue furar o Object Lock",
);

if (!CRIAR) {
  if (temBypass) {
    console.log(
      podeCriarChave
        ? "\nPara consertar: rode de novo com --criar-restrita"
        : "\nEsta chave não pode criar outra (falta writeKeys).\n" +
            "  Rode com a chave MESTRA da conta:\n" +
            "    ARQUIVOS_ACCESS_KEY_ID=<keyID mestre> ARQUIVOS_SECRET_ACCESS_KEY=<applicationKey mestre> \\\n" +
            `    ARQUIVOS_BUCKET=${bucketNome} node scripts/chave-b2.mjs --criar-restrita`,
    );
  }
  process.exit(0);
}

if (!podeCriarChave) {
  console.error("\n✗ esta chave não tem writeKeys — use a chave mestra da conta para criar a nova.");
  process.exit(1);
}

/* O id do bucket, para prender a chave nova a ele e a mais nada. */
const rb = await fetch(`${api}/b2api/v3/b2_list_buckets`, {
  method: "POST",
  headers: { Authorization: conta.authorizationToken, "Content-Type": "application/json" },
  body: JSON.stringify({ accountId: conta.accountId, bucketName: bucketNome }),
});
const buckets = await rb.json();
const bucket = buckets.buckets?.[0];
if (!bucket) {
  console.error(`✗ bucket "${bucketNome}" não encontrado nesta conta`);
  process.exit(1);
}

const rk = await fetch(`${api}/b2api/v3/b2_create_key`, {
  method: "POST",
  headers: { Authorization: conta.authorizationToken, "Content-Type": "application/json" },
  body: JSON.stringify({
    accountId: conta.accountId,
    keyName: "olumier-arquivos-restrita",
    capabilities: CAPACIDADES,
    bucketId: bucket.bucketId,
  }),
});
if (!rk.ok) {
  console.error(`✗ não consegui criar a chave: HTTP ${rk.status} ${await rk.text()}`);
  process.exit(1);
}
const nova = await rk.json();

console.log("\n✓ chave nova criada, sem bypassGovernance");
console.log(`  capacidades: ${nova.capabilities.join(", ")}`);
console.log(`  presa ao bucket: ${bucketNome}`);
console.log("\n── COLE NO .env.production E REINICIE O SERVIÇO ──");
console.log(`ARQUIVOS_ACCESS_KEY_ID=${nova.applicationKeyId}`);
console.log(`ARQUIVOS_SECRET_ACCESS_KEY=${nova.applicationKey}`);
console.log(
  "\n(a Backblaze só mostra a chave secreta uma vez — se perder, crie outra)\n" +
    "Depois de trocar, apague a chave antiga no painel da Backblaze: enquanto ela\n" +
    "existir, o buraco do bypassGovernance continua aberto.",
);
