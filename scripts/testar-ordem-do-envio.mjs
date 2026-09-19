#!/usr/bin/env node
/**
 * A ORDEM EM QUE AS FOTOS CHEGAM AO CASAL. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-ordem-do-envio.mjs
 *
 * ── DE ONDE VEIO (18/09/2026, migração 038) ───────────────────────────────
 *
 * Juan, com a galeria de 286 arquivos: "não sei o que tá acontecendo, mas não
 * tá em ordem cronológica (…) minhas PB sempre são depois da colorida, mas aqui
 * tá antes".
 *
 * A posição de cada foto nasce em `criarMediaPendente`:
 *
 *     base    = max(ordem) + 1 entre as fotos PRONTAS da galeria
 *     posicao = base + indice
 *
 * O filtro `pronto` segurava a base enquanto NENHUM arquivo do lote ficasse
 * pronto. Num teste de três arquivos isso é verdade. Num casamento de 286, que
 * leva minutos, arquivos ficam prontos o tempo todo: a base sobe, os índices
 * continuam contando do zero, e basta um arquivo demorar no preparo do
 * navegador — o RAW, o HEIC, o arquivo grande — para nascer com base alta e
 * cair depois de arquivos que vinham atrás dele na lista.
 *
 * ── POR QUE ESTE TESTE EXISTE ASSIM ───────────────────────────────────────
 *
 * As três primeiras etapas são ARITMÉTICA EXATA: posição esperada, posição
 * obtida. Elas não dependem de tempo, então não piscam.
 *
 * A última é o envio DE VERDADE em miniatura — paralelo, com preparo de
 * duração desigual. Ela é o que reproduz o relato do Juan, e a única que
 * teria pegado o defeito antes: nenhuma conta sobre um arquivo só o mostra.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada, estudioDaRodada } from "./fixture-de-teste.mjs";
import { criarMediaPendente, confirmarMedia } from "../src/lib/medias.ts";

exigirBancoDeTeste();

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

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const LOTE_A = "11111111-1111-4111-8111-111111111111";
const LOTE_B = "22222222-2222-4222-8222-222222222222";

try {
  const est = await estudioDaRodada(db);
  const g = await galeriaDaRodada(db, { nome: "ordem-envio", medias: 0, publicada: true });

  let n = 0;
  const subir = async ({ indice, lote, nome, confirmar = true }) => {
    const chave = `${est.id}/${g.id}/${nome ?? `x${n++}`}.jpg`;
    const m = await criarMediaPendente({
      galeriaId: g.id,
      tenantId: est.id,
      chave,
      chaveThumb: null,
      chavePreview: null,
      nomeOriginal: nome ?? chave,
      tipo: "foto",
      mime: "image/jpeg",
      bytes: 1000,
      largura: 1000,
      altura: 1500,
      indice,
      lote,
    });
    if (confirmar) await confirmarMedia(m.id, est.id, 1000);
    return m;
  };
  const ordemDe = async (id) => {
    const { rows } = await db.query("select ordem from medias where id = $1", [id]);
    return rows[0].ordem;
  };

  await etapa("a galeria vazia começa do zero", async () => {
    const m = await subir({ indice: 0, lote: LOTE_A });
    const o = await ordemDe(m.id);
    if (o !== 0) throw new Error(`primeira foto nasceu na posição ${o}`);
    return "posição 0";
  });

  /*
   * O CORAÇÃO DO DEFEITO, em duas fotos.
   *
   * A primeira já está PRONTA quando a segunda nasce. Antes da migração 038 a
   * base pulava para 1 e a segunda ia para 1 + 1 = 2 — um buraco que, repetido
   * 286 vezes com preparos de durações diferentes, vira a galeria embaralhada.
   */
  await etapa("a base NÃO sobe enquanto o próprio lote fica pronto", async () => {
    const m = await subir({ indice: 1, lote: LOTE_A });
    const o = await ordemDe(m.id);
    if (o !== 1) throw new Error(`o índice 1 do mesmo lote nasceu na posição ${o}, esperava 1`);
    return "índice 1 → posição 1";
  });

  await etapa("um envio NOVO começa depois de tudo que já estava lá", async () => {
    const m = await subir({ indice: 0, lote: LOTE_B });
    const o = await ordemDe(m.id);
    if (o !== 2) throw new Error(`o novo lote começou em ${o}, esperava 2`);
    return "índice 0 do segundo lote → posição 2";
  });

  await etapa("sem lote, a conta é a de sempre — cliente antigo não quebra", async () => {
    const m = await subir({ indice: 0, lote: null });
    const o = await ordemDe(m.id);
    if (o !== 3) throw new Error(`sem lote nasceu em ${o}, esperava 3`);
    return "índice 0 sem lote → posição 3";
  });

  /* ── O ENVIO DE VERDADE, EM MINIATURA ─────────────────────────────────── */

  await etapa("60 arquivos, 4 em paralelo, preparo desigual: a ordem sobrevive", async () => {
    const g2 = await galeriaDaRodada(db, { nome: "ordem-paralelo", medias: 0, publicada: true });
    const LOTE = "33333333-3333-4333-8333-333333333333";
    const N = 60;
    const nomes = Array.from({ length: N }, (_, i) => `foto-${String(i + 1).padStart(3, "0")}.jpg`);

    let proximo = 0;
    const trabalhador = async () => {
      for (;;) {
        const i = proximo++;
        if (i >= N) return;
        /*
         * O PREPARO, que acontece ANTES de a linha nascer: no navegador o
         * arquivo é decodificado e vira miniatura e prévia. Um RAW de 40 MB ou
         * um HEIC levam muito mais que um JPG pequeno — e é por isso que as
         * linhas não nascem na ordem em que os arquivos saíram da fila.
         */
        const lento = i % 7 === 0;
        await new Promise((r) => setTimeout(r, lento ? 120 + Math.random() * 120 : 5 + Math.random() * 15));
        const m = await criarMediaPendente({
          galeriaId: g2.id,
          tenantId: est.id,
          chave: `${est.id}/${g2.id}/${nomes[i]}`,
          chaveThumb: null,
          chavePreview: null,
          nomeOriginal: nomes[i],
          tipo: "foto",
          mime: "image/jpeg",
          bytes: 1000,
          largura: 1000,
          altura: 1500,
          indice: i,
          lote: LOTE,
        });
        await new Promise((r) => setTimeout(r, 5 + Math.random() * 25));
        await confirmarMedia(m.id, est.id, 1000);
      }
    };
    await Promise.all(Array.from({ length: 4 }, trabalhador));

    /* A MESMA ordenação da galeria do cliente e da grade do painel. */
    const { rows } = await db.query(
      "select nome_original from medias where galeria_id = $1 and pronto order by ordem, criado_em",
      [g2.id],
    );
    const veio = rows.map((r) => r.nome_original);
    const fora = veio.filter((nome, i) => nome !== nomes[i]).length;
    if (fora > 0) {
      const primeiro = veio.findIndex((nome, i) => nome !== nomes[i]);
      throw new Error(
        `${fora} de ${N} fora do lugar — na posição ${primeiro} veio "${veio[primeiro]}", esperava "${nomes[primeiro]}"`,
      );
    }
    return `${N} arquivos, nenhum fora do lugar`;
  });
} finally {
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ a ordem do envio tem problema");
  process.exit(1);
}
console.log("\n✓ a ordem que o fotógrafo escolheu é a ordem que o casal recebe");
