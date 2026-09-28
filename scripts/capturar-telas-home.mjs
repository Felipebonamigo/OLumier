/**
 * Refaz os PRINTS DO PAINEL que a home mostra (`public/home/produto/*.webp`).
 *
 * ── POR QUE UM SCRIPT, E NÃO PRINTS TIRADOS À MÃO ─────────────────────────
 *
 * O briefing da home pede interface real — "não esconder o software" (§28).
 * Print tirado à mão envelhece calado: a tela muda, o print continua mostrando
 * a de antes, e ninguém lembra de onde ele veio. Este script monta um estúdio
 * de teste, SOBE AS FOTOS PELO PRÓPRIO PAINEL, marca favoritas pelo mesmo
 * caminho do cliente e fotografa as telas. Mudou a interface, roda de novo.
 *
 * ── O QUE PRECISA ESTAR NO AR ─────────────────────────────────────────────
 *
 * O mesmo arranjo do CI: servidor em localhost:3040, banco de TESTE e um
 * armazém S3 (MinIO), com o `.env.local` apontando para eles. O Playwright
 * vem de fora do projeto — `NODE_PATH` aponta para onde ele estiver instalado.
 *
 *   NODE_PATH=$(npm root -g) node --env-file=.env.local \
 *     --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/capturar-telas-home.mjs
 *
 * Os dados de teste são apagados no fim (`limparRodada`).
 */
import pg from "pg";
import sharp from "sharp";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

exigirBancoDeTeste();

const { chromium } = createRequire(import.meta.url)("playwright");
const { IDENTIDADES, FOTOS_PADRAO } = await import("../src/config/home-demonstracao.ts");
const { CHAVE_TEMA } = await import("../src/config/tema.ts");
const { pessoaPorEmail, alternarDaPessoa } = await import("../src/lib/favoritas.ts");

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const RAIZ = path.resolve(import.meta.dirname, "..");
const DESTINO = path.join(RAIZ, "public/home/produto");
mkdirSync(DESTINO, { recursive: true });

/* As fotos são as PADRÃO da home (`FOTOS_PADRAO`), na ordem da galeria
   "Natural e contemporânea" — a capa primeiro. Assim o print do painel mostra as
   mesmas fotos da página em volta dele, e trocar um padrão no config muda os
   prints na próxima rodada, sem esta lista precisar ser lembrada.

   Sobem com nome de câmera, e não com o nome descritivo que têm em
   `public/home/demo`: a fila de envio mostra o nome, e é assim que ela se
   parece num casamento de verdade. E sobem em JPEG, que é o que sai da
   câmera — a derivada WebP do site vira JPEG aqui. */
const classicaDaHome = IDENTIDADES.find((i) => i.id === "classica");
const ORDEM = [classicaDaHome.capa, ...classicaDaHome.fotos.filter((f) => f !== classicaDaHome.capa)];
const pasta = mkdtempSync(path.join(tmpdir(), "ana-pedro-"));
const arquivos = await Promise.all(
  ORDEM.map(async (lugar, i) => {
    const alvo = path.join(pasta, `ANA_PEDRO_${String(142 + i * 7).padStart(4, "0")}.jpg`);
    await sharp(path.join(RAIZ, "public", FOTOS_PADRAO[lugar].src)).jpeg({ quality: 90 }).toFile(alvo);
    return alvo;
  }),
);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

/* O indicador do Next (o "N" no canto) só existe no servidor de
   desenvolvimento, e não pode entrar no print de uma página de vendas. */
const semIndicador = (pagina) =>
  pagina.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((e) => e.remove()));

const salvar = async (png, nome, largura) => {
  const saida = path.join(DESTINO, `${nome}.webp`);
  await sharp(png).resize({ width: largura, withoutEnlargement: true }).webp({ quality: 80 }).toFile(saida);
  const m = await sharp(saida).metadata();
  console.log(`  ✓ ${nome}.webp — ${m.width}×${m.height}`);
};

