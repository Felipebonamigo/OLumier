#!/usr/bin/env node
/**
 * Testa o TAMANHO DA LOGO na capa. Uso (servidor de pé em :3040):
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-tamanho-da-logo.mjs
 *
 * ── O PROBLEMA (30/09/2026) ───────────────────────────────────────────────
 *
 * Um fotógrafo, pelo Felipe: "ou achava muito grande ou muito pequena. Aí
 * tinha que diminuir a própria imagem da logo antes de subir pra plataforma".
 * Três defeitos, três consertos, e esta suíte prende os três:
 *
 *   1. a altura era o único controle → a capa desenha pela ÁREA, com a
 *      proporção do arquivo (logo comprida e quadrada com o mesmo peso);
 *   2. quatro degraus e teto sem ampliar → barrinha (`tamanhoLogo`), com
 *      altura exata; e quem nunca mexeu fica EXATAMENTE como estava;
 *   3. a margem vazia do arquivo contava como logo → sai no envio
 *      (`caixaDoDesenho`, pura, coberta aqui sem navegador).
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

exigirBancoDeTeste();
const {
  TAMANHO_LOGO,
  lerAparencia,
  medidaDaLogo,
  proporcaoDaLogo,
  tamanhoLogoEquivalente,
  alturaLogoPx,
  presetEquivalente,
  PRESETS,
} = await import("../src/config/aparencia.ts");
const { caixaDoDesenho } = await import("../src/lib/logo-client.ts");
const { lerMedidaDaLogo } = await import("../src/lib/marca-estudio.ts");

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

console.log("\nA regra do tamanho\n");

await etapa("quem nunca mexeu na barrinha continua na regra antiga (altura do eixo, sem ampliar)", () => {
  for (const logo of ["discreta", "media", "grande", "enorme"]) {
    const m = medidaDaLogo({ logo, tamanhoLogo: null }, 4);
    if (!m || !("tetoAltura" in m) || m.tetoAltura !== alturaLogoPx(logo)) {
      throw new Error(`${logo}: ${JSON.stringify(m)}`);
    }
  }
  if (medidaDaLogo({ logo: "nenhuma", tamanhoLogo: 150 }, 1) !== null) throw new Error("'nenhuma' desenhou logo");
  return "discreta 56 · média 88 · grande 136 · enorme 200 — e 'nenhuma' não desenha";
});

await etapa("com a barrinha, comprida e quadrada ficam com a MESMA área", () => {
  const quadrada = medidaDaLogo({ logo: "media", tamanhoLogo: 100 }, 1);
  const comprida = medidaDaLogo({ logo: "media", tamanhoLogo: 100 }, 4);
  const alta = medidaDaLogo({ logo: "media", tamanhoLogo: 100 }, 0.5);
  if (quadrada.altura !== 88) throw new Error(`quadrada ${quadrada.altura}`);
  if (comprida.altura !== 44) throw new Error(`4:1 ${comprida.altura}`);
  const area = (h, r) => h * h * r;
  for (const [h, r] of [[comprida.altura, 4], [alta.altura, 0.5]]) {
    const erro = Math.abs(area(h, r) - area(88, 1)) / area(88, 1);
    if (erro > 0.02) throw new Error(`área ${r}:1 difere ${Math.round(erro * 100)}%`);
  }
  return `88×88 · 176×44 · ${Math.round(alta.altura * 0.5)}×${alta.altura}`;
});

await etapa("a barrinha começa onde a logo já está (o primeiro arrasto não dá pulo)", () => {
  const casos = [];
  for (const logo of ["discreta", "media", "grande"]) {
    for (const r of [1, 2.5, 4, 0.6]) {
      const pct = tamanhoLogoEquivalente(logo, r);
      if (pct <= TAMANHO_LOGO.min || pct >= TAMANHO_LOGO.max) continue;
      const nova = medidaDaLogo({ logo, tamanhoLogo: pct }, r).altura;
      const antiga = alturaLogoPx(logo);
      if (Math.abs(nova - antiga) / antiga > 0.04) throw new Error(`${logo} ${r}:1 — ${antiga}px virou ${nova}px`);
      casos.push(`${logo} ${r}:1 → ${pct}%`);
    }
  }
  return `${casos.length} combinações, nenhuma muda mais de 4%`;
});

await etapa("proporção sem medida é quadrada; proporção absurda é aparada", () => {
  if (proporcaoDaLogo(null, null) !== 1) throw new Error("sem medida não virou 1");
  if (proporcaoDaLogo(2000, 100) !== 8) throw new Error("20:1 não foi aparada em 8");
  if (proporcaoDaLogo(100, 2000) !== 0.25) throw new Error("1:20 não foi aparada em 0,25");
  return "1 · 8 · 0,25";
});

await etapa("o valor gravado é lido com cuidado", () => {
  const ler = (v) => lerAparencia({ tamanhoLogo: v }).tamanhoLogo;
  if (lerAparencia({}).tamanhoLogo !== null) throw new Error("galeria antiga não ficou na regra antiga");
  if (ler("150") !== null) throw new Error("texto virou número");
  if (ler(1000) !== TAMANHO_LOGO.max) throw new Error("acima do teto não foi aparado");
  if (ler(3) !== TAMANHO_LOGO.min) throw new Error("abaixo do piso não foi aparado");
  if (ler(103) !== 105) throw new Error("não assentou no passo");
  return "ausente → regra antiga · 1000 → 300 · 103 → 105";
});

await etapa("mexer na barrinha tira a galeria do preset (a marcação não mente)", () => {
  const p = PRESETS[0];
  if (presetEquivalente(lerAparencia(p.aparencia)) !== p.id) throw new Error("o preset puro não foi reconhecido");
  if (presetEquivalente(lerAparencia({ ...p.aparencia, tamanhoLogo: 150 })) !== null) {
    throw new Error("com a logo em 150% ainda diz que está no preset");
  }
  return `${p.id} → personalizado`;
});

await etapa("a medida vinda do navegador é peneirada", () => {
  if (!lerMedidaDaLogo(400, 100)) throw new Error("medida boa recusada");
  for (const [l, a] of [[0, 100], [100, -1], ["x", 10], [30000, 10], [null, null]]) {
    if (lerMedidaDaLogo(l, a) !== null) throw new Error(`${l}×${a} passou`);
  }
  return "5 medidas tortas recusadas";
});

console.log("\nA margem vazia\n");

/* Uma imagem RGBA de mentira: fundo de uma cor, um retângulo de "desenho". */
function imagem(largura, altura, fundo, desenho, caixa) {
  const px = new Uint8ClampedArray(largura * altura * 4);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const dentro = x >= caixa.x && x < caixa.x + caixa.w && y >= caixa.y && y < caixa.y + caixa.h;
      px.set(dentro ? desenho : fundo, (y * largura + x) * 4);
    }
  }
  return px;
}
const TRANSPARENTE = [0, 0, 0, 0];
const BRANCO = [255, 255, 255, 255];
const PRETO = [20, 20, 20, 255];

