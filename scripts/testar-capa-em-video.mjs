#!/usr/bin/env node
/**
 * A CAPA EM VÍDEO do formato Stream, e o nome do vídeo na aba Vídeo. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-capa-em-video.mjs
 *
 * Precisa do servidor de desenvolvimento rodando e do armazém (MinIO no CI): sem
 * as chaves do R2 (R2_BUCKET e companhia) a suíte é pulada, não reprovada.
 *
 * ── O PEDIDO (08/10/2026) ──────────────────────────────────────────────────
 *
 * Juan, duas linhas no grupo: "adicionar possibilidade de trocar o nome do
 * vídeo, pois está aparecendo o nome completo que vem do CapCut" e "adicionar
 * opção de subir capa em VÍDEO no formato Stream".
 *
 * O nome já existia desde 30/09 — só que dentro do Design, e quem procurava
 * estava na aba Vídeo. A capa em vídeo não existia: a capa do Stream era sempre
 * uma imagem parada.
 *
 * ── O QUE ESTE ARQUIVO MAIS PRENDE ─────────────────────────────────────────
 *
 *   1. as medidas do clipe (30 s, 720p, 25 MB) valem no navegador E no servidor;
 *   2. a chave do clipe vem do NAVEGADOR na hora de confirmar: tem de ser desta
 *      galeria e deste estúdio, como a da capa em imagem;
 *   3. trocar ou tirar o clipe apaga os arquivos antigos do bucket — arquivo pago
 *      que nenhuma linha cita é o órfão que a varredura sai caçando;
 *   4. o clipe só chega à página do cliente quando a sala desenha a própria capa.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, segundoEstudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import {
  DURACAO_MAXIMA_DO_CLIPE,
  LIMITE_CLIPE,
  LIMITE_POSTER_DO_CLIPE,
  bitsDoClipe,
  recusaDaDuracao,
  recusaDoClipe,
  recusaDoPosterDoClipe,
  tamanhoDoClipe,
} from "../src/lib/clipe-da-capa-regras.ts";
import { objetoExiste } from "../src/lib/r2.ts";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
async function etapa(nome, fn) {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
  }
};

console.log("\nAs medidas do clipe\n");

await etapa("4K deitado cabe na caixa de 720p, sem deformar", () => {
  igual(tamanhoDoClipe(3840, 2160), { largura: 1280, altura: 720 }, "4K");
});

await etapa("vídeo em pé (celular) cabe na caixa em pé", () => {
  igual(tamanhoDoClipe(1080, 1920), { largura: 720, altura: 1280 }, "1080x1920");
});

await etapa("vídeo menor que a caixa NÃO é ampliado, e o lado sai par", () => {
  igual(tamanhoDoClipe(641, 361), { largura: 642, altura: 362 }, "641x361");
  const { largura, altura } = tamanhoDoClipe(1281, 721);
  if (largura % 2 || altura % 2) throw new Error(`lado ímpar: ${largura}x${altura}`);
});

await etapa("o bitrate acompanha a resolução, com piso", () => {
  igual(bitsDoClipe(1280, 720), 2_500_000, "720p");
  igual(bitsDoClipe(320, 180), 1_200_000, "piso");
  // 30 s no bitrate cheio têm de caber, com folga, no teto do arquivo.
  const bytes = (bitsDoClipe(1280, 720) / 8) * DURACAO_MAXIMA_DO_CLIPE;
  if (bytes > LIMITE_CLIPE * 0.5) throw new Error(`30 s a 720p pesam ${Math.round(bytes / 1e6)} MB`);
  return `30 s ≈ ${Math.round(bytes / 1e6)} MB`;
});

await etapa("até 30 s passa; mais que isso é filme, e a mensagem diz quanto", () => {
  igual(recusaDaDuracao(30), null, "30 s");
  igual(recusaDaDuracao(8.4), null, "8 s");
  const longo = recusaDaDuracao(72);
  if (!longo?.includes("30 segundos") || !longo.includes("1min12")) throw new Error(`mensagem: ${longo}`);
  if (!recusaDaDuracao(30.5)) throw new Error("30,5 s passou");
  if (!recusaDaDuracao(0) || !recusaDaDuracao(Number.NaN)) throw new Error("duração inválida passou");
});

await etapa("o servidor só aceita MP4 de até 25 MB, e quadro JPG de até 2 MB", () => {
  igual(recusaDoClipe("video/mp4", 8 * 1024 * 1024), null, "8 MB");
  if (!recusaDoClipe("video/quicktime", 1000)) throw new Error("MOV passou");
  if (!recusaDoClipe("video/mp4", LIMITE_CLIPE + 1)) throw new Error("clipe acima do teto passou");
  if (!recusaDoClipe("video/mp4", 0)) throw new Error("clipe vazio passou");
  igual(recusaDoPosterDoClipe("image/jpeg", 100_000), null, "quadro");
  if (!recusaDoPosterDoClipe("image/webp", 100_000)) throw new Error("WebP passou");
  if (!recusaDoPosterDoClipe("image/jpeg", LIMITE_POSTER_DO_CLIPE + 1)) throw new Error("quadro gordo passou");
});

console.log("\nA rota do clipe\n");

const g = await galeriaDaRodada(db, { nome: "capa-em-video", medias: 1 });
const cookie = cookieDeSessao(g.tenant_id);
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);
const rota = (id = g.id) => `${BASE}/api/galerias/${id}/capa-video`;
const enviar = (corpo, opcoes = {}) =>
  fetch(rota(opcoes.id), {
    method: opcoes.metodo ?? "POST",
    headers: { "content-type": "application/json", ...(opcoes.semSessao ? {} : { cookie: opcoes.cookie ?? cookie }) },
    body: opcoes.metodo === "DELETE" ? undefined : JSON.stringify(corpo),
  });

/* Bytes de mentira: o que importa aqui é o caminho, não a imagem. O servidor
   confere TIPO e TAMANHO do que chegou, e não decodifica nada. */
