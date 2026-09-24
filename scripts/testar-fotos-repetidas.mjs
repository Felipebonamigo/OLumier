#!/usr/bin/env node
/**
 * Testa a detecção de FOTOS REPETIDAS numa galeria.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-fotos-repetidas.mjs
 *
 * ── DE ONDE VEIO (23/09/2026) ─────────────────────────────────────────────
 *
 * Felipe, olhando o zip do casamento da Júlia baixado no Windows: dentro de
 * "Cerimônia" havia `sirius-jugusw-1070.jpg` E `sirius-jugusw-1070 (2).jpg`,
 * os dois com 2.888 KB. Ele achou que estava "aparentemente ok".
 *
 * O "(2)" É nosso e está certo — `nomeUnico` renomeia para o descompactador
 * não sobrescrever uma foto com a outra. O que não estava certo é o tamanho
 * IGUAL: duas fotos de câmera não têm o mesmo número de bytes. Era a mesma
 * foto duas vezes na galeria.
 *
 * Ele pediu a consulta no banco e disse "eu nem sei aonde esta o banco dessa
 * aplicação". A pergunta virou tela, e este teste prende as duas metades dela:
 *
 *   1. mesmo nome + mesmo tamanho = repetida de verdade (o problema);
 *   2. mesmo nome + tamanhos diferentes = duas fotos que se chamam igual
 *      (normal — duas câmeras começam em DSC_0001.jpg);
 *   3. nome único não entra;
 *   4. foto ainda não confirmada não entra — ela pode nunca chegar;
 *   5. a galeria de outro estúdio não aparece aqui.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

import { fotosRepetidas } from "../src/lib/galeria-painel.ts";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const g = await galeriaDaRodada(db, { nome: "repetidas", medias: 0, publicada: true });

const por = async (nome, bytes, pronto = true) =>
  db.query(
    `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime, bytes, pronto)
     values ($1, $2, $3, $4, 'foto', 'image/jpeg', $5, $6)`,
    [g.id, g.tenant_id, `${g.id}/${nome}-${Math.random()}`, nome, bytes, pronto],
  );

try {
  console.log("os dois casos de nome repetido");

  /* O caso do Felipe: a MESMA foto duas vezes. */
  await por("sirius-jugusw-1070.jpg", 2957312);
  await por("sirius-jugusw-1070.jpg", 2957312);
  /* O caso normal: duas câmeras, dois arquivos diferentes, mesmo nome. */
  await por("DSC_0001.jpg", 4100000);
  await por("DSC_0001.jpg", 3800000);
  /* E uma sozinha, que não pode aparecer em lista nenhuma. */
  await por("sozinha.jpg", 1000000);

  await etapa("mesmo nome + mesmo tamanho = repetida de verdade", async () => {
    const r = await fotosRepetidas(g.id);
    const alvo = r.find((x) => x.nome === "sirius-jugusw-1070.jpg");
    if (!alvo) throw new Error("a repetida não foi encontrada");
    igual(alvo.vezes, 2, "vezes");
    igual(alvo.mesmoTamanho, true, "mesmoTamanho");
  });

  await etapa("mesmo nome + tamanhos diferentes = duas fotos, e a tela diz isso", async () => {
    const r = await fotosRepetidas(g.id);
    const alvo = r.find((x) => x.nome === "DSC_0001.jpg");
    if (!alvo) throw new Error("o nome repetido não foi encontrado");
    igual(alvo.vezes, 2, "vezes");
    igual(alvo.mesmoTamanho, false, "mesmoTamanho");
  });

  await etapa("nome único não entra na lista", async () => {
    const r = await fotosRepetidas(g.id);
    if (r.some((x) => x.nome === "sozinha.jpg")) throw new Error("a foto única apareceu");
    igual(r.length, 2, "linhas");
  });

  console.log("\no que não conta");

  await etapa("foto ainda não confirmada não conta como repetida", async () => {
    await por("pendente.jpg", 500000, false);
    await por("pendente.jpg", 500000, false);
    const r = await fotosRepetidas(g.id);
    if (r.some((x) => x.nome === "pendente.jpg")) {
      throw new Error("uma pendente virou repetida — ela pode nunca chegar");
    }
  });

  await etapa("a mesma foto TRÊS vezes conta três", async () => {
    await por("sirius-jugusw-1070.jpg", 2957312);
    const r = await fotosRepetidas(g.id);
    igual(r.find((x) => x.nome === "sirius-jugusw-1070.jpg").vezes, 3, "vezes");
  });

  await etapa("a galeria do vizinho não aparece aqui", async () => {
    const g2 = await galeriaDaRodada(db, { nome: "vizinha", medias: 0, publicada: true });
    await db.query(
      `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime, bytes, pronto)
       select $1::uuid, $2::uuid, $3 || '/' || s, 'igual.jpg', 'foto', 'image/jpeg', 999, true
         from generate_series(1,2) as s`,
      [g2.id, g2.tenant_id, String(g2.id)],
    );
    const r = await fotosRepetidas(g.id);
    if (r.some((x) => x.nome === "igual.jpg")) throw new Error("vazou galeria de outro estúdio");
    /* E a do vizinho enxerga a dela. */
    const r2 = await fotosRepetidas(g2.id);
    igual(r2.length, 1, "repetidas da vizinha");
  });

  await etapa("galeria sem repetida nenhuma devolve lista vazia", async () => {
    const g3 = await galeriaDaRodada(db, { nome: "limpa", medias: 4, publicada: true });
    const r = await fotosRepetidas(g3.id);
    igual(r.length, 0, "linhas");
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ a detecção de repetidas tem problema\n" : "\n✓ fotos repetidas ok\n");
process.exit(falhou ? 1 : 0);
