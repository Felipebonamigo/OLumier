#!/usr/bin/env node
/**
 * Busca por rosto. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-rostos.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O QUE ESTÁ SENDO PRESO, E POR QUÊ ─────────────────────────────────────
 *
 * O convidado tira uma selfie, o navegador dele transforma o rosto em 128
 * números, e SÓ os números sobem. O servidor compara com os números que o
 * fotógrafo guardou no envio e devolve as fotos parecidas. Cada regra abaixo
 * foi MEDIDA em 03/09/2026 (ver `src/app/spike-rostos/page.tsx`) — nenhuma é
 * palpite:
 *
 *   - o limiar é 0,5, não os 0,6 do face-api: com 0,6, catorze pares de
 *     estranhos passaram por "mesma pessoa";
 *   - rosto abaixo de 60 px não entra no índice: abaixo de ~50 px os vetores
 *     de pessoas diferentes colidem (mulher de cabelo longo e homem barbudo a
 *     0,241);
 *   - a busca recebe DOIS vetores, o da selfie e o do espelho dela: câmera
 *     frontal grava espelhado e só isso custa até 0,550 de distância.
 *
 * E as regras que não são de medida, mas de lei e de acesso:
 *
 *   - galeria com a busca DESLIGADA não aceita vetor nenhum — sem consentimento
 *     do fotógrafo, dado biométrico não entra no banco;
 *   - desligar apaga tudo: o consentimento retirado leva os vetores junto;
 *   - a busca do convidado passa pela mesma régua da galeria (publicada, senha).
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import {
  LIMIAR_MESMA_PESSOA,
  PISO_ROSTO_PX,
  TAMANHO_VETOR,
  casar,
  distancia,
  vetorValido,
} from "../src/config/rostos.ts";
import { apagarRostosDaGaleria, contarRostos } from "../src/lib/rostos.ts";
import { gerarHashSenhaGaleria } from "../src/lib/galerias-publicas.ts";

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
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

/*
 * Vetores de mentira com a geometria dos de verdade: o face-api devolve 128
 * números de norma ~1, e "mesma pessoa" fica abaixo de 0,6 enquanto "outra
 * pessoa" fica perto de 1,0. Um gerador determinístico por semente evita que
 * o teste passe ou falhe conforme o sorteio.
 */
