#!/usr/bin/env node
/**
 * Republicar um arquivo SEM trocar o id da mídia. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-republicar.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * É o motivo de ser do plugin do Lightroom: o fotógrafo reedita uma foto já
 * entregue, clica Publicar, e só ela sobe. Até aqui o sistema tinha CRIAR e
 * APAGAR, e não tinha SUBSTITUIR — então a saída óbvia seria apagar e criar de
 * novo, com id novo.
 *
 * E aí está a perda de dado silenciosa:
 *
 *     favoritas.media_id ... on delete cascade   (migração 010)
 *
 * A seleção do álbum (migração 019) mora em cima de `favoritas`. Apagar a mídia
 * apaga a escolha do casal — a noiva marca as 40 fotos do álbum, o fotógrafo
 * clareia uma, republica, e a lista some. Sem erro, sem aviso. A capa da galeria
 * (`galerias.capa_media_id`) quebra junto.
 *
 * Este teste existe para que a única maneira de republicar seja a que preserva o
 * id. É o passo "a favorita sobrevive" que segura a promessa.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { gerarChave } from "../src/lib/chaves-api.ts";

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
 * ── GALERIA PRÓPRIA, E NÃO A PRIMEIRA QUE APARECER ────────────────────────
 *
 * A versão anterior pegava `a primeira galeria online` — a mesma que meia dúzia
 * de outras suítes usa. Dois desses testes limpam a bancada assim:
 *
 *     delete from favoritas where galeria_id = $1
 *
 * (`testar-favoritas.mjs:282` e `testar-selecao.mjs:96`.) Numa rodada sequencial
 * eles não se cruzam com esta, mas basta uma segunda sessão rodando a suíte no
 * mesmo banco — coisa comum neste repositório — para a favorita deste teste
 * sumir no meio do caminho. Foi o que reprovou o deploy de 26/08/2026: o passo
 * "a favorita sobreviveu" acusou perda de dado que o produto não tinha.
 *
 * Falso positivo em teste de perda de dado é caro duas vezes: para o deploy, e
 * para a confiança em quem grita. Galeria própria e descartável remove a chance.
 */
// Bancada propria desta execucao (ver fixture-de-teste.mjs).
const ts = [await estudioDaRodada(db)];
const { rows: [nova] } = await db.query(
  `insert into galerias (tenant_id, slug, titulo, estado, publicada)
        values ($1, $2, 'Republicar (teste)', 'online', false)
     returning id, tenant_id, titulo`,
  [ts[0].id, `republicar-teste-${Date.now()}`],
);
const galeria = nova;
const cookie = cookieDeSessao(galeria.tenant_id);

const chaveEnvio = (await gerarChave(galeria.tenant_id, "republicar", "envio")).segredo;

/* Dois PNG 1x1 de tamanhos DIFERENTES: o segundo é a "foto reeditada", e o
 * tamanho diferente é o que prova que os bytes foram reconferidos no armazém em
 * vez de copiados do que o cliente declarou. */
const png1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const png2 = Buffer.concat([png1, Buffer.alloc(64)]); // maior de propósito

const api = (caminho, { metodo = "POST", chave, corpo } = {}) =>
  fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      ...(chave ? { authorization: `Bearer ${chave}` } : {}),
      ...(corpo ? { "content-type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

console.log(`\nRepublicar sem trocar o id — galeria "${galeria.titulo}"\n`);

let mediaId = null;
let chaveOriginal = null;

await etapa("prepara e envia a foto original", async () => {
  const r = await api(`/api/galerias/${galeria.id}/upload`, {
    chave: chaveEnvio,
    corpo: { nome: "republicar.png", mime: "image/png", bytes: png1.length },
  });
  const p = await r.json();
  if (!r.ok) throw new Error(p.erro ?? `HTTP ${r.status}`);
  mediaId = p.mediaId;

  const envio = await fetch(p.url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png1,
  });
  if (!envio.ok) throw new Error(`PUT no bucket: HTTP ${envio.status}`);

  const c = await api(`/api/medias/${mediaId}/confirmar`, { chave: chaveEnvio });
  const corpo = await c.json();
  if (!c.ok) throw new Error(corpo.erro ?? `confirmar: HTTP ${c.status}`);
  igual(corpo.bytes, png1.length, "bytes");

  const { rows } = await db.query("select chave from medias where id = $1", [mediaId]);
  chaveOriginal = rows[0].chave;
  return `${png1.length} bytes`;
});

await etapa("o casal marca a foto como favorita, e ela vira capa", async () => {
  await db.query(
    "insert into favoritas (galeria_id, media_id, visitante) values ($1, $2, $3)",
    [galeria.id, mediaId, `teste-republicar-${Date.now()}`],
  );
  await db.query("update galerias set capa_media_id = $1 where id = $2", [mediaId, galeria.id]);
  const { rows } = await db.query("select count(*)::int n from favoritas where media_id = $1", [mediaId]);
  igual(rows[0].n, 1, "favoritas");
});

await etapa("sem chave, não republica", async () => {
  igual((await api(`/api/medias/${mediaId}/arquivo`, { metodo: "PUT", corpo: { bytes: 10 } })).status, 401, "status");
});

await etapa("mídia de outro estúdio não é encontrada", async () => {
  const { rows } = await db.query(
    "select id from medias where tenant_id <> $1 limit 1",
    [galeria.tenant_id],
  );
  if (rows.length === 0) return "sem mídia de outro estúdio — nada a provar";
  const r = await api(`/api/medias/${rows[0].id}/arquivo`, {
    metodo: "PUT",
    chave: chaveEnvio,
    corpo: { bytes: png2.length },
  });
  igual(r.status, 404, "status");
});

await etapa("republica a foto reeditada, na MESMA chave do armazém", async () => {
  const r = await api(`/api/medias/${mediaId}/arquivo`, {
    metodo: "PUT",
    chave: chaveEnvio,
    corpo: { bytes: png2.length },
  });
  const p = await r.json();
  if (!r.ok) throw new Error(p.erro ?? `HTTP ${r.status}`);
  if (!p.url) throw new Error("resposta sem url de envio");

  /* A chave não muda de propósito: chave nova exigiria apagar a antiga (lixo
   * pago) e trocaria o endereço de um arquivo que o casal pode ter aberto. */
  const { rows } = await db.query("select chave from medias where id = $1", [mediaId]);
  igual(rows[0].chave, chaveOriginal, "chave do armazém");

  const envio = await fetch(p.url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png2,
  });
  if (!envio.ok) throw new Error(`PUT no bucket: HTTP ${envio.status}`);
  return "mesma chave, conteúdo novo";
});

