#!/usr/bin/env node
/**
 * O SITE COMO APP NO CELULAR — ícone da tela de início e manifesto. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-app-instalado.mjs
 *
 * Precisa do servidor de desenvolvimento.
 *
 * Felipe, 01/10/2026, com a foto da tela de início do iPhone: "o atalho não está
 * igual o logo" — um "G" que o iPhone inventa quando não há `apple-touch-icon`
 * em PNG. O que esta suíte prende (ver `config/app-instalado.ts`):
 *
 *   - os PNGs existem no tamanho que o iPhone e o Android pedem;
 *   - o manifesto abre no painel, sem a barra do navegador, com os três ícones;
 *   - home, entrar, cadastrar e painel ligam o ícone, o manifesto e o modo app,
 *     SEM perder o favicon da aba;
 *   - a galeria do cliente e o site do estúdio NÃO ligam: lá, quem salva o
 *     atalho é o casal, e a marca na frente é a do fotógrafo.
 */
import pg from "pg";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

exigirBancoDeTeste();

const RAIZ = path.resolve(import.meta.dirname, "..");
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

console.log("O app na tela de início\n");

await etapa("os ícones existem no tamanho certo, sem transparência", async () => {
  const esperados = [
    ["public/icones/apple-touch-icon.png", 180],
    ["public/icones/icone-192.png", 192],
    ["public/icones/icone-512.png", 512],
    ["public/icones/icone-maskable-512.png", 512],
  ];
  for (const [arq, lado] of esperados) {
    const m = await sharp(path.join(RAIZ, arq)).metadata();
    if (m.width !== lado || m.height !== lado) throw new Error(`${arq}: ${m.width}×${m.height}`);
    /* Canto transparente vira preto ou branco conforme o aparelho: o iPhone
       recorta sozinho, então o quadrado tem de ser cheio. */
    const { data } = await sharp(path.join(RAIZ, arq)).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    if (data[3] !== 255) throw new Error(`${arq}: canto transparente`);
  }
  return `${esperados.length} ícones`;
});

await etapa("o manifesto abre no painel, como app, com os três ícones", () => {
  const m = JSON.parse(readFileSync(path.join(RAIZ, "public/app.webmanifest"), "utf8"));
  if (m.start_url !== "/painel") throw new Error(`start_url ${m.start_url}`);
  if (m.display !== "standalone") throw new Error(`display ${m.display}`);
  if (!m.icons?.some((i) => i.purpose === "maskable")) throw new Error("sem ícone maskable");
  if (m.icons.length !== 3) throw new Error(`${m.icons.length} ícones`);
  return `${m.name} · ${m.start_url} · ${m.display}`;
});

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { estudioDaRodada, galeriaDaRodada, limparRodada } = await import("./fixture-de-teste.mjs");
try {
  const est = await estudioDaRodada(db);
  const g = await galeriaDaRodada(db, { nome: "app-instalado", medias: 1 });
  const cookie = cookieDeSessao(est.id);
  const cabeca = async (url, comSessao = false) => {
    const r = await fetch(BASE + url, { headers: comSessao ? { cookie } : {}, redirect: "manual" });
    if (r.status !== 200) throw new Error(`${url}: HTTP ${r.status}`);
    const h = await r.text();
    return {
      icone: /rel="apple-touch-icon"[^>]*href="\/icones\/apple-touch-icon\.png"|href="\/icones\/apple-touch-icon\.png"[^>]*rel="apple-touch-icon"/.test(h),
      manifesto: /rel="manifest"/.test(h),
      app: /mobile-web-app-capable/.test(h),
      favicon: /rel="icon"/.test(h),
    };
  };

  await etapa("a plataforma liga ícone, manifesto e modo app, e mantém o favicon", async () => {
    for (const [url, sessao] of [["/", false], ["/entrar", false], ["/cadastrar", false], ["/painel", true]]) {
      const c = await cabeca(url, sessao);
      const falta = Object.entries(c).filter(([, v]) => !v).map(([k]) => k);
      if (falta.length) throw new Error(`${url} sem ${falta.join(", ")}`);
    }
    return "/, /entrar, /cadastrar, /painel";
  });

  await etapa("a galeria do cliente e o site do estúdio NÃO levam o ícone da plataforma", async () => {
    for (const url of [`/g/${g.tslug}/${g.gslug}`, `/e/${g.tslug}`]) {
      const c = await cabeca(url);
      if (c.icone || c.manifesto || c.app) throw new Error(`${url} ligou o app da plataforma`);
      if (!c.favicon) throw new Error(`${url} perdeu o favicon`);
    }
    return "a marca na frente é a do fotógrafo";
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ o app na tela de início tem problema" : "\n✓ o atalho do celular é o logo, e só na plataforma");
process.exitCode = falhou ? 1 : 0;