await etapa("PNG com prancheta transparente: sai só o desenho", () => {
  const c = caixaDoDesenho(imagem(100, 60, TRANSPARENTE, PRETO, { x: 30, y: 20, w: 40, h: 10 }), 100, 60);
  if (!c || c.x !== 30 || c.y !== 20 || c.largura !== 40 || c.altura !== 10) throw new Error(JSON.stringify(c));
  return "100×60 → 40×10";
});

await etapa("JPG com fundo branco: o branco em volta sai", () => {
  const px = imagem(80, 80, BRANCO, PRETO, { x: 10, y: 25, w: 60, h: 30 });
  /* Ruído de compressão no fundo não segura a caixa aberta. */
  px.set([250, 247, 252, 255], (2 * 80 + 2) * 4);
  const c = caixaDoDesenho(px, 80, 80);
  if (!c || c.x !== 10 || c.y !== 25 || c.largura !== 60 || c.altura !== 30) throw new Error(JSON.stringify(c));
  return "80×80 → 60×30";
});

await etapa("desenho que encosta num canto: nada é comido pela cor de um canto só", () => {
  const px = imagem(50, 50, BRANCO, PRETO, { x: 0, y: 0, w: 20, h: 20 });
  const c = caixaDoDesenho(px, 50, 50);
  if (!c || c.x !== 0 || c.y !== 0 || c.largura !== 50 || c.altura !== 50) throw new Error(JSON.stringify(c));
  return "cantos discordam → caixa inteira";
});

await etapa("borda quase transparente (anti-serrilhado) não conta como desenho", () => {
  const px = imagem(40, 40, TRANSPARENTE, PRETO, { x: 10, y: 10, w: 20, h: 20 });
  px.set([0, 0, 0, 8], (0 * 40 + 0) * 4);
  const c = caixaDoDesenho(px, 40, 40);
  if (!c || c.x !== 10 || c.largura !== 20) throw new Error(JSON.stringify(c));
  return "alfa 8 ignorado";
});

