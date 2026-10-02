#!/usr/bin/env node
/**
 * Testa as MINIATURAS DA ABA FOTOS pedidas aos poucos e guardadas. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-miniaturas-do-painel.mjs
 *
 * Juan, 01/10/2026, numa galeria grande: "tá tudo bem lagado… cada exclusão /
 * criação de um capítulo novo tá…". Medido em 3.000 fotos: cada clique na aba
 * trazia 2 MB de página (1,4 MB eram endereços assinados), pedia a página DUAS
 * vezes, e rebaixava as miniaturas da tela. O que esta suíte prende:
 *
 *   - a página assina só a primeira tela, e não a galeria inteira;
 *   - a rota de lote devolve só o que é desta galeria e deste estúdio;
 *   - o guardado vale até vencer, e muda quando a foto é republicada;
 *   - a aba não pede a página de novo depois de uma ação que já revalida;
 *   - o ladrilho é memorizado — marcar uma foto não redesenha as outras.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const RAIZ = path.resolve(import.meta.dirname, "..");
const fonte = (arq) => readFileSync(path.join(RAIZ, arq), "utf8");

const {
  chaveDaMiniatura,
  guardarMiniatura,
  lerMiniatura,
  ouvirMiniatura,
  esquecerMiniaturasDe,
  VALE_MS,
  LOTE_DE_MINIATURAS,
} = await import("../src/lib/miniaturas-do-painel.ts");

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

console.log("As miniaturas da aba Fotos\n");

await etapa("a chave muda com a versão e com a capa do vídeo", () => {
  const a = chaveDaMiniatura({ id: "m1", versao: 1, temCapa: false });
  const b = chaveDaMiniatura({ id: "m1", versao: 2, temCapa: false });
  const c = chaveDaMiniatura({ id: "m1", versao: 1, temCapa: true });
  if (new Set([a, b, c]).size !== 3) throw new Error(`${a} ${b} ${c}`);
  return `${a} · ${b} · ${c}`;
});

await etapa("o guardado fica enquanto vale, e é trocado depois", () => {
  const chave = chaveDaMiniatura({ id: "m2", versao: 1 });
  let avisos = 0;
  const parar = ouvirMiniatura(chave, () => avisos++);
  guardarMiniatura(chave, { url: "https://x/primeira" }, 0);
  guardarMiniatura(chave, { url: "https://x/segunda" }, VALE_MS - 1);
  if (lerMiniatura(chave)?.url !== "https://x/primeira") {
    throw new Error("uma assinatura nova trocou a guardada — a imagem baixaria de novo");
  }
  guardarMiniatura(chave, { url: "https://x/terceira" }, VALE_MS + 1);
  if (lerMiniatura(chave)?.url !== "https://x/terceira") throw new Error("a vencida não foi trocada");
  parar();
  if (avisos !== 2) throw new Error(`${avisos} avisos, esperava 2 (guardar e trocar)`);
  return "a recém-assinada não substitui a guardada";
});

await etapa("esquecer apaga só as chaves daquela mídia", () => {
  const um = chaveDaMiniatura({ id: "m3", versao: 1, temCapa: true });
  const outro = chaveDaMiniatura({ id: "m33", versao: 1, temCapa: true });
  guardarMiniatura(um, { url: "https://x/um" });
  guardarMiniatura(outro, { url: "https://x/outro" });
  esquecerMiniaturasDe("m3");
  if (lerMiniatura(um)) throw new Error("a capa trocada continuou guardada");
  if (!lerMiniatura(outro)) throw new Error("esqueceu a mídia vizinha (m33 começa com m3)");
});

await etapa("a aba não pede a página de novo depois de ação que revalida", () => {
  /* A resposta de uma Server Action que chama `revalidatePath` JÁ traz a
     página nova; `router.refresh()` logo depois é a mesma página outra vez. */
  const editor = fonte("src/components/editor-secoes.tsx");
  if (/router\.refresh\(\)/.test(editor.replace(/\/\*[^]*?\*\//g, ""))) {
    throw new Error("editor de capítulos voltou a chamar router.refresh()");
  }
  const grade = fonte("src/components/grade-medias.tsx");
  const depoisDeAcao = grade.match(/await \w+Action\(f\);\s*(?:\n\s*[^\n]*){0,2}router\.refresh\(\)/g) ?? [];
  if (depoisDeAcao.length > 0) throw new Error(`grade: ${depoisDeAcao.length} refresh depois de ação`);
  return "capítulos e grade";
});

