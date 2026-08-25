#!/usr/bin/env node
/**
 * Testa o armazém dos ARQUIVOS PESADOS — o primário no Backblaze B2.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-b2.mjs
 *
 * Por que existe (ver docs/obra-rota-b2.md): galeria grande e cofre custam
 * R$ 0,1155/GB no R2 e R$ 0,046/GB no B2. A grade de preços foi calculada com o
 * número do B2, então enquanto o arquivo pesado não morar lá, boa parte da
 * tabela vende abaixo do custo.
 *
 * Este é o caminho de SERVIR galeria, não um backup: diferente do espelho, aqui
 * falha tem de ser barulhenta. Por isso as etapas prendem as três coisas que
 * separam "funciona" de "parece funcionar":
 *   1. o byte que volta é o mesmo que subiu;
 *   2. Range devolve 206 com a fatia exata — sem isso o player 4K não faz seek,
 *      e "o vídeo não passa do começo" é o defeito mais caro de descobrir tarde;
 *   3. o primário NUNCA divide bucket com o espelho — se dividisse, as duas
 *      cópias morreriam no mesmo acidente e a promessa da página de segurança
 *      viraria mentira sem ninguém perceber.
 *
 * Sem ARQUIVOS_* configurado as etapas de rede são PULADAS em vez de vermelhas:
 * "não rodou" e "quebrou" não podem ter a mesma cor.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  arquivosConfigurado,
  ARQUIVOS_BUCKET,
  urlDeUploadArquivo,
  urlDeLeituraArquivo,
  conferirArquivo,
  apagarArquivo,
  conferirArmazemArquivos,
} from "../src/lib/b2.ts";
import { ESPELHO_BUCKET, espelhoConfigurado } from "../src/lib/espelho.ts";

let falhou = false;
let pulados = 0;

async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
async function etapaDeRede(nome, fn) {
  if (!arquivosConfigurado) {
    pulados++;
    console.log(`  – ${nome} (pulado: ARQUIVOS_* não configurado)`);
    return;
  }
  await etapa(nome, fn);
}

console.log("configuração");

/*
 * Config incompleta aqui não pode virar erro obscuro no meio de uma galeria
 * aberta pelo cliente do fotógrafo. A mensagem tem de dizer o que falta.
 */
await etapa("sem configuração, a falha diz o que falta", () => {
  if (arquivosConfigurado) return "configurado — nada a provar aqui";
  try {
    urlDeLeituraArquivo("qualquer/chave");
  } catch (e) {
    if (!e.message.includes("ARQUIVOS_")) {
      throw new Error(`mensagem não nomeia as variáveis: "${e.message}"`);
    }
    return "erro nomeia as ARQUIVOS_*";
  }
  throw new Error("deveria ter lançado sem configuração");
});

/*
 * A invariante que sustenta a página /seguranca: duas cópias em lugares que não
 * caem juntos. Primário e espelho no mesmo bucket seriam UMA cópia com dois
 * nomes — e o pior tipo de falha, a que passa despercebida porque tudo funciona
 * no dia a dia.
 */
await etapa("primário e espelho não dividem bucket", () => {
  if (!arquivosConfigurado || !espelhoConfigurado) {
    return "um dos dois ainda não configurado";
  }
  if (ARQUIVOS_BUCKET === ESPELHO_BUCKET) {
    throw new Error(`primário e espelho no mesmo bucket "${ARQUIVOS_BUCKET}"`);
  }
  return `${ARQUIVOS_BUCKET} ≠ ${ESPELHO_BUCKET}`;
});

console.log("\nida e volta");

await etapaDeRede("o armazém responde", async () => {
  const r = await conferirArmazemArquivos();
  if (!r.ok) throw new Error(r.erro);
  return ARQUIVOS_BUCKET;
});

/* Conteúdo grande o bastante para o Range pedir um pedaço do meio. */
const corpo = Buffer.from(
  Array.from({ length: 4096 }, (_, i) => String.fromCharCode(33 + (i % 90))).join(""),
);
const chave = `_teste/${randomUUID()}.txt`;
const sha = (b) => createHash("sha256").update(b).digest("hex");

await etapaDeRede("envia pela URL assinada", async () => {
  const url = await urlDeUploadArquivo(chave, "text/plain");
  const r = await fetch(url, { method: "PUT", body: corpo });
  if (!r.ok) throw new Error(`PUT devolveu ${r.status}`);
  return `${corpo.length} bytes`;
});

await etapaDeRede("o tamanho gravado é o real", async () => {
  const { bytes } = await conferirArquivo(chave);
  if (bytes !== corpo.length) throw new Error(`gravou ${bytes}, enviou ${corpo.length}`);
  return `${bytes} bytes`;
});

await etapaDeRede("o que volta é byte a byte o que subiu", async () => {
  const url = await urlDeLeituraArquivo(chave);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET devolveu ${r.status}`);
  const volta = Buffer.from(await r.arrayBuffer());
  if (sha(volta) !== sha(corpo)) throw new Error("conteúdo diferente");
  return sha(volta).slice(0, 12);
});

/*
 * Sem isto o filme abre e nunca avança: o player pede uma faixa de bytes para
 * saltar no tempo, e um armazém que ignora Range devolve o arquivo inteiro toda
 * vez. Passa no teste de "baixa certo" e falha na única coisa que o cliente faz.
 */
await etapaDeRede("Range devolve 206 com a fatia exata", async () => {
  const url = await urlDeLeituraArquivo(chave);
  const r = await fetch(url, { headers: { Range: "bytes=1000-1099" } });
  if (r.status !== 206) throw new Error(`esperava 206, veio ${r.status}`);
  const fatia = Buffer.from(await r.arrayBuffer());
  if (fatia.length !== 100) throw new Error(`fatia de ${fatia.length} bytes`);
  if (!fatia.equals(corpo.subarray(1000, 1100))) throw new Error("fatia com conteúdo errado");
  return "bytes 1000-1099 conferem";
});

/*
 * O nome do arquivo vem do navegador de quem enviou. O r2.ts já resolveu isto
 * (duas formas de `filename`, sem quebra de linha); se o b2.ts refizer à mão em
 * vez de reusar, a correção regride justamente no download do casal.
 */
await etapaDeRede("nome com acento não quebra o download", async () => {
  const url = await urlDeLeituraArquivo(chave, 300, "Ana & Pedro — Cerimônia.jpg");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET devolveu ${r.status}`);
  const disp = r.headers.get("content-disposition") ?? "";
  if (!disp.includes("filename*=UTF-8''")) throw new Error(`sem filename*: "${disp}"`);
  if (/[\r\n]/.test(disp)) throw new Error("cabeçalho com quebra de linha");
  return "duas formas de filename";
});

await etapaDeRede("apagar remove de verdade", async () => {
  await apagarArquivo(chave);
  try {
    await conferirArquivo(chave);
  } catch {
    return "sumiu";
  }
  throw new Error("o objeto continua lá");
});

if (pulados > 0) {
  console.log(`\n${pulados} etapa(s) de rede puladas — configure ARQUIVOS_* para cobrir tudo`);
  console.log("  ver docs/obra-rota-b2.md → fase 1");
}
console.log(falhou ? "\n✗ armazém dos arquivos com problema\n" : "\n✓ armazém dos arquivos ok\n");
process.exit(falhou ? 1 : 0);