try {
  const estudio = await estudioDaRodada(db, { nome: "Seu Estúdio" });
  const g = await galeriaDaRodada(db, {
    nome: "vitrine",
    titulo: "Ana & Pedro",
    medias: 0,
    publicada: true,
  });
  const classica = IDENTIDADES.find((i) => i.id === "classica");
  /* Sem `selecao_limite`: é o padrão de toda galeria, e o print mostra o
     padrão. Com 40 aqui a home dizia "até 40 por pessoa" e parecia que a
     favorita tinha teto (Felipe, 26/09/2026: "por que tem limite de 40?"). */
  await db.query(
    `update galerias set subtitulo = 'Serra Gaúcha', data_evento = '2026-03-21',
            aparencia = $2 where id = $1`,
    [g.id, JSON.stringify(classica.aparencia)],
  );

  const [nomeCookie, valorCookie] = cookieDeSessao(estudio.id).split(";")[0].split("=");
  const navegador = await chromium.launch();

  /* O painel no tema CLARO: a home é clara, e o painel escuro no meio dela
     traria de volta o preto e o dourado que a estratégia tirou da vitrine. */
  const painel = await navegador.newContext({
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 2,
  });
  await painel.addCookies([{ name: nomeCookie, value: valorCookie, url: BASE }]);
  await painel.addInitScript(([chave]) => localStorage.setItem(chave, "claro"), [CHAVE_TEMA]);
  const p = await painel.newPage();

  // ── 01 · SUBA: a fila de envio no meio do caminho ─────────────────────
  await p.goto(`${BASE}/painel/galerias/${g.id}/fotos`, { waitUntil: "networkidle" });
  const cdp = await painel.newCDPSession(p);
  /* Envio lento de propósito, para o print pegar a fila andando — com a
     rede local inteira, as oito fotos subiriam antes do clique terminar. */
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: -1,
    uploadThroughput: 160 * 1024,
  });
  await p.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles(arquivos);
  /* O print é tirado com parte das fotos já dentro e a fila aberta: é o
     "arquivos entrando" do briefing (§8), e não uma barra parada em zero. */
  for (let i = 0; i < 90; i++) {
    const { rows } = await db.query(
      "select count(*)::int as n from medias where galeria_id = $1 and pronto",
      [g.id],
    );
    if (rows[0].n >= 4) break;
    await p.waitForTimeout(500);
  }
  await p.getByRole("button", { expanded: false }).filter({ hasText: /Enviando/ }).click();
  await p.waitForTimeout(1200);
  await semIndicador(p);
  await salvar(await p.screenshot(), "envio", 1200);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  for (let i = 0; i < 120; i++) {
    const { rows } = await db.query(
      "select count(*)::int as n from medias where galeria_id = $1 and pronto",
      [g.id],
    );
    if (rows[0].n >= arquivos.length) break;
    await p.waitForTimeout(1000);
  }

  /* A capa ESCOLHIDA, com o foco da home. A capa jornal só mostra a foto
     grande quando o fotógrafo escolheu uma (ver `galeria-capa.tsx`): sem isto,
     o print "Entregue" saía só com o título, diferente do celular da home. A
     primeira que subiu é a capa da identidade (ver `ORDEM`). */
  const capaDaHome = FOTOS_PADRAO[classicaDaHome.capa];
  await db.query(
    `update galerias set
       capa_media_id = (select id from medias where galeria_id = $1 order by ordem, criado_em limit 1),
       capa_foco_x = $2, capa_foco_y = $3
     where id = $1`,
    [g.id, capaDaHome.focoX, capaDaHome.focoY],
  );

  // ── 02 · PERSONALIZE: o editor de design com a prévia ─────────────────
  /* No grupo "Cor", que é curto: assim o ajuste e a prévia cabem na mesma
     tela — é a prévia que mostra que "personalizar" é ver o resultado. */
  await p.setViewportSize({ width: 1280, height: 1000 });
  await p.goto(`${BASE}/painel/galerias/${g.id}/design`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Cor", exact: true }).click();
  await p.frameLocator('iframe[title="Prévia da galeria"]').locator("img").first().waitFor();
  await p.getByText("Aparência da galeria").scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, -24));
  await p.waitForTimeout(2500);
  await semIndicador(p);
  await salvar(await p.screenshot(), "design", 1200);
  await p.setViewportSize({ width: 1280, height: 820 });

  // ── seleção: favoritas marcadas pelo caminho do cliente ───────────────
  const { rows: fotos } = await db.query(
    "select id from medias where galeria_id = $1 order by ordem, criado_em",
    [g.id],
  );
  const ana = await pessoaPorEmail(g.id, "ana@exemplo.com", "Ana");
  for (const f of fotos.slice(0, 6)) await alternarDaPessoa(g.id, f.id, ana.id);
  const pedro = await pessoaPorEmail(g.id, "pedro@exemplo.com", "Pedro");
  for (const f of fotos.slice(2, 5)) await alternarDaPessoa(g.id, f.id, pedro.id);

  await p.goto(`${BASE}/painel/galerias/${g.id}/atividade`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  const bloco = p
    .locator("section")
    .filter({ has: p.getByRole("heading", { name: "Favoritas do cliente" }) })
    .first();
  await salvar(await bloco.screenshot(), "selecao", 1000);

  // ── 03 · ENTREGUE: a galeria no celular do cliente ────────────────────
  const cliente = await navegador.newContext({
    viewport: { width: 390, height: 700 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const c = await cliente.newPage();
  await c.goto(`${BASE}/g/${g.tslug}/${g.gslug}`, { waitUntil: "networkidle" });
  await c.waitForTimeout(2000);
  await semIndicador(c);
  await salvar(await c.screenshot(), "entrega", 780);

  await navegador.close();
} finally {
  await limparRodada(db);
  await db.end();
}
