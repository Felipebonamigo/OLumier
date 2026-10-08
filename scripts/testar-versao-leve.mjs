#!/usr/bin/env node
/**
 * A VERSÃO LEVE DO VÍDEO — a cópia que o cliente assiste. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-versao-leve.mjs
 *
 * Precisa do servidor de desenvolvimento rodando (a parte da rota).
 *
 * ── O PEDIDO (08/10/2026) ─────────────────────────────────────────────────
 *
 * Galeria do Mirna e Diogo: "os vídeos abrem e nem executam". Os 32 eram `.MOV`
 * do iPhone em HEVC, de 13 a 54 Mbps, com o índice no fim, tocados direto do
 * original. A saída é a cópia H.264 leve que o navegador do fotógrafo gera
 * (`lib/versao-leve.ts`) e a galeria toca no lugar do original.
 *
 * ── O QUE ESTE ARQUIVO PRENDE, E O QUE NÃO ───────────────────────────────
 *
 *  1. A RÉGUA de quando converter e em que tamanho — pura, sem navegador.
 *  2. O ÍNDICE NA FRENTE (`indice-na-frente.ts`), com um MP4 de verdade montado
 *     aqui: os quadros têm de sair byte a byte iguais, só em outro lugar.
 *  3. A ROTA que recebe a cópia, a URL que a galeria assina, e o apagar.
 *
 * A conversão em si (WebCodecs) só existe no navegador e não roda no Node; foi
 * conferida no Chrome em 08/10/2026 (25 Mbps → 4,9 Mbps, H.264 1080×1920, som
 * copiado, quadro-chave a cada 2 s, índice na frente) — ver
 * `docs/formatos-de-entrega.md`.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, segundoEstudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import {
  precisaDeVersaoLeve,
  tamanhoDaVersaoLeve,
  bitsDaVersaoLeve,
  BITS_MINIMO,
} from "../src/lib/versao-leve.ts";
import { indiceNaFrente, caixasDoTopo, indiceJaNaFrente } from "../src/lib/indice-na-frente.ts";
import * as mb from "mediabunny";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
};

/* ── 1. a régua ───────────────────────────────────────────────────────── */
console.log("Quando converter, e em que tamanho:\n");

await etapa("HEVC do iPhone precisa de cópia, por leve que seja", () => {
  const r = precisaDeVersaoLeve({ codec: "hevc", largura: 1080, altura: 1920, bitsPorSegundo: 9e6 });
  if (!r.precisa || !/HEVC/.test(r.motivo)) throw new Error(JSON.stringify(r));
  return r.motivo;
});
await etapa("H.264 1080p a 8 Mbps toca bem como está", () => {
  const r = precisaDeVersaoLeve({ codec: "avc", largura: 1920, altura: 1080, bitsPorSegundo: 8e6 });
  if (r.precisa) throw new Error(JSON.stringify(r));
  return r.motivo;
});
await etapa("H.264 a 54 Mbps (os vídeos mais pesados da galeria) precisa", () => {
  const r = precisaDeVersaoLeve({ codec: "avc", largura: 1080, altura: 1920, bitsPorSegundo: 54e6 });
  if (!r.precisa || !/54 Mbps/.test(r.motivo)) throw new Error(JSON.stringify(r));
  return r.motivo;
});
await etapa("H.264 4K precisa, mesmo leve", () => {
  const r = precisaDeVersaoLeve({ codec: "avc", largura: 3840, altura: 2160, bitsPorSegundo: 8e6 });
  if (!r.precisa) throw new Error(JSON.stringify(r));
  return r.motivo;
});
await etapa("4K deitado cabe em 1920×1080; em pé, em 1080×1920; pequeno não cresce", () => {
  const casos = [
    [[3840, 2160], [1920, 1080]],
    [[2160, 3840], [1080, 1920]],
    [[1080, 1920], [1080, 1920]],
    [[1440, 1920], [1080, 1440]],
    [[640, 360], [640, 360]],
    [[1921, 1081], [1920, 1080]],
  ];
  for (const [[l, a], [el, ea]] of casos) {
    const t = tamanhoDaVersaoLeve(l, a);
    if (t.largura !== el || t.altura !== ea) throw new Error(`${l}×${a} → ${t.largura}×${t.altura}`);
    if (t.largura % 2 || t.altura % 2) throw new Error(`lado ímpar em ${l}×${a}`);
  }
  return `${casos.length} casos`;
});
await etapa("1080p ganha 5 Mbps; vídeo pequeno não desce do mínimo", () => {
  if (bitsDaVersaoLeve(1920, 1080) !== 5_000_000) throw new Error(String(bitsDaVersaoLeve(1920, 1080)));
  if (bitsDaVersaoLeve(320, 240) !== BITS_MINIMO) throw new Error("passou do piso");
  return "5 Mbps / piso";
});

/* ── 2. o índice na frente ────────────────────────────────────────────── */
console.log("\nO índice vai para a frente sem mexer nos quadros:\n");

