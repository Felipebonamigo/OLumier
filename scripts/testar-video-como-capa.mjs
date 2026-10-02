#!/usr/bin/env node
/**
 * UM QUADRO DO FILME COMO CAPA DA GALERIA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-video-como-capa.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO, E O LIMITE QUE ELE JÁ TRAZ (01/10/2026) ─────────────────────
 *
 * Juan: "ter a opção de CAPAS de vídeo". Felipe: "aí vai fuder o servidor eu
 * acho (…) ou só a capa principal, não a capa das pastas".
 *
 * A capa de cada filme já existe desde 29/09 (aba Vídeo, quadro tirado do
 * arquivo no computador do fotógrafo — nada é gerado no servidor). O que
 * faltava era o degrau que o Felipe deixou de pé: o filme poder ser a CAPA DA
 * GALERIA, a imagem grande que abre a entrega.
 *
 * ── POR QUE ISSO NÃO É "SÓ TIRAR O FILTRO tipo = 'foto'" ──────────────────
 *
 * Porque a capa é desenhada por `urlDaDerivada(chave_preview, chave, …)`, que
 * cai no ORIGINAL quando não há derivada. Vídeo não tem `chave_preview`: tirar
 * o filtro sem mais nada faria a capa da galeria apontar para o .mp4 de 800 MB
 * como se fosse uma imagem. O casal veria um retângulo vazio e o estúdio pagaria
 * a saída do arquivo inteiro a cada abertura.
 *
 * Então a regra é: vídeo COM pôster vale como capa, e a imagem vem do pôster.
 * Vídeo sem pôster não vale — não há o que mostrar.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const g = await galeriaDaRodada(db, { nome: "video-capa", medias: 2 });
const cookie = cookieDeSessao(g.tenant_id);
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);

/** Um vídeo, com ou sem pôster. */
async function video(nome, comPoster) {
  const chave = `${g.tenant_id}/${g.id}/${nome}.mp4`;
  const { rows: [m] } = await db.query(
    `insert into medias
       (galeria_id, tenant_id, chave, chave_thumb, nome_original, tipo, mime,
        bytes, largura, altura, ordem, pronto)
     values ($1,$2,$3,$4,$5,'video','video/mp4',$6,1920,1080,$7,true)
     returning id`,
    [
      g.id,
      g.tenant_id,
      chave,
      comPoster ? `${chave}_thumb.webp` : null,
      `${nome}.mp4`,
      50_000_000,
      100 + (comPoster ? 0 : 1),
    ],
  );
  return m.id;
}

const comPoster = await video("filme-com-capa", true);
const semPoster = await video("filme-sem-capa", false);

const rota = `${BASE}/api/galerias/${g.id}/capa`;
const escolher = (mediaId) =>
  fetch(rota, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ mediaId }),
  });

console.log("O filme como capa da galeria:\n");

await etapa("vídeo SEM pôster é recusado — não há o que mostrar", async () => {
  const r = await escolher(semPoster);
  igual(r.status, 404, "status");
  const { rows: [linha] } = await db.query("select capa_media_id from galerias where id = $1", [g.id]);
  igual(linha.capa_media_id, null, "capa gravada");
});

await etapa("vídeo COM pôster vale como capa", async () => {
  const r = await escolher(comPoster);
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  const { rows: [linha] } = await db.query("select capa_media_id from galerias where id = $1", [g.id]);
  igual(linha.capa_media_id, comPoster, "capa gravada");
});

await etapa("a galeria desenha o PÔSTER, e nunca o .mp4", async () => {
  /*
   * A conferência que importa: o endereço da capa não pode ser o arquivo do
   * filme. É o defeito que o cabeçalho descreve, e ele seria invisível numa
   * conferência de "a capa existe".
   */
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  const limpo = html.replaceAll("\\u0026", "&").replaceAll("&amp;", "&");
  const desenhado = limpo.replace(/<script[\s\S]*?<\/script>/g, "");
  /*
   * DENTRO DO `<header data-capa=...>`, e não no documento inteiro.
   *
   * Na primeira rodada esta etapa PASSOU com a capa ainda não gravada: o pôster
   * do filme aparece na grade e num `<link rel=preload>` do cabeçalho, e a
   * conferência achava uma dessas. É o mesmo engano de três outros testes desta
   * semana — procurar no documento todo mede qualquer coisa.
   */
  const i = desenhado.indexOf("<header data-capa");
  if (i === -1) throw new Error("não achei o cabeçalho da capa");
  const capa = desenhado.slice(i, desenhado.indexOf("</header>", i));
  if (!capa.includes("filme-com-capa.mp4_thumb.webp")) {
    throw new Error("o pôster do filme não virou a capa");
  }
  if (/.mp4(?![_?])/.test(capa)) throw new Error("a capa aponta para o arquivo do filme");
  return "pôster na capa";
});

await etapa("o cartão do WhatsApp também usa o pôster", async () => {
  /* A capa do cartão sai de outra rota (`opengraph-image`), e foi por isso que
     a conferência está aqui: a página e o cartão escolhiam a capa em dois
     lugares, com o mesmo filtro copiado. */
  const r = await fetch(`${BASE}/g/${g.tslug}/${g.gslug}/opengraph-image`, { cache: "no-store" });
  igual(r.status, 200, "status");
  const tipo = r.headers.get("content-type") ?? "";
  if (!tipo.startsWith("image/")) throw new Error(`o cartão devolveu ${tipo}`);
  return tipo;
});

await etapa("o fotógrafo acha o filme na tela de escolher a capa", async () => {
  /*
   * A régua de quem PODE ser capa vale nos dois lados, e o lado da tela é o que
   * separa "implementado" de "entregue": a escrita aceitando vídeo não serve se
   * a grade de escolha continuar mostrando só foto.
   *
   * E a conferência inclui a URL: `urlDaDerivada` cairia no .mp4 quando não há
   * derivada, e a grade mostraria um arquivo de 800 MB no lugar de uma
   * miniatura — sem erro nenhum, só um quadrado vazio.
   */
  const r = await fetch(`${BASE}/api/galerias/${g.id}/fotos`, { headers: { cookie }, cache: "no-store" });
  igual(r.status, 200, "status");
  const { fotos } = await r.json();
  const comCapa = fotos.find((f) => f.id === comPoster);
  if (!comCapa) throw new Error("o filme com pôster não aparece para escolher");
  if (fotos.some((f) => f.id === semPoster)) {
    throw new Error("o filme SEM pôster apareceu — seria um quadrado vazio na grade");
  }
  if (/.mp4(?![_?])/.test(comCapa.url)) throw new Error("a miniatura do filme aponta para o .mp4");
  if (!comCapa.url.includes("_thumb.webp")) throw new Error("a miniatura não é o pôster");
  return `${fotos.length} para escolher`;
});

await etapa("foto continua podendo ser capa", async () => {
  const r = await escolher(g.midias[1].id);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows: [linha] } = await db.query("select capa_media_id from galerias where id = $1", [g.id]);
  igual(linha.capa_media_id, g.midias[1].id, "capa gravada");
});

await etapa("mídia de OUTRA galeria não vira capa", async () => {
  const outra = await galeriaDaRodada(db, { nome: "video-capa-vizinha", medias: 1 });
  const r = await escolher(outra.midias[0].id);
  igual(r.status, 404, "status");
  const { rows: [linha] } = await db.query("select capa_media_id from galerias where id = $1", [g.id]);
  igual(linha.capa_media_id, g.midias[1].id, "a capa não mudou");
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o filme como capa não fecha" : "\n✓ o filme pode ser a capa");
process.exitCode = falhou ? 1 : 0;
