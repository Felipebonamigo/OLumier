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

  /*
   * ── O CASO QUE O TESTE DE CIMA NÃO PEGA (23/09/2026) ────────────────────
   *
   * Juan, quatro dias depois da migração 038: "as fotos não estão sendo
   * apresentadas em ordem. Minha cópia PB da foto é depois da versão colorida,
   * mas tá sendo mostrada antes" — a MESMA frase de antes do conserto.
   *
   * O teste de cima sobe um lote só e sai limpo. Falta o que o fotógrafo faz
   * de verdade numa entrega grande: soltar a segunda pasta assim que a primeira
   * PARECE ter acabado. A fila esvazia, o `loteAtual` zera, o lote novo nasce —
   * e algumas linhas do lote anterior ainda não ficaram `pronto`, porque o
   * confirmar é uma segunda ida ao servidor depois do arquivo subir.
   *
   * A base do lote novo é `max(ordem)` entre as PRONTAS de outros lotes. Se a
   * cauda do lote anterior ainda não entrou nessa conta, o lote novo começa em
   * cima dela — e as duas metades se intercalam.
   *
   * É exatamente o sintoma da preto-e-branco: ela é o arquivo menor, sobe e
   * confirma antes, e a colorida que vinha antes dela na lista chega depois.
   */
  await etapa("segunda pasta solta com a cauda da primeira ainda pendente", async () => {
    const g3 = await galeriaDaRodada(db, { nome: "ordem-duas-pastas", medias: 0, publicada: true });
    const LOTE_1 = "44444444-4444-4444-8444-444444444444";
    const LOTE_2 = "55555555-5555-4555-8555-555555555555";
    const N = 20;

    const nome = (lote, i) => `pasta${lote}-${String(i + 1).padStart(3, "0")}.jpg`;
    const subirEm = async (lote, i) =>
      criarMediaPendente({
        galeriaId: g3.id,
        tenantId: est.id,
        chave: `${est.id}/${g3.id}/${nome(lote, i)}`,
        chaveThumb: null,
        chavePreview: null,
        nomeOriginal: nome(lote, i),
        tipo: "foto",
        mime: "image/jpeg",
        bytes: 1000,
        largura: 1000,
        altura: 1500,
        indice: i,
        lote: lote === 1 ? LOTE_1 : LOTE_2,
      });

    /* Primeira pasta inteira, mas só as 17 primeiras confirmam: as três
       últimas ficam penduradas, que é o estado real de um envio que "acabou"
       na tela um instante antes de acabar no servidor. */
    const primeira = [];
    for (let i = 0; i < N; i++) primeira.push(await subirEm(1, i));
    for (let i = 0; i < N - 3; i++) await confirmarMedia(primeira[i].id, est.id, 1000);

    /* Agora a segunda pasta, com o lote novo. */
    const segunda = [];
    for (let i = 0; i < N; i++) segunda.push(await subirEm(2, i));

    /* E a cauda da primeira enfim confirma. */
    for (let i = N - 3; i < N; i++) await confirmarMedia(primeira[i].id, est.id, 1000);
    for (const m of segunda) await confirmarMedia(m.id, est.id, 1000);

    const { rows } = await db.query(
      "select nome_original from medias where galeria_id = $1 and pronto order by ordem, criado_em",
      [g3.id],
    );
    const veio = rows.map((r) => r.nome_original);
    const esperado = [
      ...Array.from({ length: N }, (_, i) => nome(1, i)),
      ...Array.from({ length: N }, (_, i) => nome(2, i)),
    ];
    const fora = veio.filter((n, i) => n !== esperado[i]).length;
    if (fora > 0) {
      const p = veio.findIndex((n, i) => n !== esperado[i]);
      throw new Error(
        `${fora} de ${esperado.length} fora do lugar — na posição ${p} veio "${veio[p]}", esperava "${esperado[p]}"`,
      );
    }
    return `${esperado.length} arquivos em duas pastas, nenhum fora do lugar`;
  });

  /*
   * ── DOIS ENVIOS AO MESMO TEMPO (02/10/2026, migração 061) ───────────────
   *
   * Equipe da Carol Tedesco, subindo de novo a cerimônia: "na pasta do note tá
   * em ordem, mas no link tá subindo desorganizado".
   *
   * As etapas de cima têm UM envio de cada vez. Com dois rodando na mesma
   * galeria — duas abas, dois computadores da equipe, o envio que parecia
   * parado e continuava —, a base de cada um era "o maior `ordem` de fora do
   * lote", refeita a cada arquivo: cada linha de um empurrava a base do
   * outro. Antes da 061 esta etapa dava 139 de 150 fora do lugar num capítulo
   * e 142 no outro — em capítulos DIFERENTES. As duas seguintes davam 153 de
   * 160 e 56 de 60.
   */
  const secaoNova = async (galeriaId, nome) =>
    (await db.query("insert into secoes (galeria_id, nome, ordem) values ($1, $2, 0) returning id", [galeriaId, nome]))
      .rows[0].id;
  const doCapitulo = async (galeriaId, secaoId) =>
    (
      await db.query(
        "select nome_original from medias where galeria_id = $1 and secao_id = $2 and pronto order by ordem, criado_em",
        [galeriaId, secaoId],
      )
    ).rows.map((r) => r.nome_original);
  /* O envio do navegador em miniatura: seis no ar, preparo desigual. */
  const enviar = async (galeriaId, { nomes, indices, lote, secaoId, ate }) => {
    let proximo = 0;
    const trabalhador = async () => {
      for (;;) {
        const k = proximo++;
        if (k >= nomes.length) return;
        await new Promise((r) => setTimeout(r, k % 7 === 0 ? 60 + Math.random() * 120 : 3 + Math.random() * 20));
        const m = await criarMediaPendente({
          galeriaId,
          tenantId: est.id,
          chave: `${est.id}/${galeriaId}/${lote}/${nomes[k]}`,
          chaveThumb: null,
          chavePreview: null,
          nomeOriginal: nomes[k],
          tipo: "foto",
          mime: "image/jpeg",
          bytes: 1000,
          largura: 1000,
          altura: 1500,
          secaoId,
          indice: indices[k],
          lote,
          ate,
        });
        await new Promise((r) => setTimeout(r, 5 + Math.random() * 30));
        await confirmarMedia(m.id, est.id, 1000);
      }
    };
    await Promise.all(Array.from({ length: 6 }, trabalhador));
  };
  const nomesDe = (prefixo, n) => Array.from({ length: n }, (_, i) => `${prefixo}-${String(i + 1).padStart(4, "0")}.jpg`);
  const foraDoLugar = (veio, esperado) => veio.filter((n, i) => n !== esperado[i]).length;

  await etapa("dois envios ao mesmo tempo, capítulos diferentes: cada um na ordem da pasta", async () => {
    const g4 = await galeriaDaRodada(db, { nome: "ordem-dois-envios", medias: 0, publicada: true });
    const cer = await secaoNova(g4.id, "Cerimônia");
    const fes = await secaoNova(g4.id, "Festa");
    const nc = nomesDe("cer", 150);
    const nf = nomesDe("fes", 150);
    await Promise.all([
      enviar(g4.id, { nomes: nc, indices: nc.map((_, i) => i), lote: crypto.randomUUID(), secaoId: cer, ate: 150 }),
      enviar(g4.id, { nomes: nf, indices: nf.map((_, i) => i), lote: crypto.randomUUID(), secaoId: fes, ate: 150 }),
    ]);
    const a = foraDoLugar(await doCapitulo(g4.id, cer), nc);
    const b = foraDoLugar(await doCapitulo(g4.id, fes), nf);
    if (a + b > 0) throw new Error(`cerimônia: ${a} de 150 fora do lugar; festa: ${b} de 150`);
    return "150 + 150, nenhum fora do lugar";
  });

  await etapa("dois envios para o MESMO capítulo: o segundo vem inteiro depois do primeiro", async () => {
    const g5 = await galeriaDaRodada(db, { nome: "ordem-mesmo-capitulo", medias: 0, publicada: true });
    const cap = await secaoNova(g5.id, "Cerimônia");
    const n1 = nomesDe("parte1", 80);
    const n2 = nomesDe("parte2", 80);
    const primeiro = enviar(g5.id, { nomes: n1, indices: n1.map((_, i) => i), lote: crypto.randomUUID(), secaoId: cap, ate: 80 });
    /* O segundo sai quando o primeiro já está no ar. */
    await new Promise((r) => setTimeout(r, 40));
    await Promise.all([
      primeiro,
      enviar(g5.id, { nomes: n2, indices: n2.map((_, i) => i), lote: crypto.randomUUID(), secaoId: cap, ate: 80 }),
    ]);
    const fora = foraDoLugar(await doCapitulo(g5.id, cap), [...n1, ...n2]);
    if (fora > 0) throw new Error(`${fora} de 160 fora do lugar — as duas partes se intercalaram`);
    return "parte 1 inteira, depois a parte 2";
  });

  await etapa("reenviar as que falharam, depois de outro envio: cada uma volta ao seu lugar", async () => {
    const g6 = await galeriaDaRodada(db, { nome: "ordem-reenviar", medias: 0, publicada: true });
    const cer = await secaoNova(g6.id, "Cerimônia");
    const fes = await secaoNova(g6.id, "Festa");
    const nc = nomesDe("cer", 60);
    const LOTE_CER = crypto.randomUUID();
    const falharam = new Set([3, 17, 18, 40, 59]);
    const subiram = nc.filter((_, i) => !falharam.has(i));
    await enviar(g6.id, { nomes: subiram, indices: subiram.map((n) => nc.indexOf(n)), lote: LOTE_CER, secaoId: cer, ate: 60 });
    /* Outro envio passa na frente... */
    const nf = nomesDe("fes", 40);
    await enviar(g6.id, { nomes: nf, indices: nf.map((_, i) => i), lote: crypto.randomUUID(), secaoId: fes, ate: 40 });
    /* ...e só então "reenviar as que falharam" — mesmo lote, mesmos índices. */
    const voltam = nc.filter((_, i) => falharam.has(i));
    await enviar(g6.id, { nomes: voltam, indices: voltam.map((n) => nc.indexOf(n)), lote: LOTE_CER, secaoId: cer });
    const fora = foraDoLugar(await doCapitulo(g6.id, cer), nc);
    if (fora > 0) throw new Error(`${fora} de 60 fora do lugar`);
    return "as 5 voltaram para o meio, onde estavam na pasta";
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