await etapa("imagem toda de uma cor não vira logo de zero pixels", () => {
  if (caixaDoDesenho(imagem(10, 10, TRANSPARENTE, TRANSPARENTE, { x: 0, y: 0, w: 0, h: 0 }), 10, 10) !== null) {
    throw new Error("transparente inteira devolveu caixa");
  }
  if (caixaDoDesenho(imagem(10, 10, BRANCO, BRANCO, { x: 0, y: 0, w: 0, h: 0 }), 10, 10) !== null) {
    throw new Error("branca inteira devolveu caixa");
  }
  return "null — quem chama guarda o arquivo como veio";
});

console.log("\nDo envio à capa\n");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const g = await galeriaDaRodada(db, { nome: "tamanho-logo", medias: 2, publicada: true });
await db.query("update galerias set senha_hash = null where id = $1", [g.id]);
const cookie = cookieDeSessao(g.tenant_id);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const medida = async () =>
  (await db.query("select logo_largura, logo_altura from tenants where id = $1", [g.tenant_id])).rows[0];

try {
  await etapa("o envio grava a medida do arquivo cortado", async () => {
    const pedido = await fetch(`${BASE}/api/marca/logo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ mime: "image/png", bytes: PNG.length }),
    });
    const d = await pedido.json();
    if (!pedido.ok) throw new Error(d.erro ?? `HTTP ${pedido.status}`);
    const put = await fetch(d.url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: PNG });
    if (!put.ok) throw new Error(`bucket ${put.status}`);
    const conf = await fetch(`${BASE}/api/marca/logo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ chave: d.chave, largura: 400, altura: 100 }),
    });
    if (!conf.ok) throw new Error(`confirmação ${conf.status}`);
    const m = await medida();
    if (m.logo_largura !== 400 || m.logo_altura !== 100) throw new Error(JSON.stringify(m));
    return "400×100";
  });

  await etapa("a medição do editor não sobrescreve a do envio", async () => {
    const r = await fetch(`${BASE}/api/marca/logo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ largura: 999, altura: 999 }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const m = await medida();
    if (m.logo_largura !== 400) throw new Error(`virou ${m.logo_largura}`);
    return "continua 400×100";
  });

  await etapa("logo antiga sem medida: o editor mede e grava uma vez", async () => {
    await db.query("update tenants set logo_largura = null, logo_altura = null where id = $1", [g.tenant_id]);
    const r = await fetch(`${BASE}/api/marca/logo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ largura: 400, altura: 100 }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const m = await medida();
    if (m.logo_largura !== 400 || m.logo_altura !== 100) throw new Error(JSON.stringify(m));
    const sem = await fetch(`${BASE}/api/marca/logo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ largura: 1, altura: 1 }),
    });
    if (sem.status !== 401) throw new Error(`sem sessão respondeu ${sem.status}`);
    return "gravada; sem sessão, 401";
  });

  /** O `style` da logo na capa servida. */
  const estiloDaLogo = async (aparencia) => {
    await db.query("update galerias set aparencia = $2 where id = $1", [g.id, JSON.stringify(aparencia)]);
    const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
    const img = html.match(/<img[^>]*\/marca\/[^>]*>/)?.[0] ?? "";
    return img.match(/style="([^"]*)"/)?.[1] ?? "";
  };

  await etapa("galeria que nunca mexeu: a capa desenha como sempre", async () => {
    const s = await estiloDaLogo({ capa: "imersa", logo: "media" });
    if (!/max-height:\s*88px/.test(s)) throw new Error(`style="${s}"`);
    return s;
  });

  await etapa("com a barrinha em 100%, a logo 4:1 sai com 44 px de altura", async () => {
    const s = await estiloDaLogo({ capa: "imersa", logo: "media", tamanhoLogo: 100 });
    if (!/(^|;)\s*height:\s*44px/.test(s)) throw new Error(`style="${s}"`);
    return s;
  });

  await etapa("tirar a logo apaga a medida junto", async () => {
    const r = await fetch(`${BASE}/api/marca/logo`, { method: "DELETE", headers: { cookie } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const m = await medida();
    if (m.logo_largura !== null || m.logo_altura !== null) throw new Error(JSON.stringify(m));
    return "nula";
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ o tamanho da logo tem problema" : "\n✓ a logo cabe do jeito que o fotógrafo quer");
process.exitCode = falhou ? 1 : 0;
