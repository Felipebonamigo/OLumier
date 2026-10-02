#!/usr/bin/env node
/**
 * O QUE FALTAVA DA PASTA VOLTA PARA O MEIO DELA. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-encaixe-da-pasta.mjs
 *
 * Equipe da Carol Tedesco, 02/10/2026, mandando de novo a cerimônia: "na pasta
 * do note tá em ordem, mas no link tá subindo desorganizado".
 *
 * Mandar a mesma pasta de novo — depois do envio que travou, da página que
 * recarregou, das fotos que desistiram — sobe só as que faltam. Cada uma
 * nascia depois de tudo o que a galeria já tinha: a foto 37 chegava depois da
 * 412. A regra do encaixe mora em `lib/encaixe-da-pasta.ts`; a primeira parte
 * deste arquivo a prende sem banco, a segunda faz o envio de verdade.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada, estudioDaRodada } from "./fixture-de-teste.mjs";
import { encaixarNaPasta } from "../src/lib/encaixe-da-pasta.ts";
import { criarMediaPendente, confirmarMedia, encaixarNaOrdemDaPasta } from "../src/lib/medias.ts";

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

const foto = (n) => `cer-${String(n).padStart(3, "0")}.jpg`;
const pastaDe = (ns, bytes = 1000) => ns.map((n) => ({ nome: foto(n), bytes }));
/** Aplica as mudanças e devolve os nomes na ordem que a galeria mostraria. */
const depois = (linhas, mudam) => {
  const nova = new Map(mudam.map((m) => [m.id, m.ordem]));
  return linhas
    .map((l, i) => ({ ...l, ordem: nova.get(l.id) ?? l.ordem, i }))
    .sort((a, b) => a.ordem - b.ordem || a.i - b.i)
    .map((l) => l.nome);
};
const linha = (nome, ordem, doEnvio, bytes = 1000) => ({ id: `${nome}@${ordem}`, nome, bytes, ordem, doEnvio });
const igual = (veio, esperado) => {
  if (veio.join() !== esperado.join()) throw new Error(`veio ${veio.join(" ")}\n      esperava ${esperado.join(" ")}`);
};

console.log("O encaixe na ordem da pasta — a regra\n");