const clipe = Buffer.alloc(300_000, 7);
const quadro = Buffer.alloc(40_000, 9);

/** Faz o envio inteiro, como o navegador faz. */
async function subirTudo() {
  const pedido = await enviar({ bytes: clipe.length, posterBytes: quadro.length });
  const dados = await pedido.json();
  if (!pedido.ok) throw new Error(dados.erro ?? `HTTP ${pedido.status}`);
  const a = await fetch(dados.posterUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: quadro,
  });
  const b = await fetch(dados.url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: clipe,
  });
  return { dados, enviados: a.ok && b.ok, a, b };
}

await etapa("sem sessão, ninguém mexe no clipe", async () => {
  for (const metodo of ["POST", "PUT", "DELETE"]) {
    const r = await enviar({}, { metodo, semSessao: true });
    igual(r.status, 401, metodo);
  }
});

await etapa("galeria de outro estúdio não aceita clipe", async () => {
  const outro = await segundoEstudioDaRodada(db);
  const r = await enviar({ bytes: clipe.length, posterBytes: quadro.length }, { cookie: cookieDeSessao(outro.id) });
  igual(r.status, 404, "POST");
  const d = await enviar({}, { metodo: "DELETE", cookie: cookieDeSessao(outro.id) });
  igual(d.status, 404, "DELETE");
});

await etapa("tipo e tamanho são recusados antes de gerar URL", async () => {
  igual((await enviar({ bytes: 0, posterBytes: quadro.length })).status, 415, "clipe vazio");
  igual((await enviar({ bytes: LIMITE_CLIPE + 1, posterBytes: quadro.length })).status, 415, "clipe grande");
  igual((await enviar({ bytes: clipe.length, posterBytes: LIMITE_POSTER_DO_CLIPE + 1 })).status, 415, "quadro grande");
  igual((await enviar({ bytes: clipe.length })).status, 415, "sem o quadro");
});

let chaveDoClipe = "";
let chaveDoQuadro = "";

await etapa("o pedido devolve DUAS URLs, com as chaves na pasta DESTA galeria", async () => {
  const { dados } = await subirTudo();
  const pasta = `${g.tenant_id}/${g.id}/capa/`;
  if (!dados.chave.startsWith(`${pasta}clipe-`) || !dados.chave.endsWith(".mp4")) throw new Error(dados.chave);
  if (!dados.posterChave.startsWith(`${pasta}clipe-`) || !dados.posterChave.endsWith(".jpg")) {
    throw new Error(dados.posterChave);
  }
  if (dados.chave === dados.posterChave) throw new Error("as duas chaves são iguais");
  chaveDoClipe = dados.chave;
  chaveDoQuadro = dados.posterChave;
  // o envio de teste acima deixou os arquivos no bucket sem gravar: limpa já.
  const { apagarObjetos } = await import("../src/lib/r2.ts");
  await apagarObjetos([chaveDoClipe, chaveDoQuadro]);
});

