#!/usr/bin/env node
/**
 * O servidor de ZIP de ponta a ponta, numa bancada só desta suíte. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs scripts/testar-servidor-zip.mjs
 *
 * ── A BANCADA ─────────────────────────────────────────────────────────────
 *
 * Três processos falsos e um de verdade:
 *
 *   app       um HTTP mínimo que responde o manifesto e recebe os relatos —
 *             faz o papel de `/api/interno/zip/*`, sem banco;
 *   balde     serve "originais" de bytes aleatórios, e conta cada pedido —
 *             é o que prova que o ZIP guardado não volta ao armazém;
 *   servidor  o `servidor-zip/servidor.ts` DE VERDADE, num processo filho,
 *             com um diretório de cache só dele.
 *
 * O balde derruba a primeira busca de UMA foto de propósito (HTTP 500): é a
 * nova tentativa que tem de salvar o ZIP, e sem esta falha o teste não a
 * provaria.
 *
 * Quem julga o ZIP é um descompactador de verdade (`abrir-zip.mjs`), como nos
 * outros testes de zip — o servidor reler o que escreveu não provaria nada.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { abrirZip } from "./abrir-zip.mjs";
import { assinarPedido, chaveDeCache } from "../src/lib/zip-remoto.ts";

let falhou = false;
async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, oque) => {
  if (a !== b) throw new Error(`${oque}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cond, ms = 5000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (cond()) return;
    await espera(50);
  }
  throw new Error("esperou demais");
}

const SEGREDO = "t".repeat(48);
const GALERIA = "11111111-2222-4333-8444-555555555555";
const PEDIDO_TUDO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PEDIDO_FAV = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
const PEDIDO_VENCIDO = "aaaaaaaa-bbbb-4ccc-8ddd-000000000000";

/* ── os "originais" ─────────────────────────────────────────────────────── */
const originais = [
  { nome: "Festa/DSC_0001.jpg", bytes: randomBytes(300 * 1024 + 7) },
  { nome: "Festa/DSC_0002.jpg", bytes: randomBytes(1024 * 1024 + 3) },
  { nome: "Cerimônia/beijo (1).jpg", bytes: randomBytes(64 * 1024) },
  /* Grande o bastante para não caber nos buffers do socket: é o que faz o
     "abandonado no meio" ser abandonado de verdade, e não entregue por inteiro
     antes de o cliente desistir. */
  { nome: "Festa/filme-curto.mp4", bytes: randomBytes(24 * 1024 * 1024) },
];
const pedidosAoBalde = new Map();
let derrubarPrimeira = true;
/* E OUTRA volta com 200 e corpo vazio: foi assim que a produção quebrou em
   23/09/2026 ("chegou com 0 bytes"). Tem de valer nova tentativa, não ZIP morto. */
let esvaziarPrimeira = true;

const balde = createServer((req, res) => {
  const i = Number(req.url.slice(1));
  pedidosAoBalde.set(i, (pedidosAoBalde.get(i) ?? 0) + 1);
  if (i === 1 && derrubarPrimeira) {
    derrubarPrimeira = false;
    res.writeHead(500);
    return res.end("caiu de propósito");
  }
  if (i === 2 && esvaziarPrimeira) {
    esvaziarPrimeira = false;
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    return res.end();
  }
  const o = originais[i];
  res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": o.bytes.length });
  res.end(o.bytes);
});
await new Promise((r) => balde.listen(0, "127.0.0.1", r));
const urlDoBalde = `http://127.0.0.1:${balde.address().port}`;

/* ── o "app" ────────────────────────────────────────────────────────────── */
const relatos = [];
const arquivosDoManifesto = (quais) =>
  quais.map((i) => ({ nome: originais[i].nome, tamanho: originais[i].bytes.length }));
const TUDO = [0, 1, 2, 3];
const chaveTudo = chaveDeCache(GALERIA, "tudo", null, arquivosDoManifesto(TUDO));