await etapa("as que faltavam voltam para o meio, nas posições que já existiam", async () => {
  const antigas = [1, 2, 4, 5, 6, 8, 9, 10].map((n, i) => linha(foto(n), i, false));
  const novas = [linha(foto(3), 20, true), linha(foto(7), 21, true)];
  const linhas = [...antigas, ...novas];
  const mudam = encaixarNaPasta(linhas, pastaDe([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  igual(depois(linhas, mudam), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(foto));
  const usadas = [...new Set([...linhas.map((l) => l.ordem)])].sort((a, b) => a - b).join();
  const novasPosicoes = [...linhas.map((l) => mudam.find((m) => m.id === l.id)?.ordem ?? l.ordem)].sort((a, b) => a - b).join();
  if (usadas !== novasPosicoes) throw new Error("usou posições que o capítulo não tinha");
  return `${mudam.length} mudaram de lugar, nenhuma posição nova`;
});

await etapa("foto que não é da pasta fica onde está", async () => {
  const linhas = [
    linha(foto(1), 0, false),
    linha("abertura.jpg", 1, false),
    linha(foto(3), 2, false),
    linha(foto(2), 9, true),
  ];
  const mudam = encaixarNaPasta(linhas, pastaDe([1, 2, 3]));
  if (mudam.some((m) => m.id.startsWith("abertura"))) throw new Error("mexeu na foto de fora da pasta");
  igual(depois(linhas, mudam), [foto(1), "abertura.jpg", foto(2), foto(3)]);
});

await etapa("o capítulo arrumado à mão não é desfeito pelo envio", async () => {
  /* O fotógrafo pôs a 5 na frente de propósito. */
  const linhas = [
    linha(foto(5), 0, false),
    linha(foto(1), 1, false),
    linha(foto(2), 2, false),
    linha(foto(4), 3, false),
    linha(foto(3), 10, true),
  ];
  const mudam = encaixarNaPasta(linhas, pastaDe([1, 2, 3, 4, 5]));
  if (mudam.length) throw new Error(`mexeu em ${mudam.length}`);
});

await etapa("envio novo (nada da pasta estava lá) não muda nada", async () => {
  const linhas = [3, 1, 2].map((n, i) => linha(foto(n), i, true));
  if (encaixarNaPasta(linhas, pastaDe([1, 2, 3])).length) throw new Error("mexeu num envio novo");
});

await etapa("\"Enviar mesmo assim\": a cópia cai do lado da antiga", async () => {
  const linhas = [
    linha(foto(1), 0, false),
    linha(foto(2), 1, false),
    linha(foto(1), 5, true),
    linha(foto(2), 6, true),
    linha(foto(3), 7, true),
  ];
  const mudam = encaixarNaPasta(linhas, pastaDe([1, 2, 3]));
  igual(depois(linhas, mudam), [1, 1, 2, 2, 3].map(foto));
});

await etapa("mesmo nome com OUTRO tamanho é outra foto; caixa não importa", async () => {
  const linhas = [
    linha("CER-001.JPG", 0, false),
    linha(foto(3), 1, false),
    linha(foto(2), 5, true, 2222),
  ];
  /* A 2 da pasta tem 1000 bytes; a que subiu tem 2222 — não é a mesma. */
  if (encaixarNaPasta(linhas, pastaDe([1, 2, 3])).length) throw new Error("encaixou foto de outro tamanho");
  const mudam = encaixarNaPasta(linhas, [
    { nome: "cer-001.jpg", bytes: 1000 },
    { nome: foto(2), bytes: 2222 },
    { nome: foto(3), bytes: 1000 },
  ]);
  igual(depois(linhas, mudam), ["CER-001.JPG", foto(2), foto(3)]);
});

await etapa("posição repetida (galeria antiga): o capítulo é renumerado em sequência", async () => {
  const linhas = [
    linha(foto(1), 4, false),
    linha(foto(2), 4, false),
    linha(foto(4), 5, false),
    linha(foto(3), 9, true),
  ];
  const mudam = encaixarNaPasta(linhas, pastaDe([1, 2, 3, 4]));
  const nova = new Map(mudam.map((m) => [m.id, m.ordem]));
  const ordens = linhas.map((l) => nova.get(l.id) ?? l.ordem);
  if (new Set(ordens).size !== ordens.length) throw new Error(`continuou repetida: ${ordens.join()}`);
  igual(depois(linhas, mudam), [1, 2, 3, 4].map(foto));
});

console.log("\nO encaixe na ordem da pasta — o envio de verdade\n");

exigirBancoDeTeste();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  const est = await estudioDaRodada(db);
  const g = await galeriaDaRodada(db, { nome: "encaixe-da-pasta", medias: 0, publicada: true });
  const secao = async (nome) =>
    (await db.query("insert into secoes (galeria_id, nome, ordem) values ($1, $2, 0) returning id", [g.id, nome])).rows[0]
      .id;
  const cer = await secao("Cerimônia");
  const fes = await secao("Festa");
  const doCapitulo = async (s) =>
    (
      await db.query(
        "select nome_original from medias where galeria_id = $1 and secao_id = $2 and pronto order by ordem, criado_em",
        [g.id, s],
      )
    ).rows.map((r) => r.nome_original);
  const subir = async (nome, secaoId, indice, lote, ate) => {
    const m = await criarMediaPendente({
      galeriaId: g.id,
      tenantId: est.id,
      chave: `${est.id}/${g.id}/${lote}/${nome}`,
      chaveThumb: null,
      chavePreview: null,
      nomeOriginal: nome,
      tipo: "foto",
      mime: "image/jpeg",
      bytes: 1000,
      largura: 1000,
      altura: 1500,
      secaoId,
      indice,
      lote,
      ate,
    });
    await confirmarMedia(m.id, est.id, 1000);
  };

  const pasta = Array.from({ length: 60 }, (_, i) => foto(i + 1));
  const falharam = new Set([2, 13, 14, 37, 59]);

  await etapa("a cerimônia mandada de novo fica na ordem da pasta", async () => {
    /* Primeiro envio: cinco desistiram, espalhadas. */
    const L1 = crypto.randomUUID();
    for (const [i, nome] of pasta.entries()) if (!falharam.has(i)) await subir(nome, cer, i, L1, 60);
    /* A festa sobe depois, inteira. */
    const L2 = crypto.randomUUID();
    for (let i = 0; i < 30; i++) await subir(`fes-${String(i + 1).padStart(3, "0")}.jpg`, fes, i, L2, 30);
    const festaAntes = await doCapitulo(fes);

    /* A pasta da cerimônia, de novo: a pergunta pula as 55 que já estão lá. */
    const L3 = crypto.randomUUID();
    const faltam = pasta.filter((_, i) => falharam.has(i));
    for (const [k, nome] of faltam.entries()) await subir(nome, cer, k, L3, faltam.length);

    const antes = await doCapitulo(cer);
    const foraAntes = antes.filter((n, i) => n !== pasta[i]).length;
    if (foraAntes === 0) throw new Error("o cenário não reproduziu o defeito — as novas já nasceram no lugar");

    const mudaram = await encaixarNaOrdemDaPasta(g.id, est.id, L3, pasta.map((nome) => ({ nome, bytes: 1000 })));
    const veio = await doCapitulo(cer);
    const fora = veio.filter((n, i) => n !== pasta[i]).length;
    if (fora > 0) throw new Error(`${fora} de 60 fora do lugar: ${veio.join(" ")}`);
    if ((await doCapitulo(fes)).join() !== festaAntes.join()) throw new Error("mexeu na festa");
    return `antes ${foraAntes} de 60 fora do lugar; ${mudaram} mudaram, agora nenhuma`;
  });

  await etapa("outro estúdio não encaixa nada nesta galeria", async () => {
    const outro = await db.query("select gen_random_uuid() as id");
    const n = await encaixarNaOrdemDaPasta(g.id, outro.rows[0].id, crypto.randomUUID(), [{ nome: foto(1), bytes: 1000 }]);
    if (n !== 0) throw new Error(`mexeu em ${n}`);
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ o encaixe na ordem da pasta tem problema" : "\n✓ a pasta reenviada fica na ordem dela");
process.exit(falhou ? 1 : 0);
