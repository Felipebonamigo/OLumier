#!/usr/bin/env node
/**
 * MOVER FOTOS PARA OUTRA GALERIA, sem subir de novo. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-mover-entre-galerias.mjs
 *
 * ── O PEDIDO (08/10/2026) ─────────────────────────────────────────────────
 *
 * Uma aluna manda só as prévias do ensaio numa galeria e, quando tudo fica
 * pronto, leva essas fotos para a galeria final. Antes: apagar e SUBIR tudo de
 * novo. Agora: mover a linha de lugar — as fotos marcadas, ou o capítulo inteiro
 * —, escolhendo o capítulo do destino ("Outras fotos" se não escolher nenhum).
 *
 * ── O QUE ESTE TESTE PRENDE ───────────────────────────────────────────────
 *
 * 1. O arquivo NÃO se mexe: a chave no bucket continua a mesma. É isso que torna
 *    o movimento barato e seguro — ver `lib/mover-entre-galerias.ts`.
 * 2. O espaço das duas galerias é refeito, e o do estúdio fica igual.
 * 3. O que apontava para a foto na origem (capa da galeria, capa do capítulo,
 *    favoritas) não fica pendurado em foto que já não é de lá.
 * 4. Rosto (dado biométrico) só acompanha a foto se o destino tem a busca ligada.
 * 5. O id vindo do navegador não alcança nada que não seja do estúdio: foto,
 *    galeria ou capítulo de outro estúdio — ou de outra galeria — são recusados
 *    SEM mexer em nada.
 * 6. Galeria arquivada ou na lixeira não recebe fotos.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import {
  estudioDaRodada,
  galeriaDaRodada,
  limparRodada,
  segundoEstudioDaRodada,
} from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

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
const igual = (obtido, esperado, o) => {
  if (JSON.stringify(obtido) !== JSON.stringify(esperado)) {
    throw new Error(`${o}: esperava ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`);
  }
};

const { criarSecao } = await import("../src/lib/secoes.ts");
const { galeriasParaMover, opcoesDoDestino, moverMediasParaOutraGaleria } = await import(
  "../src/lib/mover-entre-galerias.ts"
);

const estudio = await estudioDaRodada(db);
const vizinho = await segundoEstudioDaRodada(db);
const tenantId = estudio.id;

const origem = await galeriaDaRodada(db, { nome: "previas", titulo: "Prévias", medias: 6 });
const final = await galeriaDaRodada(db, { nome: "final", titulo: "Galeria final", medias: 2 });
const final2 = await galeriaDaRodada(db, { nome: "final2", titulo: "Outra final", medias: 0 });
const alheia = await galeriaDaRodada(db, { nome: "alheia", dono: vizinho, medias: 2 });
const arquivada = await galeriaDaRodada(db, { nome: "arquivada", medias: 0 });
const lixeira = await galeriaDaRodada(db, { nome: "lixeira", medias: 0 });
await db.query("update galerias set estado = 'arquivada' where id = $1", [arquivada.id]);
await db.query("update galerias set estado = 'lixeira' where id = $1", [lixeira.id]);
/* A busca por rosto: ligada numa das finais, desligada na outra. */
await db.query("update galerias set rostos_ativos = true where id = $1", [final.id]);

const cerimonia = await criarSecao(origem.id, tenantId, "Cerimônia");
const festa = await criarSecao(final.id, tenantId, "Festa");
await criarSecao(final.id, tenantId, "Making of");
const secaoAlheia = await criarSecao(alheia.id, vizinho.id, "Alheia");

const [m0, m1, m2, m3, m4] = origem.midias.map((m) => m.id);
await db.query("update medias set secao_id = $1 where id = any($2::uuid[])", [cerimonia.id, [m0, m1, m2]]);
/* Uma foto já na Festa do destino, para provar que as novas entram DEPOIS dela. */
await db.query("update medias set secao_id = $1 where id = $2", [festa.id, final.midias[0].id]);

/* Tudo o que penduraria na origem: capas, favorita, rostos. */
await db.query("update galerias set capa_media_id = $1 where id = $2", [m1, origem.id]);
await db.query("update secoes set capa_media_id = $1 where id = $2", [m2, cerimonia.id]);
await db.query(
  "insert into favoritas (galeria_id, media_id, visitante) values ($1, $2, 'visitante-a')",
  [origem.id, m1],
);
for (const m of [m0, m4]) {
  await db.query(
    `insert into rostos (media_id, galeria_id, tenant_id, caixa, px, vetor)
     values ($1, $2, $3, '{"x":0.1,"y":0.1,"w":0.2,"h":0.2}', 120, array_fill(0.1::real, array[128]))`,
    [m, origem.id, tenantId],
  );
}
/* Uma foto ainda subindo: não é foto, e não pode ir. */
const { rows: [pendente] } = await db.query(
  `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime, bytes, ordem, pronto)
   values ($1, $2, $3, 'subindo.jpg', 'foto', 'image/jpeg', 1000, 99, false) returning id`,
  [origem.id, tenantId, `${tenantId}/${origem.id}/subindo-${Date.now()}.jpg`],
);