/**
 * Um MP4 de verdade, com índice no FIM (como sai da câmera) e duas faixas.
 * Os quadros são bytes inventados — o teste é de CONTÊINER: onde cada pacote
 * mora e se ele volta igual, não se ele decodifica.
 */
async function mp4ComIndiceNoFim() {
  const alvo = new mb.BufferTarget();
  const out = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: false }), target: alvo });
  const video = new mb.EncodedVideoPacketSource("avc");
  const audio = new mb.EncodedAudioPacketSource("aac");
  out.addVideoTrack(video);
  out.addAudioTrack(audio);
  await out.start();
  const pacotes = { video: [], audio: [] };
  const semente = (i, n) => Uint8Array.from({ length: n }, (_, k) => (i * 31 + k * 7) & 0xff);
  for (let i = 0; i < 90; i++) {
    const dados = semente(i, 200 + (i % 7) * 50);
    pacotes.video.push(dados);
    await video.add(new mb.EncodedPacket(dados, i % 30 === 0 ? "key" : "delta", i / 30, 1 / 30), i === 0
      ? { decoderConfig: { codec: "avc1.64001f", codedWidth: 64, codedHeight: 64, description: new Uint8Array([1, 0x64, 0, 0x1f, 0xff, 0xe0, 0]) } }
      : undefined);
    if (i % 2 === 0) {
      const a = semente(i + 1000, 60);
      pacotes.audio.push(a);
      await audio.add(new mb.EncodedPacket(a, "key", i / 30, 2 / 30), i === 0
        ? { decoderConfig: { codec: "mp4a.40.2", numberOfChannels: 2, sampleRate: 44100, description: new Uint8Array([0x12, 0x10]) } }
        : undefined);
    }
  }
  await out.finalize();
  return { blob: new Blob([alvo.buffer], { type: "video/mp4" }), pacotes };
}

async function lerPacotes(blob) {
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  const saida = {};
  for (const [tipo, faixa] of [["video", await input.getPrimaryVideoTrack()], ["audio", await input.getPrimaryAudioTrack()]]) {
    const sink = new mb.EncodedPacketSink(faixa);
    saida[tipo] = [];
    for await (const p of sink.packets()) saida[tipo].push(p.data);
  }
  input.dispose();
  return saida;
}

const iguais = (a, b) => a.length === b.length && a.every((x, i) => x.length === b[i].length && x.every((v, k) => v === b[i][k]));

const { blob: original, pacotes } = await mp4ComIndiceNoFim();
let movido;

await etapa("o arquivo de teste nasce como o da câmera: índice no fim", async () => {
  const ordem = (await caixasDoTopo(original)).map((c) => c.tipo).join(",");
  if ((await indiceJaNaFrente(original)) !== false) throw new Error(ordem);
  return ordem;
});
await etapa("depois de mover: índice na frente, mesmo tamanho", async () => {
  movido = await indiceNaFrente(original);
  const ordem = (await caixasDoTopo(movido)).map((c) => c.tipo).join(",");
  if ((await indiceJaNaFrente(movido)) !== true) throw new Error(ordem);
  if (movido.size !== original.size) throw new Error(`${original.size} → ${movido.size}`);
  return ordem;
});
await etapa("cada quadro e cada pedaço de som voltam byte a byte iguais", async () => {
  const lidos = await lerPacotes(movido);
  if (!iguais(lidos.video, pacotes.video)) throw new Error("os quadros mudaram");
  if (!iguais(lidos.audio, pacotes.audio)) throw new Error("o som mudou");
  return `${lidos.video.length} quadros, ${lidos.audio.length} de som`;
});
await etapa("arquivo que já está certo volta o MESMO, sem cópia", async () => {
  if ((await indiceNaFrente(movido)) !== movido) throw new Error("mexeu no que não precisava");
  return "intocado";
});
await etapa("o que não é MP4 volta como veio", async () => {
  const lixo = new Blob([new Uint8Array(1000).fill(7)]);
  if ((await indiceNaFrente(lixo)) !== lixo) throw new Error("mexeu num arquivo que não é vídeo");
  return "intocado";
});

/* ── 3. a rota, a URL da galeria e o apagar ───────────────────────────── */
console.log("\nA rota que recebe a cópia:\n");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const g = await galeriaDaRodada(db, { nome: "versao-leve", medias: 1 });
await db.query("update galerias set senha_hash = null, estado = 'online' where id = $1", [g.id]);
const cookie = cookieDeSessao(g.tenant_id);
const base = `${g.tenant_id}/${g.id}`;
const novoVideo = async (nome, bytes) =>
  (
    await db.query(
      `insert into medias (galeria_id, tenant_id, chave, nome_original, mime, tipo, bytes, largura, altura, pronto, ordem)
       values ($1,$2,$3,$4,'video/quicktime','video',$5,null,null,true,9) returning id, chave`,
      [g.id, g.tenant_id, `${base}/${nome}`, nome, bytes],
    )
  ).rows[0];