await etapa("confirma e o tamanho novo é lido do armazém", async () => {
  const r = await api(`/api/medias/${mediaId}/arquivo`, { metodo: "POST", chave: chaveEnvio });
  const c = await r.json();
  if (!r.ok) throw new Error(c.erro ?? `HTTP ${r.status}`);
  igual(c.bytes, png2.length, "bytes devolvidos");
  const { rows } = await db.query("select bytes::int as b from medias where id = $1", [mediaId]);
  igual(rows[0].b, png2.length, "bytes no banco");
  return `${png1.length} → ${png2.length} bytes`;
});

await etapa("O QUE IMPORTA: o id não mudou e a favorita sobreviveu", async () => {
  const { rows: m } = await db.query("select id from medias where id = $1", [mediaId]);
  igual(m.length, 1, "a mídia continua existindo com o mesmo id");
  const { rows: f } = await db.query("select count(*)::int n from favoritas where media_id = $1", [mediaId]);
  igual(f[0].n, 1, "favoritas depois de republicar");
  const { rows: g } = await db.query("select capa_media_id from galerias where id = $1", [galeria.id]);
  igual(g[0].capa_media_id, mediaId, "capa da galeria");
  return "seleção do álbum e capa intactas";
});

await etapa("republicar devolve o arquivo à fila do espelho", async () => {
  const { rows } = await db.query("select espelhado_em from medias where id = $1", [mediaId]);
  igual(rows[0].espelhado_em, null, "espelhado_em");
  return "espelhado_em zerado — a cópia antiga não vale para o conteúdo novo";
});

await etapa("mídia que nunca ficou pronta não é republicável", async () => {
  const r = await api(`/api/galerias/${galeria.id}/upload`, {
    chave: chaveEnvio,
    corpo: { nome: "pendente.png", mime: "image/png", bytes: png1.length },
  });
  const p = await r.json();
  const rep = await api(`/api/medias/${p.mediaId}/arquivo`, {
    metodo: "PUT",
    chave: chaveEnvio,
    corpo: { bytes: png2.length },
  });
  igual(rep.status, 409, "status");
  await fetch(`${BASE}/api/medias/${p.mediaId}/confirmar`, { method: "DELETE", headers: { cookie } });
  return "409 — republicar é para entrega feita, não para envio interrompido";
});

/*
 * Limpeza. O DELETE da mídia vem ANTES do da galeria de propósito: ele tira os
 * objetos do bucket também, e apagar a linha da galeria primeiro levaria a
 * mídia em cascata deixando o arquivo pago para trás — que é justamente o
 * órfão que `testar-limpeza` sai caçando.
 */
await fetch(`${BASE}/api/medias/${mediaId}/confirmar`, { method: "DELETE", headers: { cookie } });
await db.query("delete from galerias where id = $1", [galeria.id]);
await db.query("delete from chaves_api where tenant_id = $1 and nome = 'republicar'", [galeria.tenant_id]);
// A bancada desta execucao sai inteira (ver fixture-de-teste.mjs).
await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ republicar com falha\n" : "\n✓ republicar ok\n");
process.exit(falhou ? 1 : 0);