await etapa("confirmar com chave de FORA da galeria é recusado", async () => {
  const outro = `${g.tenant_id}/outra-galeria/capa/clipe-x.mp4`;
  const r = await enviar({ chave: outro, posterChave: `${g.tenant_id}/${g.id}/capa/clipe-y.jpg` }, { metodo: "PUT" });
  igual(r.status, 400, "chave de outra galeria");
  const r2 = await enviar({ chave: `${g.tenant_id}/${g.id}/capa/clipe-z.mp4`, posterChave: "" }, { metodo: "PUT" });
  igual(r2.status, 400, "sem o quadro");
  const r3 = await enviar({ chave: `${g.tenant_id}/${g.id}/capa/mesma.mp4`, posterChave: `${g.tenant_id}/${g.id}/capa/mesma.mp4` }, { metodo: "PUT" });
  igual(r3.status, 400, "as duas iguais");
  const { rows: [linha] } = await db.query("select capa_video_chave from galerias where id = $1", [g.id]);
  igual(linha.capa_video_chave, null, "nada gravado");
});

await etapa("confirmar sem o arquivo ter chegado é 409, e não grava", async () => {
  const pedido = await (await enviar({ bytes: clipe.length, posterBytes: quadro.length })).json();
  const r = await enviar({ chave: pedido.chave, posterChave: pedido.posterChave }, { metodo: "PUT" });
  igual(r.status, 409, "status");
  const { rows: [linha] } = await db.query("select capa_video_chave from galerias where id = $1", [g.id]);
  igual(linha.capa_video_chave, null, "nada gravado");
});

await etapa("confirmar com os arquivos TROCADOS (o quadro como clipe) apaga os dois do bucket", async () => {
  const { dados, enviados } = await subirTudo();
  if (!enviados) throw new Error("o envio de teste não chegou ao bucket");
  /* O que o servidor confere é o que ESTÁ no bucket, e não o que o navegador
     prometeu: o JPG do quadro apresentado como clipe tem o tipo errado. */
  const r = await enviar({ chave: dados.posterChave, posterChave: dados.chave }, { metodo: "PUT" });
  igual(r.status, 415, "status");
  igual(await objetoExiste(dados.chave), false, "clipe no bucket");
  igual(await objetoExiste(dados.posterChave), false, "quadro no bucket");
  const { rows: [linha] } = await db.query("select capa_video_chave from galerias where id = $1", [g.id]);
  igual(linha.capa_video_chave, null, "nada gravado");
});