const app = createServer((req, res) => {
  const json = (status, corpo) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(corpo));
  };
  if (req.headers.authorization !== `Bearer ${SEGREDO}`) return json(401, { erro: "sem acesso" });
  const url = new URL(req.url, "http://x");
  const comUrls = url.searchParams.get("comUrls") === "1";
  const m = /^\/api\/interno\/zip\/manifesto\/(.+)$/.exec(url.pathname);
  if (m) {
    const id = m[1];
    if (id === PEDIDO_VENCIDO) return json(410, { erro: "pedido vencido" });
    const quais = id === PEDIDO_TUDO ? TUDO : id === PEDIDO_FAV ? [2] : null;
    if (!quais) return json(404, { erro: "pedido não encontrado" });
    return json(200, {
      pedidoId: id,
      galeriaId: GALERIA,
      tipo: id === PEDIDO_TUDO ? "tudo" : "favoritas",
      nomeDoZip: id === PEDIDO_TUDO ? "Ana & Kaio.zip" : "Ana & Kaio - favoritas.zip",
      chaveDeCache: id === PEDIDO_TUDO ? chaveTudo : null,
      dataDoConteudo: "2026-09-20T18:30:00.000Z",
      arquivos: arquivosDoManifesto(quais).map((a, k) => ({
        ...a,
        url: comUrls ? `${urlDoBalde}/${quais[k]}` : undefined,
      })),
    });
  }
  if (url.pathname === "/api/interno/zip/evento" && req.method === "POST") {
    let corpo = "";
    req.on("data", (d) => (corpo += d));
    req.on("end", () => {
      relatos.push(JSON.parse(corpo));
      json(200, { ok: true });
    });
    return;
  }
  json(404, { erro: "?" });
});
await new Promise((r) => app.listen(0, "127.0.0.1", r));
const urlDoApp = `http://127.0.0.1:${app.address().port}`;

