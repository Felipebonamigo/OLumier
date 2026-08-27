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
 * Este é o caminho de SERVIR galeria, e falha aqui tem de ser barulhenta — o
 * cliente do fotógrafo está do outro lado. Por isso as etapas prendem as duas
 * coisas que separam "funciona" de "parece funcionar":
 *   1. o byte que volta é o mesmo que subiu;
 *   2. Range devolve 206 com a fatia exata — sem isso o player 4K não faz seek,
 *      e "o vídeo não passa do começo" é o defeito mais caro de descobrir tarde.
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
 * ── AQUI HAVIA "primário e espelho não dividem bucket" (removido 27/08/2026) ─
 *
 * O espelho de arquivos foi cancelado — ver `scripts/testar-sem-espelho.mjs`.
 * Sem segunda cópia, não há dois buckets do app para comparar, e a conferência
 * virou uma que só sabia dizer "sim" a si mesma.
 *
 * A invariante NÃO some junto, ela muda de lugar: o bucket dos originais
 * (`ARQUIVOS_BUCKET`) não pode ser o mesmo onde o rclone guarda os backups
 * cifrados do banco (`cofre-olumier`, hoje `olumier-espelho`). Se fossem o
 * mesmo, uma chave com permissão de apagar levaria os arquivos E o backup na
 * mesma tacada — que é exatamente o desastre que o backup existe para cobrir.
 *
 * Essa comparação não cabe aqui: o app não conhece o destino do rclone, e o
 * `ops/fotonio-backup.sh` — que conhece — hoje confere o CONTEÚDO do dump e não
 * o bucket de destino. Ou seja, ninguém prende esta invariante automaticamente;
 * ela é mantida à mão, pelos nomes serem diferentes (`olumier-arquivos` para os
 * originais, `olumier-espelho` para o cofre do banco). Está escrito aqui para
 * quem for mexer em bucket saber o que não pode juntar.
 */

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