let primeiro;
await etapa("o envio inteiro grava as duas colunas", async () => {
  const { dados, enviados } = await subirTudo();
  if (!enviados) throw new Error("o envio ao bucket falhou");
  const r = await enviar({ chave: dados.chave, posterChave: dados.posterChave }, { metodo: "PUT" });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.json()).erro}`);
  const { rows: [linha] } = await db.query(
    "select capa_video_chave, capa_video_poster_chave from galerias where id = $1",
    [g.id],
  );
  igual(linha.capa_video_chave, dados.chave, "clipe");
  igual(linha.capa_video_poster_chave, dados.posterChave, "quadro");
  primeiro = dados;
  return "clipe e quadro gravados";
});

await etapa("o clipe NÃO vira vídeo da galeria — não entra na grade nem na quota", async () => {
  const { rows } = await db.query("select count(*)::int as n from medias where galeria_id = $1 and tipo = 'video'", [g.id]);
  igual(rows[0].n, 0, "vídeos na galeria");
  const { rows: sobra } = await db.query("select count(*)::int as n from medias where galeria_id = $1 and chave like '%clipe-%'", [g.id]);
  igual(sobra[0].n, 0, "linhas de mídia com o clipe");
});

await etapa("trocar o clipe grava o novo e APAGA os dois antigos do bucket", async () => {
  const { dados, enviados } = await subirTudo();
  if (!enviados) throw new Error("o envio ao bucket falhou");
  const r = await enviar({ chave: dados.chave, posterChave: dados.posterChave }, { metodo: "PUT" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows: [linha] } = await db.query("select capa_video_chave from galerias where id = $1", [g.id]);
  igual(linha.capa_video_chave, dados.chave, "clipe novo");
  igual(await objetoExiste(primeiro.chave), false, "clipe antigo no bucket");
  igual(await objetoExiste(primeiro.posterChave), false, "quadro antigo no bucket");
  igual(await objetoExiste(dados.chave), true, "clipe novo no bucket");
  primeiro = dados;
});

console.log("\nO que o cliente vê\n");

/* Uma galeria só de vídeo, em Stream, com a sala desenhando a própria capa. */
async function paginaDoStream(capaStream) {
  const nome = "Filme da noite.mp4";
  await db.query("delete from medias where galeria_id = $1 and tipo = 'video'", [g.id]);
  await db.query(
    `insert into medias (galeria_id, tenant_id, chave, chave_thumb, nome_original, tipo, mime, bytes, largura, altura, ordem, pronto)
     values ($1,$2,$3,$4,$5,'video','video/mp4',5000000,1920,1080,900,true)`,
    [g.id, g.tenant_id, `${g.tenant_id}/${g.id}/stream-prova.mp4`, `${g.tenant_id}/${g.id}/stream-prova.mp4_thumb.webp`, nome],
  );
  await db.query(
    `update galerias set aparencia = jsonb_build_object('formato','stream','estiloStream','cinema','capaStream',$2::text)
      where id = $1`,
    [g.id, capaStream],
  );
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  return html.replaceAll("\\u0026", "&").replaceAll("&amp;", "&");
}

await etapa("Stream com a capa da SALA: o clipe chega à página, e o fundo é o primeiro quadro", async () => {
  const html = await paginaDoStream("sala");
  const nomeDoClipe = primeiro.chave.split("/").pop();
  const nomeDoQuadro = primeiro.posterChave.split("/").pop();
  if (!html.includes(nomeDoClipe)) throw new Error("o endereço do clipe não está na página");
  if (!html.includes(nomeDoQuadro)) throw new Error("o primeiro quadro não está na página");
  // O fundo (imagem) é o quadro do clipe, para o vídeo não "pular" ao começar.
  const desenhado = html.replace(/<script[\s\S]*?<\/script>/g, "");
  if (!desenhado.includes(nomeDoQuadro)) throw new Error("o primeiro quadro não é a imagem de fundo");
});

await etapa("Stream com a capa do GRUPO Capa: o clipe NÃO vai (a imagem fica parada)", async () => {
  const html = await paginaDoStream("galeria");
  const nomeDoClipe = primeiro.chave.split("/").pop();
  if (html.includes(nomeDoClipe)) throw new Error("o clipe foi enviado à página mesmo sem ser usado");
});

await etapa("galeria sem clipe continua igual: nenhum endereço de clipe na página", async () => {
  await db.query("update galerias set capa_video_chave = null, capa_video_poster_chave = null where id = $1", [g.id]);
  const html = await paginaDoStream("sala");
  if (html.includes("clipe-")) throw new Error("apareceu um clipe que ninguém enviou");
});

await etapa("tirar o clipe limpa as colunas E apaga os arquivos do bucket", async () => {
  // O envio acima zerou a coluna à mão; sobe de novo para tirar de verdade.
  const { dados, enviados } = await subirTudo();
  if (!enviados) throw new Error("o envio ao bucket falhou");
  const grava = await enviar({ chave: dados.chave, posterChave: dados.posterChave }, { metodo: "PUT" });
  if (!grava.ok) throw new Error(`HTTP ${grava.status}`);

  const r = await enviar({}, { metodo: "DELETE" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows: [linha] } = await db.query(
    "select capa_video_chave, capa_video_poster_chave from galerias where id = $1",
    [g.id],
  );
  igual(linha.capa_video_chave, null, "clipe");
  igual(linha.capa_video_poster_chave, null, "quadro");
  igual(await objetoExiste(dados.chave), false, "clipe no bucket");
  igual(await objetoExiste(dados.posterChave), false, "quadro no bucket");
});

console.log("\nO nome do vídeo\n");

await etapa("o nome escrito vale na tela do Stream; vazio volta ao nome do arquivo", async () => {
  const { rows: [v] } = await db.query(
    "select id from medias where galeria_id = $1 and tipo = 'video' limit 1",
    [g.id],
  );
  const { definirTituloDoVideo } = await import("../src/lib/medias.ts");
  await db.query("update galerias set aparencia = jsonb_build_object('formato','stream','estiloStream','cinema','capaStream','sala') where id = $1", [g.id]);

  await definirTituloDoVideo(g.id, g.tenant_id, v.id, "  Votos   da noiva ");
  const { rows: [m] } = await db.query("select titulo from medias where id = $1", [v.id]);
  igual(m.titulo, "Votos da noiva", "espaços arrumados");
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  if (!html.includes("Votos da noiva")) throw new Error("o nome escrito não chegou à página");

  await definirTituloDoVideo(g.id, g.tenant_id, v.id, "   ");
  const { rows: [vazio] } = await db.query("select titulo from medias where id = $1", [v.id]);
  igual(vazio.titulo, null, "vazio volta ao arquivo");
});

await etapa("a aba Vídeo oferece o campo do nome", async () => {
  const r = await fetch(`${BASE}/painel/galerias/${g.id}/video`, { headers: { cookie }, cache: "no-store" });
  igual(r.status, 200, "status");
  const html = await r.text();
  if (!html.includes("Nome na tela")) throw new Error("o campo não está na aba Vídeo");
  if (!html.includes("Filme da noite")) throw new Error("o nome tirado do arquivo não aparece como sugestão");
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ capa em vídeo com falha\n" : "\n✓ capa em vídeo ok\n");
process.exit(falhou ? 1 : 0);
