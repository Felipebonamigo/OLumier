#!/usr/bin/env node
/**
 * O PONTO FOCAL DA CAPA. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-ponto-focal.mjs
 *
 * ── O PEDIDO (08/09/2026) ─────────────────────────────────────────────────
 *
 * Juan, com o print da capa dividida: "não consigo escolher onde fica o ponto
 * focal, eu queria que aparecesse mais o corpo do noivo, mas o enquadramento
 * foi automático". Na foto, o noivo estava encostado na borda de baixo, quase
 * saindo.
 *
 * O "automático" é o `object-cover` do CSS: ele preenche a caixa e corta o
 * excedente pelo CENTRO. Numa capa que é uma faixa larga e uma foto que é um
 * retrato 2:3, isso descarta a metade de cima e a de baixo — e o assunto da
 * foto quase nunca está exatamente no meio.
 *
 * ── POR QUE COLUNA, E NÃO DENTRO DE `aparencia` ───────────────────────────
 *
 * O foco pertence à FOTO escolhida, não ao tema. Trocar de preset não pode
 * mover o enquadramento, e trocar a foto TEM de zerá-lo — um foco calibrado
 * para a foto A não quer dizer nada na foto B. Isso é a mesma vida da própria
 * escolha de capa, que já mora em `galerias.capa_media_id` / `capa_chave` e já
 * vale na hora, fora do rascunho de aparência.
 *
 * ── O QUE ESTE ARQUIVO PRENDE ─────────────────────────────────────────────
 *
 * As três coisas que fazem o recurso ser verdade: o valor é gravado dentro da
 * faixa, ele CHEGA no CSS da galeria pública, e trocar a capa devolve o centro.
 * Sem a terceira, o fotógrafo troca a foto e recebe um enquadramento torto que
 * ele não escolheu, sem entender de onde veio.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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

const g = await galeriaDaRodada(db, { nome: "foco", medias: 3, publicada: true });
const cookie = cookieDeSessao(g.tenant_id);
await db.query("update galerias set senha_hash = null where id = $1", [g.id]);

const focar = (corpo, extra = {}) =>
  fetch(`${BASE}/api/galerias/${g.id}/capa`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    ...extra,
    body: JSON.stringify(corpo),
  });

const focoGravado = async () => {
  const { rows } = await db.query(
    "select capa_foco_x as x, capa_foco_y as y from galerias where id = $1",
    [g.id],
  );
  return rows[0];
};

console.log("O ponto focal da capa:\n");

await etapa("nasce no centro", async () => {
  const f = await focoGravado();
  if (f.x !== 50 || f.y !== 50) throw new Error(`nasceu em ${f.x}/${f.y}`);
  return "50% 50%";
});

await etapa("grava o ponto escolhido", async () => {
  const r = await focar({ focoX: 30, focoY: 78 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const f = await focoGravado();
  if (f.x !== 30 || f.y !== 78) throw new Error(`gravou ${f.x}/${f.y}`);
  return "30% 78%";
});

/* A faixa é 0–100 porque o valor vira `object-position: X% Y%`. Fora dela o CSS
   aceita e desloca a imagem para longe da caixa — a capa fica vazia, e o
   fotógrafo não tem como saber por quê. */
await etapa("recusa o que não é um ponto de 0 a 100", async () => {
  const lixo = [
    { focoX: -5, focoY: 50 },
    { focoX: 50, focoY: 140 },
    { focoX: "meio", focoY: 50 },
    { focoX: null, focoY: 50 },
    { focoX: 1.5, focoY: 50 },
  ];
  for (const corpo of lixo) {
    const r = await focar(corpo);
    if (r.ok) throw new Error(`aceitou ${JSON.stringify(corpo)}`);
  }
  const f = await focoGravado();
  if (f.x !== 30 || f.y !== 78) throw new Error(`o valor bom foi corrompido: ${f.x}/${f.y}`);
  return `${lixo.length} recusados, o anterior intacto`;
});