/* ── o servidor de verdade ──────────────────────────────────────────────── */
const cacheDir = mkdtempSync(path.join(tmpdir(), "fotonio-zip-"));
const PORTA = 34000 + Math.floor(Math.random() * 1000);
const filho = spawn(
  process.execPath,
  ["--experimental-strip-types", "--no-warnings", path.resolve(import.meta.dirname, "../servidor-zip/servidor.ts")],
  {
    env: {
      ...process.env,
      ZIP_APP_URL: urlDoApp,
      ZIP_SEGREDO: SEGREDO,
      ZIP_PORTA: String(PORTA),
      ZIP_CACHE_DIR: cacheDir,
      ZIP_BUSCAS_PARALELAS: "2",
      /* Teto minúsculo: o ZIP de 25 MB cabe, e é o que prova que o teto não
         atrapalha o caso normal; ver a etapa do disco cheio. */
      ZIP_CACHE_MAX_GB: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let saidaDoFilho = "";
filho.stdout.on("data", (d) => (saidaDoFilho += d));
filho.stderr.on("data", (d) => (saidaDoFilho += d));
const BASE = `http://127.0.0.1:${PORTA}`;

const encerrar = () => {
  filho.kill("SIGKILL");
  balde.close();
  app.close();
  rmSync(cacheDir, { recursive: true, force: true });
};

try {
  /* 60s, e não 15: isto é ESPERA DE PRONTIDÃO, não medida de desempenho. Na
   * máquina de quem desenvolve o filho sobe em menos de um segundo; num
   * corredor de CI ele divide dois núcleos com o Next em dev, o Postgres, o
   * armazém e as outras suítes — e o filho ainda compila TypeScript na carga
   * (`--experimental-strip-types`). Reprovar ali não diz nada sobre o servidor
   * de ZIP; diz que a máquina estava ocupada, que é o tipo de vermelho que
   * ensina todo mundo a ignorar o portão. Se ele estiver realmente quebrado, a
   * mensagem abaixo mostra a saída dele e o teste reprova do mesmo jeito. */
  await ate(() => saidaDoFilho.includes("servidor de zip em"), 60000).catch(() => {
    throw new Error(`o servidor não subiu:\n${saidaDoFilho}`);
  });
} catch (e) {
  console.log(`  ✗ ${e.message}`);
  encerrar();
  process.exit(1);
}

const tokenTudo = assinarPedido(PEDIDO_TUDO, SEGREDO);
const tokenFav = assinarPedido(PEDIDO_FAV, SEGREDO);
const baixar = async (token, cabecalhos = {}, metodo = "GET") => {
  const r = await fetch(`${BASE}/z/${token}`, { headers: cabecalhos, method: metodo });
  const corpo = Buffer.from(await r.arrayBuffer());
  return { status: r.status, cabecalhos: r.headers, corpo };
};

console.log("\nservidor de zip");

await etapa("/saude responde", async () => {
  const r = await fetch(`${BASE}/saude`);
  const j = await r.json();
  igual(j.ok, true, "ok");
});

await etapa("link sem assinatura válida é 404, sem consultar o app", async () => {
  const antes = relatos.length;
  const { status } = await baixar(`${PEDIDO_TUDO}.assinatura-falsa`);
  igual(status, 404, "status");
  igual(relatos.length, antes, "nenhum relato");
});

await etapa("pedido vencido no app vira 410 com uma frase para a pessoa", async () => {
  const { status, corpo } = await baixar(assinarPedido(PEDIDO_VENCIDO, SEGREDO));
  igual(status, 410, "status");
  if (!corpo.toString().includes("volte à galeria")) throw new Error(`texto: ${corpo}`);
});

let zipTudo;
await etapa("dois cliques ao mesmo tempo: uma montagem, dois ZIPs iguais e completos", async () => {
  const [a, b] = await Promise.all([baixar(tokenTudo), baixar(tokenTudo)]);
  igual(a.status, 200, "status a");
  igual(b.status, 200, "status b");
  igual(a.cabecalhos.get("content-length"), String(a.corpo.length), "content-length exato");
  igual(a.corpo.equals(b.corpo), true, "os dois receberam os mesmos bytes");
  if (!a.cabecalhos.get("content-disposition").includes("Ana")) throw new Error("sem nome");
  zipTudo = a.corpo;
  /* Os relatos chegam por HTTP, cada um na sua hora: espera os três. */
  await ate(
    () =>
      relatos.filter((r) => r.pedidoId === PEDIDO_TUDO && r.evento === "servido").length === 2 &&
      relatos.filter((r) => r.pedidoId === PEDIDO_TUDO && r.evento === "montado").length >= 1,
  );
  igual(relatos.filter((r) => r.pedidoId === PEDIDO_TUDO && r.evento === "montado").length, 1, "montado uma vez");
  igual(pedidosAoBalde.get(0), 1, "original 0 buscado uma vez");
  return `${(zipTudo.length / 1024 / 1024).toFixed(1)} MB`;
});

await etapa("a foto que caiu na primeira busca foi tentada de novo", async () => {
  igual(pedidosAoBalde.get(1), 2, "original 1: a que caiu, e a que veio");
});

await etapa("a foto que veio vazia (200 sem corpo) também foi tentada de novo", async () => {
  igual(pedidosAoBalde.get(2), 2, "original 2: a vazia, e a inteira");
});

await etapa("o ZIP abre num descompactador de verdade, byte a byte", async () => {
  const r = abrirZip(zipTudo, "tudo.zip");
  if (r.codigo !== 0) throw new Error(`${r.ferramenta}: ${r.msg}`);
  for (const o of originais) {
    const lido = readFileSync(path.join(r.destino, o.nome));
    if (!lido.equals(o.bytes)) throw new Error(`${o.nome} veio diferente`);
  }
  rmSync(r.dir, { recursive: true, force: true });
  return `julgado por ${r.ferramenta}`;
});

await etapa("o terceiro clique sai do disco: o balde não é tocado", async () => {
  const antes = new Map(pedidosAoBalde);
  const { status, corpo, cabecalhos } = await baixar(tokenTudo);
  igual(status, 200, "status");
  igual(corpo.equals(zipTudo), true, "mesmos bytes");
  igual(cabecalhos.get("accept-ranges"), "bytes", "aceita Range");
  for (const [i, n] of antes) igual(pedidosAoBalde.get(i), n, `original ${i} não foi buscado de novo`);
  await ate(() => relatos.filter((r) => r.pedidoId === PEDIDO_TUDO && r.evento === "servido").length === 3);
  const ultimo = relatos.filter((r) => r.pedidoId === PEDIDO_TUDO && r.evento === "servido").at(-1);
  igual(ultimo.doCache, true, "relatado como servido do cache");
  igual(ultimo.bytes, zipTudo.length, "bytes do relato");
  const noDisco = readdirSync(cacheDir);
  igual(noDisco.includes(`${chaveTudo}.zip`), true, "o arquivo está no disco com a chave");
});

await etapa("retomar de onde parou: Range devolve 206 com o pedaço certo", async () => {
  const de = 200_000;
  const { status, corpo, cabecalhos } = await baixar(tokenTudo, { Range: `bytes=${de}-` });
  igual(status, 206, "status");
  igual(cabecalhos.get("content-range"), `bytes ${de}-${zipTudo.length - 1}/${zipTudo.length}`, "content-range");
  igual(corpo.equals(zipTudo.subarray(de)), true, "os bytes do fim");
  /* Chegou ao último byte: é a entrega que o download retomado completou. */
  await ate(() => relatos.some((r) => r.pedidoId === PEDIDO_TUDO && r.evento === "servido" && r.bytes === zipTudo.length - de));
});

await etapa("pedaço do meio (acelerador de download) é 'trecho', não entrega", async () => {
  /* Até 29/09/2026 todo Range que terminava virava 'servido' — e cada um, um
     "baixou tudo" na Atividade do fotógrafo. */
  const servidosAntes = relatos.filter((r) => r.pedidoId === PEDIDO_TUDO && r.evento === "servido").length;
  const { status, corpo } = await baixar(tokenTudo, { Range: "bytes=0-99999" });
  igual(status, 206, "status");
  igual(corpo.equals(zipTudo.subarray(0, 100_000)), true, "os bytes do começo");
  await ate(() => relatos.some((r) => r.pedidoId === PEDIDO_TUDO && r.evento === "trecho"));
  const trecho = relatos.find((r) => r.pedidoId === PEDIDO_TUDO && r.evento === "trecho");
  igual(trecho.bytes, 100_000, "bytes do trecho");
  igual(
    relatos.filter((r) => r.pedidoId === PEDIDO_TUDO && r.evento === "servido").length,
    servidosAntes,
    "nenhum 'servido' a mais",
  );
});

await etapa("apagado do cache e montado de novo, o ZIP sai idêntico byte a byte", async () => {
  /* O rodízio do cache cheio (50 galerias num fim de semana, 24/09/2026):
     o ZIP sai do disco e é montado outra vez. Os bytes têm de ser os mesmos,
     senão um "Retomar" emenda dois arquivos diferentes. */
  rmSync(path.join(cacheDir, `${chaveTudo}.zip`));
  const { status, corpo } = await baixar(tokenTudo);
  igual(status, 200, "status");
  igual(corpo.equals(zipTudo), true, "mesmos bytes da primeira montagem");
});

await etapa("retomar com a identidade de outro arquivo recebe o ZIP inteiro, não um pedaço", async () => {
  const { status, corpo, cabecalhos } = await baixar(tokenTudo, {
    Range: "bytes=200000-",
    "If-Range": '"outra-versao"',
  });
  igual(status, 200, "status inteiro");
  igual(corpo.length, zipTudo.length, "arquivo inteiro");
  const certo = await baixar(tokenTudo, { Range: "bytes=200000-", "If-Range": cabecalhos.get("etag") });
  igual(certo.status, 206, "com a identidade certa, retoma");
});

await etapa("HEAD dá o tamanho sem corpo", async () => {
  const { status, corpo, cabecalhos } = await baixar(tokenTudo, {}, "HEAD");
  igual(status, 200, "status");
  igual(cabecalhos.get("content-length"), String(zipTudo.length), "content-length");
  igual(corpo.length, 0, "sem corpo");
});

await etapa("favoritas vão em fluxo, sem guardar nada no disco", async () => {
  const antesNoDisco = readdirSync(cacheDir).length;
  const { status, corpo } = await baixar(tokenFav);
  igual(status, 200, "status");
  const r = abrirZip(corpo, "favoritas.zip");
  if (r.codigo !== 0) throw new Error(`${r.ferramenta}: ${r.msg}`);
  const lido = readFileSync(path.join(r.destino, originais[2].nome));
  igual(lido.equals(originais[2].bytes), true, "a favorita chegou inteira");
  rmSync(r.dir, { recursive: true, force: true });
  igual(readdirSync(cacheDir).length, antesNoDisco, "nada novo no disco");
  await ate(() => relatos.some((r) => r.pedidoId === PEDIDO_FAV && r.evento === "servido"));
  igual(relatos.some((r) => r.pedidoId === PEDIDO_FAV && r.evento === "montado"), true, "em fluxo conta como montado");
});

await etapa("download abandonado no meio é relatado como abortado", async () => {
  const controle = new AbortController();
  const r = await fetch(`${BASE}/z/${tokenTudo}`, { signal: controle.signal });
  const leitor = r.body.getReader();
  await leitor.read();
  controle.abort();
  await ate(() => relatos.some((x) => x.pedidoId === PEDIDO_TUDO && x.evento === "abortado"));
  const ab = relatos.find((x) => x.pedidoId === PEDIDO_TUDO && x.evento === "abortado");
  if (ab.bytes >= zipTudo.length) throw new Error("abortado com o arquivo inteiro?");
});

encerrar();
if (falhou) console.log(`\nsaída do servidor:\n${saidaDoFilho}`);
process.exit(falhou ? 1 : 0);
