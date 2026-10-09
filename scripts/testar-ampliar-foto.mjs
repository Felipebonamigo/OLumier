#!/usr/bin/env node
/**
 * A FOTO AMPLIADA NA ABA FOTOS — o que o servidor assina. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-ampliar-foto.mjs
 *
 * Precisa das chaves do armazém (R2_BUCKET e as outras) só para ASSINAR os
 * endereços — nenhum objeto é lido nem escrito.
 *
 * ── O PEDIDO (08/10/2026) ─────────────────────────────────────────────────
 *
 * Uma aluna: "poder ampliar/abrir a foto enquanto estou organizando a galeria.
 * Às vezes preciso ver o rosto do convidado pra botar no lugar certo."
 *
 * ── O QUE ESTE TESTE PRENDE ───────────────────────────────────────────────
 *
 * 1. Abre a PRÉVIA (2048 px), não o original: é leve, e é a imagem que o casal vê.
 * 2. Sem prévia, cai no original SÓ se o navegador sabe desenhá-lo (JPEG sim,
 *    HEIC não — um `<img>` de HEIC é imagem quebrada, e a tela fica com a
 *    miniatura).
 * 3. Vídeo, mídia ainda subindo e foto de outra galeria ou de outro estúdio não
 *    ganham endereço: o id vem do navegador.
 * 4. Um pedido não assina a galeria inteira: há teto de fotos por vez.
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
const exige = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const { enderecosDasPrevias, LOTE_DE_PREVIAS } = await import("../src/lib/previas-assinadas.ts");

const estudio = await estudioDaRodada(db);
const vizinho = await segundoEstudioDaRodada(db);
const g = await galeriaDaRodada(db, { nome: "ampliar", medias: 0 });
const outra = await galeriaDaRodada(db, { nome: "ampliar-outra", medias: 1 });
const alheia = await galeriaDaRodada(db, { nome: "ampliar-alheia", dono: vizinho, medias: 1 });

let n = 0;
const nova = async ({ tipo = "foto", mime = "image/jpeg", ext = "jpg", prev = true, pronto = true }) => {
  const chave = `${estudio.id}/${g.id}/ampliar-${Date.now()}-${n++}.${ext}`;
  const { rows } = await db.query(
    `insert into medias (galeria_id, tenant_id, chave, chave_thumb, chave_preview,
                         nome_original, tipo, mime, bytes, ordem, pronto)
     values ($1,$2,$3,$4,$5,$6,$7,$8,1000,$9,$10) returning id, chave, chave_preview`,
    [
      g.id,
      estudio.id,
      chave,
      chave.replace(/\.\w+$/, "_thumb.webp"),
      prev ? chave.replace(/\.\w+$/, "_prev.webp") : null,
      `f${n}.${ext}`,
      tipo,
      mime,
      n,
      pronto,
    ],
  );
  return rows[0];
};

const comPrevia = await nova({});
const jpegSemPrevia = await nova({ prev: false });
const heicSemPrevia = await nova({ prev: false, mime: "image/heic", ext: "heic" });
const heicComPrevia = await nova({ mime: "image/heic", ext: "heic" });
const filme = await nova({ tipo: "video", mime: "video/mp4", ext: "mp4", prev: false });
const subindo = await nova({ pronto: false });

const pedir = (ids, galeria = g.id, dono = estudio.id) => enderecosDasPrevias(galeria, dono, ids);

await etapa("abre a PRÉVIA, e não o original", async () => {
  const r = await pedir([comPrevia.id]);
  const url = r[comPrevia.id];
  exige(url, "sem endereço");
  exige(url.includes(comPrevia.chave_preview.split("/").pop()), "o endereço não é o da prévia");
  exige(!url.includes(comPrevia.chave.split("/").pop()), "o endereço é o do original");
});

await etapa("JPEG sem prévia cai no original (o navegador desenha)", async () => {
  const r = await pedir([jpegSemPrevia.id]);
  exige(r[jpegSemPrevia.id]?.includes(jpegSemPrevia.chave.split("/").pop()), "não caiu no original");
});

await etapa("HEIC sem prévia NÃO ganha endereço (ficaria imagem quebrada)", async () => {
  const r = await pedir([heicSemPrevia.id]);
  exige(!(heicSemPrevia.id in r), "devolveu o original de um HEIC");
});

await etapa("HEIC COM prévia abre a prévia", async () => {
  const r = await pedir([heicComPrevia.id]);
  exige(r[heicComPrevia.id]?.includes(heicComPrevia.chave_preview.split("/").pop()), "não abriu a prévia");
});

await etapa("vídeo e mídia ainda subindo não ganham endereço", async () => {
  const r = await pedir([filme.id, subindo.id]);
  igualVazio(r);
});

await etapa("foto de OUTRA galeria ou de OUTRO estúdio não vem, nem com o id certo", async () => {
  const r1 = await pedir([outra.midias[0].id]);
  igualVazio(r1);
  const r2 = await pedir([alheia.midias[0].id]);
  igualVazio(r2);
  const r3 = await pedir([comPrevia.id], g.id, vizinho.id);
  igualVazio(r3);
  const r4 = await pedir([alheia.midias[0].id], alheia.id, estudio.id);
  igualVazio(r4);
});

await etapa("há teto de fotos por pedido", async () => {
  const todas = [comPrevia, jpegSemPrevia, heicComPrevia];
  for (let i = 0; i < LOTE_DE_PREVIAS + 4; i++) todas.push(await nova({}));
  const r = await pedir(todas.map((m) => m.id));
  exige(Object.keys(r).length <= LOTE_DE_PREVIAS, `assinou ${Object.keys(r).length}, o teto é ${LOTE_DE_PREVIAS}`);
  return `${Object.keys(r).length} de ${todas.length} pedidas`;
});

function igualVazio(r) {
  const k = Object.keys(r);
  if (k.length) throw new Error(`devolveu ${k.length} endereço(s) que não devia`);
}

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ ampliar foto tem problema" : "\n✓ ampliar foto ok");
process.exit(falhou ? 1 : 0);
