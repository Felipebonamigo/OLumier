#!/usr/bin/env node
/**
 * Aplica a política de CORS do bucket. Uso:
 *   node --env-file=.env.local scripts/configurar-cors.mjs
 *   node --env-file=.env.local scripts/configurar-cors.mjs --conferir   # só lê
 *
 * Para conferir o CORS do jeito que o navegador vê (sem precisar de token de
 * admin), use `scripts/testar-cors.mjs` — esse roda junto com `npm test`.
 *
 * ── PRECISA DE UM TOKEN DE ADMIN ──────────────────────────────────────────────
 * A chave do dia a dia é de OBJETO (ler/gravar arquivo) e não enxerga a
 * configuração do bucket: mexer em CORS devolve AccessDenied, e até LER devolve
 * AccessDenied. Crie no painel da Cloudflare um token "Admin Read & Write" e
 * ponha no .env.local como:
 *
 *   R2_ADMIN_ACCESS_KEY_ID=...
 *   R2_ADMIN_SECRET_ACCESS_KEY=...
 *
 * Separados de propósito: o app em produção segue com a chave restrita, e o
 * token largo só existe na sua máquina, para ser apagado depois de usar.
 * (Em 21/08/2026 isto foi feito direto pelo painel — o caminho manual está em
 * R2 → bucket → Configurações → Política de CORS → Editar.)
 */
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";

const conferirApenas = process.argv.includes("--conferir");

const { R2_ACCOUNT_ID, R2_BUCKET } = process.env;
const chave = process.env.R2_ADMIN_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
const segredo = process.env.R2_ADMIN_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;

if (!R2_ACCOUNT_ID || !chave || !segredo || !R2_BUCKET) {
  console.error("✗ faltam variáveis do R2 no .env.local");
  process.exit(1);
}

/*
 * O CURINGA É O PONTO DA HISTÓRIA.
 *
 * Cada estúdio tem seu subdomínio (siriusfotografia.fotonio.com.br), e é nesse
 * endereço que o casal abre a galeria. Sem autorizar essa origem, "salvar na
 * galeria do celular" quebra — essa função busca o arquivo com `fetch` antes de
 * abrir o menu nativo. O download no computador continua funcionando (é uma
 * navegação, não um fetch), então o defeito aparece SÓ no celular e SÓ no
 * endereço do estúdio: a combinação mais difícil de perceber testando.
 *
 * A documentação do R2 define origem válida como "scheme://host[:port]" e não
 * promete curinga — mas na prática ele aceita e honra: verificado em 21/08/2026
 * com preflight real, inclusive para um subdomínio que ainda não existia. Sem o
 * curinga, cada estúdio novo exigiria uma passada aqui, e quem esquecesse
 * entregaria um cliente com o "salvar no celular" quebrado de nascença.
 *
 * `fotonio.com.br.golpe.net` é barrado — a comparação é por host, não por
 * "contém". Isso é testado em scripts/testar-cors.mjs.
 */
const ORIGENS = [
  "http://localhost:3040",
  "http://localhost:3000",
  "https://fotonio.com.br",
  "https://www.fotonio.com.br",
  "https://*.fotonio.com.br",
];

const ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const s3 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: { accessKeyId: chave, secretAccessKey: segredo },
});

async function mostrarAtual() {
  try {
    const atual = await s3.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET }));
    for (const r of atual.CORSRules ?? []) {
      console.log("  métodos:", r.AllowedMethods?.join(", "));
      console.log("  origens:", r.AllowedOrigins?.join(", "));
    }
    return true;
  } catch (e) {
    console.error(`✗ não consegui LER o CORS: ${e.name}`);
    if (e.name === "AccessDenied") {
      console.error("  A chave em uso é de objeto. Veja o cabeçalho deste arquivo.");
    }
    return false;
  }
}

if (conferirApenas) {
  console.log(`CORS atual do bucket "${R2_BUCKET}":`);
  process.exit((await mostrarAtual()) ? 0 : 1);
}

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
            ExposeHeaders: ["ETag"], // o envio em partes (>5 GB) lê o ETag de cada pedaço
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
} catch (e) {
  console.error(`✗ falhou: ${e.name}: ${e.message}`);
  if (e.name === "AccessDenied") {
    console.error("  Crie um token 'Admin Read & Write' — veja o cabeçalho deste arquivo.");
  }
  process.exit(1);
}

console.log(`✓ CORS gravado no bucket "${R2_BUCKET}"`);
await mostrarAtual();

/*
 * A API aceitar não é a mesma coisa que o R2 honrar: uma origem inválida pode
 * ser guardada e nunca casar com requisição nenhuma. Então perguntamos ao
 * bucket como o navegador perguntaria, e de um subdomínio que não existe — que
 * é justamente o caso que o curinga precisa cobrir.
 */
const prova = "https://estudio-que-nao-existe-ainda.fotonio.com.br";
const r = await fetch(`${ENDPOINT}/${R2_BUCKET}/qualquer`, {
  method: "OPTIONS",
  headers: { Origin: prova, "Access-Control-Request-Method": "GET" },
});
if (r.headers.get("access-control-allow-origin") === prova) {
  console.log("\n✓ o curinga está valendo: estúdio novo já nasce autorizado");
} else {
  console.error(`\n✗ o curinga NÃO está valendo (HTTP ${r.status}).`);
  console.error("  Estúdio novo vai nascer com 'salvar no celular' quebrado.");
  process.exit(1);
}
