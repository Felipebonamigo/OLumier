#!/usr/bin/env node
/**
 * Testa as FORMAS DE VER AS GALERIAS no painel. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-visao-galerias.mjs
 *
 * Felipe, 30/09/2026: "usuário reclamou que está se confundindo para
 * visualizar as galerias" — cartões, lista, capas e por mês, escolhidas no
 * topo, e um botão de buscar. O que esta suíte prende:
 *
 *   - o cookie torto cai na forma de sempre, e as quatro existem;
 *   - "por mês" agrupa na ordem que chegou, sem reordenar;
 *   - a capa segue a ordem da galeria do cliente: arquivo de capa, foto
 *     marcada, primeira foto — e nunca a galeria de outro estúdio;
 *   - as quatro formas usam o MESMO menu e a MESMA confirmação de apagar.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

exigirBancoDeTeste();

const { VISOES, VISAO_PADRAO, lerVisao, agruparPorMes } = await import("../src/config/visao-galerias.ts");
const { capasDoPainel } = await import("../src/lib/capas-do-painel.ts");

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

console.log("As formas de ver as galerias\n");

await etapa("as quatro formas, e o cookie torto cai na de sempre", () => {
  const ids = VISOES.map((v) => v.id).join(",");
  if (ids !== "cartoes,lista,capas,mes") throw new Error(ids);
  for (const lixo of [undefined, null, "", "grade", "<script>", "LISTA"]) {
    if (lerVisao(lixo) !== VISAO_PADRAO) throw new Error(`${JSON.stringify(lixo)} virou ${lerVisao(lixo)}`);
  }
  if (lerVisao("capas") !== "capas") throw new Error("capas não foi lida");
  return ids;
});

await etapa("por mês agrupa na ordem que chegou, sem reordenar", () => {
  const g = agruparPorMes([
    { id: 1, mes: "Setembro de 2026" },
    { id: 2, mes: "Setembro de 2026" },
    { id: 3, mes: "Agosto de 2026" },
    { id: 4, mes: "Setembro de 2026" },
  ]);
  const forma = g.map((x) => `${x.mes}:${x.itens.map((i) => i.id).join("")}`).join(" | ");
  if (forma !== "Setembro de 2026:12 | Agosto de 2026:3 | Setembro de 2026:4") throw new Error(forma);
  if (agruparPorMes([]).length !== 0) throw new Error("lista vazia fez grupo");
  return forma;
});

await etapa("as quatro formas usam o mesmo menu e a mesma confirmação", () => {
  const fonte = readFileSync(path.resolve(import.meta.dirname, "../src/components/lista-galerias.tsx"), "utf8");
  const menus = (fonte.match(/<details className/g) ?? []).length;
  if (menus !== 1) throw new Error(`${menus} menus escritos, esperava 1 (o compartilhado)`);
  const usos = (fonte.match(/confirmacaoDe\(g\) &&/g) ?? []).length;
  if (usos < 4) throw new Error(`a confirmação de apagar aparece em ${usos} formas`);
  for (const v of ["cartoes", "lista", "capas", "mes"]) {
    if (!fonte.includes(`visao === "${v}"`)) throw new Error(`a forma "${v}" não é desenhada`);
  }
  return "1 menu, confirmação nas 4";
});

/* ── A capa de cada galeria ─────────────────────────────────────────────── */
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { estudioDaRodada, segundoEstudioDaRodada, galeriaDaRodada, limparRodada } = await import(
  "./fixture-de-teste.mjs"
);
try {
  const estudio = await estudioDaRodada(db);
  const vizinho = await segundoEstudioDaRodada(db);
  const primeira = await galeriaDaRodada(db, { nome: "capa-primeira", medias: 3 });
  const marcada = await galeriaDaRodada(db, { nome: "capa-marcada", medias: 3 });
  const arquivo = await galeriaDaRodada(db, { nome: "capa-arquivo", medias: 3 });
  const vazia = await galeriaDaRodada(db, { nome: "capa-vazia", medias: 0 });
  const dele = await galeriaDaRodada(db, { nome: "capa-vizinho", medias: 1, dono: vizinho });
  await db.query("update galerias set capa_media_id = $1 where id = $2", [marcada.midias[2].id, marcada.id]);
  await db.query("update galerias set capa_chave = $1, capa_foco_x = 30, capa_foco_y = 70 where id = $2", [
    `${estudio.id}/capa-enviada.jpg`,
    arquivo.id,
  ]);

  await etapa("a capa segue a galeria do cliente: arquivo, foto marcada, primeira foto", async () => {
    const capas = await capasDoPainel(estudio.id, [primeira.id, marcada.id, arquivo.id, vazia.id]);
    const caminho = (id) => decodeURIComponent(new URL(capas.get(id).url).pathname);
    if (!caminho(primeira.id).includes(primeira.midias[0].chave.replace(/\.jpg$/, "_thumb.webp"))) {
      throw new Error(`primeira: ${caminho(primeira.id)}`);
    }
    if (!caminho(marcada.id).includes(marcada.midias[2].chave.replace(/\.jpg$/, "_thumb.webp"))) {
      throw new Error(`marcada: ${caminho(marcada.id)}`);
    }
    if (!caminho(arquivo.id).includes("capa-enviada.jpg")) throw new Error(`arquivo: ${caminho(arquivo.id)}`);
    const foco = capas.get(arquivo.id);
    if (foco.focoX !== 30 || foco.focoY !== 70) throw new Error(`foco ${foco.focoX}/${foco.focoY}`);
    if (capas.has(vazia.id)) throw new Error("galeria sem foto ganhou capa");
    return "miniatura da 1ª · miniatura da marcada · arquivo com foco 30/70 · vazia sem capa";
  });

  await etapa("galeria de outro estúdio não vem, mesmo pedida pelo id", async () => {
    const capas = await capasDoPainel(estudio.id, [dele.id]);
    if (capas.size !== 0) throw new Error("veio a capa do vizinho");
    return "nenhuma";
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ as formas de ver têm problema" : "\n✓ quatro formas de ver, cada uma com o mesmo menu");
process.exitCode = falhou ? 1 : 0;