function semente(n) {
  let s = n >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function vetorBase(n) {
  const r = semente(n);
  const v = Array.from({ length: TAMANHO_VETOR }, () => r() - 0.5);
  const norma = Math.hypot(...v);
  return v.map((x) => x / norma);
}
/** O mesmo rosto, medido de novo: desloca cada número um pouquinho. */
function quasePerto(v, n) {
  const r = semente(n);
  return v.map((x) => x + (r() - 0.5) * 0.02);
}

const ana = vetorBase(1);
const anaDeNovo = quasePerto(ana, 2);
const pedro = vetorBase(3);

console.log("\nBusca por rosto\n");

// ── as regras puras ────────────────────────────────────────────────────────

await etapa("distância: o mesmo vetor dá zero, a remedição fica perto, outra pessoa longe", () => {
  igual(distancia(ana, ana), 0, "mesmo vetor");
  const perto = distancia(ana, anaDeNovo);
  if (perto > 0.2) throw new Error(`remedição deu ${perto.toFixed(3)}, esperava < 0,2`);
  const longe = distancia(ana, pedro);
  if (longe < 0.9) throw new Error(`outra pessoa deu ${longe.toFixed(3)}, esperava > 0,9`);
  return `perto ${perto.toFixed(3)} · longe ${longe.toFixed(3)}`;
});

await etapa("o limiar é mais apertado que o padrão do face-api, e o piso é o medido", () => {
  if (LIMIAR_MESMA_PESSOA >= 0.6) {
    throw new Error(`limiar ${LIMIAR_MESMA_PESSOA}: com 0,6 catorze estranhos casaram`);
  }
  if (PISO_ROSTO_PX < 50) {
    throw new Error(`piso ${PISO_ROSTO_PX}px: abaixo de 50 os vetores colidem`);
  }
  return `limiar ${LIMIAR_MESMA_PESSOA} · piso ${PISO_ROSTO_PX}px`;
});

await etapa("casar: devolve só o que está abaixo do limiar, ordenado do mais parecido", () => {
  const galeria = [
    { mediaId: "m-ana", vetor: ana },
    { mediaId: "m-pedro", vetor: pedro },
    { mediaId: "m-ana-2", vetor: quasePerto(ana, 9) },
  ];
  const achados = casar([anaDeNovo], galeria);
  igual(achados.length, 2, "quantas fotos");
  if (!achados.every((a) => a.mediaId.startsWith("m-ana"))) {
    throw new Error(`veio ${JSON.stringify(achados.map((a) => a.mediaId))}`);
  }
  if (achados[0].distancia > achados[1].distancia) throw new Error("fora de ordem");
  return achados.map((a) => `${a.mediaId} ${a.distancia.toFixed(3)}`).join(", ");
});

await etapa("casar: uma foto com dois rostos aparece UMA vez, pela menor distância", () => {
  const galeria = [
    { mediaId: "m-casal", vetor: pedro },
    { mediaId: "m-casal", vetor: ana },
  ];
  const achados = casar([anaDeNovo], galeria);
  igual(achados.length, 1, "uma linha por foto");
  igual(achados[0].mediaId, "m-casal", "qual foto");
  if (achados[0].distancia > 0.2) throw new Error("não ficou com a menor distância");
});

await etapa("casar: o espelho conta — basta UM dos vetores da busca casar", () => {
  /* O convidado manda a selfie e o espelho dela. Se só o espelho bater, a
   * foto tem de vir do mesmo jeito: é exatamente o caso da câmera frontal. */
  const galeria = [{ mediaId: "m-ana", vetor: ana }];
  const achados = casar([pedro, anaDeNovo], galeria);
  igual(achados.length, 1, "achou pelo segundo vetor");
});

await etapa("vetorValido: 128 números finitos, e nada além disso", () => {
  igual(vetorValido(ana), true, "vetor bom");
  igual(vetorValido(ana.slice(0, 5)), false, "curto");
  igual(vetorValido([...ana.slice(0, 127), "x"]), false, "com texto");
  igual(vetorValido([...ana.slice(0, 127), NaN]), false, "com NaN");
  igual(vetorValido("não é lista"), false, "não é lista");
});

// ── o servidor ─────────────────────────────────────────────────────────────

const g = await galeriaDaRodada(db, { nome: "rostos", medias: 3 });
const [m0, m1] = g.midias;
const cookie = cookieDeSessao(g.tenant_id);

const buscar = (vetores, extra = {}) =>
  fetch(`${BASE}/api/g/${g.id}/rostos`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(extra.headers ?? {}) },
    body: JSON.stringify({ vetores }),
  });

const guardar = (mediaId, rostos) =>
  fetch(`${BASE}/api/medias/${mediaId}/rostos`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ rostos }),
  });

const rosto = (vetor, px = 120) => ({ caixa: { x: 0.4, y: 0.3, w: 0.1, h: 0.15 }, px, vetor });

await etapa("com a busca DESLIGADA o fotógrafo não consegue guardar rosto nenhum", async () => {
  const r = await guardar(m0.id, [rosto(ana)]);
  igual(r.status, 409, "status");
  igual(await contarRostos(g.id), 0, "linhas no banco");
});

await etapa("com a busca DESLIGADA o convidado recebe 404 — o recurso não existe para ele", async () => {
  const r = await buscar([ana]);
  igual(r.status, 404, "status");
});

await db.query("update galerias set rostos_ativos = true, rostos_ligados_em = now() where id = $1", [
  g.id,
]);

await etapa("ligada, o fotógrafo guarda os rostos da foto", async () => {
  const r = await guardar(m0.id, [rosto(ana), rosto(pedro)]);
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  igual(corpo.salvos, 2, "salvos");
  igual(await contarRostos(g.id), 2, "linhas no banco");
});