const filme = await novoVideo("cerimonia.mov", 50_000_000);
const rota = (id, metodo, corpo, ck = cookie) =>
  fetch(`${BASE}/api/medias/${id}/reproducao`, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(ck ? { cookie: ck } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

await etapa("sem sessão, recusa", async () => {
  const r = await rota(filme.id, "POST", null, null);
  if (r.status !== 401) throw new Error(`esperava 401, veio ${r.status}`);
  return "401";
});
await etapa("vídeo de OUTRO estúdio não existe para esta sessão", async () => {
  const outro = await segundoEstudioDaRodada(db);
  const r = await rota(filme.id, "POST", null, cookieDeSessao(outro.id));
  if (r.status !== 404) throw new Error(`esperava 404, veio ${r.status}`);
  return "404";
});
await etapa("FOTO não tem versão leve", async () => {
  const r = await rota(g.midias[0].id, "POST");
  if (r.status !== 400) throw new Error(`esperava 400, veio ${r.status}`);
  return "400";
});
await etapa("confirmar sem ter enviado não grava nada", async () => {
  const r = await rota(filme.id, "PUT", {});
  if (r.status !== 409) throw new Error(`esperava 409, veio ${r.status}`);
  const { rows: [m] } = await db.query("select chave_reproducao from medias where id = $1", [filme.id]);
  if (m.chave_reproducao) throw new Error("gravou a coluna sem objeto");
  return "409, coluna vazia";
});

let chaveLeve = null;
await etapa("envia, confirma: a coluna aponta para a cópia e as medidas que faltavam entram", async () => {
  const p = await rota(filme.id, "POST");
  if (!p.ok) throw new Error(`POST ${p.status}`);
  const { url } = await p.json();
  if (!/_leve\.mp4/.test(url)) throw new Error(`chave inesperada: ${url.split("?")[0]}`);
  const sobe = await fetch(url, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: movido });
  if (!sobe.ok) throw new Error(`armazém ${sobe.status}`);
  const c = await rota(filme.id, "PUT", { largura: 1080, altura: 1920, duracao: 59.4 });
  if (!c.ok) throw new Error(`PUT ${c.status} ${await c.text()}`);
  const { rows: [m] } = await db.query(
    "select chave_reproducao, largura, altura, duracao_seg from medias where id = $1",
    [filme.id],
  );
  if (m.chave_reproducao !== filme.chave.replace(/\.mov$/, "_leve.mp4")) throw new Error(m.chave_reproducao);
  if (m.largura !== 1080 || m.altura !== 1920 || m.duracao_seg !== 59) {
    throw new Error(`medidas ${m.largura}×${m.altura} ${m.duracao_seg}s`);
  }
  chaveLeve = m.chave_reproducao;
  return chaveLeve.split("/").pop();
});

await etapa("a galeria toca a CÓPIA, e o download continua sendo o ORIGINAL", async () => {
  const pedir = async (tipo) => {
    const r = await fetch(`${BASE}/api/g/${g.id}/urls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [filme.id], tipo }),
    });
    if (!r.ok) throw new Error(`urls ${tipo} ${r.status}`);
    return (await r.json()).urls[filme.id];
  };
  const assistir = await pedir("preview");
  if (!assistir?.includes("_leve.mp4")) throw new Error(`assiste ${assistir?.split("?")[0]}`);
  await db.query("update galerias set permite_download = true where id = $1", [g.id]);
  const baixar = await pedir("download");
  if (!baixar?.includes("cerimonia.mov")) throw new Error(`baixa ${baixar?.split("?")[0]}`);
  return "assiste _leve.mp4, baixa cerimonia.mov";
});

await etapa("cópia MAIOR que o original é recusada e apagada", async () => {
  const curto = await novoVideo("curto.mov", 100);
  const { url } = await (await rota(curto.id, "POST")).json();
  await fetch(url, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: movido });
  const c = await rota(curto.id, "PUT", {});
  if (c.status !== 400) throw new Error(`esperava 400, veio ${c.status}`);
  const { conferirObjeto } = await import("../src/lib/r2.ts");
  const ainda = await conferirObjeto(curto.chave.replace(/\.mov$/, "_leve.mp4")).then(() => true, () => false);
  if (ainda) throw new Error("o objeto recusado ficou no armazém");
  return "400, objeto apagado";
});

await etapa("apagar o vídeo leva a cópia junto", async () => {
  const { apagarArquivosDasMedias } = await import("../src/lib/armazem.ts");
  const { conferirObjeto } = await import("../src/lib/r2.ts");
  const { rows: [m] } = await db.query("delete from medias where id = $1 returning *", [filme.id]);
  await apagarArquivosDasMedias([m]);
  const ainda = await conferirObjeto(chaveLeve).then(() => true, () => false);
  if (ainda) throw new Error("a cópia ficou órfã no armazém");
  return "cópia apagada";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a versão leve tem falha" : "\n✓ versão leve ok");
process.exit(falhou ? 1 : 0);