await etapa("o CSS da galeria pública recebe o ponto", async () => {
  await db.query(
    `update galerias set aparencia = jsonb_set(coalesce(aparencia,'{}'::jsonb), '{capa}', '"imersa"')
      where id = $1`,
    [g.id],
  );
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  if (!/object-position:\s*30% 78%/.test(html.replace(/&#x27;|&quot;/g, ""))) {
    throw new Error("a capa não aplicou object-position com o ponto gravado");
  }
  return "object-position: 30% 78%";
});

await etapa("trocar a foto da capa devolve o centro", async () => {
  const outra = g.midias[1];
  const f = new FormData();
  f.set("galeria_id", g.id);
  f.set("media_id", outra.id);
  const r = await fetch(`${BASE}/api/galerias/${g.id}/capa`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ mediaId: outra.id }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ao trocar a capa`);
  const foco = await focoGravado();
  if (foco.x !== 50 || foco.y !== 50) {
    throw new Error(`o foco da foto anterior sobreviveu: ${foco.x}/${foco.y}`);
  }
  return "voltou para 50% 50%";
});

await etapa("galeria de outro estúdio não é alcançada", async () => {
  const { rows: t } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status)
          values ($1, 'Vizinho', $2, 'x', $3, 'ativo') returning id`,
    [`viz-foco-${g.id.slice(0, 8)}`, `viz-foco-${g.id.slice(0, 8)}@teste.local`, String(1024 ** 4)],
  );
  const { rows: gv } = await db.query(
    `insert into galerias (tenant_id, slug, titulo, publicada, estado)
          values ($1, $2, 'Do vizinho', false, 'online') returning id`,
    [t[0].id, `viz-foco-${g.id.slice(0, 8)}`],
  );
  try {
    const r = await fetch(`${BASE}/api/galerias/${gv[0].id}/capa`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ focoX: 10, focoY: 10 }),
    });
    if (r.status !== 404) throw new Error(`devolveu HTTP ${r.status}, esperava 404`);
    const { rows } = await db.query(
      "select capa_foco_x as x from galerias where id = $1",
      [gv[0].id],
    );
    if (rows[0].x !== 50) throw new Error("mexeu no foco da galeria de outro estúdio");
    return "404, e o foco dela intacto";
  } finally {
    await db.query("delete from galerias where id = $1", [gv[0].id]);
    await db.query("delete from tenants where id = $1", [t[0].id]);
  }
});

await etapa("o editor de capa oferece o ajuste e o pop-up", async () => {
  /*
   * Conferido no ARQUIVO, e não no HTML da aba, e a razão é o próprio desenho
   * da tela: desde 04/09/2026 o Design abre no grupo "Estilos prontos", e o
   * editor de capa só é montado quando a pessoa clica em "Capa". Buscar a
   * página por HTTP devolve o Design sem ele — e um teste que fizesse isso
   * ficaria vermelho sem nada estar quebrado.
   *
   * O que dá para prender daqui é a fiação: o quadro de enquadramento existe, e
   * o "usar uma foto da galeria" é um pop-up e não mais um link para outra aba.
   */
  const { readFileSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const raiz = path.resolve(import.meta.dirname, "..");
  const editor = readFileSync(path.join(raiz, "src/components/capa-galeria-editor.tsx"), "utf8");

  if (!/<PontoFocal/.test(editor)) {
    throw new Error("o editor de capa não desenha o ajuste de enquadramento");
  }
  if (!/<EscolherCapa/.test(editor)) {
    throw new Error("o editor de capa não abre o pop-up de escolher a foto");
  }
  if (editor.includes("/fotos`}")) {
    throw new Error("o escolhedor voltou a ser um link para a aba Fotos");
  }
  return "PontoFocal + EscolherCapa";
});

await etapa("o pop-up busca as fotos por rota, e só as desta galeria", async () => {
  const r = await fetch(`${BASE}/api/galerias/${g.id}/fotos`, { headers: { cookie } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { fotos } = await r.json();
  if (!Array.isArray(fotos) || fotos.length === 0) throw new Error("veio sem foto");
  if (fotos.some((f) => !f.url || !f.id)) throw new Error("foto sem url ou sem id");

  /* Sem sessão não sai nada: a miniatura é assinada, e assinar para quem não é
     o dono seria entregar a galeria inteira a quem tiver o id. */
  const sem = await fetch(`${BASE}/api/galerias/${g.id}/fotos`);
  if (sem.status !== 401) throw new Error(`sem cookie devolveu ${sem.status}`);
  return `${fotos.length} fotos, 401 sem sessão`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o ponto focal tem problema" : "\n✓ ponto focal ok");
process.exit(falhou ? 1 : 0);