await etapa("o ladrilho é memorizado, e a grade não monta <li> dentro do map", () => {
  const grade = fonte("src/components/grade-medias.tsx");
  if (!/const Ladrilho = memo\(/.test(grade)) throw new Error("o ladrilho não é memorizado");
  if (/\.map\(\(m\) => \{\s*const selecionada/.test(grade)) throw new Error("o ladrilho voltou a ser desenhado no map");
});

/* ── Com o servidor ─────────────────────────────────────────────────────── */
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { estudioDaRodada, segundoEstudioDaRodada, galeriaDaRodada, limparRodada } = await import(
  "./fixture-de-teste.mjs"
);

try {
  const dono = await estudioDaRodada(db);
  const vizinho = await segundoEstudioDaRodada(db);
  const grande = await galeriaDaRodada(db, { nome: "miniaturas", medias: 130 });
  const alheia = await galeriaDaRodada(db, { nome: "miniaturas-alheia", medias: 2, dono: vizinho });
  const cookie = cookieDeSessao(dono.id);
  const assinaturas = (texto) => new Set(texto.match(/X-Amz-Signature=[0-9a-f]{64}/g) ?? []).size;

  await etapa("a página assina só a primeira tela", async () => {
    const r = await fetch(`${BASE}/painel/galerias/${grande.id}/fotos`, { headers: { cookie } });
    const html = await r.text();
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const n = assinaturas(html);
    if (n === 0) throw new Error("nenhuma miniatura assinada — a primeira tela nasceria vazia");
    if (n > 80) throw new Error(`${n} endereços assinados para 130 fotos`);
    const rsc = await (await fetch(`${BASE}/painel/galerias/${grande.id}/fotos`, { headers: { cookie, RSC: "1" } })).text();
    if (assinaturas(rsc) > 80) throw new Error(`a volta do servidor trouxe ${assinaturas(rsc)} endereços`);
    return `${n} de 130 no HTML, ${assinaturas(rsc)} na volta do servidor`;
  });

  const pedir = (galeriaId, corpo, comSessao = true) =>
    fetch(`${BASE}/api/galerias/${galeriaId}/miniaturas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(comSessao ? { cookie } : {}) },
      body: JSON.stringify(corpo),
    });

  await etapa("o lote devolve só as fotos desta galeria", async () => {
    const minhas = grande.midias.slice(100, 103).map((m) => m.id);
    const r = await pedir(grande.id, { ids: [...minhas, alheia.midias[0].id] });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    if (!/no-store/.test(r.headers.get("cache-control") ?? "")) throw new Error("resposta pode ir para cache");
    const { enderecos } = await r.json();
    const ids = Object.keys(enderecos).sort();
    if (ids.join() !== [...minhas].sort().join()) throw new Error(`voltou ${ids.length}: ${ids.join()}`);
    for (const m of grande.midias.slice(100, 103)) {
      const chaveThumb = m.chave.replace(/\.jpg$/, "_thumb.webp").split("/").pop();
      if (!enderecos[m.id].url.includes(chaveThumb)) throw new Error(`${m.id} sem a miniatura`);
    }
    return "3 de 3, e a do vizinho não";
  });

  await etapa("galeria de outro estúdio não devolve nada", async () => {
    const r = await pedir(alheia.id, { ids: alheia.midias.map((m) => m.id) });
    const { enderecos } = await r.json();
    if (Object.keys(enderecos).length !== 0) throw new Error("assinou foto de outro estúdio");
  });

  await etapa("sem sessão, lista grande ou id torto: recusa", async () => {
    const ids = grande.midias.slice(0, 2).map((m) => m.id);
    const semSessao = await pedir(grande.id, { ids }, false);
    if (semSessao.status !== 401) throw new Error(`sem sessão deu ${semSessao.status}`);
    const muitos = Array.from({ length: LOTE_DE_MINIATURAS + 1 }, () => ids[0]);
    if ((await pedir(grande.id, { ids: muitos })).status !== 400) throw new Error("aceitou lote grande demais");
    if ((await pedir(grande.id, { ids: ["1; drop table medias"] })).status !== 400) throw new Error("aceitou id torto");
    if ((await pedir(grande.id, {})).status !== 400) throw new Error("aceitou corpo sem ids");
    return "401, 400, 400, 400";
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ miniaturas da aba Fotos têm problema" : "\n✓ miniaturas da aba Fotos ok");
process.exit(falhou ? 1 : 0);