const linha = async (id) =>
  (await db.query("select galeria_id, secao_id, ordem, chave from medias where id = $1", [id])).rows[0];
const bytesDaGaleria = async (id) =>
  Number((await db.query("select bytes_total from galerias where id = $1", [id])).rows[0].bytes_total);
const usoDoEstudio = async () =>
  Number((await db.query("select usado_bytes from tenants where id = $1", [tenantId])).rows[0].usado_bytes);

const MB = 1024 * 1024;
const chaveAntes = (await linha(m1)).chave;
const usoAntes = await usoDoEstudio();

await etapa("a lista de destinos: as MINHAS galerias no ar, menos a de origem", async () => {
  const ids = (await galeriasParaMover(tenantId, origem.id)).map((g) => g.id).sort();
  igual(ids, [final.id, final2.id].sort(), "destinos");
  return "sem a de origem, a do vizinho, a arquivada e a da lixeira";
});

await etapa("as opções do destino: capítulos, e quantas favoritas se perdem", async () => {
  const o = await opcoesDoDestino(tenantId, origem.id, final.id, { tipo: "ids", ids: [m1, m3] });
  igual(o.capitulos.map((c) => c.nome), ["Festa", "Making of"], "capítulos do destino");
  igual(o.capitulos[0].total, 1, "a Festa já tem uma foto");
  igual(o.favoritas, 1, "favoritas que se perdem");
  igual(o.grupoSolto, null, "sem nome próprio para as soltas");
});

await etapa("destino que não é meu / é a própria origem / não está no ar → sem opções", async () => {
  const escopo = { tipo: "ids", ids: [m1] };
  for (const [quem, id] of [
    ["do vizinho", alheia.id],
    ["a própria origem", origem.id],
    ["arquivado", arquivada.id],
    ["na lixeira", lixeira.id],
    ["inventado", "00000000-0000-4000-8000-000000000000"],
  ]) {
    if ((await opcoesDoDestino(tenantId, origem.id, id, escopo)) !== null) {
      throw new Error(`destino ${quem} devolveu opções`);
    }
  }
});

await etapa("RECUSA: galeria de outro estúdio, arquivada, na lixeira, a mesma, capítulo alheio", async () => {
  const base = { tenantId, origemId: origem.id, secaoDestinoId: null, escopo: { tipo: "ids", ids: [m3] } };
  const casos = [
    ["destino de outro estúdio", { destinoId: alheia.id }],
    ["destino arquivado", { destinoId: arquivada.id }],
    ["destino na lixeira", { destinoId: lixeira.id }],
    ["destino igual à origem", { destinoId: origem.id }],
    ["capítulo de OUTRA galeria", { destinoId: final2.id, secaoDestinoId: festa.id }],
    ["capítulo de outro estúdio", { destinoId: final.id, secaoDestinoId: secaoAlheia.id }],
    ["capítulo inventado", { destinoId: final.id, secaoDestinoId: "isso-nao-e-uuid" }],
  ];
  for (const [nome, extra] of casos) {
    const r = await moverMediasParaOutraGaleria({ ...base, ...extra });
    if (r.ok) throw new Error(`${nome}: foi aceito`);
  }
  igual((await linha(m3)).galeria_id, origem.id, "a foto continua na origem");
});

await etapa("RECUSA: quem é de OUTRO estúdio não entra no movimento, mesmo com o id certo", async () => {
  const idAlheio = alheia.midias[0].id;
  const r = await moverMediasParaOutraGaleria({
    tenantId,
    origemId: origem.id,
    destinoId: final.id,
    secaoDestinoId: null,
    escopo: { tipo: "ids", ids: [idAlheio] },
  });
  igual(r, { ok: true, movidas: 0, favoritasRemovidas: 0 }, "resposta");
  igual((await linha(idAlheio)).galeria_id, alheia.id, "a foto do vizinho ficou onde estava");
  /* E pedindo a origem do vizinho: o tenant da sessão não é o dono. */
  const r2 = await moverMediasParaOutraGaleria({
    tenantId,
    origemId: alheia.id,
    destinoId: final.id,
    secaoDestinoId: null,
    escopo: { tipo: "soltas" },
  });
  if (r2.ok) throw new Error("origem de outro estúdio foi aceita");
  igual((await linha(idAlheio)).galeria_id, alheia.id, "e continua lá");
});

await etapa("fotos marcadas → destino SEM capítulo: vão para as soltas, no fim, na ordem da origem", async () => {
  /* m3 marcada ANTES de m1: a ordem que vale é a da galeria, não a do clique. */
  const r = await moverMediasParaOutraGaleria({
    tenantId,
    origemId: origem.id,
    destinoId: final.id,
    secaoDestinoId: null,
    escopo: { tipo: "ids", ids: [m3, m1] },
  });
  igual(r, { ok: true, movidas: 2, favoritasRemovidas: 1 }, "resposta");
  const a = await linha(m1);
  const b = await linha(m3);
  igual([a.galeria_id, a.secao_id, b.galeria_id, b.secao_id], [final.id, null, final.id, null], "destino");
  /* O destino tinha ordens 0 e 1: as novas entram em 2 e 3, m1 antes de m3. */
  igual([a.ordem, b.ordem], [2, 3], "posições no fim do destino");
});

