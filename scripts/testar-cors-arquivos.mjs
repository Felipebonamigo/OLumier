#!/usr/bin/env node
/**
 * CORS do bucket dos ORIGINAIS — o que decide se a foto sobe. Uso:
 *
 *   node --env-file=.env.production --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-cors-arquivos.mjs
 *
 * ── POR QUE ISTO É SEPARADO DE testar-cors.mjs ────────────────────────────
 *
 * Aquele cuida do R2, que serve as DERIVADAS — a pergunta lá é sobre GET, o
 * download. Este cuida do B2, onde o ORIGINAL nasce, e a pergunta é sobre PUT.
 * São dois buckets, com credenciais diferentes, políticas separadas, e um pode
 * estar certo com o outro errado.
 *
 * Foi exatamente o que aconteceu até 27/08/2026: o R2 passava nas seis etapas
 * do outro teste, e o `olumier-arquivos` não tinha CORS NENHUM
 * (`NoSuchCorsConfiguration`). O navegador recusava o PUT antes de mandar um
 * byte, e a tela do fotógrafo dizia "0 B enviados · conexão interrompida" —
 * enquanto o servidor não via erro algum, porque o arquivo nunca passa por ele.
 * Nenhuma foto jamais tinha subido por esse caminho.
 *
 * O upload é o produto. Um teste que cobre o download e não o envio dá a
 * sensação de cobertura sem a cobertura.
 */
import { S3Client, GetBucketCorsCommand } from "@aws-sdk/client-s3";
import { DOMINIOS_ATENDIDOS } from "../src/config/dominios.ts";

const {
  ARQUIVOS_ENDPOINT,
  ARQUIVOS_ACCESS_KEY_ID,
  ARQUIVOS_SECRET_ACCESS_KEY,
  ARQUIVOS_BUCKET,
  ARQUIVOS_REGIAO,
} = process.env;

if (!ARQUIVOS_ENDPOINT || !ARQUIVOS_ACCESS_KEY_ID || !ARQUIVOS_BUCKET) {
  console.log("⚠ pulado: o armazém dos originais não está configurado neste ambiente.");
  process.exit(0);
}

const s3 = new S3Client({
  region: ARQUIVOS_REGIAO ?? "us-east-005",
  endpoint: ARQUIVOS_ENDPOINT,
  credentials: {
    accessKeyId: ARQUIVOS_ACCESS_KEY_ID,
    secretAccessKey: ARQUIVOS_SECRET_ACCESS_KEY,
  },
});

let falhas = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const erro = (m) => {
  falhas++;
  console.log(`  ✗ ${m}`);
};

console.log(`CORS do bucket dos originais ("${ARQUIVOS_BUCKET}"):\n`);

/* ── a política existe? ──────────────────────────────────────────────────── */

let regras = null;
try {
  const r = await s3.send(new GetBucketCorsCommand({ Bucket: ARQUIVOS_BUCKET }));
  regras = r.CORSRules ?? [];
  ok(`política presente — ${regras.length} regra(s)`);
} catch (e) {
  if (e.name === "NoSuchCORSConfiguration" || /CorsConfiguration/i.test(e.name)) {
    erro(
      "o bucket não tem CORS NENHUM — o navegador recusa o envio antes de mandar um byte " +
        '("0 B enviados · conexão interrompida" na tela do fotógrafo)',
    );
  } else {
    erro(`não consegui ler a política: ${e.name} — ${e.message}`);
  }
}

/* ── ela permite o que o envio precisa? ──────────────────────────────────── */

if (regras) {
  const metodos = new Set(regras.flatMap((r) => r.AllowedMethods ?? []));
  const origens = regras.flatMap((r) => r.AllowedOrigins ?? []);
  const expostos = regras.flatMap((r) => r.ExposeHeaders ?? []).map((h) => h.toLowerCase());

  /* PUT é o envio de arquivo pequeno; POST abre e fecha o envio EM PARTES, que
   * é como todo filme e toda foto grande sobem. Faltando um dos dois, metade
   * dos arquivos falha e a outra metade funciona — o pior tipo de defeito. */
  for (const m of ["PUT", "POST", "GET", "HEAD"]) {
    if (metodos.has(m)) ok(`método ${m} liberado`);
    else erro(`método ${m} NÃO liberado — ${m === "POST" ? "envio em partes quebra" : "envio quebra"}`);
  }

  for (const d of DOMINIOS_ATENDIDOS) {
    /* O curinga cobre o subdomínio de cada estúdio. O fotógrafo entra pelo
     * painel no domínio raiz, mas o link do casal mora no subdomínio dele. */
    for (const alvo of [`https://${d}`, `https://*.${d}`]) {
      if (origens.includes(alvo)) ok(`origem ${alvo}`);
      else erro(`origem ${alvo} ausente da política`);
    }
  }

  if (expostos.includes("etag")) ok("ETag exposto (envio em partes lê o de cada pedaço)");
  else erro("ETag não exposto — o envio em partes não consegue fechar o arquivo");
}

console.log(falhas ? `\n✗ ${falhas} falha(s) — a foto não sobe\n` : "\n✓ CORS dos originais ok\n");
process.exit(falhas ? 1 : 0);