await etapa("guardar de novo SUBSTITUI, não acumula — reindexar é seguro", async () => {
  const r = await guardar(m0.id, [rosto(ana)]);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  igual(await contarRostos(g.id), 1, "linhas no banco");
});

await etapa("rosto abaixo do piso é DESCARTADO pelo servidor, mesmo que o navegador mande", async () => {
  const r = await guardar(m1.id, [rosto(pedro, 120), rosto(ana, PISO_ROSTO_PX - 1)]);
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  igual(corpo.salvos, 1, "só o grande");
  igual(corpo.descartados, 1, "o pequeno");
});

await etapa("sem sessão, ninguém guarda rosto", async () => {
  const r = await fetch(`${BASE}/api/medias/${m0.id}/rostos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rostos: [rosto(ana)] }),
  });
  igual(r.status, 401, "status");
});

await etapa("o convidado acha a foto certa com a selfie remedida", async () => {
  const r = await buscar([anaDeNovo]);
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  igual(corpo.fotos.length, 1, "quantas");
  igual(corpo.fotos[0].mediaId, m0.id, "qual");
  if (corpo.fotos[0].distancia >= LIMIAR_MESMA_PESSOA) throw new Error("distância acima do limiar");
  return `distância ${corpo.fotos[0].distancia.toFixed(3)}`;
});

await etapa("o convidado acha a foto do Pedro, e ela é outra", async () => {
  const r = await buscar([quasePerto(pedro, 5)]);
  const corpo = await r.json();
  igual(corpo.fotos.length, 1, "quantas");
  igual(corpo.fotos[0].mediaId, m1.id, "qual");
});

await etapa("estranho não acha nada — e é assim que tem que ser", async () => {
  const r = await buscar([vetorBase(77)]);
  const corpo = await r.json();
  igual(corpo.fotos.length, 0, "quantas");
});

await etapa("a busca aceita o espelho: [estranho, ana] acha a Ana", async () => {
  const r = await buscar([vetorBase(77), anaDeNovo]);
  const corpo = await r.json();
  igual(corpo.fotos.length, 1, "quantas");
  igual(corpo.fotos[0].mediaId, m0.id, "qual");
});

await etapa("vetor torto é recusado com 400, sem tocar o banco", async () => {
  igual((await buscar([ana.slice(0, 5)])).status, 400, "curto");
  igual((await buscar([[...ana.slice(0, 127), "x"]])).status, 400, "com texto");
  igual((await buscar("não é lista")).status, 400, "não é lista");
  igual((await buscar([])).status, 400, "vazio");
  igual((await buscar([ana, ana, ana])).status, 400, "mais que dois");
});

await etapa("galeria com senha exige a senha também para buscar", async () => {
  await db.query("update galerias set senha_hash = $1 where id = $2", [
    gerarHashSenhaGaleria("segredo", g.id),
    g.id,
  ]);
  const r = await buscar([anaDeNovo]);
  igual(r.status, 401, "status");
  await db.query("update galerias set senha_hash = null where id = $1", [g.id]);
});

await etapa("desligar apaga TODOS os vetores da galeria — consentimento retirado, dado some", async () => {
  const antes = await contarRostos(g.id);
  if (antes < 2) throw new Error(`esperava pelo menos 2 antes, tinha ${antes}`);
  await apagarRostosDaGaleria(g.id, g.tenant_id);
  igual(await contarRostos(g.id), 0, "depois");
});

await etapa("apagar a foto leva os rostos dela junto (cascata)", async () => {
  await db.query("update galerias set rostos_ativos = true where id = $1", [g.id]);
  const r = await guardar(m0.id, [rosto(ana)]);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  igual(await contarRostos(g.id), 1, "antes");
  await db.query("delete from medias where id = $1", [m0.id]);
  igual(await contarRostos(g.id), 0, "depois");
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ busca por rosto com falha\n" : "\n✓ busca por rosto ok\n");
process.exit(falhou ? 1 : 0);