await etapa("o ARQUIVO não se mexeu: mesma chave no bucket", async () => {
  igual((await linha(m1)).chave, chaveAntes, "chave");
});

await etapa("o espaço das duas galerias foi refeito; o do estúdio ficou igual", async () => {
  /* Eram 6 MB na origem e 2 MB no destino; foram 2 fotos de 1 MB. */
  igual(await bytesDaGaleria(origem.id), 4 * MB, "origem");
  igual(await bytesDaGaleria(final.id), 4 * MB, "destino");
});

await etapa("a capa que era uma das fotos movidas foi solta; a favorita foi junto", async () => {
  const capa = (await db.query("select capa_media_id from galerias where id = $1", [origem.id])).rows[0];
  igual(capa.capa_media_id, null, "capa da galeria");
  const f = (await db.query("select count(*)::int as n from favoritas where media_id = $1", [m1])).rows[0];
  igual(f.n, 0, "favoritas da foto movida");
});

await etapa("o capítulo INTEIRO → capítulo escolhido do destino, depois do que já estava lá", async () => {
  const r = await moverMediasParaOutraGaleria({
    tenantId,
    origemId: origem.id,
    destinoId: final.id,
    secaoDestinoId: festa.id,
    escopo: { tipo: "capitulo", secaoId: cerimonia.id },
  });
  /* m1 já tinha ido; sobram m0 e m2. */
  igual(r.ok && r.movidas, 2, "movidas");
  const a = await linha(m0);
  const b = await linha(m2);
  igual([a.galeria_id, a.secao_id, b.secao_id], [final.id, festa.id, festa.id], "no capítulo Festa");
  if (!(a.ordem > 3 && b.ordem > a.ordem)) throw new Error(`ordem ${a.ordem}/${b.ordem} não vem depois do fim`);
});

await etapa("o capítulo de ORIGEM continua existindo, vazio, e sua capa foi solta", async () => {
  const s = (await db.query("select capa_media_id from secoes where id = $1", [cerimonia.id])).rows;
  igual(s.length, 1, "o capítulo ainda existe");
  igual(s[0].capa_media_id, null, "capa do capítulo");
  const n = (await db.query("select count(*)::int as n from medias where secao_id = $1", [cerimonia.id])).rows[0].n;
  igual(n, 0, "fotos que sobraram no capítulo");
});

await etapa("rostos: seguem a foto para a galeria com a busca LIGADA", async () => {
  const r = (await db.query("select galeria_id from rostos where media_id = $1", [m0])).rows;
  igual(r.map((x) => x.galeria_id), [final.id], "rosto de m0");
});

await etapa("as soltas → galeria com a busca DESLIGADA: os rostos são apagados (LGPD)", async () => {
  const r = await moverMediasParaOutraGaleria({
    tenantId,
    origemId: origem.id,
    destinoId: final2.id,
    secaoDestinoId: null,
    escopo: { tipo: "soltas" },
  });
  /* Soltas que sobraram: m4 e m5. A pendente fica de fora. */
  igual(r.ok && r.movidas, 2, "movidas");
  igual((await linha(m4)).galeria_id, final2.id, "m4 mudou");
  const n = (await db.query("select count(*)::int as n from rostos where media_id = $1", [m4])).rows[0].n;
  igual(n, 0, "rostos de m4");
});

await etapa("o que ainda estava SUBINDO não vai junto", async () => {
  igual((await linha(pendente.id)).galeria_id, origem.id, "pendente");
});

await etapa("mover de novo o que já saiu não move nada (nem quebra)", async () => {
  const r = await moverMediasParaOutraGaleria({
    tenantId,
    origemId: origem.id,
    destinoId: final.id,
    secaoDestinoId: null,
    escopo: { tipo: "ids", ids: [m1, m3] },
  });
  igual(r, { ok: true, movidas: 0, favoritasRemovidas: 0 }, "resposta");
});

await etapa("dá para voltar: o movimento é reversível", async () => {
  const r = await moverMediasParaOutraGaleria({
    tenantId,
    origemId: final.id,
    destinoId: origem.id,
    secaoDestinoId: cerimonia.id,
    escopo: { tipo: "ids", ids: [m3] },
  });
  igual(r.ok && r.movidas, 1, "movidas");
  const l = await linha(m3);
  igual([l.galeria_id, l.secao_id], [origem.id, cerimonia.id], "de volta, no capítulo");
});

await etapa("o uso do ESTÚDIO não mudou em nada (mudou de galeria, não de dono)", async () => {
  igual(await usoDoEstudio(), usoAntes, "usado_bytes");
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ mover entre galerias tem problema" : "\n✓ mover entre galerias ok");
process.exit(falhou ? 1 : 0);
