#!/usr/bin/env node
/**
 * O ZIP da galeria, pela rota, com fotos de verdade no balde. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-zip-da-galeria.mjs
 *
 * O escritor de ZIP tem suíte própria (`testar-zip-em-fluxo.mjs`). Aqui a
 * pergunta é o caminho inteiro: a rota busca cada ORIGINAL no balde, monta o
 * zip em fluxo, anuncia o tamanho exato e respeita as mesmas travas de qualquer
 * download da galeria — senha, cofre, download desligado.
 *
 * As fotos sobem de verdade para o balde (e saem no fim): uma chave falsa faria
 * a rota falhar na busca, e o teste não diria nada sobre o zip.
 */
import pg from "pg";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let falhou = false;
const ok = (m, extra) => console.log(`  ✓ ${m}${extra ? ` — ${extra}` : ""}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const { urlDeUpload, apagarObjeto } = await import("../src/lib/r2.ts");

const g = await galeriaDaRodada(db, { nome: "zip", medias: 3, publicada: true });
const url = `${BASE}/api/g/${g.id}/zip`;

/* O conteúdo de cada foto, para comparar byte a byte depois de extrair. */
const conteudos = new Map();
const chaves = [];

function extrair(zip) {
  const dir = mkdtempSync(path.join(tmpdir(), "zip-rota-"));
  const arquivo = path.join(dir, "g.zip");
  writeFileSync(arquivo, zip);
  const destino = path.join(dir, "saida");
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command",
      `Expand-Archive -LiteralPath '${arquivo}' -DestinationPath '${destino}' -Force`],
    { encoding: "utf8" },
  );
  return { dir, destino, codigo: r.status, msg: (r.stderr || "").trim() };
}

try {
  /* Cada mídia da bancada ganha um original de verdade no balde, com o tamanho
     real gravado no banco — a rota confere um contra o outro. */
  await db.query("update galerias set permite_download = true, senha_hash = null where id = $1", [g.id]);
  for (const [i, m] of g.midias.entries()) {
    const bytes = randomBytes(20_000 + i * 7_001);
    const r = await fetch(await urlDeUpload(m.chave, "image/jpeg", 300), {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: bytes,
    });
    if (!r.ok) throw new Error(`não subi ${m.chave}: HTTP ${r.status}`);
    chaves.push(m.chave);
    conteudos.set(m.nome_original, bytes);
    await db.query("update medias set bytes = $1, armazem = 'r2' where id = $2", [bytes.length, m.id]);
  }

  console.log("A galeria inteira num zip\n");

  const r = await fetch(url, { cache: "no-store" });
  if (r.status !== 200) {
    erro(`a rota respondeu HTTP ${r.status}`);
  } else {
    const tipo = r.headers.get("content-type") ?? "";
    if (tipo.includes("application/zip")) ok("responde como zip", tipo);
    else erro(`veio como ${tipo}`);

    if (/attachment/.test(r.headers.get("content-disposition") ?? "")) ok("e como download, não como página");
    else erro("sem Content-Disposition de anexo — o navegador tentaria abrir o zip");

    const zip = Buffer.from(await r.arrayBuffer());
    const anunciado = Number(r.headers.get("content-length"));
    if (anunciado === zip.length) ok("o tamanho anunciado é o entregue", `${zip.length} bytes`);
    else erro(`anunciou ${anunciado} e entregou ${zip.length} — a barra de progresso mentiria`);

    const { dir, destino, codigo, msg } = extrair(zip);
    try {
      if (codigo !== 0) {
        erro(`o Windows não abriu o zip: ${msg.split("\n")[0]}`);
      } else {
        ok("o Windows descompacta");
        let iguais = 0;
        for (const [nome, bytes] of conteudos) {
          const extraido = path.join(destino, nome);
          if (existsSync(extraido) && readFileSync(extraido).equals(bytes)) iguais++;
          else erro(`"${nome}" não saiu idêntico do zip`);
        }
        if (iguais === conteudos.size) ok(`as ${iguais} fotos saem idênticas aos originais do balde`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log("\nAs travas de qualquer download\n");

  /* Download desligado pelo fotógrafo: o zip é download, e a regra é a mesma. */
  await db.query("update galerias set permite_download = false where id = $1", [g.id]);
  const semDownload = await fetch(url, { cache: "no-store" });
  if (semDownload.status === 403) ok("com download desligado, o zip é recusado (403)");
  else erro(`com download desligado a rota respondeu ${semDownload.status}`);
  await db.query("update galerias set permite_download = true where id = $1", [g.id]);

  /* Galeria com senha e visitante que não passou por ela. */
  await db.query("update galerias set senha_hash = $1 where id = $2", ["$2b$10$naoimporta", g.id]);
  const semSenha = await fetch(url, { cache: "no-store" });
  if (semSenha.status === 401) ok("galeria com senha recusa quem não passou pela senha (401)");
  else erro(`sem a senha a rota respondeu ${semSenha.status}`);
  await db.query("update galerias set senha_hash = null where id = $1", [g.id]);

  /* No cofre a galeria não abre para ninguém. */
  await db.query("update galerias set estado = 'arquivada' where id = $1", [g.id]);
  const noCofre = await fetch(url, { cache: "no-store" });
  if (noCofre.status !== 200) ok("galeria no cofre não entrega zip", `HTTP ${noCofre.status}`);
  else erro("a galeria arquivada entregou o zip");
  await db.query("update galerias set estado = 'online' where id = $1", [g.id]);

  /* "Minhas favoritas" sem dizer quem é: não há lista para empacotar. */
  const favSemPessoa = await fetch(`${url}?favoritas=1`, { cache: "no-store" });
  if (favSemPessoa.status === 428) ok("favoritas sem identificação pedem o e-mail (428)");
  else erro(`favoritas sem identificação responderam ${favSemPessoa.status}`);
} finally {
  for (const c of chaves) await apagarObjeto(c).catch(() => {});
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ o zip da galeria tem problema");
  process.exit(1);
}
console.log("\n✓ o zip da galeria sai inteiro, com o tamanho certo, e respeita as travas");
